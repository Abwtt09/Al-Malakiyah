import {
      initI18n,
      applyTranslations,
      t,
      getLang,
      onLangChange,
    } from "../i18n.js";
    import { setupDashboard, toast } from "../portal-ui.js";
    import { escapeHtml, formatDate } from "../ui.js?v=2";
    import { watchProperties } from "../db.js";
    import {
      createDatabase,
      listDatabases,
      updateDatabase,
      deleteDatabase,
    } from "../databases-db.js";
    import { DB_ICONS, renderDbIcon } from "../db-icons.js";

    initI18n();

    let currentUserId = null;
    let databases = [];
    let editingDbId = null;
    let deletingDbId = null;
    let _propCount = '…';

    /* ── Pinned Properties card ── */
    function renderPinnedCard() {
      const icon = renderDbIcon('building-2', 22);
      return `
          <div class="db-card db-card-pinned">
            <div class="db-card-header">
              <div class="db-icon-badge">${icon}</div>
              <div class="db-card-meta">
                <p class="db-card-name">${escapeHtml(t('db.propertiesDbName'))}</p>
                <p class="db-card-desc">${escapeHtml(t('db.propertiesDbDesc'))}</p>
                <span class="db-built-in-badge">${escapeHtml(t('db.builtIn'))}</span>
              </div>
              <div class="db-card-menu"><!-- built-in: no edit/delete --></div>
            </div>
            <div class="db-card-stats" style="display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.75rem; border-top: 1px solid var(--ink-100); padding-top: 0.75rem; margin-top: 0.75rem; color: var(--ink-500);">
              <span style="white-space:nowrap;">سجل: <strong id="propdb-live-count" style="color:var(--ink-800);">${_propCount}</strong></span> · 
              <span style="white-space:nowrap;">حقل: <strong style="color:var(--ink-800);">9</strong></span>
            </div>
            <div class="db-card-actions" style="margin-top:0.75rem;">
              <a href="database.html" class="btn btn-primary btn-sm" style="flex:1;justify-content:center;">${t('db.openDb')}</a>
            </div>
          </div>`;
    }

    /* ── Icon picker ── */
    function buildIconPicker() {
      const picker = document.getElementById("dbIconPicker");
      picker.innerHTML = Object.keys(DB_ICONS)
        .map(
          (key) => `
          <button type="button" class="db-icon-opt" data-icon="${key}" title="${key}">
            ${renderDbIcon(key, 18)}
          </button>
        `,
        )
        .join("");
      picker.querySelectorAll(".db-icon-opt").forEach((btn) => {
        btn.addEventListener("click", () => {
          picker
            .querySelectorAll(".db-icon-opt")
            .forEach((b) => b.classList.remove("selected"));
          btn.classList.add("selected");
          document.getElementById("dbIconValue").value = btn.dataset.icon;
        });
      });
      setPickerIcon("database");
    }

    function setPickerIcon(icon) {
      const key = DB_ICONS[icon] ? icon : "database";
      const picker = document.getElementById("dbIconPicker");
      picker.querySelectorAll(".db-icon-opt").forEach((b) => {
        b.classList.toggle("selected", b.dataset.icon === key);
      });
      document.getElementById("dbIconValue").value = key;
    }

    /* ── Render cards ── */
    function renderCard(dbObj) {
      const rc = dbObj.recordCount ?? 0;
      const fc = (dbObj.fields || []).length;
      const created = dbObj.createdAt
        ? new Date(dbObj.createdAt).toLocaleDateString()
        : "—";
      const updated = dbObj.updatedAt
        ? new Date(dbObj.updatedAt).toLocaleDateString()
        : created;
      return `
          <div class="db-card">
            <div class="db-card-header">
              <div class="db-icon-badge">${renderDbIcon(dbObj.icon || "database", 22)}</div>
              <div class="db-card-meta">
                <p class="db-card-name">${escapeHtml(dbObj.name)}</p>
                ${dbObj.description ? `<p class="db-card-desc">${escapeHtml(dbObj.description)}</p>` : ""}
                ${dbObj.category ? `<p class="db-card-category">${escapeHtml(dbObj.category)}</p>` : ""}
              </div>
              <div class="db-card-menu">
                <button class="icon-btn db-edit-btn" data-db-id="${dbObj.id}" title="${escapeHtml(t("db.editSettings"))}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="icon-btn danger db-delete-btn" data-db-id="${dbObj.id}" title="${escapeHtml(t("db.deleteDb"))}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
              </div>
            </div>
            <div class="db-card-stats" style="display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.72rem; border-top: 1px solid var(--ink-100); padding-top: 0.75rem; margin-top: 0.75rem; color: var(--ink-500); line-height: 1.4;">
              <span style="white-space:nowrap;">سجل: <strong style="color:var(--ink-800);">${rc}</strong></span> · 
              <span style="white-space:nowrap;">حقل: <strong style="color:var(--ink-800);">${fc}</strong></span> · 
              <span style="white-space:nowrap;">إنشاء: <strong style="color:var(--ink-800);">${created}</strong></span> · 
              <span style="white-space:nowrap;">تحديث: <strong style="color:var(--ink-800);">${updated}</strong></span>
            </div>
            <div class="db-card-actions" style="margin-top:0.75rem;">
              <a href="database.html?id=${dbObj.id}" class="btn btn-outline btn-sm" style="flex:1;justify-content:center;">${t('db.openDb')}</a>
            </div>
          </div>`;
    }

    function renderGrid() {
      const grid = document.getElementById("dbGrid");
      const empty = document.getElementById("dbEmpty");
      document.getElementById("dbLoading").style.display = "none";

      // Pinned properties card is always first
      const pinnedHtml = renderPinnedCard();
      const userHtml = databases.map(renderCard).join("");
      grid.innerHTML = pinnedHtml + userHtml;
      grid.style.display = "grid";

      // Show the "create first" hint below the pinned card if no user DBs
      if (!databases.length) {
        empty.style.display = "none";
        // Inline create-first hint inside the grid as a subtle card
        const hint = document.createElement('div');
        hint.className = 'db-card';
        hint.style.cssText = 'border-style:dashed;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.75rem;min-height:10rem;cursor:pointer;';
        hint.innerHTML = `
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gray-light)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
            </svg>
            <p style="font-size:0.875rem;color:var(--gray);text-align:center;margin:0">${t('db.emptyHint')}</p>
            <button class="btn btn-primary btn-sm" id="createDbHintBtn" data-role-require="db.create">${t('db.createFirst')}</button>`;
        grid.appendChild(hint);
        hint.querySelector('#createDbHintBtn')?.addEventListener('click', openCreateModal);
      } else {
        empty.style.display = "none";
      }

      grid.querySelectorAll(".db-edit-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          openEditModal(btn.dataset.dbId);
        });
      });
      grid.querySelectorAll(".db-delete-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          openDeleteModal(btn.dataset.dbId);
        });
      });
    }

    async function loadDatabases() {
      try {
        databases = await listDatabases();
        renderGrid();
      } catch (e) {
        document.getElementById("dbLoading").style.display = "none";
        toast(t("common.error") + ": " + e.message);
      }
    }

    function startPropCounter() {
      watchProperties(props => {
        _propCount = props.length;
        // Update count inline without re-rendering the whole grid
        const el = document.getElementById('propdb-live-count');
        if (el) { el.textContent = _propCount; return; }
        // If pinned card not yet rendered, store for next renderGrid()
      });
    }

    /* ── Create / Edit modal ── */
    function openCreateModal() {
      editingDbId = null;
      document.getElementById("dbModalTitle").textContent =
        t("db.createTitle");
      document.getElementById("dbForm").reset();
      document.getElementById("dbFormError").classList.add("hidden");
      setPickerIcon("database");
      document.getElementById("dbModal").classList.remove("hidden");
      document.getElementById("dbNameInput").focus();
      applyTranslations(document.getElementById("dbModal"));
    }

    function openEditModal(dbId) {
      const dbObj = databases.find((d) => d.id === dbId);
      if (!dbObj) return;
      editingDbId = dbId;
      document.getElementById("dbModalTitle").textContent = t("db.editTitle");
      document.getElementById("dbNameInput").value = dbObj.name || "";
      document.getElementById("dbDescInput").value = dbObj.description || "";
      document.getElementById("dbCategoryInput").value = dbObj.category || "";
      document.getElementById("dbFormError").classList.add("hidden");
      setPickerIcon(dbObj.icon || "database");
      document.getElementById("dbModal").classList.remove("hidden");
      document.getElementById("dbNameInput").focus();
      applyTranslations(document.getElementById("dbModal"));
    }

    function closeDbModal() {
      document.getElementById("dbModal").classList.add("hidden");
      editingDbId = null;
    }

    document
      .getElementById("dbModalClose")
      .addEventListener("click", closeDbModal);
    document
      .getElementById("dbModalCancel")
      .addEventListener("click", closeDbModal);
    document.getElementById("dbModal").addEventListener("click", (e) => {
      if (e.target === document.getElementById("dbModal")) closeDbModal();
    });

    document
      .getElementById("dbForm")
      .addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const form = ev.currentTarget;
        const spinner = document.getElementById("dbSaveSpinner");
        const label = document.getElementById("dbSaveLabel");
        const errEl = document.getElementById("dbFormError");
        const btn = document.getElementById("dbSaveBtn");
        errEl.classList.add("hidden");
        btn.setAttribute("disabled", "");
        spinner.classList.remove("hidden");
        label.textContent = t("common.loading");

        const data = {
          name: form.elements.name.value.trim(),
          description: form.elements.description.value.trim(),
          category: form.elements.category.value.trim(),
          icon: document.getElementById("dbIconValue").value,
        };

        try {
          if (editingDbId) {
            await updateDatabase(editingDbId, data);
            toast(t("dashboard.save") || "Saved");
          } else {
            await createDatabase(data, currentUserId);
            toast(t("db.createBtn").replace("+ ", "") + " ✓");
          }
          closeDbModal();
          await loadDatabases();
        } catch (e) {
          errEl.textContent = t("common.error") + ": " + e.message;
          errEl.classList.remove("hidden");
        } finally {
          btn.removeAttribute("disabled");
          spinner.classList.add("hidden");
          label.textContent = t("db.saveDb");
        }
      });

    /* ── Delete modal ── */
    function openDeleteModal(dbId) {
      const dbObj = databases.find((d) => d.id === dbId);
      if (!dbObj) return;
      deletingDbId = dbId;
      document.getElementById("dbDeleteName").textContent = dbObj.name;
      document.getElementById("dbDeleteError").classList.add("hidden");
      document.getElementById("dbDeleteModal").classList.remove("hidden");
      applyTranslations(document.getElementById("dbDeleteModal"));
    }

    function closeDeleteModal() {
      document.getElementById("dbDeleteModal").classList.add("hidden");
      deletingDbId = null;
    }

    document
      .getElementById("dbDeleteModalClose")
      .addEventListener("click", closeDeleteModal);
    document
      .getElementById("dbDeleteCancel")
      .addEventListener("click", closeDeleteModal);
    document
      .getElementById("dbDeleteModal")
      .addEventListener("click", (e) => {
        if (e.target === document.getElementById("dbDeleteModal"))
          closeDeleteModal();
      });

    document
      .getElementById("dbDeleteConfirmBtn")
      .addEventListener("click", async () => {
        if (!deletingDbId) return;
        const spinner = document.getElementById("dbDeleteSpinner");
        const label = document.getElementById("dbDeleteLabel");
        const errEl = document.getElementById("dbDeleteError");
        const btn = document.getElementById("dbDeleteConfirmBtn");
        errEl.classList.add("hidden");
        btn.setAttribute("disabled", "");
        spinner.classList.remove("hidden");
        label.textContent = t("dashboard.deleting");
        try {
          await deleteDatabase(deletingDbId);
          closeDeleteModal();
          toast(t("db.deleteDb") + " ✓");
          await loadDatabases();
        } catch (e) {
          errEl.textContent = t("common.error") + ": " + e.message;
          errEl.classList.remove("hidden");
        } finally {
          btn.removeAttribute("disabled");
          spinner.classList.add("hidden");
          label.textContent = t("db.deleteDb");
        }
      });

    /* ── Wire create buttons ── */
    document
      .getElementById("createDbBtn")
      .addEventListener("click", openCreateModal);
    document
      .getElementById("createDbEmptyBtn")
      .addEventListener("click", openCreateModal);

    /* ── Re-render on lang change ── */
    onLangChange(() => {
      renderGrid();
      applyTranslations();
    });

    /* ── Bootstrap ── */
    buildIconPicker();
    document.getElementById("dbEmptyIcon").innerHTML = renderDbIcon(
      "database",
      56,
    );
    (async () => {
      const ctx = await setupDashboard("databases.html", {
        require: "db.view",
      });
      currentUserId = ctx.user.uid;
      startPropCounter();
      await loadDatabases();
      applyTranslations();
    })();