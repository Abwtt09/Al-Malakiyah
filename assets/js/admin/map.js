import {
      initI18n,
      applyTranslations,
      t,
      getLang,
      onLangChange,
    } from "../i18n.js";
    import { setupDashboard } from "../portal-ui.js";
    import { watchProperties } from "../db.js";
    import {
      escapeHtml,
      localize,
      formatPrice,
      formatArea,
      statusLabel,
    } from "../ui.js";

    console.log("[map] module script started");

    /* ── Ensure Leaflet is loaded (handles CDN failures) ── */
    function ensureLeaflet() {
      return new Promise((resolve, reject) => {
        if (typeof L !== "undefined" && L.map) return resolve();
        const cdn = [
          "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
          "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
        ];
        let i = 0;
        function tryCdn() {
          if (i >= cdn.length) {
            reject(new Error("Leaflet failed to load from all CDNs"));
            return;
          }
          console.log("[map] loading Leaflet from", cdn[i]);
          const s = document.createElement("script");
          s.src = cdn[i];
          s.onload = () => {
            // Check again after script loads
            if (typeof L !== "undefined" && L.map) resolve();
            else tryCdn();
          };
          s.onerror = () => tryCdn();
          document.head.appendChild(s);
          i++;
        }
        tryCdn();
      });
    }

    /* ── Async wrapper so we can catch all errors ── */
    (async function main() {
      try {
        initI18n();

        /* ══════════════════════════════════════════
       STATUS / KIND helpers
    ══════════════════════════════════════════ */
        const STATUS_COLOR = {
          available: "#16a34a",
          reserved: "#d97706",
          sold: "#dc2626",
          rented: "#3730a3",
          "under-development": "#2563eb",
          default: "#6b7280",
        };
        const STATUS_BADGE_CLS = {
          available: "badge-available",
          reserved: "badge-reserved",
          sold: "badge-sold",
          rented: "badge-rented",
        };
        const STATUS_AR = {
          available: "معروض",
          reserved: "محجوز",
          sold: "مباع",
          rented: "مؤجر",
          "under-development": "قيد التطوير",
        };
        const KIND_AR = { land: "أرض", property: "عقار" };
        const CAT_AR = {
          residential: "سكني",
          commercial: "تجاري",
          agricultural: "زراعي",
        };

        function sColor(s) {
          return STATUS_COLOR[s] || STATUS_COLOR.default;
        }

        function makeIcon(p) {
          const c = sColor(p.status);
          const isLand = p.kind === "land" || p.type === "land";
          if (isLand) {
            return L.divIcon({
              html: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
              <rect x="2" y="2" width="22" height="22" rx="5" fill="${c}" opacity=".9"/>
              <path d="M7 18 L13 8 L19 18 Z" fill="white" opacity=".9"/>
            </svg>`,
              iconSize: [26, 26],
              iconAnchor: [13, 13],
              popupAnchor: [0, -14],
              className: "",
            });
          }
          return L.divIcon({
            html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
            <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="${c}" opacity=".92"/>
            <circle cx="14" cy="14" r="5" fill="white" opacity=".9"/>
          </svg>`,
            iconSize: [28, 36],
            iconAnchor: [14, 36],
            popupAnchor: [0, -36],
            className: "",
          });
        }

        function makeSelectionIcon() {
          return L.divIcon({
            html: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 28 36">
            <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="#C6A24F" opacity="1"/>
            <circle cx="14" cy="14" r="5" fill="white" opacity="1"/>
          </svg>`,
            iconSize: [32, 42],
            iconAnchor: [16, 42],
            popupAnchor: [0, -36],
            className: "mp-selection-pin",
          });
        }

        function updateSelectionPin(p) {
          if (selectionMarker) {
            map.removeLayer(selectionMarker);
            selectionMarker = null;
          }
          if (!p) return;

          let latlng = null;
          if (hasBoundary(p)) {
            const gj = L.geoJSON(boundaryToGeoJSON(p.boundary));
            if (gj.getBounds().isValid()) {
              latlng = gj.getBounds().getCenter();
            }
          } else {
            const c = getCoords(p);
            if (c) latlng = L.latLng(c.lat, c.lng);
          }

          if (latlng) {
            selectionMarker = L.marker(latlng, { icon: makeSelectionIcon(), zIndexOffset: 1000 });
            selectionMarker.addTo(map);
          }
        }

        /* ══════════════════════════════════════════
       BOUNDARY helpers
    ══════════════════════════════════════════ */
        function hasBoundary(p) {
          const b = p.boundary;
          if (!b) return false;
          if (b.points && b.points.length >= 3) return true;
          if (b.geometry?.coordinates?.[0]?.length >= 3) return true;
          if (
            b.type === "Feature" &&
            b.geometry?.coordinates?.[0]?.length >= 3
          )
            return true;
          return false;
        }
        function boundaryToGeoJSON(b) {
          if (!b) return null;
          // Format 1: { points: [{lat, lng}, ...] }
          if (b.points && b.points.length >= 3) {
            const coords = b.points.map((pt) => [pt.lng, pt.lat]);
            const [f, l] = [coords[0], coords[coords.length - 1]];
            if (f[0] !== l[0] || f[1] !== l[1]) coords.push([...f]);
            return {
              type: "Feature",
              geometry: { type: "Polygon", coordinates: [coords] },
            };
          }
          // Format 2: GeoJSON Feature or geometry
          if (b.geometry?.coordinates?.[0]?.length >= 3) {
            return { type: "Feature", geometry: b.geometry };
          }
          if (
            b.type === "Feature" &&
            b.geometry?.coordinates?.[0]?.length >= 3
          ) {
            return b;
          }
          return null;
        }
        function getCoords(p) {
          if (p.coordinates?.lat && p.coordinates?.lng) return p.coordinates;
          if (p.kmlCoordinates) {
            const pts = p.kmlCoordinates
              .split(",")
              .map((s) => parseFloat(s.trim()));
            if (pts.length >= 2 && isFinite(pts[0]) && isFinite(pts[1]))
              return { lat: pts[0], lng: pts[1] };
          }
          return null;
        }
        function getBoundaryPoints(p) {
          const b = p.boundary;
          if (!b) return [];
          if (b.points && b.points.length >= 3) return b.points;
          if (b.geometry?.coordinates?.[0]) {
            return b.geometry.coordinates[0]
              .slice(0, -1)
              .map((c) => ({ lat: c[1], lng: c[0] }));
          }
          if (b.type === "Feature" && b.geometry?.coordinates?.[0]) {
            return b.geometry.coordinates[0]
              .slice(0, -1)
              .map((c) => ({ lat: c[1], lng: c[0] }));
          }
          return [];
        }
        function calcBoundaryArea(pts) {
          const n = pts.length;
          if (n < 3) return 0;
          const mLat = 111320;
          const cLat = pts.reduce((s, p) => s + p.lat, 0) / n;
          const mLng = mLat * Math.cos((cLat * Math.PI) / 180);
          let area = 0;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += pts[i].lng * mLng * pts[j].lat * mLat;
            area -= pts[j].lng * mLng * pts[i].lat * mLat;
          }
          return Math.abs(area / 2);
        }
        function fmtArea(m2) {
          if (!m2) return "—";
          if (m2 >= 1e6) return (m2 / 1e6).toFixed(3) + " كم²";
          return (
            m2.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " م²"
          );
        }

        /* ══════════════════════════════════════════
       MAP INIT
    ══════════════════════════════════════════ */
        await ensureLeaflet();
        console.log("[map] Leaflet ready, initializing map");
        const map = L.map("mapCanvas", {
          center: [22.5, 57.5],
          zoom: 6,
          zoomControl: true,
          attributionControl: true,
        });
        // Tile layers
        const satLayer = L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          {
            maxZoom: 20,
            attribution: "&copy; Esri, Maxar",
          },
        ).addTo(map);
        const satRefLayer = L.tileLayer(
          "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
          {
            maxZoom: 20,
            attribution: "",
            pane: "overlayPane",
          },
        ).addTo(map);
        const normalLayer = L.tileLayer(
          "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors",
          },
        );

        // Layer switcher
        function setLayer(mode) {
          const satBtn = document.getElementById("satelliteBtn");
          const norBtn = document.getElementById("normalBtn");
          if (mode === "satellite") {
            map.removeLayer(normalLayer);
            map.addLayer(satLayer);
            map.addLayer(satRefLayer);
            satBtn.classList.add("active");
            norBtn.classList.remove("active");
          } else {
            map.removeLayer(satLayer);
            map.removeLayer(satRefLayer);
            map.addLayer(normalLayer);
            norBtn.classList.add("active");
            satBtn.classList.remove("active");
          }
        }
        document
          .getElementById("satelliteBtn")
          .addEventListener("click", () => setLayer("satellite"));
        document
          .getElementById("normalBtn")
          .addEventListener("click", () => setLayer("normal"));

        requestAnimationFrame(() => map.invalidateSize());

        const polygonLayer = L.featureGroup().addTo(map);
        const markerLayer = L.featureGroup().addTo(map);
        let initialFit = false;

        /* ══════════════════════════════════════════
       STATE
    ══════════════════════════════════════════ */
        let allProps = [];
        let activeId = null;
        let selectionMarker = null;

        const F = {
          search: "",
          kind: "",
          category: "",
          status: "",
          region: "",
          areaMin: null,
          areaMax: null,
          priceMin: null,
          priceMax: null,
        };

        function matchesFilter(p) {
          if (F.kind && p.kind !== F.kind) return false;
          if (F.category) {
            const cat =
              p.category || (p.kind === "land" && !p.category ? "land" : "");
            if (cat !== F.category) return false;
          }
          if (F.status && p.status !== F.status) return false;
          if (F.search) {
            const hay = [
              localize(p.title, "ar") || localize(p.title, "en") || "",
              localize(p.location, "ar") || localize(p.location, "en") || "",
              p.region || "",
            ]
              .join(" ")
              .toLowerCase();
            if (!hay.includes(F.search.toLowerCase())) return false;
          }
          if (F.region) {
            const loc = (
              localize(p.location, "ar") ||
              p.region ||
              ""
            ).toLowerCase();
            if (!loc.includes(F.region.toLowerCase())) return false;
          }
          const area = p.area || p.areaSize;
          if (F.areaMin != null && (!area || area < F.areaMin)) return false;
          if (F.areaMax != null && (!area || area > F.areaMax)) return false;
          if (F.priceMin != null && (!p.price || p.price < F.priceMin))
            return false;
          if (F.priceMax != null && (!p.price || p.price > F.priceMax))
            return false;
          return true;
        }

        /* ══════════════════════════════════════════
       DETAIL CARD
    ══════════════════════════════════════════ */
        function showDetail(p) {
          activeId = p.id;
          const lang = getLang();

          const title = localize(p.title, lang) || "—";
          const desc = localize(p.description, lang) || "";
          const loc = localize(p.location, lang) || p.region || "";
          const price = p.price
            ? Number(p.price).toLocaleString("en-US") + " OMR"
            : "—";

          // Area: prefer boundary calculation over stored value
          let areaStr = "—";
          if (hasBoundary(p)) {
            const pts = getBoundaryPoints(p);
            if (pts.length >= 3) {
              const m2 = calcBoundaryArea(pts);
              if (m2 > 0) areaStr = fmtArea(m2);
            }
          }
          if (areaStr === "—" && (p.area || p.areaSize)) {
            areaStr = fmtArea(p.area || p.areaSize);
          }

          // Image
          const img = p.images?.[0] || "";
          const imgEl = document.getElementById("mpDetailImg");
          const phEl = document.getElementById("mpDetailImgPlaceholder");
          if (img) {
            imgEl.src = img;
            imgEl.style.display = "block";
            phEl.style.display = "none";
          } else {
            imgEl.style.display = "none";
            phEl.style.display = "flex";
          }

          // Status bar
          const statusCls = STATUS_BADGE_CLS[p.status] || "";
          const statusTxt = STATUS_AR[p.status] || p.status || "";
          const kindTxt = KIND_AR[p.kind] || "";
          const catTxt = CAT_AR[p.category] || "";
          document.getElementById("mpDetailStatusBar").innerHTML = [
            statusTxt
              ? `<span class="mp-badge ${statusCls}">${escapeHtml(statusTxt)}</span>`
              : "",
            kindTxt
              ? `<span class="mp-badge" style="background:rgba(255,255,255,.18);color:#fff">${escapeHtml(kindTxt)}</span>`
              : "",
            catTxt
              ? `<span class="mp-badge" style="background:rgba(255,255,255,.12);color:rgba(255,255,255,.75)">${escapeHtml(catTxt)}</span>`
              : "",
          ].join("");

          document.getElementById("mpDetailTitle").textContent = title;
          document.getElementById("mpDetailPrice").textContent = price;
          document.getElementById("mpDetailArea").textContent = areaStr;

          const locRow = document.getElementById("mpDetailLocRow");
          document.getElementById("mpDetailLoc").textContent = loc;
          locRow.style.display = loc ? "flex" : "none";

          const descEl = document.getElementById("mpDetailDesc");
          if (desc) {
            descEl.textContent =
              desc.length > 140 ? desc.slice(0, 140) + "…" : desc;
            descEl.style.display = "block";
          } else {
            descEl.style.display = "none";
          }

          const notesEl = document.getElementById("mpDetailNotes");
          if (p.notes) {
            notesEl.textContent = "ملاحظات: " + p.notes;
            notesEl.style.display = "block";
          } else {
            notesEl.style.display = "none";
          }

          document.getElementById("mpDetailFull").href =
            `property-view.html?id=${encodeURIComponent(p.id)}`;

          const gmapsBtn = document.getElementById("mpDetailGmaps");
          if (p.locationUrl) {
            gmapsBtn.href = p.locationUrl;
            gmapsBtn.style.display = "flex";
          } else gmapsBtn.style.display = "none";

          document.getElementById("mpDetail").classList.add("is-open");

          // Highlight active list item
          document
            .querySelectorAll(".mp-list-item")
            .forEach((el) =>
              el.classList.toggle("is-active", el.dataset.id === p.id),
            );
        }

        function closeDetail() {
          document.getElementById("mpDetail").classList.remove("is-open");
          activeId = null;
          document
            .querySelectorAll(".mp-list-item")
            .forEach((el) => el.classList.remove("is-active"));
          updateSelectionPin(null);
        }

        document
          .getElementById("mpDetailClose")
          .addEventListener("click", closeDetail);

        /* ══════════════════════════════════════════
       RENDER MAP LAYERS
    ══════════════════════════════════════════ */
        function inViewport(p) {
          const vp = map.getBounds().pad(0.5);
          if (hasBoundary(p)) {
            try {
              const gj = boundaryToGeoJSON(p.boundary);
              if (!gj) return false;
              const b = L.geoJSON(gj).getBounds();
              return b.isValid() ? vp.intersects(b) : false;
            } catch {
              return false;
            }
          }
          const c = getCoords(p);
          return c ? vp.contains([c.lat, c.lng]) : false;
        }

        function renderMap() {
          polygonLayer.clearLayers();
          markerLayer.clearLayers();

          const filtered = allProps.filter(matchesFilter);
          const withLoc = filtered.filter(
            (p) => hasBoundary(p) || getCoords(p),
          );
          const noLoc = allProps.filter(
            (p) => !hasBoundary(p) && !getCoords(p),
          );

          // First render: show everything, then fit bounds. After that, use viewport culling.
          const skipVp = !initialFit;

          let polyCnt = 0,
            markCnt = 0;

          for (const p of withLoc) {
            if (!skipVp && !inViewport(p)) continue;

            if (hasBoundary(p)) {
              polyCnt++;
              const isLand = p.kind === "land" || p.type === "land";
              const boundaryColor = isLand ? "#C6A24F" : sColor(p.status);
              const gl = L.geoJSON(boundaryToGeoJSON(p.boundary), {
                style: {
                  color: boundaryColor,
                  weight: 2.5,
                  opacity: 0.92,
                  fillColor: boundaryColor,
                  fillOpacity: isLand ? 0.22 : 0.15,
                },
              });
              const ttip = localize(p.title, getLang()) || "";
              if (ttip) gl.bindTooltip(ttip, { sticky: true, opacity: 0.9 });
              gl.on("click", (e) => {
                L.DomEvent.stopPropagation(e);
                showDetail(p);
                // Zoom to the boundary
                const gj = L.geoJSON(boundaryToGeoJSON(p.boundary));
                if (gj.getBounds().isValid()) {
                  map.flyToBounds(gj.getBounds(), { padding: [60, 60], duration: 0.8, maxZoom: 18 });
                }
                updateSelectionPin(p);
              });
              polygonLayer.addLayer(gl);
            } else {
              const coords = getCoords(p);
              if (!coords) continue;
              markCnt++;
              const mk = L.marker([coords.lat, coords.lng], {
                icon: makeIcon(p),
              });
              const mTip = localize(p.title, getLang()) || "";
              if (mTip) mk.bindTooltip(mTip, { sticky: true, opacity: 0.9 });
              mk.on("click", (e) => {
                L.DomEvent.stopPropagation(e);
                showDetail(p);
                updateSelectionPin(p);
              });
              markerLayer.addLayer(mk);
            }
          }

          if (!initialFit && withLoc.length > 0) {
            initialFit = true;
            const urlParams = new URLSearchParams(window.location.search);
            const targetId = urlParams.get('id');
            const targetProp = targetId ? withLoc.find(p => p.id === targetId) : null;

            if (targetProp) {
              if (hasBoundary(targetProp)) {
                const gj = L.geoJSON(boundaryToGeoJSON(targetProp.boundary));
                if (gj.getBounds().isValid()) {
                  map.fitBounds(gj.getBounds(), { padding: [100, 100], maxZoom: 18 });
                }
              } else {
                const c = getCoords(targetProp);
                if (c) {
                  map.setView([c.lat, c.lng], 17);
                }
              }
              showDetail(targetProp);
              updateSelectionPin(targetProp);
              setTimeout(renderMap, 300);
            } else {
              const allFeatures = L.featureGroup();
              for (const p of withLoc) {
                if (hasBoundary(p)) {
                  const gj = L.geoJSON(boundaryToGeoJSON(p.boundary));
                  allFeatures.addLayer(gj);
                } else {
                  const c = getCoords(p);
                  if (c) {
                    const mk = L.marker([c.lat, c.lng], { icon: makeIcon(p) });
                    allFeatures.addLayer(mk);
                  }
                }
              }
              if (allFeatures.getBounds().isValid()) {
                map.fitBounds(allFeatures.getBounds(), {
                  padding: [60, 60],
                  maxZoom: 15,
                });
                setTimeout(renderMap, 300);
              }
            }
          }

          const total = polyCnt + markCnt;
          const badge = document.getElementById("mapCountBadge");
          if (badge) {
            badge.textContent =
              total > 0
                ? `${total} عقار` + (polyCnt ? ` · ${polyCnt} حدود` : "")
                : "—";
          }

        }

        /* ══════════════════════════════════════════
       MAP EVENTS
    ══════════════════════════════════════════ */
        let moveTimer;
        map.on("moveend zoomend", () => {
          clearTimeout(moveTimer);
          moveTimer = setTimeout(renderMap, 200);
        });

        map.on("click", () => {
          closeDetail();
        });

        /* ══════════════════════════════════════════
       FILTER CONTROLS
    ══════════════════════════════════════════ */

        // Pill groups — single select
        function initPills(containerId, key) {
          document
            .getElementById(containerId)
            .addEventListener("click", (e) => {
              const pill = e.target.closest(".mp-pill");
              if (!pill) return;
              document
                .querySelectorAll(`#${containerId} .mp-pill`)
                .forEach((p) => p.classList.remove("active"));
              pill.classList.add("active");
              F[key] =
                pill.dataset[
                key === "kind"
                  ? "kind"
                  : key === "category"
                    ? "cat"
                    : "status"
                ] || "";
              renderMap();
            });
        }
        initPills("kindPills", "kind");
        initPills("catPills", "category");
        initPills("statusPills", "status");

        // Region select (dynamic from data)
        function buildRegionSelect(props) {
          const sel = document.getElementById("filterRegion");
          const current = sel.value;
          const regions = new Set();
          props.forEach(p => {
            const r = localize(p.location, "ar") || p.region || "";
            if (r) regions.add(r.trim());
          });
          sel.innerHTML = '<option value="">كل المناطق</option>' +
            Array.from(regions).sort().map(r =>
              `<option value="${escapeHtml(r)}"${r === current ? ' selected' : ''}>${escapeHtml(r)}</option>`
            ).join("");
        }
        document.getElementById("filterRegion").addEventListener("change", (e) => {
          F.region = e.target.value.trim();
          updateFilterToggleState();
          renderMap();
        });

        // Search results renderer
        function updateSearchResults(q) {
          const box = document.getElementById("mpSearchResultsBox");
          const list = document.getElementById("mpResultsList");
          if (!box || !list) return;

          if (!q) {
            box.classList.add("is-hidden");
            list.innerHTML = "";
            return;
          }

          const matches = allProps.filter(p => {
            const hay = [
              localize(p.title, "ar") || localize(p.title, "en") || "",
              localize(p.location, "ar") || localize(p.location, "en") || "",
              p.region || "",
            ].join(" ").toLowerCase();
            return hay.includes(q);
          });

          if (matches.length === 0) {
            list.innerHTML = `<p class="mp-list-empty" style="padding: 1.5rem 0.5rem; text-align: center; color: var(--gray); font-size: 0.8125rem;">لا توجد نتائج مطابقة</p>`;
            box.classList.remove("is-hidden");
            return;
          }

          const lang = getLang();
          list.innerHTML = matches.map(p => {
            const title = localize(p.title, lang) || "—";
            const price = p.price
              ? Number(p.price).toLocaleString("en-US") + " OMR"
              : "—";
            const dot = sColor(p.status);
            const img = p.images?.[0] || "";
            const thumbHtml = img
              ? `<img src="${img}" style="width:100%; height:100%; object-fit:cover;" />`
              : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3; margin: auto;"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>`;

            return `<div class="mp-list-item" data-id="${escapeHtml(p.id)}">
              <div class="mp-list-thumb">
                ${thumbHtml}
              </div>
              <div class="mp-list-info">
                <span class="mp-list-name">${escapeHtml(title)}</span>
                <span class="mp-list-price">${escapeHtml(price)}</span>
              </div>
              <span class="mp-list-dot" style="background:${dot}"></span>
            </div>`;
          }).join("");

          list.querySelectorAll(".mp-list-item").forEach(item => {
            item.addEventListener("click", () => {
              const p = allProps.find(x => x.id === item.dataset.id);
              if (!p) return;
              showDetail(p);
              if (hasBoundary(p)) {
                const gj = L.geoJSON(boundaryToGeoJSON(p.boundary));
                if (gj.getBounds().isValid()) {
                  map.flyToBounds(gj.getBounds(), { padding: [60, 60], duration: 1 });
                }
              } else {
                const c = getCoords(p);
                if (c) map.flyTo([c.lat, c.lng], 16, { duration: 1 });
              }
              updateSelectionPin(p);
              box.classList.add("is-hidden");
            });
          });

          box.classList.remove("is-hidden");
        }

        // Search input handling
        const searchInput = document.getElementById("mpSearch");
        let searchTimer;
        searchInput.addEventListener("input", () => {
          clearTimeout(searchTimer);
          const q = searchInput.value.trim().toLowerCase();
          searchTimer = setTimeout(() => {
            F.search = q;
            updateFilterToggleState();
            renderMap();
            updateSearchResults(q);
          }, 180);
        });

        searchInput.addEventListener("focus", () => {
          const q = searchInput.value.trim().toLowerCase();
          if (q) {
            updateSearchResults(q);
          }
        });

        document.addEventListener("click", (e) => {
          const overlay = document.getElementById("mpSearchOverlay");
          const box = document.getElementById("mpSearchResultsBox");
          if (overlay && box && !overlay.contains(e.target)) {
            box.classList.add("is-hidden");
          }
        });

        // Press Enter in search: fly to first match
        searchInput.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          const q = searchInput.value.trim().toLowerCase();
          if (!q) return;
          const match = allProps.find(p => {
            const hay = [
              localize(p.title, "ar") || localize(p.title, "en") || "",
              localize(p.location, "ar") || localize(p.location, "en") || "",
              p.region || "",
            ].join(" ").toLowerCase();
            return hay.includes(q);
          });
          if (!match) return;
          showDetail(match);
          if (hasBoundary(match)) {
            const gj = L.geoJSON(boundaryToGeoJSON(match.boundary));
            if (gj.getBounds().isValid()) map.flyToBounds(gj.getBounds(), { padding: [60, 60], duration: 1 });
          } else {
            const c = getCoords(match);
            if (c) map.flyTo([c.lat, c.lng], 16, { duration: 1 });
          }
        });

        // Dual-slider setup
        const AREA_MAX = 100000, PRICE_MAX = 5000000;

        function formatSliderArea(v) {
          return v >= AREA_MAX ? '∞' : Number(v).toLocaleString('en-US');
        }
        function formatSliderPrice(v) {
          return v >= PRICE_MAX ? '∞' : Number(v).toLocaleString('en-US');
        }

        function updateSliderFill(minEl, maxEl, fillEl, maxVal) {
          const minPct = (minEl.value / maxVal) * 100;
          const maxPct = (maxEl.value / maxVal) * 100;
          fillEl.style.left = minPct + '%';
          fillEl.style.width = (maxPct - minPct) + '%';
        }

        // Area slider
        const aMinEl = document.getElementById('filterAreaMin');
        const aMaxEl = document.getElementById('filterAreaMax');
        const aMinVal = document.getElementById('areaMinVal');
        const aMaxVal = document.getElementById('areaMaxVal');
        const aFill = document.getElementById('areaTrackFill');

        function syncAreaSlider() {
          let min = parseInt(aMinEl.value), max = parseInt(aMaxEl.value);
          if (min > max) { [aMinEl.value, aMaxEl.value] = [max, min]; min = max; max = parseInt(aMaxEl.value); }
          aMinVal.textContent = formatSliderArea(min);
          aMaxVal.textContent = formatSliderArea(max);
          updateSliderFill(aMinEl, aMaxEl, aFill, AREA_MAX);
          F.areaMin = min > 0 ? min : null;
          F.areaMax = max < AREA_MAX ? max : null;
          updateFilterToggleState();
          renderMap();
        }
        aMinEl.addEventListener('input', syncAreaSlider);
        aMaxEl.addEventListener('input', syncAreaSlider);
        syncAreaSlider();

        // Price slider
        const pMinEl = document.getElementById('filterPriceMin');
        const pMaxEl = document.getElementById('filterPriceMax');
        const pMinVal = document.getElementById('priceMinVal');
        const pMaxVal = document.getElementById('priceMaxVal');
        const pFill = document.getElementById('priceTrackFill');

        function syncPriceSlider() {
          let min = parseInt(pMinEl.value), max = parseInt(pMaxEl.value);
          if (min > max) { [pMinEl.value, pMaxEl.value] = [max, min]; min = max; max = parseInt(pMaxEl.value); }
          pMinVal.textContent = formatSliderPrice(min);
          pMaxVal.textContent = formatSliderPrice(max);
          updateSliderFill(pMinEl, pMaxEl, pFill, PRICE_MAX);
          F.priceMin = min > 0 ? min : null;
          F.priceMax = max < PRICE_MAX ? max : null;
          updateFilterToggleState();
          renderMap();
        }
        pMinEl.addEventListener('input', syncPriceSlider);
        pMaxEl.addEventListener('input', syncPriceSlider);
        syncPriceSlider();

        // Active filter indicator on toggle button
        function updateFilterToggleState() {
          const btn = document.getElementById('mpFilterToggle');
          const hasFilters = F.kind || F.category || F.status || F.region ||
            F.areaMin != null || F.areaMax != null || F.priceMin != null || F.priceMax != null;
          btn.classList.toggle('has-active-filters', !!hasFilters);
          btn.classList.toggle('is-active', !document.getElementById('mpPanel').classList.contains('is-hidden'));
        }

        // Reset
        document.getElementById("mpReset").addEventListener("click", () => {
          Object.assign(F, {
            search: "",
            kind: "",
            category: "",
            status: "",
            region: "",
            areaMin: null,
            areaMax: null,
            priceMin: null,
            priceMax: null,
          });
          document.getElementById("mpSearch").value = "";
          document.getElementById("filterRegion").value = "";
          aMinEl.value = 0; aMaxEl.value = AREA_MAX;
          pMinEl.value = 0; pMaxEl.value = PRICE_MAX;
          syncAreaSlider(); syncPriceSlider();
          document
            .querySelectorAll(
              "#kindPills .mp-pill, #catPills .mp-pill, #statusPills .mp-pill",
            )
            .forEach((p) => {
              p.classList.toggle(
                "active",
                p.dataset.kind === "" ||
                p.dataset.cat === "" ||
                p.dataset.status === "",
              );
            });
          updateFilterToggleState();
          renderMap();
        });

        // Filter panel toggle via the filter button
        const panel = document.getElementById("mpPanel");
        const filterToggleBtn = document.getElementById("mpFilterToggle");

        filterToggleBtn.addEventListener("click", () => {
          const hidden = panel.classList.toggle("is-hidden");
          filterToggleBtn.classList.toggle("is-active", !hidden);
          updateFilterToggleState();
        });

        document.getElementById("mpPanelClose").addEventListener("click", () => {
          panel.classList.add("is-hidden");
          filterToggleBtn.classList.remove("is-active");
          updateFilterToggleState();
        });

        // Close panel on outside click
        document.addEventListener("click", (e) => {
          if (!panel.classList.contains("is-hidden") &&
            !panel.contains(e.target) &&
            !filterToggleBtn.contains(e.target)) {
            panel.classList.add("is-hidden");
            filterToggleBtn.classList.remove("is-active");
            updateFilterToggleState();
          }
        });

        // Lang change
        onLangChange(() => {
          applyTranslations();
          renderMap();
        });

        console.log("[map] registering Supabase watcher");
        watchProperties(
          (props) => {
            console.log("[map] received", props.length, "properties from Supabase");
            if (props.length === 0) {
              const badge = document.getElementById("mapCountBadge");
              if (badge) badge.textContent = "⚠️ لا توجد عقارات";
            }
            allProps = props;
            buildRegionSelect(props);
            renderMap();
          },
          (err) => {
            console.error("[map] Firestore error:", err.message);
            const badge = document.getElementById("mapCountBadge");
            if (badge) badge.textContent = "⚠️ فشل الاتصال بقاعدة البيانات";
          },
        );

        console.log("[map] calling setupDashboard");
        setupDashboard("map.html", { require: "view" })
          .then((ctx) => {
            console.log("[map] setupDashboard resolved, role=" + ctx.role);
            applyTranslations();
            requestAnimationFrame(() => {
              map.invalidateSize();
              console.log("[map] invalidateSize called");
            });
            // Hide loading overlay after everything is ready
            window.__mapLoaded = true;
            const lo = document.getElementById("mapLoading");
            if (lo) {
              lo.style.opacity = "0";
              setTimeout(() => lo.remove(), 500);
            }
          })
          .catch((err) => {
            console.warn("[map] setupDashboard failed:", err.message);
            // If auth/permission fails, show a useful message on the loading overlay
            const lo = document.getElementById("mapLoading");
            if (lo) {
              lo.innerHTML =
                '<div style="text-align:center;padding:2rem;max-width:26rem;font-family:system-ui;">' +
                '<p style="color:#ef4444;font-size:1rem;font-weight:600;margin-bottom:.5rem;">فشل تحميل الخريطة</p>' +
                '<p style="color:rgba(255,255,255,.5);font-size:.8125rem;">' +
                escapeHtml(err.message) +
                "</p>" +
                '<p style="color:rgba(255,255,255,.25);font-size:.75rem;margin-top:.75rem;">' +
                (err.message === "auth_timeout"
                  ? "تعذر التحقق من الحساب. قد تحتاج لتسجيل الدخول مرة أخرى."
                  : "تأكد من اتصال الإنترنت وأعد تحميل الصفحة.") +
                "</p></div>";
            }
          });

      } catch (err) {
        console.error("[map] init error:", err);
        const lo = document.getElementById("mapLoading");
        if (lo) {
          lo.innerHTML =
            '<div style="text-align:center;padding:2rem;max-width:26rem;font-family:system-ui;">' +
            '<p style="color:#ef4444;font-size:1rem;font-weight:600;margin-bottom:.5rem;">خطأ في تحميل الخريطة</p>' +
            '<p style="color:rgba(255,255,255,.5);font-size:.8125rem;direction:ltr;word-break:break-all;">' +
            escapeHtml(err.message) +
            "</p>" +
            '<p style="color:rgba(255,255,255,.25);font-size:.75rem;margin-top:.75rem;">راجع وحدة تحكم المتصفح (F12) للتفاصيل.</p></div>';
        }
      }
    })();