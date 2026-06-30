// Shared dashboard chrome — sidebar + auth guard + user pill + mobile drawer.
import { applyTranslations, onLangChange, setLang, getLang, LANGS, t } from './i18n.js';
import { signOut, requireAuth, changePassword } from './auth.js';
import { getUserProfile } from './db.js';
import { can, roleLabel, applyRoleGuards, normalizeRole } from './roles.js';
import { readCachedProfile, writeCachedProfile, clearCachedProfile } from './profile-cache.js';

/* ── Startup debug logger ────────────────────────────────────────── */
const _startupLog = [];
function _dbg(step, msg) {
  const t = Math.round(performance.now());
  const line = `[STARTUP STEP ${step}] ${msg} (${t}ms)`;
  _startupLog.push(line);
  console.log(line);
}
export function getStartupLog() { return [..._startupLog]; }

const ITEMS = [
  { href: '/admin/', key: 'dashboard.overview', icon: 'grid', perm: 'view' },
  { href: '/admin/messages.html', key: 'dashboard.messages', icon: 'inbox', perm: 'messages.read' },
  { href: '/admin/properties.html', key: 'dashboard.properties', icon: 'building', perm: 'view' },
  { href: '/admin/map.html', key: 'map.eyebrow', icon: 'map', perm: 'view' },
  { href: '/admin/databases.html', key: 'db.navTitle', icon: 'database', perm: 'db.view' },
];

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  map: '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
};

export async function setupDashboard(currentPath, opts = {}) {
  // Inject background glowing orbs if not on the map page
  if (currentPath !== 'map.html' && !document.querySelector('.glow-orb')) {
    const orb1 = document.createElement('div');
    orb1.className = 'glow-orb glow-orb-1';
    const orb2 = document.createElement('div');
    orb2.className = 'glow-orb glow-orb-2';
    document.body.prepend(orb1, orb2);
  }

  _dbg(1, 'Supabase Init — client initialized, entering setupDashboard');

  /* ─────────────────── PHASE 1: instant chrome ───────────────────
     Render the sidebar from a cached profile *synchronously*. This is
     what the user sees within the first paint — no waiting on Firebase. */
  const cached = readCachedProfile();
  if (cached?.role) {
    const cachedCtx = { user: { uid: cached.uid, email: cached.email }, profile: cached, role: cached.role };
    renderTopbar(currentPath, cachedCtx);
    renderSidebar(currentPath, cachedCtx);
    renderMobileBar(currentPath, { role: cached.role });
    applyRoleGuards(document, cached.role);
    onLangChange(() => applyRoleGuards(document, cached.role));
  }

  /* ─────────────────── PHASE 2: background verify ─────────────────── */
  _dbg(2, 'Auth Ready — checking Supabase session');
  let user;
  try {
    user = await requireAuth();
    _dbg(2, `Auth Ready — signed in as uid=${user.uid}`);
  } catch (e) {
    // If auth fails and we have a cached profile, use it as fallback
    if (cached && e.message !== 'not signed in') {
      _dbg(2, `Auth error — using cached session as fallback`);
      user = { uid: cached.uid, email: cached.email };
    } else {
      clearCachedProfile();
      _dbg(2, `Auth FAILED: ${e.message}`);
      throw new Error('not signed in');
    }
  }



  _dbg(3, `DB Ready — fetching profile for uid=${user.uid}`);
  let profile = null;
  let profileFetchFailed = false;
  let profileFetchError = '';
  try {
    profile = await Promise.race([
      getUserProfile(user.uid),
      new Promise((_, rej) => setTimeout(() => rej(new Error('profile_timeout')), 20000)),
    ]);
    _dbg(3, profile
      ? `Firestore Ready — profile loaded role=${profile.role}`
      : 'Firestore Ready — profile document does not exist');
  } catch (e) {
    _dbg(3, `Firestore FAILED: ${e.message} — will use cached profile as fallback if available`);
    profileFetchError = e.message || String(e);
    // Network error or timeout: fall back to cached profile so the user isn't
    // kicked out on every slow page navigation. Only the role/permissions matter
    // here, not freshness — they'll be refreshed on the next successful load.
    if (cached) {
      profile = { ...cached };
      _dbg(3, `Using cached profile (role=${cached.role}) due to Firestore error`);
    } else {
      profileFetchFailed = true;
    }
  }

  if (profileFetchFailed) {
    document.body.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;text-align:center;font-family:system-ui;background:#fafaf7;color:#1c1917;">
      <div style="background:rgba(255,255,255,0.8);backdrop-filter:blur(20px);padding:2.5rem;border-radius:1.25rem;border:1px solid rgba(255,255,255,0.72);box-shadow:0 8px 32px rgba(43,43,43,0.08);max-width:28rem;">
        <div style="background:#fef3c7;color:#d97706;width:3rem;height:3rem;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1.5rem;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/></svg>
        </div>
        <p style="font-size:0.75rem;letter-spacing:.18em;text-transform:uppercase;color:#78716c;margin-bottom:0.5rem;font-weight:600;">DATABASE CONNECTION ERROR</p>
        <h1 style="font-size:1.375rem;margin:0 0 1rem;font-weight:700;color:#1c1917;font-family:'IBM Plex Sans Arabic', sans-serif;">فشل الاتصال بقاعدة البيانات</h1>
        <p style="color:#57534e;margin:0 0 2rem;font-size:0.9rem;line-height:1.6;font-family:'IBM Plex Sans Arabic', sans-serif;">
          تعذر تحميل بيانات الحساب من الخادم. يرجى التحقق من اتصال الإنترنت وإعادة المحاولة.<br>
          <span style="font-size:0.8rem;color:#dc2626;font-family:system-ui;display:block;margin-top:0.5rem;">Error: ${profileFetchError}</span>
        </p>
        <button onclick="window.location.reload()" style="background:#bca374;color:#fff;border:none;padding:0.75rem 2rem;font-size:0.9375rem;border-radius:0.75rem;cursor:pointer;font-weight:600;box-shadow:0 4px 12px rgba(188,163,116,0.25);transition:transform 0.15s, opacity 0.15s;font-family:'IBM Plex Sans Arabic', sans-serif;">إعادة المحاولة / Retry</button>
      </div>
    </div>`;
    throw new Error('profile_fetch_failed');
  }

  if (!profile || profile.disabled === true) {
    clearCachedProfile();
    try { await signOut(); } catch {}
    sessionStorage.setItem(
      'almalakiyah.loginError',
      profile?.disabled
        ? 'تم تعطيل حسابك. تواصل مع مسؤول النظام.\nYour account has been disabled.'
        : 'حسابك غير مفعّل في النظام. تواصل مع مسؤول النظام.\nYour account is not active. Contact your system administrator.',
    );
    window.location.replace('/admin/login.html');
    throw new Error('no access');
  }

  // Force first-time setup flow if not complete
  if (profile.isSetupComplete === false && normalizePath(currentPath) !== 'setup') {
    window.location.replace('/admin/setup.html');
    throw new Error('setup incomplete');
  }

  const role = normalizeRole(profile.role);
  _dbg(4, `Role Resolved — role=${role}, proceeding to render sidebar and register Firestore watchers`);

  // Page-level permission gate
  if (opts.require && !can(role, opts.require)) {
    document.body.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;text-align:center;font-family:system-ui;background:#fafaf7;">
      <div>
        <p style="font-size:0.7rem;letter-spacing:.18em;text-transform:uppercase;color:#7c7c7c;">403</p>
        <h1 style="font-size:2rem;margin:1rem 0;">Access denied</h1>
        <p style="color:#525252;max-width:24rem;margin:0 auto 1.5rem;">ليس لديك صلاحية لعرض هذه الصفحة. You do not have permission to view this page.</p>
        <a href="./" style="color:#0d0d0d;text-decoration:underline;text-underline-offset:4px;">→ Dashboard</a>
      </div>
    </div>`;
    throw new Error('permission denied');
  }

  // Persist fresh profile so the NEXT page load is instant.
  writeCachedProfile({ uid: user.uid, email: user.email, ...profile, role });

  // Re-render chrome only if no cached version was shown, or profile changed.
  if (!cached || cached.role !== role || cached.name !== profile.name) {
    renderTopbar(currentPath, { user, profile, role });
    renderSidebar(currentPath, { user, profile, role });
    renderMobileBar(currentPath, { role });
    applyRoleGuards(document, role);
    onLangChange(() => applyRoleGuards(document, role));
  }

  _dbg(5, 'Dashboard Loaded — setupDashboard resolved, Firestore watchers will register now');
  return { user, profile, role };
}

function logoSvg() {
  return `
    <img src="../assets/img/logo.png" alt="" class="logo-mark">
    <span class="logo-text">
      <span class="logo-name">الملكية للإستثمار</span>
    </span>`;
}

function normalizePath(p) {
  // Strip .html extension, leading ./ or /, and optional admin/ prefix
  // so that paths with or without the prefix/extension compare equal.
  // Empty result (root / index) normalises to 'index'.
  const stripped = (p || '')
    .replace(/\.html$/i, '')
    .replace(/^\.?\//, '')
    .replace(/^admin\//, '');
  return stripped || 'index';
}

function navItemsHtml(currentPath, role) {
  const normalCurrent = normalizePath(currentPath);
  return ITEMS.filter((it) => can(role, it.perm))
    .map(
      (it) => `
      <a href="${it.href}" class="sidebar-link ${normalCurrent === normalizePath(it.href) ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[it.icon]}</svg>
        <span data-i18n="${it.key}"></span>
      </a>`,
    )
    .join('');
}

function userPillHtml({ user, profile, role }) {
  const name = profile?.name || user.email || '—';
  const initial = (profile?.name || user.email || '?').slice(0, 1).toUpperCase();
  return `
    <div class="user-pill-container">
      <button class="user-pill" id="userPillBtn" aria-label="User menu" aria-haspopup="true" aria-expanded="false">
        <div class="user-avatar">${escape(initial)}</div>
        <div class="user-info">
          <p class="name">${escape(name)}</p>
          <p class="role" data-role-label="${role}">${escape(roleLabel(role, getLang()))}</p>
        </div>
        <svg class="user-pill-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="user-dropdown" id="userDropdown" style="display: none;">
        <a href="/admin/settings.html" class="dropdown-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span data-i18n="dashboard.settings">الإعدادات</span>
        </a>
        <button class="dropdown-item signout-btn text-danger">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span data-i18n="dashboard.signOut">تسجيل الخروج</span>
        </button>
      </div>
    </div>
  `;
}

function langSwitcherHtml() {
  const lang = getLang();
  return `
    <div class="lang-switcher">
      ${LANGS.map((l) => `<button data-lang="${l.value}" class="${lang === l.value ? 'active' : ''}">${l.native}</button>`).join('')}
    </div>`;
}

function renderSidebar(currentPath, ctx) {
  const target = document.getElementById('sidebar');
  if (!target) return;

  target.innerHTML = `
    <aside class="dashboard-sidebar">
      <nav class="sidebar-nav">
        ${navItemsHtml(currentPath, ctx.role)}
      </nav>
    </aside>
  `;

  wireSidebar(target);
}

export function toggleDrawer(open = true) {
  const drawer = document.getElementById('dashboardDrawer');
  const overlay = document.getElementById('drawerOverlay');
  if (!drawer || !overlay) return;

  if (open) {
    drawer.style.display = 'flex';
    overlay.style.display = 'block';
    document.body.style.overflow = 'hidden';
    window.__lenis?.stop();
    void drawer.offsetHeight;
    drawer.classList.add('is-open');
    overlay.classList.add('is-open');
  } else {
    drawer.classList.remove('is-open');
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
    window.__lenis?.start();
    setTimeout(() => {
      if (!drawer.classList.contains('is-open')) {
        drawer.style.display = 'none';
        overlay.style.display = 'none';
      }
    }, 380);
  }
}

function renderTopbar(currentPath, ctx) {
  const existing = document.getElementById('dashTopbar');
  if (existing) existing.remove();

  const el = document.createElement('header');
  el.id = 'dashTopbar';
  el.className = 'dashboard-topbar';
  el.innerHTML = `
    <button class="mobile-menu-btn" id="openDrawerBtn" aria-label="Open menu">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
    <a href="./" class="logo">${logoSvg()}</a>
    <div class="topbar-spacer"></div>
    <div class="topbar-user">
      ${userPillHtml(ctx)}
    </div>
  `;
  document.body.prepend(el);
  wireTopbar(el);
}

function wireTopbar(root) {
  const pillBtn = root.querySelector('#userPillBtn');
  const dropdown = root.querySelector('#userDropdown');
  if (pillBtn && dropdown) {
    const toggle = (e) => {
      e.stopPropagation();
      const isOpen = dropdown.style.display === 'block';
      dropdown.style.display = isOpen ? 'none' : 'block';
      pillBtn.setAttribute('aria-expanded', !isOpen);
    };
    pillBtn.addEventListener('click', toggle);
    
    // Close when clicking anywhere else
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && !pillBtn.contains(e.target)) {
        dropdown.style.display = 'none';
        pillBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  root.querySelector('.signout-btn')?.addEventListener('click', async () => {
    clearCachedProfile();
    try { await signOut(); } catch {}
    window.location.replace('/admin/login.html');
  });
  root.querySelector('#openDrawerBtn')?.addEventListener('click', () => {
    toggleDrawer(true);
  });
  applyTranslations(root);
  onLangChange(() => {
    root.querySelectorAll('[data-role-label]').forEach((el) => {
      el.textContent = roleLabel(el.getAttribute('data-role-label'), getLang());
    });
    applyTranslations(root);
  });
}

/* ── Mobile: slide-in drawer + overlay ── */
function renderMobileBar(currentPath, ctx) {
  // Inject once. If already mounted (cached pass), reuse.
  if (document.getElementById('mobileBar')) return;
  if (!ctx?.role) return;

  const bar = document.createElement('div');
  bar.id = 'mobileBar';
  bar.innerHTML = `
    <div class="drawer-overlay" id="drawerOverlay" style="display:none;"></div>

    <aside class="dashboard-drawer" id="dashboardDrawer" style="display:none;">
      <div class="drawer-head">
        <a href="./" class="logo">${logoSvg()}</a>
        <button class="drawer-close" id="closeDrawerBtn" aria-label="Close menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <nav class="drawer-nav">
        ${navItemsHtml(currentPath, ctx.role)}
      </nav>
      <div class="drawer-bottom">
        ${getDrawerUserPill()}
      </div>
    </aside>
  `;
  document.body.prepend(bar);
  wireMobileBar(bar);
}

function getDrawerUserPill() {
  // drawer signout removed as requested
  return '';
}

function wireSidebar(root) {
  root.querySelectorAll('.lang-switcher button').forEach((btn) =>
    btn.addEventListener('click', () => setLang(btn.getAttribute('data-lang'))),
  );

  applyTranslations(root);
  onLangChange(() => {
    root.querySelectorAll('.lang-switcher button').forEach((btn) =>
      btn.classList.toggle('active', btn.getAttribute('data-lang') === getLang()),
    );
    applyTranslations(root);
  });
}

function wireMobileBar(root) {
  const drawer = root.querySelector('#dashboardDrawer');
  const overlay = root.querySelector('#drawerOverlay');
  const closeBtn = root.querySelector('#closeDrawerBtn');

  closeBtn?.addEventListener('click', () => toggleDrawer(false));
  overlay?.addEventListener('click', () => toggleDrawer(false));

  // Prevent clicks INSIDE the drawer from bubbling to document-level handlers
  // (e.g. context-menu closers), but ONLY for non-link elements so that
  // <a href> navigation is never blocked.
  drawer.addEventListener('click', (e) => {
    if (!e.target.closest('a[href]')) e.stopPropagation();
  });

  // Each nav link: close the drawer, then let the browser navigate via href
  drawer.querySelectorAll('.sidebar-link').forEach((a) => {
    a.addEventListener('click', () => toggleDrawer(false));
  });

  // Close on Esc
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) {
      toggleDrawer(false);
    }
  });

  // Lang switcher
  drawer.querySelectorAll('.lang-switcher button').forEach((btn) =>
    btn.addEventListener('click', () => setLang(btn.getAttribute('data-lang'))),
  );

  // Sign out
  drawer.querySelector('.drawer-signout')?.addEventListener('click', async () => {
    clearCachedProfile();
    try { await signOut(); } catch {}
    window.location.replace('/admin/login.html');
  });

  applyTranslations(root);
  onLangChange(() => {
    drawer.querySelectorAll('.lang-switcher button').forEach((btn) =>
      btn.classList.toggle('active', btn.getAttribute('data-lang') === getLang()),
    );
    applyTranslations(root);
  });
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* simple toast */
export function toast(message, ms = 2400) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
