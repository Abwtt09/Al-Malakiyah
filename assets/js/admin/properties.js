import { initI18n, applyTranslations, onLangChange, t } from '../i18n.js';
    import { setupDashboard } from '../portal-ui.js';
    import { watchProperties, deleteProperty, logActivity } from '../db.js';
    import { priceHtml, statusLabel, typeLabel, escapeHtml, localize, searchHaystack } from '../ui.js?v=2';

    initI18n();

    let all = [];
    let pendingDelete = null;
    let currentRole = 'viewer';
    let currentUserId = null;

    const filters = { search: '', status: 'all', type: 'all', region: 'all', minPrice: null, maxPrice: null, minArea: null, maxArea: null };

    function applyFilters() {
      return all.filter(p => {
        if (filters.search) {
          const hay = [
            searchHaystack(p.title),
            searchHaystack(p.location),
            p.type, p.region,
            p.propertyCode || '',
          ].join(' ').toLowerCase();
          if (!hay.includes(filters.search)) return false;
        }
        if (filters.status !== 'all' && p.status !== filters.status) return false;
        if (filters.type !== 'all' && p.type !== filters.type) return false;
        if (filters.region !== 'all') {
          const r = (localize(p.location) || p.region || '').toLowerCase();
          if (r !== filters.region) return false;
        }
        if (filters.minPrice != null && (p.price ?? 0) < filters.minPrice) return false;
        if (filters.maxPrice != null && (p.price ?? 0) > filters.maxPrice) return false;
        if (filters.minArea != null && (p.area ?? p.areaSize ?? 0) < filters.minArea) return false;
        if (filters.maxArea != null && (p.area ?? p.areaSize ?? 0) > filters.maxArea) return false;
        return true;
      });
    }

    function refreshRegions() {
      const sel = document.getElementById('regionFilter');
      const cur = sel.value;
      const regions = [...new Set(
        all.map(p => (localize(p.location) || p.region || '').trim()).filter(Boolean)
      )].sort();
      const allLabel = t('dashboard.allRegions') || 'جميع المناطق';
      sel.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>` +
        regions.map(r => `<option value="${escapeHtml(r.toLowerCase())}"${cur === r.toLowerCase() ? ' selected' : ''}>${escapeHtml(r)}</option>`).join('');
    }

    function cardHtml(p) {
      const img = p.images?.[0];
      const title = escapeHtml(localize(p.title) || '—');
      const location = localize(p.location);
      const area = (p.area || p.areaSize)
        ? `${Number(p.area || p.areaSize).toLocaleString('en-US')} ${p.unit || 'm²'}`
        : '';
      const viewUrl = `property-view.html?id=${encodeURIComponent(p.id)}`;
      return `
          <div class="prop-card" data-view-href="${viewUrl}" style="cursor:pointer;">
            <div class="prop-card-img">
              ${img
          ? `<img src="${escapeHtml(img)}" alt="" loading="lazy">`
          : `<div class="prop-card-img-placeholder">
                     <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                       <rect x="3" y="3" width="18" height="18" rx="2"/>
                       <circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                     </svg>
                   </div>`}
              <span class="badge badge-${escapeHtml(p.status || 'available')}">${escapeHtml(statusLabel(p.status))}</span>
              <div class="prop-card-actions-overlay">
                <a class="icon-btn" href="property-edit.html?id=${encodeURIComponent(p.id)}" data-role-require="properties.edit" aria-label="Edit" title="${escapeHtml(t('dashboard.editPropertyTitle') || 'Edit')}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </a>
                <button class="icon-btn danger" data-id="${escapeHtml(p.id)}" data-title="${title}" data-role-require="properties.delete" aria-label="Delete">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
                </button>
              </div>
            </div>
            <div class="prop-card-body">
              <div class="prop-card-meta">
                <span class="badge badge-muted" style="font-size:0.65rem;">${escapeHtml(typeLabel(p.type) || '—')}</span>
                ${area ? `<span>${escapeHtml(area)}</span>` : ''}
              </div>
              <h3 class="prop-card-name">${title}</h3>
              ${location ? `<p class="prop-card-location">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                ${escapeHtml(location)}
              </p>` : ''}
              ${p.notes ? `<p class="prop-card-notes" style="font-size: 0.75rem; color: #d9b86c; margin-top: 0.25rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(p.notes)}">
                <strong>ملاحظة:</strong> ${escapeHtml(p.notes)}
              </p>` : ''}
              <div class="prop-card-footer">${priceHtml(p.price)}</div>
            </div>
          </div>`;
    }

    function render() {
      const filtered = applyFilters();
      const grid = document.getElementById('propGrid');
      const countEl = document.getElementById('propCount');

      countEl.textContent = filtered.length
        ? `${filtered.length} ${t('dashboard.propertiesCount') || ''}`
        : '';

      if (!filtered.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
            <strong>${all.length === 0 ? t('dashboard.noProperties') : t('properties.noMatches')}</strong>
            ${all.length === 0
            ? `<a href="property-edit.html" style="display:block;margin-top:.5rem;text-decoration:underline;text-underline-offset:4px;color:var(--ink-900);">${t('dashboard.addFirst')}</a>`
            : `<p style="margin-top:.375rem;font-size:.8125rem;color:var(--ink-500);">${t('properties.noMatchesHint')}</p>`}
          </div>`;
        return;
      }

      grid.innerHTML = filtered.map(cardHtml).join('');

      grid.querySelectorAll('.prop-card[data-view-href]').forEach(card => {
        card.addEventListener('click', e => {
          if (e.target.closest('.prop-card-actions-overlay')) return;
          location.href = card.dataset.viewHref;
        });
      });

      grid.querySelectorAll('.icon-btn.danger[data-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          pendingDelete = { id: btn.dataset.id, title: btn.dataset.title };
          document.getElementById('deleteName').textContent = pendingDelete.title;
          document.getElementById('deleteModal').classList.remove('hidden');
        });
      });

      import('../roles.js').then(m => m.applyRoleGuards(grid, currentRole));
    }

    // ── Filter wiring ──
    document.getElementById('searchInput').addEventListener('input', e => {
      filters.search = e.target.value.trim().toLowerCase();
      render();
    });
    document.getElementById('typeFilter').addEventListener('change', e => {
      filters.type = e.target.value; render();
    });
    document.getElementById('regionFilter').addEventListener('change', e => {
      filters.region = e.target.value; render();
    });
    document.getElementById('minPrice').addEventListener('input', e => {
      filters.minPrice = e.target.value !== '' ? parseFloat(e.target.value) : null; render();
    });
    document.getElementById('maxPrice').addEventListener('input', e => {
      filters.maxPrice = e.target.value !== '' ? parseFloat(e.target.value) : null; render();
    });
    document.getElementById('minArea').addEventListener('input', e => {
      filters.minArea = e.target.value !== '' ? parseFloat(e.target.value) : null; render();
    });
    document.getElementById('maxArea').addEventListener('input', e => {
      filters.maxArea = e.target.value !== '' ? parseFloat(e.target.value) : null; render();
    });
    document.getElementById('statusFilters').addEventListener('click', e => {
      const btn = e.target.closest('[data-status]');
      if (!btn) return;
      document.querySelectorAll('#statusFilters [data-status]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filters.status = btn.dataset.status;
      render();
    });

    // ── Delete modal ──
    const deleteModal = document.getElementById('deleteModal');
    const closeDeleteModal = () => { deleteModal.classList.add('hidden'); pendingDelete = null; };
    document.getElementById('cancelDelete').addEventListener('click', closeDeleteModal);
    document.getElementById('modalCloseBtn').addEventListener('click', closeDeleteModal);
    deleteModal.addEventListener('click', e => { if (e.target === deleteModal) closeDeleteModal(); });

    document.getElementById('confirmDelete').addEventListener('click', async e => {
      if (!pendingDelete) return;
      const btn = e.currentTarget;
      btn.setAttribute('disabled', '');
      btn.textContent = t('dashboard.deleting');
      try {
        await deleteProperty(pendingDelete.id);
        await logActivity({
          action: 'deleted', targetType: 'property',
          targetId: pendingDelete.id, userId: currentUserId,
          meta: { title: pendingDelete.title },
        });
        closeDeleteModal();
      } catch (err) {
        alert(err.message);
      } finally {
        btn.removeAttribute('disabled');
        btn.textContent = t('dashboard.delete');
      }
    });

    onLangChange(() => { applyTranslations(); refreshRegions(); render(); });

    (async () => {
      try {
        const ctx = await setupDashboard('properties.html');
        currentRole = ctx.role;
        currentUserId = ctx.user.uid;
      } catch (err) {
        const silent = ['not signed in', 'no access', 'permission denied'];
        if (!silent.includes(err.message)) console.error('[properties]', err);
        return;
      }
      applyTranslations();

      // Advanced filters toggle drawer handler
      const toggleBtn = document.getElementById('btnAdvancedToggle');
      const advancedSection = document.getElementById('advancedFiltersSection');
      if (toggleBtn && advancedSection) {
        toggleBtn.addEventListener('click', () => {
          const isHidden = advancedSection.style.display === 'none';
          advancedSection.style.display = isHidden ? 'block' : 'none';
          toggleBtn.classList.toggle('active', isHidden);
          // Highlight background to show advanced filters are active if user starts typing in them
        });
      }

      watchProperties(props => {
        all = props;
        refreshRegions();
        render();
      }, err => {
        console.error('[watchProperties]', err);
        document.getElementById('propGrid').innerHTML =
          `<p class="empty-state" style="grid-column:1/-1;color:#dc2626;">فشل تحميل العقارات · ${escapeHtml(err.message)}</p>`;
      });
    })();