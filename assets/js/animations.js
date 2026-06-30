(function () {
  'use strict';

  const gsap = window.gsap;
  if (!gsap) return;

  document.documentElement.classList.add('gsap-ready');

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.classList.add('reduce-motion');
    return;
  }

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  const DUR = 0.25;
  const EASE = 'power2.out';
  const STAGGER = 0.06;

  /* ── Entrance: stagger cards ── */
  function animateEntrance() {
    const tl = gsap.timeline({ defaults: { duration: DUR, ease: EASE } });

    // Dashboard welcome
    const welcome = document.querySelector('.dash-welcome');
    if (welcome) tl.from(welcome, { y: 12, opacity: 0 }, 0);

    // Logo
    const logo = document.querySelector('.dash-logo-center');
    if (logo) tl.from(logo, { y: 10, opacity: 0 }, 0.05);

    // Quick nav cards
    const quickCards = document.querySelectorAll('.dash-quick-card');
    if (quickCards.length) {
      tl.from(quickCards, { y: 14, opacity: 0, stagger: STAGGER }, 0.1);
    }

    // Stat cards
    const statCards = document.querySelectorAll('.stat-card');
    if (statCards.length) {
      tl.from(statCards, { y: 12, opacity: 0, stagger: STAGGER }, 0.08);
    }

    // Table cards
    const tableCards = document.querySelectorAll('.table-card, .db-spreadsheet-container, .messages-list, .message-detail');
    if (tableCards.length) {
      tl.from(tableCards, { y: 10, opacity: 0, stagger: STAGGER }, 0.08);
    }

    // Dashboard header
    const dashHeader = document.querySelector('.dashboard-header');
    if (dashHeader) tl.from(dashHeader, { y: 10, opacity: 0 }, 0);

    // Toolbars
    const toolbars = document.querySelectorAll('.dashboard-toolbar, .db-toolbar, .propdb-toolbar, .map-toolbar');
    if (toolbars.length) {
      tl.from(toolbars, { y: 8, opacity: 0, stagger: STAGGER }, 0.05);
    }

    // Property cards
    const propCards = document.querySelectorAll('.prop-card');
    if (propCards.length) {
      tl.from(propCards, { y: 12, opacity: 0, stagger: STAGGER }, 0.08);
    }

    // DB cards
    const dbCards = document.querySelectorAll('.db-card');
    if (dbCards.length) {
      tl.from(dbCards, { y: 12, opacity: 0, stagger: STAGGER }, 0.08);
    }

    // Form sections
    const formSections = document.querySelectorAll('.form-section, .settings-section');
    if (formSections.length) {
      tl.from(formSections, { y: 10, opacity: 0, stagger: STAGGER }, 0.06);
    }
  }

  /* ── Sidebar links stagger (runs only once per session) ── */
  function animateSidebar() {
    const root = document.getElementById('sidebar');
    if (!root) return;

    // Only animate on the very first page load of the session.
    // On refresh / navigation within the same tab, skip the animation
    // so the sidebar appears instantly without a jarring re-entry.
    const DONE_KEY = 'almalakiyah.sidebarAnimated';
    const alreadyDone = sessionStorage.getItem(DONE_KEY);

    let done = false;
    const observer = new MutationObserver(() => {
      if (done) return;
      const links = root.querySelectorAll('.sidebar-link');
      if (!links.length) return;
      done = true;
      observer.disconnect();

      if (alreadyDone) {
        // Sidebar already animated this session — show instantly
        gsap.set(links, { opacity: 1, x: 0 });
      } else {
        sessionStorage.setItem(DONE_KEY, '1');
        gsap.from(links, {
          x: -10, opacity: 0,
          duration: 0.28, ease: 'power2.out', stagger: 0.045, delay: 0.05,
        });
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  }


  /* ── Table rows stagger on dynamic load ── */
  function watchTableRows() {
    const tables = document.querySelectorAll('.table-card tbody, .db-spreadsheet tbody, .propdb-table tbody');
    tables.forEach((tbody) => {
      let lastCount = 0;
      new MutationObserver(() => {
        const rows = Array.from(tbody.querySelectorAll('tr'));
        if (!rows.length || rows.length === lastCount) return;
        lastCount = rows.length;
        gsap.from(rows, { opacity: 0, x: -4, duration: 0.2, ease: EASE, stagger: 0.03 });
      }).observe(tbody, { childList: true });
    });
  }

  /* ── Watch for dynamically loaded stat cards ── */
  function watchStatGrid() {
    const grid = document.querySelector('.stat-grid');
    if (!grid) return;
    let done = false;
    new MutationObserver(() => {
      if (done) return;
      const cards = grid.querySelectorAll('.stat-card');
      if (cards.length < 2) return;
      done = true;
      gsap.from(cards, { y: 10, opacity: 0, duration: DUR, ease: EASE, stagger: STAGGER });
    }).observe(grid, { childList: true, subtree: true });
  }

  /* ── Watch for dynamically loaded property cards ── */
  function watchPropertyGrid() {
    const grid = document.getElementById('propGrid');
    if (!grid) return;
    const animated = new WeakSet();
    new MutationObserver(() => {
      const newCards = Array.from(grid.querySelectorAll('.prop-card')).filter(c => !animated.has(c));
      if (!newCards.length) return;
      newCards.forEach(c => animated.add(c));
      gsap.from(newCards, { y: 10, opacity: 0, duration: 0.2, ease: EASE, stagger: 0.04 });
    }).observe(grid, { childList: true });
  }

  /* ── Watch for async quick cards ── */
  function animateQuickCards() {
    const grid = document.getElementById('quickGrid');
    if (!grid) return;
    let done = false;
    const obs = new MutationObserver(() => {
      const cards = grid.querySelectorAll('.dash-quick-card');
      if (!cards.length || done) return;
      done = true; obs.disconnect();
      gsap.from(cards, { y: 12, opacity: 0, duration: DUR, ease: EASE, stagger: STAGGER });
    });
    obs.observe(grid, { childList: true, subtree: true });
    const existing = grid.querySelectorAll('.dash-quick-card');
    if (existing.length) {
      done = true; obs.disconnect();
      gsap.from(existing, { y: 12, opacity: 0, duration: DUR, ease: EASE, stagger: STAGGER, delay: 0.1 });
    }
  }

  /* ── Bootstrap ── */
  onReady(function () {
    animateEntrance();
    animateSidebar();
    watchTableRows();
    watchStatGrid();
    watchPropertyGrid();
    animateQuickCards();
  });

  /* ── Public API ── */
  window.__anim = {
    fadeUp:   (els, opts) => gsap.from(els, { y: 10, opacity: 0, duration: DUR, ease: EASE, stagger: STAGGER, ...(opts || {}) }),
    stagger:  (els, opts) => gsap.from(els, { y: 8, opacity: 0, duration: 0.2, ease: EASE, stagger: 0.04, ...(opts || {}) }),
    scrollTo: () => {},
  };
})();
