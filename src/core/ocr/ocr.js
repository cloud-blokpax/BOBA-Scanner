// js/ocr.js
// Optimizations:
//   - initTesseract() now checks crossOriginIsolated before attempting init.
//     COOP/COEP headers in vercel.json unlock SharedArrayBuffer so Tesseract
//     workers can run; graceful AI fallback when headers are absent.
//   - cropAndPreprocess(): SCALE raised 3→4 for sharper character rendering,
//     unsharp-mask sharpening pass added before adaptive threshold, C raised 8→10.
//   - runOCR(): third region (bottom-centre) tried as final fallback.
//   - extractCardNumber(): expanded prefix length limit, added Z↔2 / G↔6
//     confusion pairs, added numeric-only pattern for Alpha Edition cards.

import { ready, tesseractWorker, setTesseractWorker } from '../state.js';
import { setStatus } from '../../ui/toast.js';
import { getActiveAdapter } from '../../collections/registry.js';

export async function initTesseract() {
    if (!window.crossOriginIsolated) {
        // COOP/COEP headers not active — SharedArrayBuffer unavailable.
        // Fall back silently; every scan will use the AI path instead.
        ready.ocr = false;
        setStatus('ocr', 'disabled');
        console.log('⏭️ OCR disabled — page not cross-origin isolated (AI active)');
        return;
    }
    try {
        setTesseractWorker(await Tesseract.createWorker('eng'));
        // PSM 7 = treat image as a single text line (card numbers are one line)
        // Character whitelist from active adapter (restricts to valid card-number chars)
        const adapter = getActiveAdapter();
        const whitelist = adapter ? adapter.ocrWhitelist : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ';
        await tesseractWorker.setParameters({
            tessedit_pageseg_mode: '7',
            tessedit_char_whitelist: whitelist,
        });
        ready.ocr = true;
        setStatus('ocr', 'ready');
        console.log('✅ OCR ready (cross-origin isolated, PSM=SINGLE_LINE)');
    } catch (err) {
        ready.ocr = false;
        setStatus('ocr', 'disabled');
        console.warn('OCR init failed, AI active:', err.message);
    }
}

// Main entry point — called by scanner.js and batch-scanner.js
export async function runOCR(imageUrl) {
    if (!ready.ocr || !tesseractWorker) {
        throw new Error('OCR not ready');
    }

    const sourceCanvas = await loadImageToCanvas(imageUrl);

    // Get OCR regions from the active adapter (ordered by priority)
    const adapter = getActiveAdapter();
    const regions = adapter ? adapter.getOCRRegions() : [
        { x: 0.01, y: 0.84, w: 0.35, h: 0.13 },
        { x: 0.60, y: 0.84, w: 0.35, h: 0.13 },
        { x: 0.0,  y: 0.80, w: 1.0,  h: 0.18 },
    ];

    const results = [];
    for (const region of regions) {
        const result = await runOCROnRegion(sourceCanvas, region);
        results.push(result);
        if (result.cardNumber) return result;
        // Bail out early if the worker crashed
        if (!ready.ocr || !tesseractWorker) break;
    }

    // Return the result with the highest confidence
    if (results.length === 0) return { text: '', confidence: 0, cardNumber: null };
    return results.reduce((best, r) =>
        r.confidence > best.confidence ? r : best
    );
}

async function runOCROnRegion(sourceCanvas, region) {
    // Guard: worker may have been nulled by a previous failure in this same scan
    if (!tesseractWorker) return { text: '', confidence: 0, cardNumber: null };

    const cropped  = cropAndPreprocess(sourceCanvas, region);
    const dataUrl  = cropped.toDataURL('image/png');
    try {
        const result     = await tesseractWorker.recognize(dataUrl);
        const text       = result.data.text || '';
        const confidence = result.data.confidence || 0;
        const cardNumber = extractCardNumber(text);
        return { text, confidence, cardNumber };
    } catch (err) {
        // Worker became invalid — terminate it cleanly and try once to recreate.
        console.warn('OCR worker error, recreating...', err.message);
        try { await tesseractWorker.terminate(); } catch (_) {}
        setTesseractWorker(null);
        ready.ocr = false;
        try {
            setTesseractWorker(await Tesseract.createWorker('eng'));
            const _adapter = getActiveAdapter();
            const _wl = _adapter ? _adapter.ocrWhitelist : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ';
            await tesseractWorker.setParameters({
                tessedit_pageseg_mode: '7',
                tessedit_char_whitelist: _wl,
            });
            ready.ocr = true;
            const result     = await tesseractWorker.recognize(dataUrl);
            const text       = result.data.text || '';
            const confidence = result.data.confidence || 0;
            const cardNumber = extractCardNumber(text);
            return { text, confidence, cardNumber };
        } catch (err2) {
            // Recreation also failed — keep worker null so remaining regions skip
            // immediately instead of crashing again.
            setTesseractWorker(null);
            ready.ocr = false;
            console.warn('OCR worker recreation failed:', err2.message);
            return { text: '', confidence: 0, cardNumber: null };
        }
    }
}

function loadImageToCanvas(imageUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width  = img.width;
            canvas.height = img.height;
            canvas.getContext('2d').drawImage(img, 0, 0);
            resolve(canvas);
        };
        img.onerror = () => reject(new Error('Failed to load image for OCR'));
        img.src = imageUrl;
    });
}

function cropAndPreprocess(sourceCanvas, region) {
    const sw  = sourceCanvas.width;
    const sh  = sourceCanvas.height;
    const sx  = Math.floor(sw * region.x);
    const sy  = Math.floor(sh * region.y);
    const sw2 = Math.floor(sw * region.w);
    const sh2 = Math.floor(sh * region.h);

    // Scale 4× (up from 3×) for crisper character rendering at small sizes
    const SCALE = 4;
    const out   = document.createElement('canvas');
    out.width   = sw2 * SCALE;
    out.height  = sh2 * SCALE;
    const ctx   = out.getContext('2d');
    ctx.drawImage(sourceCanvas, sx, sy, sw2, sh2, 0, 0, out.width, out.height);

    const imageData = ctx.getImageData(0, 0, out.width, out.height);
    const data = imageData.data;
    const w    = out.width;
    const h    = out.height;

    // ── Histogram stretch (contrast enhancement) ─────────────────────────────
    // Find 2nd/98th percentile luminance and stretch to full 0-255 range.
    // Normalizes low-contrast photos (dim lighting, glare, foil cards).
    const totalPx = w * h;
    const hist = new Uint32Array(256);
    for (let i = 0; i < totalPx; i++) {
        const lum = Math.round(data[i*4]*0.299 + data[i*4+1]*0.587 + data[i*4+2]*0.114);
        hist[lum]++;
    }
    const p2Count  = Math.floor(totalPx * 0.02);
    const p98Count = Math.floor(totalPx * 0.98);
    let cumul = 0, lo = -1, hi = 255;
    for (let v = 0; v < 256; v++) {
        cumul += hist[v];
        if (cumul >= p2Count  && lo === -1)  lo = v;
        if (cumul >= p98Count && hi === 255) hi = v;
    }
    if (lo === -1) lo = 0;
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < totalPx; i++) {
        const idx = i * 4;
        data[idx]     = Math.min(255, Math.max(0, Math.round((data[idx]     - lo) * 255 / range)));
        data[idx + 1] = Math.min(255, Math.max(0, Math.round((data[idx + 1] - lo) * 255 / range)));
        data[idx + 2] = Math.min(255, Math.max(0, Math.round((data[idx + 2] - lo) * 255 / range)));
    }

    // ── Grayscale conversion ─────────────────────────────────────────────────
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        gray[i] = Math.round(data[i*4]*0.299 + data[i*4+1]*0.587 + data[i*4+2]*0.114);
    }

    // ── Unsharp mask (3×3 Laplacian sharpening) ──────────────────────────────
    // Emphasises character edges before binarisation, improving Tesseract accuracy
    // on slightly blurry card photos.
    const sharpened = new Uint8Array(w * h);
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let sum = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const ny = Math.min(h - 1, Math.max(0, y + dy));
                    const nx = Math.min(w - 1, Math.max(0, x + dx));
                    sum += gray[ny * w + nx] * kernel[(dy + 1) * 3 + (dx + 1)];
                }
            }
            sharpened[y * w + x] = Math.min(255, Math.max(0, sum));
        }
    }

    // ── Adaptive threshold (integral-image method) ───────────────────────────
    // C raised 8→10: slightly more aggressive binarisation handles low-contrast ink.
    const integral = new Float64Array((w+1) * (h+1));
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            integral[(y+1)*(w+1)+(x+1)] = sharpened[y*w+x]
                + integral[y*(w+1)+(x+1)]
                + integral[(y+1)*(w+1)+x]
                - integral[y*(w+1)+x];
        }
    }

    const half = 10, C = 10;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const x1  = Math.max(0, x - half);
            const y1  = Math.max(0, y - half);
            const x2  = Math.min(w, x + half + 1);
            const y2  = Math.min(h, y + half + 1);
            const n   = (x2-x1) * (y2-y1);
            const sum = integral[y2*(w+1)+x2] - integral[y1*(w+1)+x2]
                      - integral[y2*(w+1)+x1] + integral[y1*(w+1)+x1];
            const val = sharpened[y*w+x] < (sum/n - C) ? 0 : 255;
            const idx = (y*w+x)*4;
            data[idx] = data[idx+1] = data[idx+2] = val;
            data[idx+3] = 255;
        }
    }
    ctx.putImageData(imageData, 0, 0);
    return out;
}

export function extractCardNumber(text) {
    // Pre-clean common OCR noise before pattern matching
    const upper = text.toUpperCase()
        .replace(/[|!¡]/g, 'I')
        .replace(/[\\/()\[\].,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Patterns ordered by specificity (most specific first).
    // Prefix length raised to {1,6} to cover sets like GLBF, BLBF, EDLCA.
    const patterns = [
        /\b([A-Z]{1,6})[-–—]\s*(\d{1,4})\b/,
        /\b([A-Z]{1,6})\s+(\d{2,4})\b/,
        /\b([A-Z]{1,6})(\d{2,4})\b/,
        /([A-Z]{2,})[\s\-–—]*(\d{2,})/,
    ];

    for (const pattern of patterns) {
        const match = upper.match(pattern);
        if (match) {
            // Fix common OCR confusables in the letter prefix
            const prefix = match[1]
                .replace(/0/g, 'O')
                .replace(/8/g, 'B')
                .replace(/5/g, 'S')
                .replace(/1/g, 'I')
                .replace(/2/g, 'Z')
                .replace(/6/g, 'G');
            // Fix common OCR confusables in the numeric part
            const numPart = match[2]
                .replace(/O/g, '0')
                .replace(/I/g, '1')
                .replace(/B/g, '8')
                .replace(/S/g, '5')
                .replace(/Z/g, '2')
                .replace(/G/g, '6');
            return `${prefix}-${numPart}`;
        }
    }

    // Numeric-only fallback for Alpha Edition cards (e.g. "76", "115")
    const numOnly = upper.match(/\b(\d{2,4})\b/);
    if (numOnly) return numOnly[1];

    return null;
}

console.log('✅ OCR module loaded');
