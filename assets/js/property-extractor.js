/**
 * property-extractor.js
 * Extracts property metadata from uploaded PDF/image deed documents.
 *
 * PDF files → PDF.js text layer extraction
 * Image files (JPG/PNG/scanned) → Tesseract.js OCR (Arabic + English)
 *
 * Returns: { fields, rawText, isImageOnly, fileType, boundaryPoints, ocrMethod, error }
 */

import {
  extractAllCoordinates,
  isOmanRegion,
} from './boundary-utils.js';

const PDFJS_CDN    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js';

let _pdfjs = null;
let _tesseractReady = false;

/* ─── Loaders ─────────────────────────────────────────────────────────────── */

async function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}

async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  await loadScript(PDFJS_CDN);
  const lib = window['pdfjs-dist/build/pdf'];
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  _pdfjs = lib;
  return _pdfjs;
}

async function loadTesseract() {
  if (_tesseractReady) return window.Tesseract;
  await loadScript(TESSERACT_CDN);
  _tesseractReady = true;
  return window.Tesseract;
}

/* ─── PDF text extraction ─────────────────────────────────────────────────── */

async function extractPdfText(file) {
  const lib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  return pages.join('\n');
}

function isPdfImageOnly(text) { return text.trim().length < 30; }

/* ─── OCR for images and scanned PDFs ────────────────────────────────────── */

/**
 * Run Tesseract OCR on a file (image or blob).
 * @param {File|Blob} fileOrBlob
 * @param {(pct:number)=>void} [onProgress]
 * @returns {Promise<string>} extracted text
 */
export async function ocrFile(fileOrBlob, onProgress) {
  const Tesseract = await loadTesseract();
  const result = await Tesseract.recognize(fileOrBlob, 'ara+eng', {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });
  return result.data.text;
}

/* ─── Pattern matchers ────────────────────────────────────────────────────── */

const ARABIC_NUMS = /[٠١٢٣٤٥٦٧٨٩]/g;
function normAr(s) {
  return s.replace(ARABIC_NUMS, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c).toString());
}

function matchFirst(text, patterns) {
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m) return m[1].trim();
  }
  return null;
}

const PATTERNS = {
  parcelNo: [
    /رقم\s+القطعة[:\s]+([٠-٩\d/\-]+)/u,
    /القطعة\s+رقم[:\s]+([٠-٩\d/\-]+)/u,
    /قطعة\s+رقم[:\s]+([٠-٩\d/\-]+)/u,
    /رقم\s+القسيمة[:\s]+([٠-٩\d/\-]+)/u,
    /Parcel\s+No\.?[:\s]+([\d/\-]+)/i,
    /Plot\s+No\.?[:\s]+([\d/\-]+)/i,
    /Plot\s+Number[:\s]+([\d/\-]+)/i,
  ],
  blockNo: [
    /رقم\s+المخطط[:\s]+([٠-٩\d/\-]+)/u,
    /المخطط\s+رقم[:\s]+([٠-٩\d/\-]+)/u,
    /مخطط\s+رقم[:\s]+([٠-٩\d/\-]+)/u,
    /Block\s+No\.?[:\s]+([\d/\-]+)/i,
    /Block\s+Number[:\s]+([\d/\-]+)/i,
  ],
  ownerName: [
    /المالك[:\s]+([^\n\r،,\d]{3,50})/u,
    /اسم\s+المالك[:\s]+([^\n\r،,\d]{3,50})/u,
    /باسم[:\s]+([^\n\r،,\d]{3,50})/u,
    /المالكة[:\s]+([^\n\r،,\d]{3,50})/u,
    /Owner[\s:]+([^\n\r,\d]{3,50})/i,
    /Owned\s+by[\s:]+([^\n\r,\d]{3,50})/i,
  ],
  area: [
    /المساحة\s+الكلية[:\s]*([\d٠-٩,،.]+)\s*(م²|متر|م2)?/u,
    /المساحة[:\s]*([\d٠-٩,،.]+)\s*(م²|متر|م2|sqm|m²)?/u,
    /مساحة\s+القطعة[:\s]*([\d٠-٩,،.]+)/u,
    /Total\s+Area[:\s]*([\d,\.]+)\s*(m²|sqm|m2)?/i,
    /Area[:\s]*([\d,\.]+)\s*(m²|sqm|m2)?/i,
    /Land\s+Area[:\s]*([\d,\.]+)/i,
  ],
  districtName: [
    /حي[:\s]+([^\n\r،,\d]{2,40})/u,
    /الحي[:\s]+([^\n\r،,\d]{2,40})/u,
    /المنطقة[:\s]+([^\n\r،,\d]{2,40})/u,
    /الولاية[:\s]+([^\n\r،,\d]{2,40})/u,
    /District[:\s]+([^\n\r,\d]{2,40})/i,
    /Wilayat[:\s]+([^\n\r,\d]{2,40})/i,
    /Governorate[:\s]+([^\n\r,\d]{2,40})/i,
  ],
  city: [
    /المدينة[:\s]+([^\n\r،,\d]{2,30})/u,
    /المحافظة[:\s]+([^\n\r،,\d]{2,30})/u,
    /City[:\s]+([^\n\r,\d]{2,30})/i,
    /Governorate[:\s]+([^\n\r,\d]{2,30})/i,
  ],
};

/** Parse raw deed text into structured fields plus a single coordinate pair (legacy). */
function parseText(text) {
  const result = {};

  const parcelNo = matchFirst(text, PATTERNS.parcelNo);
  if (parcelNo) result.parcelNo = normAr(parcelNo).replace(/\s+/g, '');

  const blockNo = matchFirst(text, PATTERNS.blockNo);
  if (blockNo) result.blockNo = normAr(blockNo).replace(/\s+/g, '');

  const ownerName = matchFirst(text, PATTERNS.ownerName);
  if (ownerName) result.ownerName = ownerName.replace(/\s{2,}/g, ' ');

  const areaRaw = matchFirst(text, PATTERNS.area);
  if (areaRaw) {
    const num = parseFloat(normAr(areaRaw).replace(/[,،]/g, ''));
    if (!isNaN(num) && num > 0) result.area = num;
  }

  const district = matchFirst(text, PATTERNS.districtName);
  const city = matchFirst(text, PATTERNS.city);
  if (district || city) {
    result.location = [district, city].filter(Boolean).join('، ');
  }

  // Single best coordinate (first Oman-region point found)
  const pts = extractAllCoordinates(text);
  if (pts.length > 0) {
    result.lat = pts[0].lat;
    result.lng = pts[0].lng;
  }

  return result;
}

/* ─── Public API ──────────────────────────────────────────────────────────── */

/**
 * Main entry point.
 * @param {File} file - uploaded deed/document
 * @param {(status:string, pct:number)=>void} [onProgress]
 * @returns {Promise<ExtractionResult>}
 *   { fields, rawText, isImageOnly, fileType, boundaryPoints, ocrMethod, error }
 */
export async function extractPropertyData(file, onProgress = null) {
  const fileType = file.type;
  const result = {
    fields: {},
    rawText: '',
    isImageOnly: false,
    fileType,
    boundaryPoints: [],
    ocrMethod: 'none',
  };

  const progress = (status, pct) => onProgress && onProgress(status, pct);

  if (fileType === 'application/pdf') {
    progress('reading_pdf', 10);
    try {
      const text = await extractPdfText(file);
      result.rawText = text;
      result.isImageOnly = isPdfImageOnly(text);

      if (!result.isImageOnly) {
        progress('parsing', 70);
        result.fields = parseText(text);
        result.boundaryPoints = extractAllCoordinates(text);
        result.ocrMethod = 'pdf_text';
        progress('done', 100);
      } else {
        // Scanned PDF — run OCR on it
        progress('ocr_start', 15);
        try {
          const ocrText = await ocrFile(file, pct => progress('ocr', 15 + pct * 0.75));
          result.rawText = ocrText;
          result.isImageOnly = false;
          result.fields = parseText(ocrText);
          result.boundaryPoints = extractAllCoordinates(ocrText);
          result.ocrMethod = 'tesseract_pdf';
          progress('done', 100);
        } catch (ocrErr) {
          console.warn('[extractor] OCR failed for scanned PDF:', ocrErr.message);
          result.isImageOnly = true;
          result.ocrMethod = 'ocr_failed';
        }
      }
    } catch (err) {
      console.warn('[extractor] PDF error:', err);
      result.error = err.message;
    }

  } else if (fileType.startsWith('image/')) {
    progress('ocr_start', 5);
    try {
      const ocrText = await ocrFile(file, pct => progress('ocr', 5 + pct * 0.85));
      result.rawText = ocrText;
      result.isImageOnly = false;
      result.fields = parseText(ocrText);
      result.boundaryPoints = extractAllCoordinates(ocrText);
      result.ocrMethod = 'tesseract_image';
      progress('done', 100);
    } catch (err) {
      console.warn('[extractor] Image OCR failed:', err);
      result.isImageOnly = true;
      result.ocrMethod = 'ocr_failed';
      result.error = 'OCR processing failed. Please enter data manually.';
    }
  } else {
    result.error = 'Unsupported file type';
  }

  return result;
}
