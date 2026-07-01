import {
      initI18n,
      applyTranslations,
      onLangChange,
    } from "../i18n.js";
    import { setupDashboard, toast } from "../portal-ui.js";
    import { getProperty, listPropertyDocs, approveProperty, logActivity } from "../db.js";
    import {
      priceHtml,
      statusLabel,
      typeLabel,
      categoryLabel,
      escapeHtml,
      localize,
      localizeTags,
      formatArea,
      formatDate,
      googleMapsEmbedUrl,
    } from "../ui.js?v=2";

    initI18n();

    const id = new URLSearchParams(location.search).get("id");

    /* ── helpers ── */
    function docTypeLabel(type) {
      return { deed: "صك ملكية", plan: "مخطط", other: "مرفق" }[type] ?? "مرفق";
    }
    function fmtBytes(n) {
      if (!n) return "";
      if (n < 1024) return `${n} B`;
      if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
      return `${(n / 1_048_576).toFixed(1)} MB`;
    }

    /* ── Gallery ── */
    function renderGallery(images) {
      const main = document.getElementById("pvGalleryMain");
      const thumbs = document.getElementById("pvThumbs");
      if (!images?.length) return;

      function show(i) {
        main.innerHTML = `<img src="${escapeHtml(images[i])}" alt="">`;
        thumbs
          .querySelectorAll(".pv-thumb")
          .forEach((el, j) => el.classList.toggle("active", j === i));
      }

      if (images.length === 1) {
        main.innerHTML = `<img src="${escapeHtml(images[0])}" alt="">`;
        return;
      }

      thumbs.innerHTML = images
        .map(
          (url, i) =>
            `<img class="pv-thumb${i === 0 ? " active" : ""}" src="${escapeHtml(url)}" data-i="${i}" loading="lazy" alt="">`,
        )
        .join("");

      thumbs.addEventListener("click", (e) => {
        const t = e.target.closest(".pv-thumb");
        if (t) show(Number(t.dataset.i));
      });

      show(0);
    }

    /* ── Map ── */
    function initMap(p) {
      const mapCard = document.getElementById("pvMapCard");
      const container = document.getElementById("pvMap");

      const hasBoundary = !!(p.boundary?.geometry || p.boundary?.points?.length >= 3);
      const hasCoords = p.coordinates && Number.isFinite(p.coordinates.lat);
      const hasMapUrl = (p.mapUrl || "").trim();

      if (!hasBoundary && !hasCoords && !hasMapUrl) return;

      mapCard.classList.remove("hidden");

      if (hasBoundary || hasCoords) {
        const center = hasCoords
          ? [p.coordinates.lat, p.coordinates.lng]
          : [22.5, 57.5];

        const map = L.map(container, {
          center,
          zoom: hasCoords ? 14 : 6,
          zoomControl: true,
          attributionControl: false,
        });

        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 20, crossOrigin: true },
        ).addTo(map);
        L.tileLayer(
          "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 20, pane: "overlayPane", crossOrigin: true },
        ).addTo(map);

        if (hasBoundary) {
          // Convert points format to GeoJSON if needed
          let boundaryGeo = p.boundary;
          if (p.boundary.points && !p.boundary.geometry) {
            const coords = p.boundary.points.map(pt => [pt.lng, pt.lat]);
            const [f, l] = [coords[0], coords[coords.length - 1]];
            if (f[0] !== l[0] || f[1] !== l[1]) coords.push([...f]);
            boundaryGeo = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } };
          }
          const layer = L.geoJSON(boundaryGeo, {
            style: {
              color: "#C6A24F",
              weight: 2.5,
              fillColor: "#C6A24F",
              fillOpacity: 0.2,
            },
          }).addTo(map);
          setTimeout(() => {
            map.invalidateSize();
            try {
              const b = layer.getBounds();
              if (b.isValid())
                map.fitBounds(b, { padding: [28, 28], maxZoom: 18 });
            } catch { }
          }, 150);
        } else {
          L.marker([p.coordinates.lat, p.coordinates.lng]).addTo(map);
          setTimeout(() => {
            map.invalidateSize();
          }, 150);
        }
        return;
      }

      // Fallback: Google Maps embed
      const embedUrl = googleMapsEmbedUrl(hasMapUrl, p.coordinates);
      if (embedUrl) {
        container.innerHTML = `<iframe src="${escapeHtml(embedUrl)}" allowfullscreen loading="lazy"></iframe>`;
      }
    }



    /* ── Render property ── */
    async function render(p) {
      document.title = `${localize(p.title) || "—"} · الملكية للإستثمار`;
      document.getElementById("pvTitle").textContent =
        localize(p.title) || "—";
      document.getElementById("pvEditBtn").href =
        `property-edit.html?id=${encodeURIComponent(p.id)}`;
      document.getElementById("pvPlatformMapBtn").href =
        `map.html?id=${encodeURIComponent(p.id)}`;

      // Badges
      document.getElementById("pvBadges").innerHTML = [
        `<span class="badge badge-${p.status}">${escapeHtml(statusLabel(p.status))}</span>`,
        p.approved === false
          ? `<span class="badge" style="background:#fee2e2;color:#ef4444;">بانتظار الاعتماد</span>`
          : "",
        p.type
          ? `<span class="badge badge-muted">${escapeHtml(typeLabel(p.type))}</span>`
          : "",
        p.category
          ? `<span class="badge badge-muted" style="font-size:.65rem;">${escapeHtml(categoryLabel(p.category))}</span>`
          : "",
        p.featured
          ? `<span class="badge" style="background:#fef3c7;color:#92400e;display:inline-flex;align-items:center;gap:0.25rem;">مميز <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="display:inline-block;vertical-align:middle;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></span>`
          : "",
      ].join("");

      // Approve Button wiring
      const approveBtn = document.getElementById("pvApproveBtn");
      if (approveBtn) {
        if (p.approved === false) {
          approveBtn.classList.remove("hidden");
          approveBtn.onclick = async () => {
            approveBtn.disabled = true;
            try {
              await approveProperty(p.id);
              await logActivity({
                action: 'approved',
                targetType: 'property',
                targetId: p.id,
                userId: currentUserId,
                meta: { title: localize(p.title) },
              });
              toast('تم اعتماد العقار بنجاح ✓');
              setTimeout(() => location.reload(), 600);
            } catch (err) {
              alert(err.message);
              approveBtn.disabled = false;
            }
          };
        } else {
          approveBtn.classList.add("hidden");
        }
      }

      // Price
      const priceEl = document.getElementById("pvPriceEl");
      priceEl.innerHTML = Number.isFinite(p.price)
        ? `<div class="pv-price">${priceHtml(p.price)}</div>`
        : `<p class="pv-no-price">السعر غير محدد</p>`;

      // Specs & Area
      const areaValEl = document.getElementById("pvAreaVal");
      const areaCardSlot = document.getElementById("pvAreaCardSlot");
      if (p.area) {
        areaValEl.textContent = formatArea(p.area, p.areaUnit || p.unit || "m2");
        areaCardSlot.style.display = "flex";
      } else {
        areaCardSlot.style.display = "none";
      }

      const specs = [];
      if (p.bedrooms > 0) specs.push(["الغرف", p.bedrooms]);
      if (p.bathrooms > 0) specs.push(["الحمامات", p.bathrooms]);
      const specsEl = document.getElementById("pvSpecs");
      if (specs.length) {
        specsEl.style.display = "grid";
        specsEl.innerHTML = specs
          .map(
            ([lbl, val]) => `
            <div class="pv-spec">
              <div class="pv-spec-lbl">${lbl}</div>
              <div class="pv-spec-val">${escapeHtml(String(val))}</div>
            </div>
          `,
          )
          .join("");
      } else {
        specsEl.style.display = "none";
      }

      // Location
      const loc = localize(p.location);
      if (loc) {
        document.getElementById("pvLocCard").classList.remove("hidden");
        document.getElementById("pvLocation").textContent = loc;
      }

      // Description
      const desc = localize(p.description);
      const descCard = document.getElementById("pvDescCard");
      if (desc) {
        document.getElementById("pvDesc").textContent = desc;
      } else {
        descCard.style.display = "none";
      }

      // Notes
      const notes = p.notes;
      const notesCard = document.getElementById("pvNotesCard");
      if (notes) {
        notesCard.classList.remove("hidden");
        document.getElementById("pvNotes").textContent = notes;
      } else {
        notesCard.classList.add("hidden");
      }

      // Tags
      const tags = localizeTags(p.tags);
      if (tags?.length) {
        document.getElementById("pvTagsCard").classList.remove("hidden");
        document.getElementById("pvTags").innerHTML = tags
          .map((tg) => `<span class="pv-tag">${escapeHtml(tg)}</span>`)
          .join("");
      }

      // Gallery
      renderGallery(p.images);

      // Map
      initMap(p);
    }

    /* ── Load ── */
    async function load() {
      if (!id) {
        document.getElementById("pvLoading").classList.add("hidden");
        document.getElementById("pvError").classList.remove("hidden");
        return;
      }
      try {
        const p = await getProperty(id);

        document.getElementById("pvLoading").classList.add("hidden");

        if (!p) {
          document.getElementById("pvError").classList.remove("hidden");
          return;
        }

        await render(p);
        setupPdfBtn(p);
        document.getElementById("pvContent").classList.remove("hidden");
      } catch (e) {
        document.getElementById("pvLoading").classList.add("hidden");
        document.getElementById("pvError").classList.remove("hidden");
        console.error(e);
      }
    }

    function setupPdfBtn(p) {
      const btn = document.getElementById("pvPdfBtn");
      if (!btn) return;

      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<span class="spinner" style="width:12px;height:12px;margin:0;border-width:2px;border-color:var(--gold) transparent transparent transparent;"></span> جاري تصدير PDF...`;

        try {
          // 1. Load html2pdf bundle from CDN if not already loaded
          if (typeof html2pdf === "undefined") {
            await new Promise((resolve, reject) => {
              const s = document.createElement("script");
              s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
              s.onload = resolve;
              s.onerror = reject;
              document.head.appendChild(s);
            });
          }

          // 2. Capture map preview as base64 image using html2canvas
          let mapImgSrc = "";
          const mapEl = document.getElementById("pvMap");
          if (mapEl && window.html2canvas) {
            const canvas = await window.html2canvas(mapEl, {
              useCORS: true,
              allowTaint: false,
              logging: false,
              scale: 1.5
            });
            mapImgSrc = canvas.toDataURL("image/jpeg", 0.95);
          }

          // 3. Construct print-optimized HTML
          const container = document.createElement("div");
          container.style.position = "absolute";
          container.style.left = "0";
          container.style.top = "9999px";
          container.style.width = "800px";
          container.style.zIndex = "99999";
          container.style.background = "#FAF7F0";
          
          container.innerHTML = `
            <div style="direction: rtl; font-family: 'IBM Plex Sans Arabic', sans-serif; background: #FAF7F0; padding: 24px; box-sizing: border-box; color: #211E1B; max-width: 800px; margin: auto;">
              <!-- Header -->
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #C6A24F; padding-bottom: 12px; margin-bottom: 16px;">
                <div>
                  <h1 style="font-size: 22px; font-weight: 700; margin: 0; color: #C6A24F;">الملكية للإستثمار</h1>
                  <p style="font-size: 10px; color: #7c7c7c; margin: 2px 0 0 0; text-transform: uppercase; letter-spacing: 1px;">Almalakiyah Real Estate</p>
                </div>
                <div style="text-align: left; direction: ltr;">
                  <p style="font-size: 11px; margin: 0; font-weight: 600; text-align: left; direction: rtl;">وثيقة عرض عقار</p>
                  <p style="font-size: 9px; color: #7c7c7c; margin: 2px 0 0 0;">التاريخ: ${new Date().toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
              </div>

              <!-- Title -->
              <div style="margin-bottom: 16px;">
                <h2 style="font-size: 18px; font-weight: 700; margin: 0; color: #211E1B; line-height: 1.4;">${escapeHtml(localize(p.title))}</h2>
                <div style="display: flex; gap: 8px; margin-top: 8px;">
                  <span style="background: #FAF7F0; border: 1px solid #C6A24F; color: #C6A24F; font-size: 10px; padding: 3px 8px; border-radius: 4px; font-weight: 600;">${escapeHtml(statusLabel(p.status))}</span>
                  <span style="background: rgba(33, 30, 27, 0.05); color: #211E1B; font-size: 10px; padding: 3px 8px; border-radius: 4px; font-weight: 600;">${escapeHtml(typeLabel(p.type))}</span>
                  ${p.category ? `<span style="background: rgba(33, 30, 27, 0.05); color: #211E1B; font-size: 10px; padding: 3px 8px; border-radius: 4px; font-weight: 600;">${escapeHtml(categoryLabel(p.category))}</span>` : ''}
                </div>
              </div>

              <!-- Main Image -->
              ${p.images && p.images.length > 0 ? `
              <div style="margin-bottom: 16px; border-radius: 6px; overflow: hidden; height: 260px; background: #211E1B;">
                <img src="${p.images[0]}" style="width: 100%; height: 100%; object-fit: cover;" crossorigin="anonymous" />
              </div>
              ` : ''}

              <!-- Specs Grid -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px;">
                <div style="background: #ffffff; border: 1px solid rgba(198, 162, 79, 0.15); border-radius: 6px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 11px; color: #7c7c7c;">السعر المطلوب</span>
                  <span style="font-size: 14px; font-weight: 700; color: #C6A24F;">${p.price ? Number(p.price).toLocaleString('en-US') + ' ر.ع.' : '—'}</span>
                </div>
                <div style="background: #ffffff; border: 1px solid rgba(198, 162, 79, 0.15); border-radius: 6px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 11px; color: #7c7c7c;">المساحة</span>
                  <span style="font-size: 14px; font-weight: 700; color: #211E1B;">${p.area ? Number(p.area).toLocaleString('en-US') + ' م²' : '—'}</span>
                </div>
                <div style="background: #ffffff; border: 1px solid rgba(198, 162, 79, 0.15); border-radius: 6px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 11px; color: #7c7c7c;">الموقع</span>
                  <span style="font-size: 12px; font-weight: 600; color: #211E1B; max-width: 180px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(localize(p.location) || '—')}</span>
                </div>
                <div style="background: #ffffff; border: 1px solid rgba(198, 162, 79, 0.15); border-radius: 6px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 11px; color: #7c7c7c;">رابط العقار</span>
                  <a href="${location.href}" style="font-size: 10px; color: #C6A24F; font-weight: 600; text-decoration: none;">عرض في المنصة</a>
                </div>
              </div>

              <!-- Description -->
              ${p.description ? `
              <div style="background: #ffffff; border: 1px solid rgba(198, 162, 79, 0.15); border-radius: 6px; padding: 12px 16px; margin-bottom: 16px;">
                <h3 style="font-size: 12px; font-weight: 700; margin: 0 0 6px 0; color: #211E1B; border-bottom: 1px solid rgba(198, 162, 79, 0.1); padding-bottom: 4px;">الوصف</h3>
                <p style="font-size: 11px; line-height: 1.5; color: #525252; margin: 0; white-space: pre-wrap;">${escapeHtml(localize(p.description))}</p>
              </div>
              ` : ''}

              <!-- Notes -->
              ${p.notes ? `
              <div style="background: rgba(198,162,79,0.04); border-right: 3px solid #C6A24F; border-radius: 4px; padding: 12px 16px; margin-bottom: 16px; page-break-inside: avoid;">
                <h3 style="font-size: 11px; font-weight: 700; margin: 0 0 6px 0; color: #92400e;">ملاحظات</h3>
                <p style="font-size: 11px; line-height: 1.5; color: #92400e; margin: 0; white-space: pre-wrap;">${escapeHtml(p.notes)}</p>
              </div>
              ` : ''}

              <!-- Map -->
              ${mapImgSrc ? `
              <div style="background: #ffffff; border: 1px solid rgba(198, 162, 79, 0.15); border-radius: 6px; overflow: hidden; padding: 10px; margin-bottom: 16px; page-break-inside: avoid;">
                <h3 style="font-size: 12px; font-weight: 700; margin: 0 0 8px 0; color: #211E1B;">الموقع الجغرافي وحدود الأرض</h3>
                <div style="height: 240px; border-radius: 4px; overflow: hidden;">
                  <img src="${mapImgSrc}" style="width: 100%; height: 100%; object-fit: cover;" />
                </div>
              </div>
              ` : ''}

              <!-- Footer -->
              <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(198, 162, 79, 0.15); padding-top: 12px; margin-top: 16px; font-size: 9px; color: #7c7c7c;">
                <div>
                  <p style="margin: 0; font-weight: 600;">الملكية للإستثمار © 2026</p>
                  <p style="margin: 2px 0 0 0;">للتواصل: info@almalakiyah.local · almalakiyah.local</p>
                </div>
                <div style="text-align: left; direction: ltr;">
                  <p style="margin: 0; font-weight: 600;">رمز العقار: ${p.id.slice(0, 8).toUpperCase()}</p>
                </div>
              </div>
            </div>
          `;
          
          document.body.appendChild(container);

          // 4. Run html2pdf
          const filename = `عقار_${localize(p.title).replace(/\s+/g, '_')}.pdf`;
          const opt = {
            margin:       [8, 8, 8, 8],
            filename:     filename,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
          };

          await html2pdf().from(container).set(opt).save();
          container.remove();

        } catch (err) {
          console.error(err);
          alert("حدث خطأ أثناء تصدير ملف PDF للمشاركة: " + err.message);
        } finally {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
        }
      });
    }

    let currentUserId = null;
    let currentRole = 'viewer';

    (async () => {
      const ctx = await setupDashboard("properties.html");
      currentUserId = ctx.user.uid;
      currentRole = ctx.role;
      applyTranslations();
      const { applyRoleGuards } = await import("../roles.js");
      applyRoleGuards(document.getElementById("pvContent"), ctx.role);
      load();
    })();

    onLangChange(() => {
      applyTranslations();
      location.reload();
    });