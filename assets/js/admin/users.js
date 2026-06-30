import {
        initI18n,
        applyTranslations,
        onLangChange,
        getLang,
        t,
      } from "../i18n.js";
      import {setupDashboard, toast} from "../portal-ui.js";
      import {
        listUsers,
        setUserProfile,
        deleteUser,
        disableUser,
        enableUser,
        updateUserRole,
        logActivity,
      } from "../db.js";
      import {formatDate, escapeHtml} from "../ui.js?v=2";
      import {roleLabel, ROLES, isAdminOwner} from "../roles.js";
      import {createUserAccount} from "../admin-auth.js";

      initI18n();

      let items = [];
      let editing = null; // null = add mode, object = edit mode
      let currentUser = null;
      let currentRole = "viewer";

      function render() {
        const wrap = document.getElementById("usersTable");
        if (items.length === 0) {
          wrap.innerHTML = `<div class="empty-state" data-i18n="dashboard.noUsers"></div>`;
          applyTranslations(wrap);
          return;
        }
        const lang = getLang();
        wrap.innerHTML = `
          <table>
            <thead>
              <tr>
                <th data-i18n="dashboard.userName"></th>
                <th data-i18n="dashboard.tableRole"></th>
                <th class="desktop-only" data-i18n="dashboard.tableJoined"></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${items
                .map(
                  (u) => `
                <tr>
                  <td>
                    <div style="min-width:0;">
                      <p style="font-size:0.875rem;font-weight:500;color:var(--ink-900);">${escapeHtml(u.name || "—")}</p>
                      <p class="num" style="font-size:0.75rem;color:var(--ink-500);">@${escapeHtml(u.username || u.id || "")}${u.phone ? " · " + escapeHtml(u.phone) : ""}${u.disabled ? ' · <span style="color:#dc2626;">معطّل</span>' : ""}</p>
                    </div>
                  </td>
                  <td>
                    <select class="field-select" data-role-for="${escapeHtml(u.id)}" style="padding:0.4rem 0.75rem;font-size:0.8125rem;">
                      ${ROLES.map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${escapeHtml(roleLabel(r, lang))}</option>`).join("")}
                    </select>
                  </td>
                  <td class="desktop-only" style="font-size:0.75rem;color:var(--ink-500);">${u.createdAt ? escapeHtml(formatDate(u.createdAt)) : "—"}</td>
                  <td>
                    <div class="table-actions">
                      <button class="icon-btn" data-edit="${escapeHtml(u.id)}" aria-label="Edit" title="${t("dashboard.editUser")}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button class="icon-btn ${u.disabled ? "" : "danger"}" data-toggle="${escapeHtml(u.id)}" data-disabled="${u.disabled ? "1" : "0"}" aria-label="${u.disabled ? "Enable" : "Disable"}" title="${u.disabled ? "تفعيل" : "تعطيل"}">
                        ${
                          u.disabled
                            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
                            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>'
                        }
                      </button>
                      <button class="icon-btn danger" data-remove="${escapeHtml(u.id)}" data-name="${escapeHtml(u.name || "")}" aria-label="Remove">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        `;

        wrap.querySelectorAll("[data-role-for]").forEach((sel) =>
          sel.addEventListener("change", async () => {
            const uid = sel.getAttribute("data-role-for");
            const role = sel.value;
            try {
              await updateUserRole(uid, role);
              await logActivity({
                action: "roleChanged",
                targetType: "user",
                targetId: uid,
                userId: currentUser.uid,
                meta: {role},
              });
              toast("✓");
              const u = items.find((x) => x.id === uid);
              if (u) u.role = role;
            } catch (e) {
              alert(e.message);
              render();
            }
          }),
        );

        wrap.querySelectorAll("[data-edit]").forEach((btn) =>
          btn.addEventListener("click", () => {
            const uid = btn.getAttribute("data-edit");
            const u = items.find((x) => x.id === uid);
            if (!u) return;
            editing = u;
            form.reset();
            form.elements.name.value = u.name || "";
            form.elements.username.value = u.username || "";
            form.elements.phone.value = u.phone || "";
            form.elements.role.value = u.role || "viewer";
            // edit mode: username readonly, password optional
            form.elements.username.setAttribute("readonly", "");
            form.elements.username.style.opacity = "0.6";
            form.elements.password.removeAttribute("required");
            document.getElementById("pwdHint").textContent =
              "اتركها فارغة إذا لم تريد تغيير كلمة المرور";
            document.getElementById("userModalTitle").textContent = t(
              "dashboard.userEditTitle",
            );
            errorEl.classList.add("hidden");
            modal.classList.remove("hidden");
          }),
        );

        wrap.querySelectorAll("[data-toggle]").forEach((btn) =>
          btn.addEventListener("click", async () => {
            const uid = btn.getAttribute("data-toggle");
            const isDisabled = btn.getAttribute("data-disabled") === "1";
            if (uid === currentUser.uid) return;
            try {
              if (isDisabled) await enableUser(uid);
              else await disableUser(uid);
              const u = items.find((x) => x.id === uid);
              if (u) u.disabled = !isDisabled;
              toast("✓");
              render();
            } catch (e) {
              alert(e.message);
            }
          }),
        );

        wrap.querySelectorAll("[data-remove]").forEach((btn) =>
          btn.addEventListener("click", async () => {
            const uid = btn.getAttribute("data-remove");
            if (uid === currentUser.uid)
              return alert("Cannot remove yourself.");
            if (!confirm(t("dashboard.removeUserConfirm"))) return;
            try {
              await deleteUser(uid);
              await logActivity({
                action: "deleted",
                targetType: "user",
                targetId: uid,
                userId: currentUser.uid,
                meta: {name: btn.getAttribute("data-name")},
              });
              items = items.filter((x) => x.id !== uid);
              render();
            } catch (e) {
              alert(e.message);
            }
          }),
        );

        applyTranslations(wrap);
      }

      async function load() {
        try {
          items = await listUsers();
        } catch (e) {
          console.error(e);
          items = [];
        }
        render();
      }

      // Add user flow
      const modal = document.getElementById("userModal");
      const form = document.getElementById("userForm");
      const errorEl = document.getElementById("userFormError");

      function openAddModal() {
        editing = null;
        form.reset();
        form.elements.username.removeAttribute("readonly");
        form.elements.username.style.opacity = "";
        form.elements.username.setAttribute("required", "");
        form.elements.password.setAttribute("required", "");
        document
          .getElementById("pwdHint")
          .setAttribute("data-i18n", "dashboard.userPasswordHint");
        document.getElementById("pwdHint").textContent = t(
          "dashboard.userPasswordHint",
        );
        form.elements.role.value = "editor";
        errorEl.classList.add("hidden");
        document.getElementById("userModalTitle").textContent = t(
          "dashboard.addUser",
        ).replace(/^\+\s*/, "");
        modal.classList.remove("hidden");
      }

      const closeModal = () => {
        modal.classList.add("hidden");
        editing = null;
      };

      document
        .getElementById("addUserBtn")
        .addEventListener("click", openAddModal);
      document
        .getElementById("cancelUser")
        .addEventListener("click", closeModal);
      document
        .getElementById("closeUserModal")
        .addEventListener("click", closeModal);
      modal.addEventListener("click", (e) => {
        if (e.target.id === "userModal") closeModal();
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errorEl.classList.add("hidden");
        const saveBtn = document.getElementById("saveUserBtn");
        const spinner = document.getElementById("userSaveSpinner");
        const label = document.getElementById("saveUserLabel");
        saveBtn.setAttribute("disabled", "");
        spinner.classList.remove("hidden");
        label.textContent = t("dashboard.saving");

        try {
          if (editing) {
            // ── EDIT MODE ──
            const payload = {
              name: form.elements.name.value.trim(),
              phone: form.elements.phone.value.trim() || null,
              role: form.elements.role.value,
            };
            await setUserProfile(editing.id, payload);
            await logActivity({
              action: "updated",
              targetType: "user",
              targetId: editing.id,
              userId: currentUser.uid,
              meta: {name: payload.name},
            });
            toast(t("dashboard.userEdited"));
            closeModal();
            load();
          } else {
            // ── ADD MODE ──
            const username = form.elements.username.value.trim().toLowerCase();
            const password = form.elements.password.value;
            const uid = await createUserAccount(username, password);
            const payload = {
              name: form.elements.name.value.trim(),
              username,
              phone: form.elements.phone.value.trim() || null,
              role: form.elements.role.value,
              disabled: false,
              createdAt: Date.now(),
              isSetupComplete: false,
            };
            await setUserProfile(uid, payload);
            await logActivity({
              action: "created",
              targetType: "user",
              targetId: uid,
              userId: currentUser.uid,
              meta: {role: payload.role, username},
            });
            toast(t("dashboard.userCreated"));
            closeModal();
            load();
          }
        } catch (err) {
          const code = err.code || "";
          let msg = err.message;
          if (code === "auth/email-already-in-use")
            msg = t("dashboard.userExists");
          else if (code === "auth/weak-password")
            msg = t("dashboard.userWeakPassword");
          errorEl.textContent = msg;
          errorEl.classList.remove("hidden");
        } finally {
          saveBtn.removeAttribute("disabled");
          spinner.classList.add("hidden");
          label.textContent = t("dashboard.saveUser");
        }
      });

      onLangChange(() => render());

      (async () => {
        const ctx = await setupDashboard("users.html", {
          require: "users.read",
        });
        currentUser = ctx.user;
        currentRole = ctx.role;
        applyTranslations();
        load();
      })();