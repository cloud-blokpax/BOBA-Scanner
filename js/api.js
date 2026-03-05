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

// ── Card crop constants ───────────────────────────────────────────────────────
// Target height (px) for the card region after crop.  At 1 200 px the bottom
// 14 % strip used by Tesseract is ~168 px → scaled ×4 = 672 px of text area —
// well above the 50 px minimum Tesseract needs for reliable recognition.
const CARD_TARGET_HEIGHT = 1200;

// Fraction of the detected card dimension added as padding on every edge so
// that the AI grader can evaluate corners, edges, and centering borders.
const CROP_PAD_RATIO = 0.08;

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
async function cropToCard(file) {
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

            out.toBlob(blob => {
                if (!blob) { resolve(null); return; }
                resolve({ blob, canvas: out });
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
async function compressImage(file) {
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

console.log('✅ API module loaded');
