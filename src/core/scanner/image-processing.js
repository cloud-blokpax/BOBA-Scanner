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
import { getActiveAdapter } from '../../collections/registry.js';

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

            // ── Compute centering from printed card border widths ─────
            // PSA and TAG both measure the card's own printed borders —
            // left border vs right border, top border vs bottom border.
            // This mirrors that methodology: scan inward from each card
            // edge to find where the uniform border color meets the artwork.
            const centering = measurePrintedBorderCentering(out);

            // Card bounds metadata for downstream consumers (corner extraction)
            const cardBounds = { padX, padY };

            out.toBlob(blob => {
                if (!blob) { resolve(null); return; }
                resolve({ blob, canvas: out, centering, cardBounds });
            }, 'image/jpeg', 0.92);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
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

// ── Centering measurement (PSA/TAG methodology) ───────────────────────────────

/**
 * measurePrintedBorderCentering(canvas)
 *
 * Measures the card's printed border widths on all 4 sides, mirroring how
 * PSA physically measures border widths and how TAG uses imaging to do the same.
 *
 * PSA methodology: if left border = 3mm and right border = 2mm →
 *   centering = 60/40 (left 60%, right 40% of total horizontal border space).
 *
 * Algorithm:
 * 1. Identify the card region within the padded canvas using CROP_PAD_RATIO
 * 2. For each side, scan multiple scan lines inward from the card edge
 * 3. Sample the border color at depth=2px (skip edge anti-aliasing)
 * 4. Scan inward until the color diverges significantly → that's the artwork boundary
 * 5. Use the median of all scan lines per side for robustness
 *
 * Returns { lr, tb, borderPx } or null if borders cannot be detected (full-bleed art).
 * lr = "left%/right%", tb = "top%/bottom%"
 */
export function measurePrintedBorderCentering(canvas) {
    // Compute card bounds within the padded canvas using the known padding fraction
    const padFrac = CROP_PAD_RATIO / (1 + 2 * CROP_PAD_RATIO);
    const W = canvas.width, H = canvas.height;
    const padX = Math.round(W * padFrac);
    const padY = Math.round(H * padFrac);

    // Card region
    const cL = padX, cT = padY, cR = W - padX, cB = H - padY;
    const cW = cR - cL, cH = cB - cT;
    if (cW < 30 || cH < 30) return null;

    const ctx = canvas.getContext('2d');
    const px = ctx.getImageData(0, 0, W, H).data;

    function getPixel(x, y) {
        const xi = Math.max(0, Math.min(W - 1, x));
        const yi = Math.max(0, Math.min(H - 1, y));
        const i = (yi * W + xi) * 4;
        return [px[i], px[i + 1], px[i + 2]];
    }
    function colorDist([r1, g1, b1], [r2, g2, b2]) {
        return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
    }

    // Scan positions: 9 points distributed across the middle 60% of each side
    const SCAN_POSITIONS = [0.20, 0.275, 0.35, 0.425, 0.50, 0.575, 0.65, 0.725, 0.80];
    const COLOR_THRESH = 30;   // RGB Euclidean distance to call a color change
    const MIN_UNIFORM  = 4;    // min scan depths with uniform color to qualify as a border

    function detectBorder(side) {
        const isH = side === 'left' || side === 'right';
        const maxBorder = Math.floor((isH ? cW : cH) * 0.22); // max 22% of card dim
        const widths = [];

        for (const pos of SCAN_POSITIONS) {
            // Return the pixel at 'depth' pixels inward from the card edge for this side
            function pxAt(depth) {
                let x, y;
                if (side === 'left')   { x = cL + depth;               y = Math.round(cT + cH * pos); }
                if (side === 'right')  { x = cR - 1 - depth;           y = Math.round(cT + cH * pos); }
                if (side === 'top')    { x = Math.round(cL + cW * pos); y = cT + depth; }
                if (side === 'bottom') { x = Math.round(cL + cW * pos); y = cB - 1 - depth; }
                return getPixel(x, y);
            }

            // Sample border color at depth=2 (avoid 1-px anti-aliasing artifacts)
            const refColor = pxAt(2);

            // Check that the edge region is uniform — if not, it's full-bleed art
            let uniformCount = 0;
            for (let d = 1; d <= 7; d++) {
                if (colorDist(pxAt(d), refColor) < COLOR_THRESH) uniformCount++;
            }
            if (uniformCount < MIN_UNIFORM) continue;

            // Scan inward until the color diverges — that's where artwork begins
            let borderWidth = null;
            for (let d = 3; d <= maxBorder; d++) {
                if (colorDist(pxAt(d), refColor) > COLOR_THRESH) {
                    borderWidth = d;
                    break;
                }
            }
            if (borderWidth !== null) widths.push(borderWidth);
        }

        if (widths.length < 3) return null; // insufficient valid scan lines
        widths.sort((a, b) => a - b);
        return widths[Math.floor(widths.length / 2)]; // median for robustness
    }

    const leftW   = detectBorder('left');
    const rightW  = detectBorder('right');
    const topW    = detectBorder('top');
    const bottomW = detectBorder('bottom');

    // Only compute an axis if both sides were measurable
    const hasLR = leftW !== null && rightW !== null;
    const hasTB = topW  !== null && bottomW !== null;
    if (!hasLR && !hasTB) return null;

    const borderPx = { leftW, rightW, topW, bottomW, cW, cH, padX, padY };

    const hTotal = hasLR ? leftW  + rightW  : 1;
    const vTotal = hasTB ? topW   + bottomW : 1;
    const lPct   = hasLR ? Math.round((leftW  / hTotal) * 100) : null;
    const tPct   = hasTB ? Math.round((topW   / vTotal) * 100) : null;

    return {
        lr:       hasLR ? `${lPct}/${100 - lPct}` : null,
        tb:       hasTB ? `${tPct}/${100 - tPct}` : null,
        borderPx
    };
}

/**
 * createCenteringOverlay(canvas, borderPx)
 *
 * Generates an annotated JPEG (base64) showing the card with dashed lines
 * marking each detected border boundary, plus measured L/R and T/B ratios
 * color-coded to PSA centering thresholds. This is sent to Claude as visual
 * evidence alongside the card image and corner grid.
 *
 * Color coding:
 *   Green  = PSA 10 range (≤55/45)
 *   Lime   = PSA 9 range  (≤60/40)
 *   Amber  = PSA 8 range  (≤65/35)
 *   Orange = PSA 7 range  (≤70/30)
 *   Red    = PSA 6 or below
 */
export function createCenteringOverlay(canvas, borderPx) {
    const { leftW, rightW, topW, bottomW, cW, cH, padX, padY } = borderPx;
    const MARGIN = 52; // pixels of label space around the card

    const out = document.createElement('canvas');
    out.width  = cW + MARGIN * 2;
    out.height = cH + MARGIN * 2;
    const ctx  = out.getContext('2d');

    // Dark background
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, out.width, out.height);

    // Draw the card (strip artificial padding from source canvas)
    ctx.drawImage(canvas, padX, padY, cW, cH, MARGIN, MARGIN, cW, cH);

    function gradeColor(pct) {
        if (pct === null) return '#6b7280';
        const worst = Math.max(pct, 100 - pct);
        if (worst <= 55) return '#22c55e'; // PSA 10
        if (worst <= 60) return '#86efac'; // PSA 9
        if (worst <= 65) return '#fbbf24'; // PSA 8
        if (worst <= 70) return '#f97316'; // PSA 7
        return '#ef4444';                  // PSA 6 and below
    }

    const hTotal = (leftW || 0) + (rightW || 0);
    const vTotal = (topW  || 0) + (bottomW || 0);
    const lPct   = (leftW  !== null && rightW  !== null) ? Math.round(leftW  / hTotal * 100) : null;
    const tPct   = (topW   !== null && bottomW !== null) ? Math.round(topW   / vTotal * 100) : null;
    const lrColor = gradeColor(lPct);
    const tbColor = gradeColor(tPct);

    ctx.lineWidth = 2;
    ctx.setLineDash([10, 5]);

    function drawLine(x1, y1, x2, y2, color) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(MARGIN + x1, MARGIN + y1);
        ctx.lineTo(MARGIN + x2, MARGIN + y2);
        ctx.stroke();
    }

    if (leftW   !== null) drawLine(leftW,        0, leftW,        cH, lrColor);
    if (rightW  !== null) drawLine(cW - rightW,  0, cW - rightW,  cH, lrColor);
    if (topW    !== null) drawLine(0, topW,       cW, topW,           tbColor);
    if (bottomW !== null) drawLine(0, cH - bottomW, cW, cH - bottomW, tbColor);

    ctx.setLineDash([]);

    // Text helper: draw with drop-shadow for readability over card image
    function drawLabel(text, x, y, color, angle = 0) {
        ctx.save();
        ctx.translate(x, y);
        if (angle) ctx.rotate(angle);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 16px monospace';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.fillStyle = '#000';
        for (const [dx, dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) ctx.fillText(text, dx, dy);
        ctx.shadowBlur = 0;
        ctx.fillStyle = color;
        ctx.fillText(text, 0, 0);
        ctx.restore();
    }

    // L/R label centered at bottom margin
    if (lPct !== null) {
        const lrLabel = `L/R  ${Math.max(lPct, 100-lPct)} / ${Math.min(lPct, 100-lPct)}`;
        drawLabel(lrLabel, out.width / 2, out.height - MARGIN / 2, lrColor);
    }

    // T/B label centered in right margin, rotated
    if (tPct !== null) {
        const tbLabel = `T/B  ${Math.max(tPct, 100-tPct)} / ${Math.min(tPct, 100-tPct)}`;
        drawLabel(tbLabel, out.width - MARGIN / 2, out.height / 2, tbColor, -Math.PI / 2);
    }

    return out.toDataURL('image/jpeg', 0.90).split(',')[1];
}

/**
 * measureAndVisualizeCentering(blob, hasPadding)
 *
 * Loads a card image blob, measures printed border centering algorithmically,
 * and generates a visual overlay for sending to Claude.
 *
 * hasPadding = true when the image went through cropToCard (has CROP_PAD_RATIO
 * artificial padding around the card). false for raw unprocessed images.
 *
 * Returns { centering, centeringImageData } — either may be null if borders
 * cannot be detected (full-bleed art, raw image with no padding info, etc.)
 */
export async function measureAndVisualizeCentering(blob) {
    return new Promise(resolve => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const canvas = document.createElement('canvas');
            canvas.width  = img.naturalWidth  || img.width;
            canvas.height = img.naturalHeight || img.height;
            canvas.getContext('2d').drawImage(img, 0, 0);

            const measured = measurePrintedBorderCentering(canvas);
            if (!measured) {
                resolve({ centering: null, centeringImageData: null });
                return;
            }

            const centeringImageData = createCenteringOverlay(canvas, measured.borderPx);
            // Return only the text centering data (lr/tb) for the API request body
            resolve({
                centering: { lr: measured.lr, tb: measured.tb },
                centeringImageData
            });
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve({ centering: null, centeringImageData: null }); };
        img.src = url;
    });
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

            // Extract card number region from adapter (defaults to bottom-left 40% × 15%)
            const adapter = getActiveAdapter();
            const cropRegion = adapter ? adapter.getCardNumberCropRegion() : { x: 0.0, y: 0.82, w: 0.40, h: 0.15 };
            const rx = cropRegion.x, ry = cropRegion.y, rw = cropRegion.w, rh = cropRegion.h;
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
            let cumul = 0, lo = -1, hi = 255;
            const p2 = Math.floor(totalPx * 0.02), p98 = Math.floor(totalPx * 0.98);
            for (let v = 0; v < 256; v++) {
                cumul += hist[v];
                if (cumul >= p2  && lo === -1)  lo = v;
                if (cumul >= p98 && hi === 255) hi = v;
            }
            if (lo === -1) lo = 0;
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
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
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
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
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
