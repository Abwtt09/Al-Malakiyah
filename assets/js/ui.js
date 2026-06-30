// Shared UI helpers used by the admin dashboard.
// (Navbar/footer/card builders were removed when the public site was retired.)
import { getLang, t } from './i18n.js';

/* ─────────────────────────── format ─────────────────────────── */

/** Compact numeric form: 2.45M / 16.8K / 4,200. Currency-agnostic. */
function compactNumber(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return value.toLocaleString('en-US');
}

/**
 * Plain-text price — always rendered in Omani Rial. The `currency` argument is
 * accepted for back-compat but ignored: any legacy USD/EUR values still show
 * as OMR everywhere in the UI.
 */
export function formatPrice(value) {
  if (!Number.isFinite(value)) return '—';
  return `OMR ${compactNumber(value)}`;
}

/** Inline SVG of the new Omani Rial symbol — used wherever prices render as HTML. */
export const OMR_SYMBOL_SVG =
  '<svg class="omr-symbol" viewBox="0 0 741.36 415.06" aria-label="OMR">' +
    '<path d="M259.9,219.89c-.63-49.2,11.44-95.41,35.76-137.75C331.7,19.4,371.24-.36,439.78,34.99c10.67,5.5,53.6,35.43,57.81,44.54,5.03,10.87-27.48,103.87-29.11,122.3-34.69-37.51-99.37-98.66-154.85-69.62-45.05,23.58-12.02,62.54,11.46,87.68h406.25l-39.14,70.23-289.2-2c-1.11,4.66.87,3.3,2.53,4.6,12.44,9.72,80.97,31.54,94.75,31.54l172.05,1.99-39.49,71.25H10.03l39.24-71.24h272.14l-37.11-36.13H69.33l39.23-70.23h151.33Z"/>' +
  '</svg>';

/**
 * HTML price — always uses the new Omani Rial symbol. The currency argument is
 * accepted for back-compat but ignored. Returns trusted HTML.
 */
export function priceHtml(value) {
  if (!Number.isFinite(value)) return '—';
  return `${OMR_SYMBOL_SVG}<span class="num">${compactNumber(value)}</span>`;
}

export function formatArea(size, unit = 'm2') {
  const u = unit === 'm2' ? 'm²' : 'ft²';
  return `${Number(size).toLocaleString('en-US')} ${u}`;
}

export function formatDate(ts) {
  const locale = getLang() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
  return new Date(ts).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const slugify = (text) =>
  String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/(^-|-$)/g, '');

/* ─────────────────────────── bilingual helpers ─────────────────────────── */

/**
 * Returns the current-language version of a bilingual field.
 * Accepts a plain string (legacy) or { ar, en }. Falls back gracefully.
 */
export function localize(field, lang) {
  const L = lang || getLang();
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object') {
    return field[L] || field.en || field.ar || Object.values(field)[0] || '';
  }
  return String(field);
}

export function localizeTags(tags, lang) {
  const L = lang || getLang();
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'object') return tags[L] || tags.en || tags.ar || [];
  return [];
}

/** Concatenates every translation of a field — used by search. */
export function searchHaystack(field) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) return field.join(' ');
  if (typeof field === 'object') return Object.values(field).flat().join(' ');
  return String(field);
}

/* ─────────────────────────── Google Maps embed ─────────────────────────── */

export function googleMapsEmbedUrl(mapUrl, coordinates) {
  const trimmed = (mapUrl || '').trim();
  if (trimmed) {
    if (trimmed.includes('/maps/embed?')) return trimmed;
    const at = trimmed.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (at) return `https://maps.google.com/maps?q=${at[1]},${at[2]}&z=15&output=embed`;
    const q = trimmed.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (q) return `https://maps.google.com/maps?q=${q[1]},${q[2]}&z=15&output=embed`;
    return `https://maps.google.com/maps?q=${encodeURIComponent(trimmed)}&output=embed`;
  }
  if (coordinates && Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lng)) {
    return `https://maps.google.com/maps?q=${coordinates.lat},${coordinates.lng}&z=15&output=embed`;
  }
  return null;
}

/* ─────────────────────────── status / label maps ─────────────────────────── */

export const statusLabel = (status) => {
  const map = {
    available: t('properties.statusAvailable'),
    'under-development': t('properties.statusUnderDevelopment'),
    reserved: t('properties.statusReserved'),
    sold: t('properties.statusSold'),
    rented: t('properties.statusRented'),
  };
  return map[status] ?? status;
};

export const typeLabel = (type) => {
  const map = {
    land: t('properties.typeLand'),
    villa: t('properties.typeVilla'),
    building: t('properties.typeBuilding'),
    commercial: t('properties.typeCommercial'),
    apartment: t('properties.typeApartment'),
    'mixed-use': t('properties.typeMixedUse'),
    room: t('properties.typeRoom'),
    office: t('properties.typeOffice'),
    warehouse: t('properties.typeWarehouse'),
  };
  return map[type] ?? type;
};

export const categoryLabel = (cat) => {
  const map = {
    residential: t('properties.categoryResidential'),
    commercial: t('properties.categoryCommercial'),
    land: t('properties.categoryLand'),
    'mixed-use': t('properties.categoryMixedUse'),
  };
  return map[cat] ?? cat;
};

export const projectStatusLabel = (status) => {
  const map = {
    planning: t('projectsPage.statusPlanning'),
    'in-progress': t('projectsPage.statusInProgress'),
    completed: t('projectsPage.statusCompleted'),
  };
  return map[status] ?? status;
};

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
