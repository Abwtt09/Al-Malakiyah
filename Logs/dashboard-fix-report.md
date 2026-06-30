# Dashboard Fix Report — 2026-06-03

---

## Issue 1 — Startup hangs forever (loading screen never clears)

### Root cause

`persistentMultipleTabManager` in `firebase-config.js` uses cross-tab IndexedDB locking.
On Firebase Hosting, orphaned heartbeat entries (from fast reloads, navigations, or multiple users)
cause the new Firestore instance to wait indefinitely for the lock. Every `getDoc` and `onSnapshot`
call is queued silently — no error, no timeout, no rejection. The queue never drains.

**Exact location:**
```
File:  assets/js/firebase-config.js
Line:  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
```

**Fix:** Changed to `persistentSingleTabManager`, which never acquires a cross-tab lock.
Initialization completes immediately on every page load.

**Why localhost works / Firebase Hosting fails:**
- Localhost: single developer, fresh browser state, IndexedDB never accumulates orphaned entries
- Firebase Hosting: real traffic, multiple users, fast reloads → orphaned heartbeats accumulate

### Secondary fixes

- `requireAuth()` now rejects with `Error('auth_timeout')` after 10 s — `assets/js/auth.js`
- `getUserProfile()` wrapped in 8 s `Promise.race` — `assets/js/portal-ui.js`
- `onSnapshot` calls now have `onErr` callbacks — `assets/js/firestore.js`
- Global 10 s startup timer with error UI — `index.html`
- `[STARTUP STEP N]` logs in browser console — `assets/js/portal-ui.js`

---

## Issue 2 — `SyntaxError: ui.js does not provide export 'priceHtml'`

### Root cause

**The code is not broken. The browser is serving a stale cached file.**

`firebase.json` applied `Cache-Control: public, max-age=31536000, immutable` to all files matching
`assets/**/*.@(css|js|svg|png|jpg|jpeg|webp|woff2)`.

The `immutable` directive instructs browsers: *"This URL's content will never change — never
re-fetch it."* When the previous deployment's `ui.js` (which had not yet received `priceHtml`) was
first downloaded, every user's browser cached it permanently.

When the developer deployed the updated `ui.js` (with `priceHtml` at line 35), the browser saw the
same URL, assumed the content was identical, and served the old file. The import statement in
`index.html` asked for `priceHtml`, the stale module didn't have it, and the browser threw:

```
Uncaught SyntaxError: The requested module './assets/js/ui.js'
does not provide an export named 'priceHtml'
```

**Why localhost works:** The local dev server does not send `Cache-Control: immutable`. The browser
fetches fresh files on every page load and always gets the current `ui.js`.

### Full import/export audit

Every import across every file was verified against every export. **Zero genuine mismatches exist.**

| File | Imports from ui.js | All valid? |
|------|-------------------|------------|
| `index.html` | `priceHtml, formatDate, escapeHtml, localize` | ✓ |
| `properties.html` | `formatPrice, priceHtml, formatDate, statusLabel, escapeHtml, localize, searchHaystack` | ✓ |
| `property-edit.html` | `escapeHtml, googleMapsEmbedUrl, OMR_SYMBOL_SVG` | ✓ |
| `messages.html` | `formatDate, escapeHtml` | ✓ |
| `users.html` | `formatDate, escapeHtml` | ✓ |
| `attachments.html` | `formatDate, escapeHtml` | ✓ |

All cross-module imports in `.js` files (`portal-ui.js`, `auth.js`, `firestore.js`, `cloudinary.js`,
`admin-auth.js`, `ui.js`) were also verified. No broken imports anywhere.

### Fix — two parts

**Part 1: Cache-bust the stale `ui.js`** (immediate — fixes existing browsers)

Changed every `ui.js` reference from `assets/js/ui.js` to `assets/js/ui.js?v=2` in all 8 HTML files
(both `<link rel="modulepreload">` and `import` statements). The browser sees a new URL, gets a cache
miss, and downloads the current `ui.js` which exports `priceHtml`.

Files updated:
- `index.html`
- `properties.html`
- `property-edit.html`
- `messages.html`
- `users.html`
- `attachments.html`
- `login.html`
- `404.html`

**Part 2: Fix the cache policy** (structural — prevents recurrence)

Changed `firebase.json` to separate JS/CSS from images:

```diff
- "source": "assets/**/*.@(css|js|svg|png|jpg|jpeg|webp|woff2)",
- "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]

+ "source": "assets/**/*.@(js|css)",
+ "headers": [{ "key": "Cache-Control", "value": "no-cache" }]

+ "source": "assets/**/*.@(svg|png|jpg|jpeg|webp|woff2)",
+ "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
```

JS and CSS files change between deployments — `immutable` is wrong for them.
Images and fonts never change at the same URL — `immutable` is correct for them.

With `no-cache`, the browser revalidates JS/CSS on every page load. The server returns `304 Not
Modified` if unchanged (fast, zero bandwidth). If changed, the browser downloads the new version.

---

## Files Changed (combined)

| File | Change |
|------|--------|
| `firebase-config.js` | `persistentMultipleTabManager` → `persistentSingleTabManager` |
| `firebase.json` | JS/CSS: `no-cache`; images: keep `immutable` |
| `auth.js` | `requireAuth` 10 s timeout |
| `portal-ui.js` | Profile fetch timeout, `[STARTUP STEP N]` logs |
| `firestore.js` | `onErr` callbacks on watch functions |
| `index.html` | Global startup timeout, `ui.js?v=2` |
| `properties.html` | `ui.js?v=2`, load timeout |
| `property-edit.html` | `ui.js?v=2` |
| `messages.html` | `ui.js?v=2` |
| `users.html` | `ui.js?v=2` |
| `attachments.html` | `ui.js?v=2` |
| `login.html` | `ui.js?v=2` (modulepreload only) |
| `404.html` | `ui.js?v=2` (modulepreload only) |

---

## Verification Steps

1. `firebase deploy --only hosting`
2. Open `https://royalty-real.web.app` in an incognito window (clean state)
3. DevTools → Network tab: confirm `ui.js?v=2` returns HTTP 200 with fresh content
4. DevTools → Console: confirm `[STARTUP STEP 1]` through `[STARTUP STEP 6]` print in order
5. Confirm loading spinners are replaced by live data
6. Return visit (same tab): DevTools → Network → `ui.js?v=2` should return HTTP 304 (cached, revalidated)

---

## Why `immutable` + no cache-busting = disaster

```
First deploy:   ui.js  (no priceHtml)  →  browser caches with immutable
Second deploy:  ui.js  (has priceHtml) →  browser ignores (immutable = never refetch)
Import runs:    import { priceHtml } from './assets/js/ui.js'
Browser serves: old cached ui.js (no priceHtml)
Result:         SyntaxError
```

`immutable` is only safe when the URL itself changes on every content change (e.g., `ui.abc123.js`
with a content hash). Without a build tool generating hashed filenames, JS files must use `no-cache`.
