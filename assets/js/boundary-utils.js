/**
 * boundary-utils.js
 * Coordinate conversion, polygon geometry, GeoJSON/KML generation for Oman real estate.
 */

// WGS84 ellipsoid constants
const A = 6378137.0;
const F = 1 / 298.257223563;
const B = A * (1 - F);
const E2 = 1 - (B * B) / (A * A);
const EP2 = E2 / (1 - E2);

// Oman approximate bounding box (generous — includes all Omani territories)
export const OMAN_BOUNDS = { minLat: 16.5, maxLat: 26.5, minLng: 51.5, maxLng: 60.0 };

// Broader "plausible Oman region" for coordinate sniff (includes neighbouring countries)
export function isOmanRegion(lat, lng) {
  return lat >= 12 && lat <= 32 && lng >= 34 && lng <= 62;
}

export function isWithinOman(lat, lng) {
  return lat >= OMAN_BOUNDS.minLat && lat <= OMAN_BOUNDS.maxLat
    && lng >= OMAN_BOUNDS.minLng && lng <= OMAN_BOUNDS.maxLng;
}

/* ─── DMS → Decimal degrees ──────────────────────────────────────────────── */

export function dmsToDecimal(degrees, minutes, seconds, direction) {
  let dd = Math.abs(Number(degrees)) + Number(minutes) / 60 + Number(seconds) / 3600;
  if (direction === 'S' || direction === 'W' || direction === 'س' || direction === 'غ') dd = -dd;
  return dd;
}

/* ─── UTM → WGS84 Lat/Lng ────────────────────────────────────────────────── */

export function utmToLatLng(easting, northing, zoneNumber = 40, hemisphere = 'N') {
  const k0 = 0.9996;
  const x = easting - 500000;
  const y = hemisphere === 'S' ? northing - 10000000 : northing;
  const lon0 = ((zoneNumber - 1) * 6 - 180 + 3) * Math.PI / 180;

  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const M = y / k0;
  const mu = M / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 * E2 * E2 / 256));

  const phi1 = mu
    + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu)
    + (21 * Math.pow(e1, 2) / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu)
    + (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu)
    + (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);

  const N1 = A / Math.sqrt(1 - E2 * Math.sin(phi1) * Math.sin(phi1));
  const T1 = Math.tan(phi1) * Math.tan(phi1);
  const C1 = EP2 * Math.cos(phi1) * Math.cos(phi1);
  const R1 = A * (1 - E2) / Math.pow(1 - E2 * Math.sin(phi1) * Math.sin(phi1), 1.5);
  const D = x / (N1 * k0);

  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * Math.pow(D, 4) / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * Math.pow(D, 6) / 720
  );

  const lon = lon0 + (
    D
    - (1 + 2 * T1 + C1) * D * D * D / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * Math.pow(D, 5) / 120
  ) / Math.cos(phi1);

  return { lat: lat * 180 / Math.PI, lng: lon * 180 / Math.PI };
}

/** Auto-detect UTM zone from easting value (heuristic for Oman). */
export function detectUtmZone(easting, _northing) {
  // Oman spans zones 39-41. Easting 200k-800k is typical.
  // Treat everything as Zone 40N by default (covers most of Oman 54-60°E).
  return { zone: 40, hemisphere: 'N' };
}

/* ─── Polygon geometry ───────────────────────────────────────────────────── */

/** Build a GeoJSON Feature from an array of {lat, lng} points. */
export function buildGeoJSON(points, properties = {}) {
  if (!points || points.length < 3) return null;
  const coords = points.map(p => [Number(p.lng), Number(p.lat)]);
  // Close ring
  if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
    coords.push([...coords[0]]);
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] },
    properties,
  };
}

/** Extract points array from a GeoJSON Feature. */
export function geoJSONToPoints(feature) {
  const ring = feature?.geometry?.coordinates?.[0];
  if (!ring) return [];
  return ring.slice(0, -1).map(c => ({ lat: c[1], lng: c[0] }));
}

/** Approximate polygon area in m² using the shoelace formula. */
export function polygonAreaM2(points) {
  if (!points || points.length < 3) return 0;
  const mLat = 111320;
  const centerLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const mLng = mLat * Math.cos(centerLat * Math.PI / 180);
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += (points[i].lng * mLng) * (points[j].lat * mLat);
    area -= (points[j].lng * mLng) * (points[i].lat * mLat);
  }
  return Math.abs(area / 2);
}

/* ─── Self-intersection check ────────────────────────────────────────────── */

function _crossDirection(pi, pj, pk) {
  return (pk.lng - pi.lng) * (pj.lat - pi.lat) - (pj.lng - pi.lng) * (pk.lat - pi.lat);
}

function _segmentsIntersect(a, b, c, d) {
  const d1 = _crossDirection(c, d, a);
  const d2 = _crossDirection(c, d, b);
  const d3 = _crossDirection(a, b, c);
  const d4 = _crossDirection(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Returns true if the polygon defined by points[] has any self-intersecting edges. */
export function hasSelfIntersection(points) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      // Skip adjacent-edge pairs that share a vertex
      if (i === 0 && j === n - 1) continue;
      const c = points[j], d = points[(j + 1) % n];
      if (_segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

/** Validate a points array. Returns { valid, error?, area? } */
export function validatePolygon(points) {
  if (!points || points.length < 3) return { valid: false, error: 'Need at least 3 corner points' };
  for (const p of points) {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || isNaN(p.lat) || isNaN(p.lng))
      return { valid: false, error: 'Invalid coordinate values in polygon' };
  }
  const area = polygonAreaM2(points);
  if (area < 0.5) return { valid: false, error: 'Polygon area is too small — possible coordinate error' };
  if (points.length >= 4 && hasSelfIntersection(points))
    return { valid: false, error: 'Polygon edges cross — self-intersecting shape is not allowed' };
  return { valid: true, area };
}

/** Remove duplicate/near-duplicate points (threshold in degrees). */
export function deduplicatePoints(points, threshold = 0.000005) {
  const out = [];
  for (const p of points) {
    const dup = out.some(r => Math.abs(r.lat - p.lat) < threshold && Math.abs(r.lng - p.lng) < threshold);
    if (!dup) out.push(p);
  }
  return out;
}

/* ─── Format helpers ─────────────────────────────────────────────────────── */

export function formatArea(m2) {
  if (m2 >= 1e6) return `${(m2 / 1e6).toFixed(3)} km²`;
  return `${m2.toLocaleString('en', { maximumFractionDigits: 1 })} m²`;
}

/* ─── KML export ─────────────────────────────────────────────────────────── */

export function geoJSONToKML(feature, name = 'Property', description = '') {
  if (!feature?.geometry?.coordinates?.[0]) return '';
  const ring = feature.geometry.coordinates[0];
  const coordStr = ring.map(c => `${c[0]},${c[1]},0`).join('\n                ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(name)}</name>
    <Style id="poly">
      <LineStyle><color>ff2563eb</color><width>2</width></LineStyle>
      <PolyStyle><color>402563eb</color></PolyStyle>
    </Style>
    <Placemark>
      <name>${escapeXml(name)}</name>
      <description>${escapeXml(description)}</description>
      <styleUrl>#poly</styleUrl>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
                ${coordStr}
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ─── Multi-point coordinate extraction from raw text ────────────────────── */

export function extractAllCoordinates(rawText) {
  const text = rawText;
  const points = [];

  // ── Pattern A: DMS  "23° 27' 15.23" N  58° 32' 11.45" E" ──────────────
  const dmsRx = /(\d{1,3})[°º\s]+(\d{1,2})['’′\s]+(\d{1,2}(?:[.,]\d+)?)["”″\s]*([NSns])\s*[,،\s]+(\d{1,3})[°º\s]+(\d{1,2})['’′\s]+(\d{1,2}(?:[.,]\d+)?)["”″\s]*([EWew])/g;
  let m;
  while ((m = dmsRx.exec(text)) !== null) {
    const lat = dmsToDecimal(m[1], m[2], m[3].replace(',', '.'), m[4].toUpperCase());
    const lng = dmsToDecimal(m[5], m[6], m[7].replace(',', '.'), m[8].toUpperCase());
    if (isOmanRegion(lat, lng)) points.push({ lat, lng });
  }

  // ── Pattern B: Decimal pairs "23.456789, 58.123456" ───────────────────
  const decRx = /\b(\d{1,2}\.\d{4,8})[°\s,،]+(\d{2,3}\.\d{4,8})\b/g;
  while ((m = decRx.exec(text)) !== null) {
    const a = parseFloat(m[1]), b = parseFloat(m[2]);
    let lat, lng;
    if (a >= 12 && a <= 32 && b >= 34 && b <= 62) { lat = a; lng = b; }
    else if (b >= 12 && b <= 32 && a >= 34 && a <= 62) { lat = b; lng = a; }
    if (lat !== undefined && isOmanRegion(lat, lng)) points.push({ lat, lng });
  }

  // ── Pattern C: lat/lng labelled "lat: 23.456, lng: 58.123" ───────────
  const labRx = /lat[:\s]+([\d.\-]+)[,\s]+(?:lon|lng)[:\s]+([\d.\-]+)/gi;
  while ((m = labRx.exec(text)) !== null) {
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (isOmanRegion(lat, lng)) points.push({ lat, lng });
  }

  // ── Pattern D: UTM  "E: 654321.5  N: 2598765.3" ─────────────────────
  const utmRx = /[Ee](?:asting)?[:\s]+([\d,. ]+)[,\s]+[Nn](?:orthing)?[:\s]+([\d,. ]+)/g;
  while ((m = utmRx.exec(text)) !== null) {
    const e = parseFloat(m[1].replace(/[, ]/g, ''));
    const n = parseFloat(m[2].replace(/[, ]/g, ''));
    if (e > 100000 && e < 999999 && n > 1000000 && n < 4000000) {
      const { zone, hemisphere } = detectUtmZone(e, n);
      const coords = utmToLatLng(e, n, zone, hemisphere);
      if (isOmanRegion(coords.lat, coords.lng)) points.push(coords);
    }
  }

  // ── Pattern E: Arabic labelled  "إحداثيات: 23.456, 58.123" ───────────
  const arRx = /(?:إحداثيات|إحداثي|خط العرض)[:\s]+([\d.٠-٩]+)[,،\s]+(?:خط الطول)?[:\s]*([\d.٠-٩]+)/g;
  while ((m = arRx.exec(text)) !== null) {
    const lat = parseFloat(normalizeArabicNums(m[1]));
    const lng = parseFloat(normalizeArabicNums(m[2]));
    if (!isNaN(lat) && !isNaN(lng) && isOmanRegion(lat, lng)) points.push({ lat, lng });
  }

  return deduplicatePoints(points);
}

function normalizeArabicNums(s) {
  return s.replace(/[٠١٢٣٤٥٦٧٨٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c).toString());
}
