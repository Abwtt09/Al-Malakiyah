import { initI18n, applyTranslations, t, getLang, onLangChange } from '../i18n.js';
    import { setupDashboard, toast } from '../portal-ui.js';
    import { escapeHtml } from '../ui.js?v=2';
    import { renderDbIcon } from '../db-icons.js';
    import {
      getDatabase, updateDatabase,
      addField, updateField, deleteField, reorderFields,
      createRecord, listRecords, updateRecord, deleteRecord, duplicateRecord, importRecords,
    } from '../databases-db.js';
    import { watchProperties, deleteProperty } from '../db.js';
    import { localize, formatPrice, formatArea, statusLabel, typeLabel } from '../ui.js?v=2';

    initI18n();

    /* ═══ Constants ═══ */
    const PAGE_SIZE = 50;
    const FIELD_TYPES_CLEAN = [
      { type: 'text', icon: 'Aa', labelKey: 'db.typeText' },
      { type: 'longText', icon: '¶', labelKey: 'db.typeLongText' },
      { type: 'number', icon: '#', labelKey: 'db.typeNumber' },
      { type: 'currency', icon: '＄', labelKey: 'db.typeCurrency' },
      { type: 'date', icon: '📅', labelKey: 'db.typeDate' },
      { type: 'boolean', icon: '☑', labelKey: 'db.typeBoolean' },
      { type: 'dropdown', icon: '▾', labelKey: 'db.typeDropdown' },
      { type: 'multiSelect', icon: '⊕', labelKey: 'db.typeMultiSelect' },
      { type: 'status', icon: '◉', labelKey: 'db.typeStatus' },
      { type: 'email', icon: '@', labelKey: 'db.typeEmail' },
      { type: 'phone', icon: '☎', labelKey: 'db.typePhone' },
      { type: 'url', icon: '🔗', labelKey: 'db.typeUrl' },
      { type: 'location', icon: '📍', labelKey: 'db.typeLocation' },
      { type: 'coordinates', icon: '⊕', labelKey: 'db.typeCoordinates' },
      { type: 'image', icon: '🖼', labelKey: 'db.typeImage' },
      { type: 'file', icon: '📎', labelKey: 'db.typeFile' },
      { type: 'propertyPolygon', icon: '⬡', labelKey: 'db.typePropertyPolygon' },
    ];

    /* ═══ State ═══ */
    const params = new URLSearchParams(location.search);
    const DB_ID = params.get('db') || params.get('id');
    const isPropertiesMode = !DB_ID || DB_ID === 'properties';
    let _allProps = [];
    let _propertiesWatchUnsubscribe = null;
    let currentUserId = null;
    let currentDb = null;
    let records = [];
    let currentPage = 1;
    let searchQuery = '';
    let sortFieldId = null;
    let sortDir = 'asc';
    let activeEdit = null;
    let editingFieldId = null;  // for field modal
    let fieldOptions = [];      // options for dropdown/multiSelect/status
    let ctxFieldId = null;      // column context menu target

    /* ═══ Helpers ═══ */
    function esc(s) { return escapeHtml(String(s ?? '')); }

    function chipClass(idx) {
      return `chip-c${idx % 7}`;
    }

    function renderCellValue(field, value) {
      if (value === null || value === undefined || value === '') {
        return `<span class="db-cell-empty">—</span>`;
      }
      switch (field.type) {
        case 'boolean':
          return value
            ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
            : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;
        case 'number':
          return esc(Number(value).toLocaleString());
        case 'currency':
          return esc(Number(value).toLocaleString()) + ' OMR';
        case 'date':
          try { return esc(new Date(value).toLocaleDateString()); } catch { return esc(value); }
        case 'email':
          return `<a href="mailto:${esc(value)}" class="db-cell-link">${esc(value)}</a>`;
        case 'phone':
          return `<a href="tel:${esc(value)}" class="db-cell-link">${esc(value)}</a>`;
        case 'url':
        case 'image':
        case 'file': {
          const label = String(value).split('/').pop().split('?')[0] || value;
          return `<a href="${esc(value)}" target="_blank" rel="noopener" class="db-cell-link">${esc(label)}</a>`;
        }
        case 'status':
        case 'dropdown': {
          const idx = (field.options || []).indexOf(value);
          return `<span class="tag-chip ${chipClass(Math.max(0, idx))}">${esc(value)}</span>`;
        }
        case 'multiSelect':
          if (!Array.isArray(value) || !value.length) return `<span class="db-cell-empty">—</span>`;
          return value.map((v, i) => `<span class="tag-chip ${chipClass(i)}">${esc(v)}</span>`).join(' ');
        case 'coordinates':
          if (value && typeof value === 'object') return `${value.lat ?? ''}, ${value.lng ?? ''}`;
          return esc(value);
        case 'longText':
          return `<span style="white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(value)}</span>`;
        case 'propertyPolygon': {
          try {
            const coords = typeof value === 'string' ? JSON.parse(value) : value;
            const pts = Array.isArray(coords) ? coords.length
              : (Array.isArray(coords?.coordinates?.[0]) ? coords.coordinates[0].length : 0);
            return `<span style="color:var(--ink-600);font-size:.8125rem;">⬡ ${pts} ${t('db.polygonPoints')}</span>`;
          } catch { return `<span class="db-cell-link">⬡ Polygon</span>`; }
        }
        default:
          return esc(value);
      }
    }

    function getVisibleRecords() {
      if (isPropertiesMode) {
        let r = [..._allProps];
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          r = r.filter(p => {
            const name = (localize(p.title) || localize(p.name) || '').toLowerCase();
            const region = (localize(p.location) || p.region || '').toLowerCase();
            return name.includes(q) || region.includes(q);
          });
        }
        return r;
      }

      let r = [...records];
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        r = r.filter((rec) =>
          (currentDb.fields || []).some((f) => {
            const v = rec[f.id];
            if (v === null || v === undefined) return false;
            return String(v).toLowerCase().includes(q);
          }),
        );
      }
      if (sortFieldId) {
        r.sort((a, b) => {
          const av = String(a[sortFieldId] ?? '');
          const bv = String(b[sortFieldId] ?? '');
          const cmp = av.localeCompare(bv, undefined, { numeric: true });
          return sortDir === 'asc' ? cmp : -cmp;
        });
      }
      return r;
    }

    function renderPropertiesTable() {
      const pageRecs = getPageRecords();
      const vis = getVisibleRecords();

      // Update record count badge
      document.getElementById('recordCountBadge').textContent =
        `${vis.length} ${t('dashboard.totalProperties') || 'عقار'}`;

      // Head
      document.getElementById('spreadsheetHead').innerHTML = `<tr>
          <th class="db-col-num" style="text-align:center;padding:.5rem;">#</th>
          <th>اسم العقار</th>
          <th>النوع</th>
          <th>المنطقة</th>
          <th>السعر</th>
          <th>المساحة</th>
          <th>الحالة</th>
          <th>رابط الخريطة</th>
          <th>الموقع على الخريطة</th>
          <th class="db-col-actions" style="text-align:center;">العمليات</th>
        </tr>`;

      // Body
      if (!pageRecs.length) {
        document.getElementById('spreadsheetBody').innerHTML = `<tr><td colspan="10">
            <div class="db-no-data">
              <div class="db-no-data-icon">📭</div>
              <p>${escapeHtml(t('db.noRecords'))}</p>
            </div>
          </td></tr>`;
      } else {
        const offset = (currentPage - 1) * PAGE_SIZE;
        document.getElementById('spreadsheetBody').innerHTML = pageRecs.map((p, i) => {
          const name = escapeHtml(localize(p.title) || localize(p.name) || '—');
          const type = escapeHtml(typeLabel(p.type) || p.type || '—');
          const region = escapeHtml(localize(p.location) || p.region || '—');
          const price = p.price != null ? escapeHtml(formatPrice(p.price)) : '—';
          const area  = p.area  != null ? escapeHtml(formatArea(p.area)) : '—';
          const status = p.status || 'available';
          const locationUrl = p.locationUrl || '';
          const hasCoords = !!(p.coordinates || p.kmlCoordinates);
          
          return `<tr data-record-id="${escapeHtml(p.id)}">
              <td class="db-num-cell db-col-num">${offset + i + 1}</td>
              <td><span class="propdb-name" style="font-weight:600;color:var(--ink-800);">${name}</span></td>
              <td>${type}</td>
              <td>${region}</td>
              <td style="font-family:var(--font-sans-en)">${price}</td>
              <td style="font-family:var(--font-sans-en)">${area}</td>
              <td><span class="badge badge-${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span></td>
              <td class="propdb-coords" style="text-align:center;">${locationUrl ? `<a href="${escapeHtml(locationUrl)}" target="_blank" rel="noopener" style="color:var(--gold);font-size:1rem;text-decoration:none;">🔗</a>` : '—'}</td>
              <td class="propdb-coords" style="text-align:center;">${p.boundary && p.boundary.points ? '<span class="badge" style="background:#f0fdf4;color:#15803d;border:1px solid #86efac;font-size:0.6875rem;">✓ حدود</span>' : hasCoords ? '<span class="badge" style="background:#eff6ff;color:#1d4ed8;border:1px solid #93c5fd;font-size:0.6875rem;">📍 نقطة</span>' : '—'}</td>
              <td class="db-actions-cell db-col-actions">
                <div class="db-row-actions-wrap" style="display:flex;gap:0.375rem;justify-content:center;">
                  <a class="icon-btn" href="property-edit.html?id=${escapeHtml(p.id)}" title="${escapeHtml(t('db.editRecord'))}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </a>
                  <button class="icon-btn danger db-del-prop" data-record-id="${escapeHtml(p.id)}" title="${escapeHtml(t('db.deleteRecord'))}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  </button>
                </div>
              </td>
            </tr>`;
        }).join('');
      }

      renderPagination(vis.length);
      wirePropertiesTableEvents();
      applyTranslations(document.getElementById('dbContent'));
    }

    function wirePropertiesTableEvents() {
      document.getElementById('spreadsheetBody').querySelectorAll('.db-del-prop').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const propId = btn.dataset.recordId;
          const confirmDelete = confirm('هل أنت متأكد من حذف هذا العقار؟');
          if (!confirmDelete) return;
          try {
            await deleteProperty(propId);
            toast('تم حذف العقار بنجاح ✓');
          } catch (err) {
            alert('خطأ أثناء الحذف: ' + err.message);
          }
        });
      });
    }

    function getPageRecords() {
      const vis = getVisibleRecords();
      const start = (currentPage - 1) * PAGE_SIZE;
      return vis.slice(start, start + PAGE_SIZE);
    }

    /* ═══ Render spreadsheet ═══ */
    function renderTable() {
      if (isPropertiesMode) {
        renderPropertiesTable();
        return;
      }
      const fields = currentDb.fields || [];
      const pageRecs = getPageRecords();
      const vis = getVisibleRecords();

      // Update record count badge
      document.getElementById('recordCountBadge').textContent =
        `${vis.length} ${t('db.totalRecords')}`;

      // Head
      const canEdit = true; // guarded by data-role-require on UI elements
      const headCols = fields.map((f) => {
        const sortIcon = sortFieldId === f.id
          ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
        return `<th>
            <div class="db-th-inner" data-field-id="${esc(f.id)}">
              <span class="db-th-type">${FIELD_TYPES_CLEAN.find((x) => x.type === f.type)?.icon || 'Aa'}</span>
              <span class="db-th-label" title="${esc(f.name)}">${esc(f.name)}${sortIcon}</span>
              <button class="db-th-menu" data-field-id="${esc(f.id)}" title="…">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
              </button>
            </div>
          </th>`;
      }).join('');

      document.getElementById('spreadsheetHead').innerHTML = `<tr>
          <th class="db-col-num" style="text-align:center;padding:.5rem;">#</th>
          ${headCols}
          <th class="db-col-addfield" style="text-align:center;" data-role-require="db.edit">
            <button class="db-add-col-btn" id="addFieldColBtn" title="${esc(t('db.addField'))}">+</button>
          </th>
          <th class="db-col-actions"></th>
        </tr>`;

      // Body
      if (!fields.length) {
        document.getElementById('spreadsheetBody').innerHTML = `<tr><td colspan="99">
            <div class="db-no-data">
              <div class="db-no-data-icon">🏗️</div>
              <p>${esc(t('db.noFieldsMsg'))}</p>
            </div>
          </td></tr>`;
      } else if (!pageRecs.length) {
        document.getElementById('spreadsheetBody').innerHTML = `<tr><td colspan="99">
            <div class="db-no-data">
              <div class="db-no-data-icon">📭</div>
              <p>${esc(t('db.noRecords'))}</p>
              <small>${esc(t('db.noRecordsHint'))}</small>
            </div>
          </td></tr>`;
      } else {
        const offset = (currentPage - 1) * PAGE_SIZE;
        document.getElementById('spreadsheetBody').innerHTML = pageRecs.map((rec, i) => {
          const cells = fields.map((f) =>
            `<td class="db-cell" data-field-id="${esc(f.id)}" data-record-id="${esc(rec.id)}" data-field-type="${esc(f.type)}">
                <div class="db-cell-inner">${renderCellValue(f, rec[f.id])}</div>
              </td>`,
          ).join('');
          return `<tr data-record-id="${esc(rec.id)}">
              <td class="db-num-cell db-col-num">${offset + i + 1}</td>
              ${cells}
              <td class="db-col-addfield"></td>
              <td class="db-actions-cell db-col-actions">
                <div class="db-row-actions-wrap">
                  <button class="icon-btn db-edit-rec" data-record-id="${esc(rec.id)}" title="${esc(t('db.editRecord'))}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="icon-btn db-dup-rec" data-record-id="${esc(rec.id)}" title="${esc(t('db.duplicateRecord'))}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                  <button class="icon-btn danger db-del-rec" data-record-id="${esc(rec.id)}" title="${esc(t('db.deleteRecord'))}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  </button>
                </div>
              </td>
            </tr>`;
        }).join('');
      }

      renderPagination(vis.length);
      wireTableEvents();
      applyTranslations(document.getElementById('dbContent'));
    }

    function renderPagination(total) {
      const pagination = document.getElementById('pagination');
      const totalPages = Math.ceil(total / PAGE_SIZE);
      if (totalPages <= 1) { pagination.style.display = 'none'; return; }
      pagination.style.display = 'flex';
      let html = `<button class="db-page-btn" id="pagePrev" ${currentPage === 1 ? 'disabled' : ''}>‹</button>`;
      for (let p = 1; p <= totalPages; p++) {
        if (totalPages > 8 && p > 2 && p < totalPages - 1 && Math.abs(p - currentPage) > 2) {
          if (p === 3 || p === totalPages - 2) html += `<span class="db-page-info">…</span>`;
          continue;
        }
        html += `<button class="db-page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
      }
      html += `<button class="db-page-btn" id="pageNext" ${currentPage === totalPages ? 'disabled' : ''}>›</button>`;
      pagination.innerHTML = html;
      pagination.querySelectorAll('[data-page]').forEach((btn) => {
        btn.addEventListener('click', () => { currentPage = +btn.dataset.page; renderTable(); });
      });
      pagination.querySelector('#pagePrev')?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderTable(); } });
      pagination.querySelector('#pageNext')?.addEventListener('click', () => { if (currentPage < totalPages) { currentPage++; renderTable(); } });
    }

    /* ═══ Inline cell editing ═══ */
    function cancelActiveEdit() {
      if (!activeEdit) return;
      const { td } = activeEdit;
      td.querySelectorAll('.db-cell-input').forEach((el) => el.remove());
      activeEdit = null;
    }

    function wireTableEvents() {
      // Cell click → inline edit
      document.querySelectorAll('.db-cell').forEach((td) => {
        td.addEventListener('click', () => startCellEdit(td));
      });
      // Row actions
      document.querySelectorAll('.db-edit-rec').forEach((btn) => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); openRecordModal(btn.dataset.recordId); });
      });
      document.querySelectorAll('.db-dup-rec').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await duplicateRecord(DB_ID, btn.dataset.recordId, currentUserId);
            await refreshRecords();
            toast(t('db.duplicateRecord') + ' ✓');
          } catch (err) { toast(t('common.error') + ': ' + err.message); }
        });
      });
      document.querySelectorAll('.db-del-rec').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(t('db.deleteRecordConfirm'))) return;
          try {
            await deleteRecord(DB_ID, btn.dataset.recordId);
            await refreshRecords();
          } catch (err) { toast(t('common.error') + ': ' + err.message); }
        });
      });
      // Column header menu buttons
      document.querySelectorAll('.db-th-menu').forEach((btn) => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); openColCtxMenu(e, btn.dataset.fieldId); });
      });
      // Column header sort
      document.querySelectorAll('.db-th-inner').forEach((div) => {
        div.addEventListener('click', (e) => {
          if (e.target.closest('.db-th-menu')) return;
          const fid = div.dataset.fieldId;
          if (sortFieldId === fid) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
          else { sortFieldId = fid; sortDir = 'asc'; }
          currentPage = 1;
          renderTable();
        });
      });
      // Add field via + column button
      document.getElementById('addFieldColBtn')?.addEventListener('click', () => openAddFieldModal());
      // Add record via last row button handled globally
    }

    function startCellEdit(td) {
      const fieldId = td.dataset.fieldId;
      const recordId = td.dataset.recordId;
      const fieldType = td.dataset.fieldType;
      const field = (currentDb.fields || []).find((f) => f.id === fieldId);
      const record = records.find((r) => r.id === recordId);
      if (!field || !record) return;

      cancelActiveEdit();

      // Complex types → open modal focused on that field
      if (['longText', 'multiSelect', 'coordinates', 'image', 'file', 'propertyPolygon'].includes(fieldType)) {
        openRecordModal(recordId, fieldId);
        return;
      }

      // Boolean → toggle immediately
      if (fieldType === 'boolean') {
        const newVal = !record[fieldId];
        const inner = td.querySelector('.db-cell-inner');
        inner.innerHTML = renderCellValue(field, newVal);
        updateRecord(DB_ID, recordId, { [fieldId]: newVal }).catch((e) => toast(t('common.error')));
        const idx = records.findIndex((r) => r.id === recordId);
        if (idx >= 0) records[idx] = { ...records[idx], [fieldId]: newVal };
        return;
      }

      // Inject inline input
      const currentValue = record[fieldId];
      const input = buildInlineInput(field, currentValue);
      activeEdit = { td, recordId, fieldId, field, currentValue };
      td.appendChild(input);
      if (input.tagName === 'SELECT') { input.focus(); }
      else { input.select ? input.select() : input.focus(); }

      const save = async () => {
        if (!activeEdit || activeEdit.td !== td) return;
        const newVal = extractInputValue(input, field);
        activeEdit = null;
        if (input.parentNode) input.remove();
        if (JSON.stringify(newVal) !== JSON.stringify(currentValue)) {
          try {
            await updateRecord(DB_ID, recordId, { [fieldId]: newVal });
            const idx = records.findIndex((r) => r.id === recordId);
            if (idx >= 0) records[idx] = { ...records[idx], [fieldId]: newVal };
            td.querySelector('.db-cell-inner').innerHTML = renderCellValue(field, newVal);
          } catch (e) { toast(t('common.error')); }
        }
      };

      const cancel = () => {
        if (!activeEdit || activeEdit.td !== td) return;
        activeEdit = null;
        if (input.parentNode) input.remove();
      };

      input.addEventListener('blur', save);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        if (e.key === 'Enter' && fieldType !== 'longText') { e.preventDefault(); input.blur(); }
        if (e.key === 'Tab') { save(); }
      });
    }

    function buildInlineInput(field, value) {
      let el;
      switch (field.type) {
        case 'number': case 'currency':
          el = Object.assign(document.createElement('input'), { type: 'number', value: value ?? '' });
          break;
        case 'date':
          el = Object.assign(document.createElement('input'), { type: 'date', value: value ?? '' });
          break;
        case 'email':
          el = Object.assign(document.createElement('input'), { type: 'email', value: value ?? '' });
          break;
        case 'phone':
          el = Object.assign(document.createElement('input'), { type: 'tel', value: value ?? '' });
          break;
        case 'url':
          el = Object.assign(document.createElement('input'), { type: 'url', value: value ?? '' });
          break;
        case 'dropdown': case 'status': {
          el = document.createElement('select');
          const none = Object.assign(document.createElement('option'), { value: '', textContent: '—' });
          el.appendChild(none);
          (field.options || []).forEach((opt) => {
            const o = Object.assign(document.createElement('option'), { value: opt, textContent: opt });
            if (opt === value) o.selected = true;
            el.appendChild(o);
          });
          break;
        }
        default:
          el = Object.assign(document.createElement('input'), { type: 'text', value: value ?? '' });
      }
      el.className = 'db-cell-input';
      return el;
    }

    function extractInputValue(input, field) {
      if (input.tagName === 'SELECT') return input.value || null;
      if (field.type === 'number' || field.type === 'currency') {
        const n = parseFloat(input.value);
        return isNaN(n) ? null : n;
      }
      return input.value || null;
    }

    /* ═══ Record Edit Modal ═══ */
    let modalRecordId = null;
    let modalIsNew = false;

    function openRecordModal(recordId, focusFieldId = null) {
      modalRecordId = recordId || null;
      modalIsNew = !recordId;
      cancelActiveEdit();

      const record = recordId ? records.find((r) => r.id === recordId) : {};
      document.getElementById('recordModalTitle').textContent = modalIsNew ? t('db.newRecord') : t('db.editRecord');
      document.getElementById('recordDeleteBtn').style.display = modalIsNew ? 'none' : '';
      document.getElementById('recordError').classList.add('hidden');

      const fields = currentDb.fields || [];
      if (!fields.length) {
        document.getElementById('recordFields').innerHTML = `<p style="color:var(--ink-400);font-size:.875rem;">${esc(t('db.noFieldsMsg'))}</p>`;
      } else {
        document.getElementById('recordFields').innerHTML = fields.map((f) =>
          `<div class="record-field-row">
              <label class="record-field-label">${esc(f.name)} ${f.required ? '<span class="record-field-required">*</span>' : ''}</label>
              ${buildModalFieldInput(f, record?.[f.id])}
            </div>`,
        ).join('');
      }

      document.getElementById('recordModal').classList.remove('hidden');
      applyTranslations(document.getElementById('recordModal'));

      if (focusFieldId) {
        const el = document.querySelector(`[data-field-input="${focusFieldId}"]`);
        if (el) el.focus();
      } else {
        document.querySelector('.record-fields [data-field-input]')?.focus();
      }
    }

    function buildModalFieldInput(field, value) {
      const attr = `data-field-input="${esc(field.id)}"`;
      const cls = 'class="field-input"';
      switch (field.type) {
        case 'longText':
          return `<textarea ${cls} ${attr} rows="4" style="resize:vertical;">${esc(value ?? '')}</textarea>`;
        case 'number': case 'currency':
          return `<input type="number" ${cls} ${attr} value="${esc(value ?? '')}" />`;
        case 'date':
          return `<input type="date" ${cls} ${attr} value="${esc(value ?? '')}" />`;
        case 'email':
          return `<input type="email" ${cls} ${attr} value="${esc(value ?? '')}" />`;
        case 'phone':
          return `<input type="tel" ${cls} ${attr} value="${esc(value ?? '')}" />`;
        case 'url': case 'image': case 'file':
          return `<input type="url" ${cls} ${attr} value="${esc(value ?? '')}" placeholder="https://…" />`;
        case 'boolean':
          return `<input type="checkbox" ${attr} ${value ? 'checked' : ''} style="width:1.25rem;height:1.25rem;" />`;
        case 'dropdown': case 'status': {
          const opts = (field.options || []).map((o) =>
            `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('');
          return `<select ${cls} ${attr}><option value="">—</option>${opts}</select>`;
        }
        case 'multiSelect': {
          const selected = Array.isArray(value) ? value : [];
          const opts = (field.options || []).map((o) =>
            `<label class="checkbox-row" style="font-size:.875rem;padding:.25rem 0;">
                <input type="checkbox" value="${esc(o)}" data-multi="${esc(field.id)}" ${selected.includes(o) ? 'checked' : ''} />
                ${esc(o)}
              </label>`).join('');
          return `<div ${attr} style="display:flex;flex-direction:column;gap:.125rem;">${opts || `<span style="color:var(--ink-400);font-size:.8125rem;">${esc(t('db.fieldOptions'))}</span>`}</div>`;
        }
        case 'coordinates': {
          const lat = value?.lat ?? '';
          const lng = value?.lng ?? '';
          return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;" ${attr}>
              <input type="number" class="field-input" data-coord-lat="${esc(field.id)}" placeholder="Lat" step="any" value="${esc(lat)}" />
              <input type="number" class="field-input" data-coord-lng="${esc(field.id)}" placeholder="Lng" step="any" value="${esc(lng)}" />
            </div>`;
        }
        case 'propertyPolygon': {
          const raw = typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : (value ?? '');
          return `<div>
              <textarea class="field-input" ${attr} data-polygon-input="${esc(field.id)}" rows="5"
                style="resize:vertical;font-family:monospace;font-size:.75rem;"
                placeholder='[[24.123,56.789],[24.124,56.790],...]'>${esc(raw)}</textarea>
              <p style="font-size:.75rem;color:var(--ink-400);margin-top:.25rem;" data-i18n="db.polygonHint"></p>
            </div>`;
        }
        default:
          return `<input type="text" ${cls} ${attr} value="${esc(value ?? '')}" />`;
      }
    }

    function readModalFieldValue(field) {
      if (field.type === 'propertyPolygon') {
        const ta = document.querySelector(`[data-polygon-input="${field.id}"]`);
        if (!ta) return null;
        const raw = ta.value.trim();
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return raw; }
      }
      const attr = `[data-field-input="${field.id}"]`;
      const el = document.querySelector(attr);
      if (!el) return null;
      switch (field.type) {
        case 'boolean': return el.checked;
        case 'number': case 'currency': { const n = parseFloat(el.value); return isNaN(n) ? null : n; }
        case 'multiSelect':
          return Array.from(document.querySelectorAll(`[data-multi="${field.id}"]:checked`)).map((cb) => cb.value);
        case 'coordinates': {
          const lat = parseFloat(document.querySelector(`[data-coord-lat="${field.id}"]`)?.value);
          const lng = parseFloat(document.querySelector(`[data-coord-lng="${field.id}"]`)?.value);
          if (isNaN(lat) && isNaN(lng)) return null;
          return { lat: isNaN(lat) ? 0 : lat, lng: isNaN(lng) ? 0 : lng };
        }
        default: return el.value || null;
      }
    }

    function closeRecordModal() {
      document.getElementById('recordModal').classList.add('hidden');
      modalRecordId = null;
      modalIsNew = false;
    }

    document.getElementById('recordModalClose').addEventListener('click', closeRecordModal);
    document.getElementById('recordModalCancel').addEventListener('click', closeRecordModal);
    document.getElementById('recordModal').addEventListener('click', (e) => { if (e.target === document.getElementById('recordModal')) closeRecordModal(); });

    document.getElementById('recordSaveBtn').addEventListener('click', async () => {
      const spinner = document.getElementById('recordSaveSpinner');
      const label = document.getElementById('recordSaveLabel');
      const btn = document.getElementById('recordSaveBtn');
      const errEl = document.getElementById('recordError');
      errEl.classList.add('hidden');
      btn.setAttribute('disabled', '');
      spinner.classList.remove('hidden');
      label.textContent = t('dashboard.saving');

      try {
        const data = {};
        for (const f of (currentDb.fields || [])) {
          const v = readModalFieldValue(f);
          if (v !== null && v !== undefined) data[f.id] = v;
          else if (f.required) { throw new Error(`${f.name} is required`); }
        }
        if (modalIsNew) {
          await createRecord(DB_ID, data, currentUserId);
        } else {
          await updateRecord(DB_ID, modalRecordId, data);
        }
        closeRecordModal();
        await refreshRecords();
        toast(t('db.saveRecord') + ' ✓');
      } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.removeAttribute('disabled');
        spinner.classList.add('hidden');
        label.textContent = t('db.saveRecord');
      }
    });

    document.getElementById('recordDeleteBtn').addEventListener('click', async () => {
      if (!modalRecordId || !confirm(t('db.deleteRecordConfirm'))) return;
      try {
        await deleteRecord(DB_ID, modalRecordId);
        closeRecordModal();
        await refreshRecords();
      } catch (e) { toast(t('common.error') + ': ' + e.message); }
    });

    /* ═══ Add / Edit Field Modal ═══ */
    function buildFieldTypePicker() {
      document.getElementById('fieldTypeGrid').innerHTML = FIELD_TYPES_CLEAN.map((ft) =>
        `<button type="button" class="field-type-opt ${editingFieldId ? '' : ft.type === 'text' ? 'selected' : ''}" data-type="${ft.type}">
            <span class="field-type-icon">${ft.icon}</span>
            <span>${t(ft.labelKey)}</span>
          </button>`,
      ).join('');
      document.querySelectorAll('.field-type-opt').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.field-type-opt').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          const needsOpts = ['dropdown', 'status', 'multiSelect'].includes(btn.dataset.type);
          document.getElementById('fieldOptionsSection').style.display = needsOpts ? '' : 'none';
        });
      });
    }

    function openAddFieldModal(existingField = null) {
      editingFieldId = existingField?.id || null;
      fieldOptions = existingField?.options ? [...existingField.options] : [];
      document.getElementById('fieldModalTitle').textContent = existingField ? t('db.editFieldTitle') : t('db.addFieldTitle');
      document.getElementById('fieldNameInput').value = existingField?.name || '';
      document.getElementById('fieldRequired').checked = existingField?.required || false;
      document.getElementById('fieldError').classList.add('hidden');
      buildFieldTypePicker();

      if (existingField) {
        const btn = document.querySelector(`.field-type-opt[data-type="${existingField.type}"]`);
        if (btn) {
          document.querySelectorAll('.field-type-opt').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
        }
        const needsOpts = ['dropdown', 'status', 'multiSelect'].includes(existingField.type);
        document.getElementById('fieldOptionsSection').style.display = needsOpts ? '' : 'none';
      } else {
        document.querySelector('.field-type-opt')?.classList.add('selected');
        document.getElementById('fieldOptionsSection').style.display = 'none';
      }

      renderOptionChips();
      document.getElementById('fieldModal').classList.remove('hidden');
      document.getElementById('fieldNameInput').focus();
      applyTranslations(document.getElementById('fieldModal'));
    }

    function renderOptionChips() {
      document.getElementById('optionChips').innerHTML = fieldOptions.map((opt, i) =>
        `<span class="option-chip">${esc(opt)}<button type="button" data-idx="${i}">×</button></span>`,
      ).join('');
      document.querySelectorAll('#optionChips button').forEach((btn) => {
        btn.addEventListener('click', () => {
          fieldOptions.splice(+btn.dataset.idx, 1);
          renderOptionChips();
        });
      });
    }

    function addOption() {
      const input = document.getElementById('optionInput');
      const val = input.value.trim();
      if (val && !fieldOptions.includes(val)) { fieldOptions.push(val); renderOptionChips(); }
      input.value = '';
      input.focus();
    }

    document.getElementById('optionInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addOption(); }
    });
    document.getElementById('addOptionBtn').addEventListener('click', addOption);

    function closeFieldModal() {
      document.getElementById('fieldModal').classList.add('hidden');
      editingFieldId = null;
      fieldOptions = [];
    }

    document.getElementById('fieldModalClose').addEventListener('click', closeFieldModal);
    document.getElementById('fieldModalCancel').addEventListener('click', closeFieldModal);
    document.getElementById('fieldModal').addEventListener('click', (e) => { if (e.target === document.getElementById('fieldModal')) closeFieldModal(); });

    document.getElementById('fieldForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const name = document.getElementById('fieldNameInput').value.trim();
      if (!name) return;
      const selectedType = document.querySelector('.field-type-opt.selected')?.dataset.type || 'text';
      const required = document.getElementById('fieldRequired').checked;
      const spinner = document.getElementById('fieldSaveSpinner');
      const label = document.getElementById('fieldSaveLabel');
      const btn = document.getElementById('fieldSaveBtn');
      const errEl = document.getElementById('fieldError');
      errEl.classList.add('hidden');
      btn.setAttribute('disabled', '');
      spinner.classList.remove('hidden');
      label.textContent = t('common.loading');

      const fieldData = { name, type: selectedType, required, options: fieldOptions };
      try {
        if (editingFieldId) {
          await updateField(DB_ID, editingFieldId, fieldData);
        } else {
          await addField(DB_ID, fieldData);
        }
        currentDb = await getDatabase(DB_ID);
        closeFieldModal();
        closeManageFieldsModal();
        renderTable();
        toast(t('db.saveField') + ' ✓');
      } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.removeAttribute('disabled');
        spinner.classList.add('hidden');
        label.textContent = t('db.saveField');
      }
    });

    /* ═══ Manage Fields Modal ═══ */
    function openManageFieldsModal() {
      renderFieldsList();
      document.getElementById('manageFieldsModal').classList.remove('hidden');
      applyTranslations(document.getElementById('manageFieldsModal'));
    }

    function closeManageFieldsModal() {
      document.getElementById('manageFieldsModal').classList.add('hidden');
    }

    function renderFieldsList() {
      const fields = currentDb.fields || [];
      const list = document.getElementById('fieldsList');
      if (!fields.length) {
        list.innerHTML = `<p style="color:var(--ink-400);font-size:.875rem;text-align:center;padding:1rem;">${esc(t('db.noFieldsMsg'))}</p>`;
        return;
      }
      list.innerHTML = fields.map((f, idx) => {
        const typeInfo = FIELD_TYPES_CLEAN.find((x) => x.type === f.type) || FIELD_TYPES_CLEAN[0];
        return `<div class="deed-doc-row" style="align-items:center;">
            <div style="display:flex;flex-direction:column;gap:.125rem;margin-inline-end:.25rem;">
              <button class="icon-btn mf-move-up" data-field-id="${esc(f.id)}" ${idx === 0 ? 'disabled' : ''} title="${esc(t('db.moveFieldUp'))}" style="width:1.5rem;height:1.5rem;font-size:.7rem;">↑</button>
              <button class="icon-btn mf-move-down" data-field-id="${esc(f.id)}" ${idx === fields.length - 1 ? 'disabled' : ''} title="${esc(t('db.moveFieldDown'))}" style="width:1.5rem;height:1.5rem;font-size:.7rem;">↓</button>
            </div>
            <div class="deed-doc-icon"><span style="font-size:1.1rem;">${typeInfo.icon}</span></div>
            <div class="deed-doc-meta">
              <p class="deed-doc-name">${esc(f.name)}</p>
              <p class="deed-doc-type">${t(typeInfo.labelKey)} ${f.required ? '· required' : ''}</p>
            </div>
            <div class="deed-doc-actions">
              <button class="icon-btn mf-edit" data-field-id="${esc(f.id)}" title="${esc(t('db.editFieldMenu'))}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="icon-btn danger mf-delete" data-field-id="${esc(f.id)}" title="${esc(t('db.deleteFieldMenu'))}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
            </div>
          </div>`;
      }).join('');

      list.querySelectorAll('.mf-move-up').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const fs = [...(currentDb.fields || [])];
          const idx = fs.findIndex((f) => f.id === btn.dataset.fieldId);
          if (idx <= 0) return;
          [fs[idx - 1], fs[idx]] = [fs[idx], fs[idx - 1]];
          try {
            await reorderFields(DB_ID, fs);
            currentDb = await getDatabase(DB_ID);
            renderFieldsList();
            renderTable();
          } catch (e) { toast(t('common.error') + ': ' + e.message); }
        });
      });
      list.querySelectorAll('.mf-move-down').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const fs = [...(currentDb.fields || [])];
          const idx = fs.findIndex((f) => f.id === btn.dataset.fieldId);
          if (idx < 0 || idx >= fs.length - 1) return;
          [fs[idx], fs[idx + 1]] = [fs[idx + 1], fs[idx]];
          try {
            await reorderFields(DB_ID, fs);
            currentDb = await getDatabase(DB_ID);
            renderFieldsList();
            renderTable();
          } catch (e) { toast(t('common.error') + ': ' + e.message); }
        });
      });
      list.querySelectorAll('.mf-edit').forEach((btn) => {
        btn.addEventListener('click', () => {
          const field = (currentDb.fields || []).find((f) => f.id === btn.dataset.fieldId);
          if (field) openAddFieldModal(field);
        });
      });
      list.querySelectorAll('.mf-delete').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('db.deleteFieldConfirm'))) return;
          try {
            await deleteField(DB_ID, btn.dataset.fieldId);
            currentDb = await getDatabase(DB_ID);
            renderFieldsList();
            renderTable();
            toast(t('db.deleteField') + ' ✓');
          } catch (e) { toast(t('common.error') + ': ' + e.message); }
        });
      });
    }

    document.getElementById('mfModalClose').addEventListener('click', closeManageFieldsModal);
    document.getElementById('manageFieldsModal').addEventListener('click', (e) => { if (e.target === document.getElementById('manageFieldsModal')) closeManageFieldsModal(); });
    document.getElementById('mfAddFieldBtn').addEventListener('click', () => openAddFieldModal());

    /* ═══ Column Context Menu ═══ */
    function openColCtxMenu(e, fieldId) {
      ctxFieldId = fieldId;
      const menu = document.getElementById('colCtxMenu');
      menu.style.display = '';
      const rect = e.target.getBoundingClientRect();
      menu.style.top = `${rect.bottom + 4}px`;
      menu.style.insetInlineStart = `${rect.left}px`;
      e.stopPropagation();
    }

    document.getElementById('ctxSortAsc').addEventListener('click', () => {
      sortFieldId = ctxFieldId; sortDir = 'asc'; currentPage = 1; renderTable();
      document.getElementById('colCtxMenu').style.display = 'none';
    });
    document.getElementById('ctxSortDesc').addEventListener('click', () => {
      sortFieldId = ctxFieldId; sortDir = 'desc'; currentPage = 1; renderTable();
      document.getElementById('colCtxMenu').style.display = 'none';
    });
    document.getElementById('ctxEditField').addEventListener('click', () => {
      const field = (currentDb.fields || []).find((f) => f.id === ctxFieldId);
      if (field) openAddFieldModal(field);
      document.getElementById('colCtxMenu').style.display = 'none';
    });
    document.getElementById('ctxDeleteField').addEventListener('click', async () => {
      document.getElementById('colCtxMenu').style.display = 'none';
      if (!confirm(t('db.deleteFieldConfirm'))) return;
      try {
        await deleteField(DB_ID, ctxFieldId);
        currentDb = await getDatabase(DB_ID);
        renderTable();
        toast(t('db.deleteField') + ' ✓');
      } catch (e) { toast(t('common.error') + ': ' + e.message); }
    });

    document.addEventListener('click', () => {
      document.getElementById('colCtxMenu').style.display = 'none';
      document.getElementById('exportMenu').style.display = 'none';
    });

    /* ═══ Toolbar Actions ═══ */
    document.getElementById('addRecordBtn').addEventListener('click', () => openRecordModal(null));
    document.getElementById('manageFieldsBtn').addEventListener('click', openManageFieldsModal);

    document.getElementById('searchInput').addEventListener('input', (e) => {
      searchQuery = e.target.value;
      currentPage = 1;
      renderTable();
    });

    document.getElementById('exportBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = document.getElementById('exportMenu');
      menu.style.display = menu.style.display === 'none' ? '' : 'none';
    });

    document.getElementById('exportXlsx').addEventListener('click', () => {
      document.getElementById('exportMenu').style.display = 'none';
      exportToXlsx();
    });
    document.getElementById('exportCsv').addEventListener('click', () => {
      document.getElementById('exportMenu').style.display = 'none';
      exportToCsv();
    });
    document.getElementById('exportPdf').addEventListener('click', () => {
      document.getElementById('exportMenu').style.display = 'none';
      exportToPdf();
    });

    /* ═══ Export ═══ */
    function visibleRows() {
      if (isPropertiesMode) {
        return getVisibleRecords().map((p) => ({
          "اسم العقار": localize(p.title) || localize(p.name) || '—',
          "النوع": typeLabel(p.type) || p.type || '—',
          "المنطقة": localize(p.location) || p.region || '—',
          "السعر (ر.ع)": p.price || 0,
          "المساحة (م²)": p.area || 0,
          "الحالة": statusLabel(p.status) || p.status || '—',
          "رابط الخريطة": p.locationUrl || ''
        }));
      }

      return getVisibleRecords().map((rec) => {
        const row = { ID: rec.id };
        (currentDb.fields || []).forEach((f) => {
          const v = rec[f.id];
          row[f.name] = Array.isArray(v) ? v.join(', ') : (v ?? '');
        });
        return row;
      });
    }

    function exportToXlsx() {
      const rows = visibleRows();
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      const dbName = isPropertiesMode ? (t('db.propertiesDbName') || 'العقارات') : (currentDb?.name || 'بيانات');
      XLSX.utils.book_append_sheet(wb, ws, dbName.slice(0, 31));
      XLSX.writeFile(wb, `${dbName}-${Date.now()}.xlsx`);
      toast(t('data.exportDone'));
    }

    function exportToCsv() {
      const rows = visibleRows();
      const ws = XLSX.utils.json_to_sheet(rows);
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const dbName = isPropertiesMode ? (t('db.propertiesDbName') || 'العقارات') : (currentDb?.name || 'بيانات');
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${dbName}-${Date.now()}.csv` });
      a.click(); URL.revokeObjectURL(a.href);
      toast(t('data.exportDone'));
    }

    function exportToPdf() {
      if (isPropertiesMode) {
        exportPropertiesPdf();
        return;
      }

      const lang = getLang();
      const fields = currentDb.fields || [];
      const visRecs = getVisibleRecords();
      const rows = visRecs.map((rec) =>
        `<tr>${fields.map((f) => {
          const v = rec[f.id];
          let display = '';
          if (v === null || v === undefined) display = '';
          else if (Array.isArray(v)) display = v.join(', ');
          else if (typeof v === 'object') display = JSON.stringify(v);
          else display = String(v);
          return `<td>${esc(display)}</td>`;
        }).join('')}</tr>`,
      ).join('');
      const dir = lang === 'ar' ? 'rtl' : 'ltr';
      const html = `<!doctype html><html dir="${dir}" lang="${lang}">
          <head><meta charset="utf-8"/><title>${esc(currentDb.name)}</title>
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap"/>
          </head>
          <body>
          <div class="report-header">
            <div class="brand-block">
              <div class="brand-name">Royalty Real Estate</div>
              <div class="brand-tagline">Data Report · ${new Date().toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
            </div>
            <div class="db-block">
              <div class="db-title">${esc(currentDb.icon || '')} ${esc(currentDb.name)}</div>
              <div class="db-meta">${visRecs.length} records${currentDb.description ? ' · ' + esc(currentDb.description) : ''}</div>
            </div>
          </div>
          <table>
            <thead><tr>${fields.map((f) => `<th>${esc(f.name)}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="footer">
            <span>Royalty Real Estate — Confidential</span>
            <span>${new Date().toLocaleString()}</span>
          </div>
          </body></html>`;
      const win = window.open('', '_blank');
      if (win) { win.document.write(html); win.document.close(); win.onload = () => { win.focus(); win.print(); }; }
    }

    function exportPropertiesPdf() {
      const container = document.createElement("div");
      container.style.position = "absolute";
      container.style.left = "0";
      container.style.top = "9999px";
      container.style.width = "800px";
      container.style.zIndex = "99999";
      container.style.background = "#ffffff";
      container.style.padding = "24px";
      container.style.direction = "rtl";
      container.style.fontFamily = "'IBM Plex Sans Arabic', sans-serif";

      const visRecs = getVisibleRecords();
      let tableRows = visRecs.map((p, idx) => `
        <tr style="${idx % 2 === 0 ? 'background:#fafafa;' : ''} border-bottom:1px solid #eee;">
          <td style="padding:8px;font-size:11px;font-family:'IBM Plex Sans Arabic',sans-serif;">${escapeHtml(localize(p.title) || localize(p.name) || '—')}</td>
          <td style="padding:8px;font-size:11px;font-family:'IBM Plex Sans Arabic',sans-serif;">${escapeHtml(typeLabel(p.type) || p.type || '—')}</td>
          <td style="padding:8px;font-size:11px;font-family:'IBM Plex Sans Arabic',sans-serif;">${escapeHtml(localize(p.location) || p.region || '—')}</td>
          <td style="padding:8px;font-size:11px;direction:ltr;text-align:right;font-family:sans-serif;">${p.price ? Number(p.price).toLocaleString('en-US') + ' ر.ع.' : '—'}</td>
          <td style="padding:8px;font-size:11px;direction:ltr;text-align:right;font-family:sans-serif;">${p.area ? Number(p.area).toLocaleString('en-US') + ' م²' : '—'}</td>
          <td style="padding:8px;font-size:11px;font-family:'IBM Plex Sans Arabic',sans-serif;"><span style="padding:3px 6px;border-radius:4px;font-size:10px;background:#fef3c7;color:#92400e;">${escapeHtml(statusLabel(p.status) || p.status || '—')}</span></td>
        </tr>
      `).join('');

      container.innerHTML = `
        <div style="border-bottom:2px solid #C6A24F;padding-bottom:12px;margin-bottom:16px;">
          <h1 style="font-size:20px;color:#C6A24F;margin:0;font-family:'IBM Plex Sans Arabic',sans-serif;">قائمة العقارات · الملكية للاستثمار</h1>
          <p style="font-size:10px;color:#7c7c7c;margin:4px 0 0 0;font-family:'IBM Plex Sans Arabic',sans-serif;">تاريخ التصدير: ${new Date().toLocaleDateString('ar-EG-u-nu-latn')}</p>
        </div>
        <table style="width:100%;border-collapse:collapse;text-align:right;font-family:'IBM Plex Sans Arabic',sans-serif;">
          <thead>
            <tr style="background:#FAF7F0;border-bottom:2px solid #eee;">
              <th style="padding:8px;font-size:12px;font-weight:700;">اسم العقار</th>
              <th style="padding:8px;font-size:12px;font-weight:700;">النوع</th>
              <th style="padding:8px;font-size:12px;font-weight:700;">المنطقة</th>
              <th style="padding:8px;font-size:12px;font-weight:700;text-align:right;">السعر</th>
              <th style="padding:8px;font-size:12px;font-weight:700;text-align:right;">المساحة</th>
              <th style="padding:8px;font-size:12px;font-weight:700;">الحالة</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      `;

      document.body.appendChild(container);
      const opt = {
        margin:       [10, 10, 10, 10],
        filename:     `تقرير_العقارات_${new Date().toISOString().slice(0,10)}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' }
      };

      html2pdf().from(container).set(opt).save().then(() => {
        container.remove();
        toast(t('data.exportDone'));
      }).catch((err) => {
        console.error(err);
        container.remove();
      });
    }

    /* ═══ Import Modal ═══ */
    let importParsedRows = [];
    let importHeaders = [];

    document.getElementById('importBtn').addEventListener('click', () => {
      importParsedRows = []; importHeaders = [];
      document.getElementById('importStep1').style.display = '';
      document.getElementById('importStep2').style.display = 'none';
      document.getElementById('importError').classList.add('hidden');
      document.getElementById('importModal').classList.remove('hidden');
      applyTranslations(document.getElementById('importModal'));
    });

    document.getElementById('importModalClose').addEventListener('click', () => { document.getElementById('importModal').classList.add('hidden'); });
    document.getElementById('importModal').addEventListener('click', (e) => { if (e.target === document.getElementById('importModal')) document.getElementById('importModal').classList.add('hidden'); });
    document.getElementById('importResetBtn').addEventListener('click', () => { document.getElementById('importModal').classList.add('hidden'); });

    const importDropZone = document.getElementById('importDropZone');
    const importFileInput = document.getElementById('importFileInput');
    importDropZone.addEventListener('click', () => importFileInput.click());
    importDropZone.addEventListener('dragover', (e) => { e.preventDefault(); importDropZone.classList.add('drag-over'); });
    importDropZone.addEventListener('dragleave', () => importDropZone.classList.remove('drag-over'));
    importDropZone.addEventListener('drop', (e) => { e.preventDefault(); importDropZone.classList.remove('drag-over'); if (e.dataTransfer.files[0]) processImportFile(e.dataTransfer.files[0]); });
    importFileInput.addEventListener('change', (e) => { if (e.target.files[0]) processImportFile(e.target.files[0]); e.target.value = ''; });

    function processImportFile(file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          importParsedRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
          if (!importParsedRows.length) { alert(t('db.importNoRows')); return; }
          importHeaders = Object.keys(importParsedRows[0]);
          showImportMapping();
        } catch (err) { alert(t('db.importError') + ': ' + err.message); }
      };
      reader.readAsArrayBuffer(file);
    }

    function showImportMapping() {
      document.getElementById('importStep1').style.display = 'none';
      document.getElementById('importStep2').style.display = '';
      document.getElementById('importRowCountMsg').textContent = `${importParsedRows.length} ${t('db.importRowsLoaded')}`;

      const fields = currentDb.fields || [];
      const fieldOpts = fields.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
      document.getElementById('importColMap').innerHTML = importHeaders.map((header) => {
        const match = fields.find((f) => f.name.toLowerCase() === header.toLowerCase());
        const sel = `<select class="import-col-target" data-header="${esc(header)}">
            <option value="">${t('db.importSkipCol')}</option>
            ${fields.map((f) => `<option value="${esc(f.id)}" ${f.id === match?.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
            <option value="__new__">${t('db.importCreateNew')}</option>
          </select>`;
        return `<div class="import-col-row">
            <span class="import-col-source">${esc(header)}</span>
            <span class="import-col-arrow">→</span>
            <div class="import-col-target">${sel}</div>
          </div>`;
      }).join('');
      applyTranslations(document.getElementById('importStep2'));
    }

    document.getElementById('importConfirmBtn').addEventListener('click', async () => {
      const spinner = document.getElementById('importSpinner');
      const label = document.getElementById('importConfirmLabel');
      const btn = document.getElementById('importConfirmBtn');
      const errEl = document.getElementById('importError');
      errEl.classList.add('hidden');
      btn.setAttribute('disabled', ''); spinner.classList.remove('hidden');
      label.textContent = t('db.importProgress');

      try {
        // Build mapping: header → fieldId (or __new__)
        const mapping = {};
        document.querySelectorAll('.import-col-target select').forEach((sel) => {
          if (sel.value) mapping[sel.dataset.header] = sel.value;
        });

        // Create new fields if needed
        const newFieldMap = {};
        for (const [header, target] of Object.entries(mapping)) {
          if (target === '__new__') {
            const newField = await addField(DB_ID, { name: header, type: 'text', required: false, options: [] });
            newFieldMap[header] = newField.id;
          }
        }
        currentDb = await getDatabase(DB_ID);

        // Build record rows
        const rows = importParsedRows.map((row) => {
          const rec = {};
          for (const [header, target] of Object.entries(mapping)) {
            const fieldId = target === '__new__' ? newFieldMap[header] : target;
            if (fieldId && row[header] !== undefined && row[header] !== '') {
              rec[fieldId] = row[header];
            }
          }
          return rec;
        });

        await importRecords(DB_ID, rows, currentUserId);
        document.getElementById('importModal').classList.add('hidden');
        await refreshRecords();
        toast(`${t('db.importDone')} — ${rows.length} ${t('db.importRowsLoaded')}`);
      } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.removeAttribute('disabled'); spinner.classList.add('hidden');
        label.textContent = t('db.importConfirmBtn');
      }
    });

    /* ═══ Data refresh ═══ */
    async function refreshRecords() {
      records = await listRecords(DB_ID);
      renderTable();
    }

    /* ═══ Bootstrap ═══ */
    onLangChange(() => { renderTable(); applyTranslations(); });

    (async () => {
      const ctx = await setupDashboard('database.html', { require: 'db.view' });
      currentUserId = ctx.user.uid;

      if (isPropertiesMode) {
        // Hide buttons not applicable to properties
        document.getElementById('importBtn').style.display = 'none';
        document.getElementById('manageFieldsBtn').style.display = 'none';

        // Update page header for Properties Mode
        document.title = `العقارات · Royalty Real Estate`;
        document.getElementById('dbHeaderIcon').innerHTML = renderDbIcon('building-2', 28);
        document.getElementById('dbHeaderName').textContent = 'العقارات';
        document.getElementById('dbHeaderDesc').textContent = 'قاعدة بيانات العقارات والأراضي بالمنصة';
        document.getElementById('dbHeader').style.display = 'flex';

        // Load Properties data
        document.getElementById('pageLoading').style.display = 'none';
        document.getElementById('dbContent').style.display = '';

        _propertiesWatchUnsubscribe = watchProperties((props) => {
          _allProps = props;
          renderTable();
        });
        applyTranslations();
        return;
      }

      currentDb = await getDatabase(DB_ID);
      document.getElementById('pageLoading').style.display = 'none';

      if (!currentDb) {
        document.getElementById('dbNotFound').style.display = '';
        return;
      }

      // Update page title
      document.title = `${currentDb.name} · Royalty Real Estate`;

      // Render header
      document.getElementById('dbHeaderIcon').innerHTML = renderDbIcon(currentDb.icon || 'database', 28);
      document.getElementById('dbHeaderName').textContent = currentDb.name;
      document.getElementById('dbHeaderDesc').textContent = currentDb.description || '';
      document.getElementById('dbHeader').style.display = 'flex';

      // Load and render custom db records
      records = await listRecords(DB_ID);
      document.getElementById('dbContent').style.display = '';
      renderTable();
      applyTranslations();
    })();