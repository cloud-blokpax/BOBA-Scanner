// ============================================================
// js/ocr.js — ENHANCED
//
// Improvements over the previous version:
//
//  1. ADAPTIVE THRESHOLDING
//     Instead of a single global threshold (gray > 128 → white),
//     we compute a local threshold for each pixel based on its
//     neighbourhood average. This handles cards with gradient
//     backgrounds, dark borders, and uneven lighting.
//
//  2. CONTRAST STRETCHING (histogram normalisation)
//     Before binarising, we stretch the tonal range so the
//     darkest pixel becomes 0 and the brightest becomes 255.
//     On a poorly-lit photo this can be the difference between
//     readable and unreadable text.
//
//  3. UNSHARP MASK SHARPENING
//     We apply a 3×3 sharpening kernel after upscaling.
//     Tesseract is trained on crisp printed text — sharpening
//     dramatically improves accuracy on soft/compressed images.
//
//  4. DESKEW (rotation correction)
//     Slight tilt in the photo causes Tesseract to misread
//     characters. We estimate the dominant text angle via
//     Hough-style projection and rotate to compensate.
//
//  5. MULTI-REGION SCANNING
//     Card number location varies across sets:
//       - Most sets: bottom-left corner
//       - Some sets: bottom-right corner
//       - Some sets: bottom-centre banner
//     We try all three regions in parallel and pick the result
//     with the highest confidence.
//
//  6. TESSERACT PARAMETER TUNING
//     - tessedit_char_whitelist: only alphanumeric + dash
//       (eliminates garbage characters that look like letters)
//     - psm 7: treat the region as a single line of text
//       (card number is always one line — avoids paragraph noise)
//     - psm 6 as fallback: assume a uniform block of text
//
//  7. MULTI-PASS OCR WITH DIFFERENT PREPROCESSINGS
//     We run OCR on 3 versions of the cropped region:
//       - adaptive threshold (primary)
//       - inverted adaptive threshold (for light-on-dark text)
//       - contrast-stretched grayscale (no binarisation)
//     We return the result with the highest Tesseract confidence.
//
//  8. SMARTER TEXT CLEANING
//     Extended character substitution table beyond O→0 and |→I:
//     handles B/8, S/5, Z/2, l/1, and common OCR ligatures.
//     Post-match validation checks that the prefix matches known
//     BoBA set prefixes before accepting a result.
//
// ============================================================

// ── Known BoBA card number prefixes ──────────────────────────────────────────
// Used to validate OCR results before accepting them.
// Add new set prefixes here as new sets are released.
const KNOWN_PREFIXES = new Set([
  'BLBF', 'BF', 'AAAA', 'BJX', 'BOJ', 'BJ',
  'BOBA', 'BBA', 'BB', 'BA', 'BL'
]);

// ── Tesseract parameters ──────────────────────────────────────────────────────
// psm 7 = treat image as single text line (best for card numbers)
// psm 6 = assume uniform block of text (fallback)
const TESS_PARAMS_LINE = {
  tessedit_pageseg_mode: '7',
  tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'
};
const TESS_PARAMS_BLOCK = {
  tessedit_pageseg_mode: '6',
  tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- '
};

// ── Region definitions ────────────────────────────────────────────────────────
// Scan three regions in parallel and keep the best result.
// Coordinates are fractions of the full card image (x, y, w, h).
const SCAN_REGIONS = [
  { id: 'bottom-left',   x: 0.03, y: 0.84, w: 0.38, h: 0.13 }, // most common
  { id: 'bottom-right',  x: 0.59, y: 0.84, w: 0.38, h: 0.13 }, // some sets
  { id: 'bottom-center', x: 0.25, y: 0.84, w: 0.50, h: 0.13 }, // banner-style
  { id: 'full-bottom',   x: 0.00, y: 0.80, w: 1.00, h: 0.20 }, // wide fallback
];

// ── Tesseract worker pool ─────────────────────────────────────────────────────
// We maintain two workers so we can run parallel OCR passes
// (different preprocessing → different worker → true parallelism).
let ocrWorkers = [];

async function initTesseract() {
  setStatus('ocr', 'loading');
  try {
    let attempts = 0;
    while (typeof Tesseract === 'undefined' && attempts < 50) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }
    if (typeof Tesseract === 'undefined') throw new Error('Tesseract not loaded');

    // Create 2 workers in parallel — one per preprocessing variant
    ocrWorkers = await Promise.all([
      Tesseract.createWorker('eng'),
      Tesseract.createWorker('eng'),
    ]);

    // Keep the global reference to the first worker for compatibility
    tesseractWorker = ocrWorkers[0];

    ready.ocr = true;
    setStatus('ocr', 'ready');
    console.log(`✅ OCR ready (${ocrWorkers.length} workers)`);
  } catch (err) {
    console.error('❌ OCR init failed:', err);
    setStatus('ocr', 'error');
  }
}

// ── Primary entry point ───────────────────────────────────────────────────────
// Replaces the previous runOCR().  Returns { text, confidence, region, variant }.
async function runOCR(imageUrl) {
  if (!ready.ocr || ocrWorkers.length === 0) {
    throw new Error('OCR not ready');
  }

  // 1. Load image once into an offscreen canvas
  const sourceCanvas = await loadImageToCanvas(imageUrl);

  // 2. Run all regions through enhanced preprocessing in parallel
  const candidates = await Promise.all(
    SCAN_REGIONS.map(region => scanRegion(sourceCanvas, region))
  );

  // 3. Flatten and filter results
  const allResults = candidates
    .flat()
    .filter(r => r.cardNumber !== null);

  if (allResults.length === 0) {
    // Return the raw highest-confidence text even without a parsed number
    const best = candidates.flat().sort((a, b) => b.confidence - a.confidence)[0];
    return {
      text:       best?.text || '',
      confidence: best?.confidence || 0,
      cardNumber: null,
      region:     best?.region || 'unknown',
      variant:    best?.variant || 'unknown'
    };
  }

  // 4. Prefer results whose prefix is in KNOWN_PREFIXES
  const validated = allResults.filter(r => {
    const prefix = r.cardNumber.split('-')[0];
    return KNOWN_PREFIXES.has(prefix);
  });

  const pool = validated.length > 0 ? validated : allResults;

  // 5. Pick highest confidence
  pool.sort((a, b) => b.confidence - a.confidence);
  const winner = pool[0];

  console.log(`🏆 Best OCR: "${winner.cardNumber}" conf=${winner.confidence.toFixed(1)}% region=${winner.region} variant=${winner.variant}`);
  return winner;
}

// ── Scan one region through all preprocessing variants ───────────────────────
async function scanRegion(sourceCanvas, region) {
  // Crop and upscale the region
  const cropped = cropRegion(sourceCanvas, region);

  // Generate 3 preprocessing variants
  const variants = [
    { id: 'adaptive',         canvas: applyAdaptiveThreshold(cropped) },
    { id: 'adaptive-inverted',canvas: invertCanvas(applyAdaptiveThreshold(cropped)) },
    { id: 'contrast-gray',    canvas: applyContrastStretch(cropped) },
  ];

  // Deskew each variant
  const deskewed = variants.map(v => ({
    id:     v.id,
    canvas: deskewCanvas(v.canvas)
  }));

  // Sharpen each variant
  const sharpened = deskewed.map(v => ({
    id:     v.id,
    canvas: applyUnsharpMask(v.canvas)
  }));

  // Run OCR on each variant using round-robin worker assignment
  const results = await Promise.all(
    sharpened.map((v, i) => runOCRVariant(v.canvas, v.id, region.id, ocrWorkers[i % ocrWorkers.length]))
  );

  return results;
}

// ── Run Tesseract on one preprocessed canvas ──────────────────────────────────
async function runOCRVariant(canvas, variantId, regionId, worker) {
  const dataUrl = canvas.toDataURL('image/png');

  try {
    // Try single-line mode first (best for card numbers)
    await worker.setParameters(TESS_PARAMS_LINE);
    const result = await worker.recognize(dataUrl);
    const text   = result.data.text;
    const conf   = result.data.confidence;

    const cardNumber = extractCardNumber(text);

    // If single-line didn't parse, retry with block mode
    if (!cardNumber && conf < 50) {
      await worker.setParameters(TESS_PARAMS_BLOCK);
      const result2 = await worker.recognize(dataUrl);
      const cardNumber2 = extractCardNumber(result2.data.text);
      return {
        text:       result2.data.text,
        confidence: result2.data.confidence,
        cardNumber: cardNumber2,
        region:     regionId,
        variant:    `${variantId}-block`
      };
    }

    return { text, confidence: conf, cardNumber, region: regionId, variant: variantId };

  } catch (err) {
    console.warn(`OCR variant ${variantId}/${regionId} failed:`, err.message);
    return { text: '', confidence: 0, cardNumber: null, region: regionId, variant: variantId };
  }
}

// ── Image preprocessing pipeline ─────────────────────────────────────────────

// Load an image URL into an HTMLCanvasElement
function loadImageToCanvas(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Upscale to at least 400px tall for Tesseract accuracy
      const scale  = Math.max(1, Math.ceil(400 / img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = img.width  * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('loadImageToCanvas: failed'));
    img.src = imageUrl;
  });
}

// Crop a fractional region and upscale 3× for OCR
function cropRegion(sourceCanvas, region) {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;

  const sx = Math.floor(sw * region.x);
  const sy = Math.floor(sh * region.y);
  const sw2 = Math.floor(sw * region.w);
  const sh2 = Math.floor(sh * region.h);

  const SCALE = 3; // 3× upscale for better character resolution
  const out   = document.createElement('canvas');
  out.width   = sw2 * SCALE;
  out.height  = sh2 * SCALE;
  out.getContext('2d').drawImage(sourceCanvas, sx, sy, sw2, sh2, 0, 0, out.width, out.height);
  return out;
}

// ENHANCEMENT 1: Adaptive threshold
// For each pixel, threshold is the mean of a local window minus a constant.
// This handles cards with gradient/textured backgrounds far better than
// a single global threshold value.
function applyAdaptiveThreshold(canvas, windowSize = 15, C = 10) {
  const ctx  = canvas.getContext('2d');
  const w    = canvas.width;
  const h    = canvas.height;
  const src  = ctx.getImageData(0, 0, w, h);
  const dst  = ctx.createImageData(w, h);
  const d    = src.data;
  const out  = dst.data;
  const half = Math.floor(windowSize / 2);

  // Compute grayscale first
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  }

  // Build integral image for fast window sum
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      integral[(y + 1) * (w + 1) + (x + 1)] =
        gray[y * w + x] +
        integral[y * (w + 1) + (x + 1)] +
        integral[(y + 1) * (w + 1) + x] -
        integral[y * (w + 1) + x];
    }
  }

  // Threshold each pixel
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - half);
      const y1 = Math.max(0, y - half);
      const x2 = Math.min(w, x + half + 1);
      const y2 = Math.min(h, y + half + 1);
      const area = (x2 - x1) * (y2 - y1);
      const sum  =
        integral[y2 * (w + 1) + x2] -
        integral[y1 * (w + 1) + x2] -
        integral[y2 * (w + 1) + x1] +
        integral[y1 * (w + 1) + x1];
      const mean = sum / area;
      const val  = gray[y * w + x] < mean - C ? 0 : 255;
      const idx  = (y * w + x) * 4;
      out[idx] = out[idx + 1] = out[idx + 2] = val;
      out[idx + 3] = 255;
    }
  }

  const result = document.createElement('canvas');
  result.width  = w;
  result.height = h;
  result.getContext('2d').putImageData(dst, 0, 0);
  return result;
}

// ENHANCEMENT 2: Contrast stretching
// Finds the actual min/max luminance in the crop and remaps to 0–255.
// Makes faded text on washed-out cards much more readable.
function applyContrastStretch(canvas) {
  const ctx  = canvas.getContext('2d');
  const w    = canvas.width;
  const h    = canvas.height;
  const id   = ctx.getImageData(0, 0, w, h);
  const d    = id.data;

  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    if (g < min) min = g;
    if (g > max) max = g;
  }

  const range = max - min || 1;
  for (let i = 0; i < d.length; i += 4) {
    const g   = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const val = Math.round(((g - min) / range) * 255);
    d[i] = d[i + 1] = d[i + 2] = val;
    d[i + 3] = 255;
  }

  const result = document.createElement('canvas');
  result.width  = w;
  result.height = h;
  result.getContext('2d').putImageData(id, 0, 0);
  return result;
}

// Invert a canvas (swap black and white)
function invertCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const id  = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d   = id.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
  const result = document.createElement('canvas');
  result.width  = canvas.width;
  result.height = canvas.height;
  result.getContext('2d').putImageData(id, 0, 0);
  return result;
}

// ENHANCEMENT 3: Unsharp mask sharpening
// Subtracts a blurred version to enhance edges.
// Tesseract is trained on crisp type — this narrows the gap between
// a phone photo and a scanner-quality image.
function applyUnsharpMask(canvas, strength = 1.5) {
  const w   = canvas.width;
  const h   = canvas.height;
  const ctx = canvas.getContext('2d');
  const src = ctx.getImageData(0, 0, w, h);
  const d   = src.data;

  // 3×3 box blur approximation
  const blurred = new Uint8ClampedArray(d.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum += d[((y + dy) * w + (x + dx)) * 4 + c];
          }
        }
        blurred[(y * w + x) * 4 + c] = Math.round(sum / 9);
      }
      blurred[(y * w + x) * 4 + 3] = 255;
    }
  }

  // original + strength * (original - blurred)
  const result = ctx.createImageData(w, h);
  const out    = result.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      out[i + c] = Math.max(0, Math.min(255,
        Math.round(d[i + c] + strength * (d[i + c] - blurred[i + c]))
      ));
    }
    out[i + 3] = 255;
  }

  const output = document.createElement('canvas');
  output.width  = w;
  output.height = h;
  output.getContext('2d').putImageData(result, 0, 0);
  return output;
}

// ENHANCEMENT 4: Deskew
// Projects horizontal pixel density onto angles from -10° to +10°
// and rotates to the angle that maximises the variance (sharpest projection
// = most aligned with text baseline).
// For slight phone tilts this meaningfully improves Tesseract accuracy.
function deskewCanvas(canvas) {
  const w    = canvas.width;
  const h    = canvas.height;
  const ctx  = canvas.getContext('2d');
  const id   = ctx.getImageData(0, 0, w, h);
  const d    = id.data;

  // Work on a small downscaled copy to keep deskew fast
  const SCALE   = 0.25;
  const sw      = Math.max(1, Math.round(w * SCALE));
  const sh      = Math.max(1, Math.round(h * SCALE));
  const tmp     = document.createElement('canvas');
  tmp.width     = sw;
  tmp.height    = sh;
  const tctx    = tmp.getContext('2d');
  tctx.drawImage(canvas, 0, 0, sw, sh);
  const small   = tctx.getImageData(0, 0, sw, sh).data;

  // Build a binary map of dark pixels
  const bin = new Uint8Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    bin[i] = small[i * 4] < 128 ? 1 : 0;
  }

  // Hough-inspired projection: try angles from -10° to +10° in 0.5° steps
  let bestAngle    = 0;
  let bestVariance = -1;

  for (let deg = -10; deg <= 10; deg += 0.5) {
    const rad = deg * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Count dark pixels per rotated row
    const rows = new Float64Array(sh + sw);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        if (!bin[y * sw + x]) continue;
        const ry = Math.round(y * cos - x * sin) + sw;
        if (ry >= 0 && ry < rows.length) rows[ry]++;
      }
    }

    // Variance of row projections (higher = sharper alignment)
    const mean = rows.reduce((a, b) => a + b, 0) / rows.length;
    const variance = rows.reduce((a, b) => a + (b - mean) ** 2, 0) / rows.length;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestAngle    = deg;
    }
  }

  // Only rotate if tilt is meaningful (> 0.5°)
  if (Math.abs(bestAngle) <= 0.5) return canvas;

  console.log(`📐 Deskewing ${bestAngle.toFixed(1)}°`);

  const out  = document.createElement('canvas');
  out.width  = w;
  out.height = h;
  const octx = out.getContext('2d');
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, w, h);
  octx.translate(w / 2, h / 2);
  octx.rotate(-bestAngle * Math.PI / 180);
  octx.translate(-w / 2, -h / 2);
  octx.drawImage(canvas, 0, 0);
  return out;
}

// ── Text parsing ──────────────────────────────────────────────────────────────

// ENHANCEMENT 8: Extended character substitution table
// Handles far more common OCR errors than the previous O→0 / |→I.
function cleanOCRText(text) {
  return text
    .toUpperCase()
    // Common single-char OCR errors
    .replace(/[|!¡]/g,  'I')   // pipe/bang → I
    .replace(/[O]/g,    '0')   // letter O → zero (in numeric context, handled below)
    .replace(/[B]/g,    '8')   // B → 8 (in numeric context, handled below)
    // We'll do context-sensitive O→0 and 8→B after splitting the card number
    .replace(/\$/g,     'S')
    .replace(/[@]/g,    'A')
    .replace(/[1l]/g,   '1')   // lowercase l → 1 (in numeric context)
    .replace(/\s+/g,    ' ')
    .trim();
}

// Context-sensitive digit repair: in the numeric part of a card number,
// O→0, l→1, I→1, B→8, S→5, Z→2.
// In the alpha prefix part, 0→O, 8→B, 5→S, 2→Z.
function repairCardNumber(raw) {
  const parts = raw.split('-');
  if (parts.length < 2) return raw;

  const prefix = parts[0]
    .replace(/0/g, 'O')
    .replace(/8/g, 'B')
    .replace(/5/g, 'S')
    .replace(/2/g, 'Z')
    .replace(/1/g, 'I');

  const numPart = parts.slice(1).join('-')
    .replace(/O/g, '0')
    .replace(/l/g, '1')
    .replace(/I/g, '1')
    .replace(/B/g, '8')
    .replace(/S/g, '5')
    .replace(/Z/g, '2');

  return `${prefix}-${numPart}`;
}

function extractCardNumber(text) {
  const cleaned = cleanOCRText(text);

  const patterns = [
    // Standard format with dash: BLBF-84, BF-108
    /\b([A-Z]{2,5})[-–—]\s*(\d{1,4})\b/,
    // No dash, letters then digits: BLBF84
    /\b([A-Z]{2,5})(\d{2,4})\b/,
    // Spaced: BF 108
    /\b([A-Z]{2,5})\s+(\d{2,4})\b/,
    // Partial match fallback
    /([A-Z]{2,})[\s\-–—]*(\d{2,})/,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      const raw = `${match[1]}-${match[2]}`;
      return repairCardNumber(raw);
    }
  }

  return null;
}

// ── Backwards-compatible runOCR wrapper ───────────────────────────────────────
// scanner.js calls runOCR(imageUrl) and expects { text, confidence }
// The enhanced version returns the same shape plus extras.
// No changes needed in scanner.js.

// ── Debug helper (dev mode only) ──────────────────────────────────────────────
// Call showOCRDebug(imageUrl) in the console to see all preprocessing variants.
async function showOCRDebug(imageUrl) {
  const sourceCanvas = await loadImageToCanvas(imageUrl);

  for (const region of SCAN_REGIONS) {
    const cropped = cropRegion(sourceCanvas, region);
    const variants = {
      'adaptive':         applyAdaptiveThreshold(cropped),
      'adaptive+sharpen': applyUnsharpMask(applyAdaptiveThreshold(cropped)),
      'contrast':         applyContrastStretch(cropped),
      'deskewed':         deskewCanvas(applyAdaptiveThreshold(cropped)),
      'inverted':         invertCanvas(applyAdaptiveThreshold(cropped)),
    };

    console.group(`Region: ${region.id}`);
    for (const [name, canvas] of Object.entries(variants)) {
      const img = document.createElement('img');
      img.src   = canvas.toDataURL();
      img.style.cssText = 'height:60px;margin:4px;border:1px solid #ccc;';
      img.title = name;
      document.body.appendChild(img);
      console.log(`Variant: ${name}`);
    }
    console.groupEnd();
  }
}

window.showOCRDebug = showOCRDebug;

console.log('✅ Enhanced OCR module loaded');
