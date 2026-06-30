import { initI18n, applyTranslations, getLang, setLang, LANGS, t } from '../i18n.js';
    import { setupDashboard } from '../portal-ui.js';
    import { signOut, changePassword } from '../auth.js';
    import { can } from '../roles.js';

    initI18n();

    (async () => {
      let ctx;
      try {
        ctx = await setupDashboard('settings.html');
      } catch (err) {
        const silent = ['not signed in', 'no access', 'permission denied'];
        if (!silent.includes(err.message)) console.error('[settings]', err);
        return;
      }

      const { profile } = ctx;
      applyTranslations();

      // ── Language switcher ──
      const langWrap = document.getElementById('settingsLangSwitcher');
      function renderLang() {
        const cur = getLang();
        langWrap.innerHTML = LANGS.map(l =>
          `<button class="${l.value === cur ? 'active' : ''}" data-lang="${l.value}">${l.native}</button>`
        ).join('');
      }
      renderLang();
      langWrap.addEventListener('click', e => {
        const btn = e.target.closest('[data-lang]');
        if (!btn) return;
        setLang(btn.dataset.lang);
        applyTranslations();
        renderLang();
      });

      // ── Change Password ──
      const pwdForm = document.getElementById('pwdForm');
      const pwdMsg = document.getElementById('pwdMsg');
      const pwdSaveBtn = document.getElementById('pwdSaveBtn');

      pwdForm.addEventListener('submit', async e => {
        e.preventDefault();
        const current = document.getElementById('fCurrentPwd').value;
        const next = document.getElementById('fNewPwd').value;
        const confirm = document.getElementById('fConfirmPwd').value;

        pwdMsg.style.display = 'none';

        if (!current || !next) return;
        if (next !== confirm) {
          pwdMsg.textContent = t('dashboard.passwordMismatch');
          pwdMsg.style.color = '#C0392B';
          pwdMsg.style.display = 'block';
          return;
        }

        pwdSaveBtn.disabled = true;
        try {
          await changePassword(current, next);
          pwdMsg.textContent = t('dashboard.passwordChanged');
          pwdMsg.style.color = '#1A6B36';
          pwdMsg.style.display = 'block';
          pwdForm.reset();
        } catch (err) {
          pwdMsg.textContent = err.message || t('common.error');
          pwdMsg.style.color = '#C0392B';
          pwdMsg.style.display = 'block';
        } finally {
          pwdSaveBtn.disabled = false;
        }
      });

      // ── Sign Out ──
      document.getElementById('signOutBtn').addEventListener('click', async () => {
        await signOut();
        location.href = 'login.html';
      });

      // ── Admin section visibility ──
      const role = profile?.role || 'viewer';
      if (can(role, 'users.read')) {
        document.getElementById('sectionAdmin').style.display = 'block';
      }

    })();