import { initI18n, applyTranslations, t } from '../i18n.js';
      import { setupDashboard, toast } from '../portal-ui.js';
      import { getProperty, createProperty, updateProperty, logActivity } from '../db.js';
      import { uploadToStorage, getPublicUrl } from '../storage.js';
      import { escapeHtml, OMR_SYMBOL_SVG, localize } from '../ui.js?v=2';

      initI18n();

      const symbolSlot = document.getElementById('priceSymbolSlot');
      if (symbolSlot && OMR_SYMBOL_SVG) symbolSlot.innerHTML = OMR_SYMBOL_SVG;

      const id    = new URLSearchParams(location.search).get('id');
      const mode  = id ? 'edit' : 'create';
      const form  = document.getElementById('propForm');
      const errorEl   = document.getElementById('formError');
      const saveBtn   = document.getElementById('saveBtn');
      const saveLabel = document.getElementById('saveLabel');
      let currentUserId = null;

      document.getElementById('pageTitle').textContent =
        mode === 'create' ? 'إضافة عقار جديد' : 'تعديل بيانات العقار';

      /* ═══════════════════ KML Parser ═══════════════════ */

      let kmlBoundary  = null;   // {type:'polygon', points:[{lat,lng},...]} — Firestore-safe (no nested arrays)
      let kmlCentroid  = null;   // {lat, lng} — centroid / point

      function parseKmlCoordText(text) {
        return text.trim().split(/\s+/).map(s => {
          const p = s.split(',');
          if (p.length < 2) return null;
          const lng = parseFloat(p[0]);
          const lat = parseFloat(p[1]);
          return (isFinite(lat) && isFinite(lng)) ? { lat, lng } : null;
        }).filter(Boolean);
      }

      function calcCentroid(pts) {
        return {
          lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
          lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
        };
      }

      function polygonAreaM2(pts) {
        let area = 0;
        const n = pts.length;
        const mLat = 111320;
        const cLat = pts.reduce((s, p) => s + p.lat, 0) / n;
        const mLng = mLat * Math.cos(cLat * Math.PI / 180);
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          area += pts[i].lng * mLng * pts[j].lat * mLat;
          area -= pts[j].lng * mLng * pts[i].lat * mLat;
        }
        return Math.abs(area / 2);
      }

      function fmtArea(m2) {
        if (m2 >= 1e6) return (m2 / 1e6).toFixed(3) + ' كم²';
        return m2.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' م²';
      }

      async function parseKmlFile(file) {
        const text = await file.text();
        const xml = new DOMParser().parseFromString(text, 'text/xml');
        if (xml.querySelector('parsererror')) throw new Error('ملف KML غير صالح');

        // Firestore boundary format: {type:'polygon', points:[{lat,lng},...]}
        // (avoids nested arrays which Firestore forbids)

        // 1. Try Polygon
        const polyEls = xml.querySelectorAll(
          'Polygon outerBoundaryIs LinearRing coordinates, Polygon LinearRing coordinates, Polygon coordinates'
        );
        for (const el of polyEls) {
          const pts = parseKmlCoordText(el.textContent);
          if (pts.length >= 3) {
            const boundary = { type: 'polygon', points: pts };
            return { boundary, centroid: calcCentroid(pts), pointCount: pts.length, area: polygonAreaM2(pts), type: 'polygon' };
          }
        }

        // 2. Try MultiGeometry / LineString as polygon approximation
        const lineEls = xml.querySelectorAll('LinearRing coordinates, LineString coordinates');
        for (const el of lineEls) {
          const pts = parseKmlCoordText(el.textContent);
          if (pts.length >= 3) {
            const boundary = { type: 'polygon', points: pts };
            return { boundary, centroid: calcCentroid(pts), pointCount: pts.length, area: polygonAreaM2(pts), type: 'polygon' };
          }
        }

        // 3. Try Point
        const ptEl = xml.querySelector('Point coordinates');
        if (ptEl) {
          const pts = parseKmlCoordText(ptEl.textContent);
          if (pts.length > 0) return { boundary: null, centroid: pts[0], pointCount: 1, area: 0, type: 'point' };
        }

        throw new Error('لم يتم العثور على إحداثيات صالحة في ملف KML');
      }

      /* ─── KML UI ─── */

      const kmlDropZone  = document.getElementById('kmlDropZone');
      const kmlFileInput = document.getElementById('kmlFileInput');
      const kmlStatusEl  = document.getElementById('kmlStatus');

      function showKmlStatus(type, title, meta, fileName) {
        kmlDropZone.style.display = 'none';
        kmlStatusEl.style.display = 'block';
        kmlStatusEl.innerHTML = `
          <div class="kml-status ${type}">
            <div style="flex-shrink:0;margin-top:.1rem">
              ${type === 'success'
                ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
                : type === 'loading'
                  ? '<span class="spinner" style="width:1rem;height:1rem;border-width:2px"></span>'
                  : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
              }
            </div>
            <div class="kml-status-body">
              <p class="kml-status-title">${escapeHtml(title)}</p>
              ${meta ? `<p class="kml-status-meta">${escapeHtml(meta)}</p>` : ''}
              ${fileName ? `<p class="kml-status-meta" style="margin-top:.2rem;font-family:monospace;font-size:.75rem">${escapeHtml(fileName)}</p>` : ''}
              ${type !== 'loading' ? `<button type="button" class="kml-replace-btn" id="kmlReplaceBtn">استبدال الملف</button>` : ''}
            </div>
          </div>
        `;
        document.getElementById('kmlReplaceBtn')?.addEventListener('click', () => {
          kmlBoundary = null;
          kmlCentroid = null;
          kmlStatusEl.style.display = 'none';
          kmlDropZone.style.display = '';
        });
      }

      async function handleKmlFile(file) {
        showKmlStatus('loading', 'جاري تحليل ملف KML…', null, file.name);
        try {
          const result = await parseKmlFile(file);
          kmlBoundary = result.boundary;
          kmlCentroid = result.centroid;
          if (result.type === 'polygon') {
            const areaTxt = result.area > 0 ? ` · المساحة: ${fmtArea(result.area)}` : '';
            showKmlStatus(
              'success',
              'تم استخراج حدود العقار بنجاح ✓',
              `${result.pointCount} نقطة حدود${areaTxt}`,
              file.name
            );
          } else {
            showKmlStatus(
              'success',
              'تم استخراج موقع العقار (نقطة) ✓',
              `خط العرض: ${result.centroid.lat.toFixed(6)} · خط الطول: ${result.centroid.lng.toFixed(6)}`,
              file.name
            );
          }
        } catch (err) {
          kmlBoundary = null;
          kmlCentroid = null;
          showKmlStatus('error', 'فشل قراءة ملف KML', err.message, file.name);
        }
      }

      kmlDropZone.addEventListener('click', () => kmlFileInput.click());
      kmlDropZone.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') kmlFileInput.click();
      });
      kmlDropZone.addEventListener('dragover', e => {
        e.preventDefault(); kmlDropZone.classList.add('drag-over');
      });
      kmlDropZone.addEventListener('dragleave', () => kmlDropZone.classList.remove('drag-over'));
      kmlDropZone.addEventListener('drop', e => {
        e.preventDefault();
        kmlDropZone.classList.remove('drag-over');
        const f = e.dataTransfer.files[0];
        if (f) handleKmlFile(f);
      });
      kmlFileInput.addEventListener('change', e => {
        const f = e.target.files[0];
        if (f) handleKmlFile(f);
        e.target.value = '';
      });

      /* ═══════════════════ Media Uploader ═══════════════════ */

      let images = [];
      const uploaderRoot = document.getElementById('mediaUploader');
      const fileInput = document.createElement('input');
      fileInput.type = 'file'; fileInput.accept = 'image/*,video/*';
      fileInput.multiple = true; fileInput.style.display = 'none';
      uploaderRoot.appendChild(fileInput);
      const uploadErrEl = document.getElementById('uploadError');

      function renderUploader(busy = false, progress = 0) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:1rem';
        const grid = document.createElement('div');
        grid.className = 'uploader-grid';
        grid.innerHTML = images.map(url => `
          <div class="uploader-tile">
            <img src="${escapeHtml(url)}" alt="" loading="lazy" />
            <button type="button" class="remove" data-url="${escapeHtml(url)}" aria-label="حذف">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>`).join('');
        if (images.length < 15) {
          grid.innerHTML += `
            <button type="button" class="uploader-add" id="uploadAddBtn" ${busy ? 'disabled' : ''}>
              ${busy
                ? `<span class="spinner"></span><span style="font-size:.8rem">${progress}%</span>`
                : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                   <span style="font-size:.8rem">إضافة صورة</span>`}
            </button>`;
        }
        const meta = document.createElement('p');
        meta.className = 'uploader-meta';
        meta.innerHTML = `${images.length}/15 صورة · JPG أو PNG`;
        wrap.appendChild(grid);
        wrap.appendChild(meta);
        Array.from(uploaderRoot.children).forEach(c => { if (c !== fileInput) c.remove(); });
        uploaderRoot.appendChild(wrap);
        grid.querySelectorAll('.remove').forEach(btn => {
          btn.addEventListener('click', () => { images = images.filter(x => x !== btn.dataset.url); renderUploader(); });
        });
        grid.querySelector('#uploadAddBtn')?.addEventListener('click', () => fileInput.click());
      }

      fileInput.addEventListener('change', async e => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        uploadErrEl.classList.remove('visible');
        for (let i = 0; i < files.length && images.length < 15; i++) {
          try {
            renderUploader(true, 0);
            const result = await uploadToStorage(files[i], 'land-images', {
              onProgress: pct => renderUploader(true, Math.round(pct)),
            });
            const url = getPublicUrl('land-images', result.path);
            if (url) images.push(url);
          } catch (err) {
            uploadErrEl.textContent = 'فشل رفع الملف: ' + err.message;
            uploadErrEl.classList.add('visible'); break;
          }
        }
        fileInput.value = '';
        renderUploader();
      });

      renderUploader();

      /* ═══════════════════ Load Existing ═══════════════════ */

      async function loadExisting() {
        if (!id) return;
        const p = await getProperty(id);
        if (!p) return;

        document.getElementById('fTitle').value    = localize(p.title) || '';
        document.getElementById('fDesc').value     = localize(p.description) || '';
        document.getElementById('fNotes').value    = p.notes || '';
        document.getElementById('fKind').value     = p.kind     || 'property';
        document.getElementById('fCategory').value = p.category || 'residential';
        document.getElementById('fStatus').value   = p.status   || 'available';
        document.getElementById('fArea').value     = p.area ?? p.areaSize ?? '';
        document.getElementById('fLocation').value = localize(p.location) || p.region || '';
        document.getElementById('fPrice').value    = p.price ?? '';
        document.getElementById('fMapUrl').value   = p.locationUrl || p.mapUrl || '';
        if (p.coordinates?.lat != null) document.getElementById('fLat').value = p.coordinates.lat;
        if (p.coordinates?.lng != null) document.getElementById('fLng').value = p.coordinates.lng;
        images = (p.images || []).slice();
        renderUploader();

        // Restore boundary from existing property
        if (p.boundary && p.boundary.points) {
          kmlBoundary = p.boundary;
          kmlCentroid = p.coordinates || null;
          const ptCount = p.boundary.points.length;
          showKmlStatus('success', 'تم تحميل حدود العقار ✓', `${ptCount} نقطة حدود محفوظة مسبقاً`, '');
        } else if (p.coordinates) {
          kmlCentroid = p.coordinates;
          showKmlStatus(
            'success', 'موقع العقار محدد ✓',
            `خط العرض: ${p.coordinates.lat.toFixed(6)} · خط الطول: ${p.coordinates.lng.toFixed(6)}`,
            ''
          );
        }
      }

      /* ═══════════════════ Form Submit ═══════════════════ */

      form.addEventListener('submit', async e => {
        e.preventDefault();
        errorEl.classList.remove('visible');

        const title = document.getElementById('fTitle').value.trim();
        if (!title) {
          document.getElementById('fTitle').focus();
          errorEl.textContent = 'يرجى إدخال اسم العقار.';
          errorEl.classList.add('visible');
          return;
        }

        saveBtn.disabled = true;
        saveLabel.textContent = 'جاري الحفظ…';

        try {
          const description = document.getElementById('fDesc').value.trim();
          const notes = document.getElementById('fNotes').value.trim();
          const locationUrl = document.getElementById('fMapUrl').value.trim();
          const location = document.getElementById('fLocation').value.trim();
          const area  = parseFloat(document.getElementById('fArea').value)  || 0;
          const price = parseFloat(document.getElementById('fPrice').value) || 0;

          const payload = {
            title,
            kind:     document.getElementById('fKind').value,
            category: document.getElementById('fCategory').value,
            status:   document.getElementById('fStatus').value,
            area,
            price,
            currency: 'OMR',
            images,
          };
          if (description) payload.description = description;
          if (notes) payload.notes = notes;
          else payload.notes = null;
          if (location) payload.location = location;
          else payload.location = null;
          if (locationUrl) payload.locationUrl  = locationUrl;
          const manualLat = parseFloat(document.getElementById('fLat').value);
          const manualLng = parseFloat(document.getElementById('fLng').value);
          if (kmlBoundary) payload.boundary     = kmlBoundary;
          if (kmlCentroid) payload.coordinates  = kmlCentroid;
          else if (isFinite(manualLat) && isFinite(manualLng)) payload.coordinates = { lat: manualLat, lng: manualLng };

          // Clean undefined
          Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

          let savedId = id;
          if (mode === 'create') {
            payload.createdBy = currentUserId;
            savedId = await createProperty(payload);
          } else {
            await updateProperty(id, payload);
          }

          try {
            await logActivity({
              action: mode === 'create' ? 'created' : 'updated',
              targetType: 'property',
              targetId: savedId,
              userId: currentUserId,
              meta: { title },
            });
          } catch {}

          toast(mode === 'create' ? 'تم إضافة العقار ✓' : 'تم حفظ التعديلات ✓');
          setTimeout(() => window.location.replace('properties.html'), 600);

        } catch (err) {
          errorEl.textContent = err.message || 'حدث خطأ أثناء الحفظ.';
          errorEl.classList.add('visible');
          saveBtn.disabled = false;
          saveLabel.textContent = 'حفظ العقار';
        }
      });

      function parseGoogleMapsCoords(url) {
        if (!url) return null;
        
        // Format 1: @lat,lng
        const regexAt = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
        const matchAt = url.match(regexAt);
        if (matchAt) {
          return { lat: parseFloat(matchAt[1]), lng: parseFloat(matchAt[2]) };
        }
        
        // Format 2: place/lat,lng or place/lat+lng
        const regexPlace = /place\/(-?\d+\.\d+)[,+](-?\d+\.\d+)/;
        const matchPlace = url.match(regexPlace);
        if (matchPlace) {
          return { lat: parseFloat(matchPlace[1]), lng: parseFloat(matchPlace[2]) };
        }
        
        // Format 3: q=lat,lng or ll=lat,lng query params
        try {
          const urlObj = new URL(url);
          const q = urlObj.searchParams.get("q") || urlObj.searchParams.get("ll");
          if (q) {
            const parts = q.split(",");
            if (parts.length >= 2) {
              const lat = parseFloat(parts[0]);
              const lng = parseFloat(parts[1]);
              if (!isNaN(lat) && !isNaN(lng)) {
                return { lat, lng };
              }
            }
          }
        } catch (e) {
          const regexQuery = /[?&](q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/;
          const matchQuery = url.match(regexQuery);
          if (matchQuery) {
            return { lat: parseFloat(matchQuery[2]), lng: parseFloat(matchQuery[3]) };
          }
        }
        
        // Format 4: general fallback
        const regexGeneral = /\/(-?\d+\.\d+),(-?\d+\.\d+)/;
        const matchGeneral = url.match(regexGeneral);
        if (matchGeneral) {
          return { lat: parseFloat(matchGeneral[1]), lng: parseFloat(matchGeneral[2]) };
        }

        return null;
      }

      document.getElementById('fMapUrl').addEventListener('input', e => {
        const url = e.target.value.trim();
        const coords = parseGoogleMapsCoords(url);
        if (coords) {
          document.getElementById('fLat').value = coords.lat;
          document.getElementById('fLng').value = coords.lng;
          toast('تم استخراج الإحداثيات تلقائياً ✓');
        }
      });

      /* ═══════════════════ Bootstrap ═══════════════════ */

      (async () => {
        try {
          const ctx = await setupDashboard('properties.html', {
            require: mode === 'create' ? 'properties.create' : 'properties.edit',
          });
          currentUserId = ctx.user.uid;
        } catch (err) {
          const silent = ['not signed in', 'no access', 'permission denied'];
          if (!silent.includes(err.message)) console.error('[property-edit]', err);
          return;
        }
        applyTranslations();
        await loadExisting();
      })();