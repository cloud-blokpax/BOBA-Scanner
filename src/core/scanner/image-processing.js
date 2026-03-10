// ============================================================
// js/api.js
// Changes:
//   - REMOVED duplicate callAPI() — scanner.js is the single definition
//   - REMOVED saveApiKey / clearApiKey / toggleApiSection / updateApiToggle
//     These referenced DOM elements that don't exist in index.html.
//   - KEPT compressImage() — still used for image preparation
//   - ADDED cropToCard() — detects card in image and crops to it
//     with padding so the AI grader can evaluate edges and corners.
// ============================================================

import { config } from '../../core/config.js';

// ── Card crop constants ───────────────────────────────────────────────────────
// Target height (px) for the card region after crop.  At 1 200 px the bottom
// 14 % strip used by Tesseract is ~168 px → scaled ×4 = 672 px of text area —
// well above the 50 px minimum Tesseract needs for reliable recognition.
export const CARD_TARGET_HEIGHT = 1200;

// Fraction of the detected card dimension added as padding on every edge so
// that the AI grader can evaluate corners, edges, and centering borders.
export const CROP_PAD_RATIO = 0.08;

/**
 * cropToCard(file)
 *
 * Loads the image, detects the card against its background using
 * corner-colour subtraction, then returns a cropped + padded canvas/blob.
 *
 * Returns { blob, canvas } on success, or null when detection fails
 * (callers fall back to the original file).
 *
 * Sizing rationale
 * ─────────────────
 *   Card height    : CARD_TARGET_HEIGHT (1 200 px)
 *   Padding each side: CROP_PAD_RATIO × card dimension (≈ 8 %)
 *   Total output   : ~1 390 × ~990 px for a standard portrait card
 *
 * This gives the Tesseract OCR pipeline enough pixels in the text strip
 * while keeping enough edge margin for the Claude Vision grader to assess
 * corners, edge wear, and border centering.
 */
export async function cropToCard(file) {
    return new Promise(resolve => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const srcW = img.naturalWidth  || img.width;
            const srcH = img.naturalHeight || img.height;

            // Draw full source image
            const src = document.createElement('canvas');
            src.width  = srcW;
            src.height = srcH;
            src.getContext('2d').drawImage(img, 0, 0);

            // Detect card bounding box
            const bounds = _detectCardBounds(src);
            if (!bounds) { resolve(null); return; }

            const { x, y, w, h } = bounds;

            // Add padding so grader sees edges and corners
            const padX = Math.round(w * CROP_PAD_RATIO);
            const padY = Math.round(h * CROP_PAD_RATIO);
            const cx   = Math.max(0, x - padX);
            const cy   = Math.max(0, y - padY);
            const cw   = Math.min(srcW - cx, w + padX * 2);
            const ch   = Math.min(srcH - cy, h + padY * 2);

            // Scale so the card portion (not padding) hits CARD_TARGET_HEIGHT
            const outScale = CARD_TARGET_HEIGHT / h;
            const outW = Math.round(cw * outScale);
            const outH = Math.round(ch * outScale);

            const out = document.createElement('canvas');
            out.width  = outW;
            out.height = outH;
            out.getContext('2d').drawImage(src, cx, cy, cw, ch, 0, 0, outW, outH);

            // ── Compute centering from bounding-box geometry ──────────
            // The card's position within the original photo encodes its
            // print centering.  Margins are measured in source-image pixels.
            const leftMargin   = x;
            const rightMargin  = srcW - (x + w);
            const topMargin    = y;
            const bottomMargin = srcH - (y + h);

            let centering = null;
            const hTotal = leftMargin + rightMargin;
            const vTotal = topMargin  + bottomMargin;
            // Only compute if there is meaningful border on both axes
            // (at least 2 % of the dimension — otherwise the card fills the frame)
            if (hTotal > srcW * 0.02 && vTotal > srcH * 0.02) {
                const lPct = Math.round((leftMargin / hTotal) * 100);
                const tPct = Math.round((topMargin  / vTotal) * 100);
                centering = {
                    lr: `${lPct}/${100 - lPct}`,
                    tb: `${tPct}/${100 - tPct}`
                };
            }

            // Card bounds metadata for downstream consumers (corner extraction)
            const cardBounds = { padX, padY };

            out.toBlob(blob => {
                if (!blob) { resolve(null); return; }
                resolve({ blob, canvas: out, centering, cardBounds });
            }, 'image/jpeg', 0.92);
        };
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

/**
 * _detectCardBounds(srcCanvas)
 *
 * Downscales the canvas for speed, samples the four corners to estimate the
 * background colour, then finds the bounding box of pixels that differ
 * significantly from that background.
 *
 * Returns {x, y, w, h} in original-canvas coordinates, or null.
 */
function _detectCardBounds(srcCanvas) {
    const W = srcCanvas.width, H = srcCanvas.height;

    // Work at ≤ 350 px for fast processing
    const PROC = 350;
    const scale = Math.min(1, PROC / Math.max(W, H));
    const pw = Math.max(1, Math.round(W * scale));
    const ph = Math.max(1, Math.round(H * scale));

    const proc = document.createElement('canvas');
    proc.width  = pw;
    proc.height = ph;
    proc.getContext('2d').drawImage(srcCanvas, 0, 0, pw, ph);
    const { data } = proc.getContext('2d').getImageData(0, 0, pw, ph);

    // ── Sample corners to estimate background colour ──────────────────────
    // Use the outermost 6 % of each corner quadrant.
    const cs = Math.max(2, Math.round(Math.min(pw, ph) * 0.06));
    let bgR = 0, bgG = 0, bgB = 0, n = 0;
    for (let iy = 0; iy < cs; iy++) {
        for (let ix = 0; ix < cs; ix++) {
            for (const [cy, cx] of [
                [iy, ix], [iy, pw - 1 - ix],
                [ph - 1 - iy, ix], [ph - 1 - iy, pw - 1 - ix]
            ]) {
                const i = (cy * pw + cx) * 4;
                bgR += data[i]; bgG += data[i + 1]; bgB += data[i + 2]; n++;
            }
        }
    }
    bgR /= n; bgG /= n; bgB /= n;

    // ── Find bounding box of foreground (non-background) pixels ──────────
    const DIFF_THRESH = 35; // Euclidean RGB distance to background
    let x0 = pw, x1 = 0, y0 = ph, y1 = 0, fgPx = 0;

    for (let iy = 0; iy < ph; iy++) {
        for (let ix = 0; ix < pw; ix++) {
            const i  = (iy * pw + ix) * 4;
            const dr = data[i]     - bgR;
            const dg = data[i + 1] - bgG;
            const db = data[i + 2] - bgB;
            if (Math.sqrt(dr * dr + dg * dg + db * db) > DIFF_THRESH) {
                if (ix < x0) x0 = ix; if (ix > x1) x1 = ix;
                if (iy < y0) y0 = iy; if (iy > y1) y1 = iy;
                fgPx++;
            }
        }
    }

    // ── Validate detection ────────────────────────────────────────────────
    if (x1 <= x0 || y1 <= y0)          return null; // nothing found
    if (fgPx < pw * ph * 0.08)         return null; // card covers < 8 % — too small
    const bw = x1 - x0, bh = y1 - y0;
    if (Math.max(bw, bh) / Math.min(bw, bh) > 4) return null; // extreme ratio

    // Scale bounding box back to original canvas coordinates
    return {
        x: Math.round(x0 / scale),
        y: Math.round(y0 / scale),
        w: Math.round(bw  / scale),
        h: Math.round(bh  / scale)
    };
}

// Compress and resize an image File before sending to the API.
// Uses createImageBitmap() + OffscreenCanvas when available (off-main-thread)
// to avoid freezing the UI on large images. Falls back to synchronous canvas.
export async function compressImage(file) {
  const maxDim  = config.maxSize || 1000;
  const quality = config.quality || 0.85;

  // ── Fast path: OffscreenCanvas (Chrome 69+, Firefox 105+) ────────────────
  if (typeof createImageBitmap !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(file);
      let { width, height } = bitmap;

      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round((height / width) * maxDim); width = maxDim; }
        else                { width  = Math.round((width / height) * maxDim); height = maxDim; }
      }

      const oc = new OffscreenCanvas(width, height);
      oc.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      const blob   = await oc.convertToBlob({ type: 'image/jpeg', quality });
      const buffer = await blob.arrayBuffer();
      const bytes  = new Uint8Array(buffer);
      let binary   = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    } catch {
      // OffscreenCanvas failed — fall through to synchronous canvas
    }
  }

  // ── Fallback: synchronous main-thread canvas ──────────────────────────────
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round((height / width) * maxDim); width = maxDim; }
          else                { width  = Math.round((width / height) * maxDim); height = maxDim; }
        }

        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * cropCardNumberRegion(file)
 *
 * Extracts the bottom-left card-number strip from a card image,
 * upscales 2× and applies contrast enhancement for the AI to read.
 * Returns base64 string or null.
 */
export async function cropCardNumberRegion(file) {
    return new Promise(resolve => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const sw = img.naturalWidth  || img.width;
            const sh = img.naturalHeight || img.height;

            // Extract bottom-left 40% width × 15% height
            const rx = 0.0, ry = 0.82, rw = 0.40, rh = 0.15;
            const sx = Math.floor(sw * rx);
            const sy = Math.floor(sh * ry);
            const cw = Math.floor(sw * rw);
            const ch = Math.floor(sh * rh);

            // 2× upscale for sharper text
            const SCALE = 2;
            const out = document.createElement('canvas');
            out.width  = cw * SCALE;
            out.height = ch * SCALE;
            const ctx = out.getContext('2d');
            ctx.drawImage(img, sx, sy, cw, ch, 0, 0, out.width, out.height);

            // Contrast stretch: map 2nd/98th percentile to 0-255
            const imgData = ctx.getImageData(0, 0, out.width, out.height);
            const d = imgData.data;
            const totalPx = out.width * out.height;
            const hist = new Uint32Array(256);
            for (let i = 0; i < totalPx; i++) {
                const lum = Math.round(d[i*4]*0.299 + d[i*4+1]*0.587 + d[i*4+2]*0.114);
                hist[lum]++;
            }
            let cumul = 0, lo = 0, hi = 255;
            const p2 = Math.floor(totalPx * 0.02), p98 = Math.floor(totalPx * 0.98);
            for (let v = 0; v < 256; v++) {
                cumul += hist[v];
                if (cumul >= p2  && lo === 0)   lo = v;
                if (cumul >= p98 && hi === 255) hi = v;
            }
            const range = Math.max(1, hi - lo);
            for (let i = 0; i < totalPx; i++) {
                const idx = i * 4;
                d[idx]     = Math.min(255, Math.max(0, Math.round((d[idx]     - lo) * 255 / range)));
                d[idx + 1] = Math.min(255, Math.max(0, Math.round((d[idx + 1] - lo) * 255 / range)));
                d[idx + 2] = Math.min(255, Math.max(0, Math.round((d[idx + 2] - lo) * 255 / range)));
            }
            ctx.putImageData(imgData, 0, 0);

            // Export as high-quality JPEG base64
            const dataUrl = out.toDataURL('image/jpeg', 0.92);
            resolve(dataUrl.split(',')[1]);
        };
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

/**
 * cropGradingRegions(file, cardBounds)
 *
 * Extracts all 4 corners of a card image into a 2×2 grid for the AI
 * grader to assess corner sharpness precisely. Returns base64 string or null.
 *
 * When cardBounds is provided, the extraction offsets inward by the padding
 * amount so the grid shows actual card corners instead of background.
 */
export async function cropGradingRegions(file, cardBounds) {
    return new Promise(resolve => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const sw = img.naturalWidth  || img.width;
            const sh = img.naturalHeight || img.height;

            // Compute padding offset — the stored image is card + padding.
            // Padding fraction per side = CROP_PAD_RATIO / (1 + 2*CROP_PAD_RATIO)
            let padPxX = 0, padPxY = 0;
            if (cardBounds) {
                const padFrac = CROP_PAD_RATIO / (1 + 2 * CROP_PAD_RATIO);
                padPxX = Math.round(sw * padFrac);
                padPxY = Math.round(sh * padFrac);
            }

            // Card area within the image (excluding padding)
            const cardW = sw - 2 * padPxX;
            const cardH = sh - 2 * padPxY;

            // Each corner region: 22% × 22% of the card area
            const cornerW = Math.floor(cardW * 0.22);
            const cornerH = Math.floor(cardH * 0.22);

            // Output: 2×2 grid, each cell upscaled 1.5×
            const SCALE = 1.5;
            const cellW = Math.round(cornerW * SCALE);
            const cellH = Math.round(cornerH * SCALE);
            const gap = 4; // pixel gap between cells

            const out = document.createElement('canvas');
            out.width  = cellW * 2 + gap;
            out.height = cellH * 2 + gap;
            const ctx = out.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, out.width, out.height);

            // Top-left corner (offset by padding)
            ctx.drawImage(img, padPxX, padPxY, cornerW, cornerH, 0, 0, cellW, cellH);
            // Top-right corner
            ctx.drawImage(img, sw - padPxX - cornerW, padPxY, cornerW, cornerH, cellW + gap, 0, cellW, cellH);
            // Bottom-left corner
            ctx.drawImage(img, padPxX, sh - padPxY - cornerH, cornerW, cornerH, 0, cellH + gap, cellW, cellH);
            // Bottom-right corner
            ctx.drawImage(img, sw - padPxX - cornerW, sh - padPxY - cornerH, cornerW, cornerH, cellW + gap, cellH + gap, cellW, cellH);

            const dataUrl = out.toDataURL('image/jpeg', 0.92);
            resolve(dataUrl.split(',')[1]);
        };
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

/**
 * compressImageForGrading(file)
 *
 * Higher-quality compression for grading — preserves fine detail like
 * corner sharpness, surface scratches, and edge chips.
 */
export async function compressImageForGrading(file) {
  const maxDim  = 2000;   // higher than scanning (1400)
  const quality = 0.92;   // higher than scanning (0.7)

  if (typeof createImageBitmap !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(file);
      let { width, height } = bitmap;

      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round((height / width) * maxDim); width = maxDim; }
        else                { width  = Math.round((width / height) * maxDim); height = maxDim; }
      }

      const oc = new OffscreenCanvas(width, height);
      oc.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      const blob   = await oc.convertToBlob({ type: 'image/jpeg', quality });
      const buffer = await blob.arrayBuffer();
      const bytes  = new Uint8Array(buffer);
      let binary   = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    } catch { /* fall through */ }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round((height / width) * maxDim); width = maxDim; }
          else                { width  = Math.round((width / height) * maxDim); height = maxDim; }
        }

        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

console.log('✅ API module loaded');
