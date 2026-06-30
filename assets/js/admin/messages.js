import {
      initI18n,
      applyTranslations,
      t,
      onLangChange,
    } from "../i18n.js";
    import { setupDashboard, toast } from "../portal-ui.js";
    import {
      listMessagesForUser,
      listMessagesSentBy,
      markMessageRead,
      deleteMessage,
      logActivity,
      sendMessage,
      listUsers,
    } from "../db.js";
    import { formatDate, escapeHtml } from "../ui.js?v=2";

    initI18n();

    let inbox = [];
    let sent = [];
    let users = [];
    let active = null;
    let tab = "inbox";
    let currentRole = "viewer";
    let currentUserId = null;
    let currentUserName = "";

    function userLookup(uid) {
      return users.find((u) => u.id === uid) || null;
    }

    function visibleList() {
      return tab === "inbox" ? inbox : sent;
    }

    function render() {
      const wrap = document.getElementById("messagesArea");
      const list = visibleList();
      if (list.length === 0) {
        wrap.innerHTML = `<div class="empty-state surface" data-i18n="dashboard.noMessages"></div>`;
        applyTranslations(wrap);
        return;
      }
      wrap.innerHTML = `
          <div class="messages-grid">
            <ul class="messages-list">
              ${list
          .map((m) => {
            const isRead = (m.readBy || {})[currentUserId];
            const peer =
              tab === "inbox"
                ? m.fromName || userLookup(m.fromUid)?.name || "—"
                : m.toAll
                  ? t("dashboard.broadcast")
                  : m.recipientsSummary || "—";
            return `
                  <li>
                    <button class="msg ${isRead || tab === "sent" ? "read" : ""} ${active?.id === m.id ? "active" : ""}" data-id="${escapeHtml(m.id)}">
                      <div class="row">
                        <span class="name">${escapeHtml(peer)}</span>
                        ${!isRead && tab === "inbox" ? `<span class="badge badge-dark" data-i18n="dashboard.new"></span>` : ""}
                      </div>
                      <span class="sub">${escapeHtml(m.subject || "")}</span>
                      <span class="date">${escapeHtml(formatDate(m.createdAt))}</span>
                    </button>
                  </li>
                `;
          })
          .join("")}
            </ul>
            <div id="messageDetail">
              ${active
          ? renderDetail(active)
          : `<div class="empty-state surface" data-i18n="dashboard.selectMessage"></div>`
        }
            </div>
          </div>
        `;
      applyTranslations(wrap);
      wrap
        .querySelectorAll("[data-id]")
        .forEach((btn) =>
          btn.addEventListener("click", () =>
            selectMessage(btn.getAttribute("data-id")),
          ),
        );
      wireDetail();
      import("../roles.js").then((m) =>
        m.applyRoleGuards(wrap, currentRole),
      );
    }

    function renderDetail(m) {
      const sender = userLookup(m.fromUid);
      const senderName = m.fromName || sender?.name || "—";
      const senderPhone = sender?.phone;
      const recipients = m.toAll
        ? t("dashboard.broadcast")
        : (m.toUids || [])
          .map((uid) => userLookup(uid)?.name || uid)
          .join("، ");

      return `
          <article class="message-detail">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
              <div style="min-width:0;flex:1;">
                <p class="eyebrow mb-4" data-i18n="dashboard.from"></p>
                <h2>${escapeHtml(senderName)}</h2>
                ${senderPhone ? `<p class="meta num" style="margin-top:0.25rem;">${escapeHtml(senderPhone)}</p>` : ""}
              </div>
              <button class="icon-btn danger" id="deleteMsgBtn" data-role-require="messages.delete" aria-label="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            </div>
            <div style="margin-top:1.5rem;padding-top:1.25rem;border-top:1px solid var(--ink-100);font-size:0.875rem;">
              <p><span style="color:var(--ink-500);">${escapeHtml(t("dashboard.to"))} — </span>${escapeHtml(recipients)}</p>
              <p style="margin-top:0.5rem;"><span style="color:var(--ink-500);">${escapeHtml(t("dashboard.composeSubject"))} — </span>${escapeHtml(m.subject || "")}</p>
              <p style="margin-top:0.5rem;font-size:0.75rem;color:var(--ink-400);">${escapeHtml(formatDate(m.createdAt))}</p>
            </div>
            <div class="message-body">${escapeHtml(m.body || "")}</div>
            ${senderPhone
          ? `
              <div style="margin-top:1.5rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
                <a href="tel:${escapeHtml(senderPhone)}" class="btn btn-outline btn-sm">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                  <span data-i18n="dashboard.callByPhone"></span>
                </a>
              </div>`
          : ""
        }
          </article>
        `;
    }

    function wireDetail() {
      const btn = document.getElementById("deleteMsgBtn");
      if (btn)
        btn.addEventListener("click", async () => {
          if (!confirm(t("dashboard.deleteConfirm"))) return;
          try {
            await deleteMessage(active.id);
            await logActivity({
              action: "deleted",
              targetType: "message",
              targetId: active.id,
              userId: currentUserId,
            });
            inbox = inbox.filter((x) => x.id !== active.id);
            sent = sent.filter((x) => x.id !== active.id);
            active = null;
            render();
          } catch (e) {
            alert(e.message);
          }
        });
    }

    async function selectMessage(id) {
      const m = visibleList().find((x) => x.id === id);
      if (!m) return;
      active = m;
      if (tab === "inbox" && !(m.readBy || {})[currentUserId]) {
        try {
          await markMessageRead(id, currentUserId);
          m.readBy = { ...(m.readBy || {}), [currentUserId]: Date.now() };
        } catch { }
      }
      render();
    }

    async function load() {
      try {
        [inbox, sent] = await Promise.all([
          listMessagesForUser(currentUserId),
          listMessagesSentBy(currentUserId),
        ]);
      } catch (e) {
        console.error(e);
        inbox = [];
        sent = [];
      }
      render();
    }

    // tab switching
    document.querySelectorAll("#msgTabs button").forEach((b) =>
      b.addEventListener("click", () => {
        tab = b.getAttribute("data-tab");
        document
          .querySelectorAll("#msgTabs button")
          .forEach((x) => x.classList.toggle("active", x === b));
        active = null;
        render();
      }),
    );

    /* ── compose ── */
    const modal = document.getElementById("composeModal");
    const form = document.getElementById("composeForm");
    const errorEl = document.getElementById("composeError");
    const sendBtn = document.getElementById("sendBtn");
    const sendLabel = document.getElementById("sendLabel");

    function renderRecipients() {
      const picker = document.getElementById("recipientPicker");
      const eligible = users.filter((u) => u.id !== currentUserId);
      if (eligible.length === 0) {
        picker.innerHTML = `<p style="font-size:0.75rem;color:var(--ink-400);">—</p>`;
        return;
      }
      picker.innerHTML = eligible
        .map(
          (u) => `
          <label class="chip" style="cursor:pointer;">
            <input type="checkbox" value="${escapeHtml(u.id)}" data-recipient style="margin-inline-end:0.25rem;" />
            ${escapeHtml(u.name || u.username || u.id)}
          </label>
        `,
        )
        .join("");
    }

    document.getElementById("composeBtn").addEventListener("click", () => {
      form.reset();
      document.getElementById("toAll").checked = false;
      errorEl.classList.add("hidden");
      renderRecipients();
      modal.classList.remove("hidden");
    });
    document
      .getElementById("cancelCompose")
      .addEventListener("click", () => modal.classList.add("hidden"));
    document
      .getElementById("closeCompose")
      .addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", (e) => {
      if (e.target.id === "composeModal") modal.classList.add("hidden");
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.classList.add("hidden");

      const toAll = document.getElementById("toAll").checked;
      const toUids = Array.from(
        form.querySelectorAll("[data-recipient]:checked"),
      ).map((x) => x.value);
      if (!toAll && toUids.length === 0) {
        errorEl.textContent = t("dashboard.composeSelectRecipients");
        errorEl.classList.remove("hidden");
        return;
      }

      sendBtn.setAttribute("disabled", "");
      sendLabel.textContent = t("dashboard.composeSending");
      try {
        const recipientsSummary = toAll
          ? t("dashboard.broadcast")
          : toUids.map((uid) => userLookup(uid)?.name || uid).join("، ");
        const id = await sendMessage({
          fromUid: currentUserId,
          fromName: currentUserName,
          subject: form.elements.subject.value.trim(),
          body: form.elements.body.value.trim(),
          toUids: toAll ? [] : toUids,
          toAll,
          recipientsSummary,
          channels: {
            email: form.elements.chEmail.checked,
            sms: form.elements.chSms.checked,
          },
        });
        await logActivity({
          action: "created",
          targetType: "message",
          targetId: id,
          userId: currentUserId,
          meta: { subject: form.elements.subject.value },
        });
        modal.classList.add("hidden");
        toast("✓");
        tab = "sent";
        document
          .querySelectorAll("#msgTabs button")
          .forEach((b) =>
            b.classList.toggle(
              "active",
              b.getAttribute("data-tab") === "sent",
            ),
          );
        load();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove("hidden");
      } finally {
        sendBtn.removeAttribute("disabled");
        sendLabel.textContent = t("dashboard.composeSend");
      }
    });

    onLangChange(() => render());

    (async () => {
      const ctx = await setupDashboard("messages.html", {
        require: "messages.read",
      });
      currentRole = ctx.role;
      currentUserId = ctx.user.uid;
      currentUserName = ctx.profile?.name || ctx.profile?.username || "—";
      try {
        users = await listUsers();
      } catch {
        users = [];
      }
      applyTranslations();
      load();
    })();