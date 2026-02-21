// js/ocr.js — FAST SINGLE-PASS VERSION
//
// The previous "enhanced" version ran up to 24 Tesseract passes
// (4 regions × 3 preprocessing variants × 2 PSM modes).
// Each pass takes 3-8s → total wait up to 2 minutes with no visible progress.
// Reverted to a single-pass approach that still improves on the original:
//
//  ✓ Pre-initialized worker (reused across scans — fast)
//  ✓ Adaptive threshold (better than fixed 128 cutoff)
//  ✓ 3× upscale of the card number region
//  ✓ Tesseract whitelist + single-line PSM
//  ✓ Context-aware character repair (alpha vs numeric parts)
//  ✓ Tries bottom-left THEN bottom-right if first attempt fails
//  ✓ Falls through to AI quickly if OCR confidence is low

// tesseractWorker is declared as a global in state.js
// Setting it here makes it available to scanner.js's ready check
async function initTesseract() {
    setStatus('ocr', 'loading');
    try {
        let attempts = 0;
        while (typeof Tesseract === 'undefined' && attempts < 50) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }
        if (typeof Tesseract === 'undefined') throw new Error('Tesseract not loaded');

        tesseractWorker = await Tesseract.createWorker('eng');
        
        // Tune Tesseract for card number recognition
        await tesseractWorker.setParameters({
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
            tessedit_pageseg_mode: '7'  // single line of text
        });

        ready.ocr = true;
        setStatus('ocr', 'ready');
        console.log('✅ OCR ready (worker initialized)');
    } catch (err) {
        console.error('❌ OCR failed:', err);
        setStatus('ocr', 'error');
    }
}

// Main entry point — called by scanner.js
// Returns { text, confidence, cardNumber }
async function runOCR(imageUrl) {
    if (!ready.ocr || !tesseractWorker) {
        throw new Error('OCR not ready');
    }

    const sourceCanvas = await loadImageToCanvas(imageUrl);

    // Try bottom-left first (most common card number location)
    const result1 = await runOCROnRegion(sourceCanvas, { x: 0.03, y: 0.83, w: 0.40, h: 0.14 });
    if (result1.cardNumber) return result1;

    // Try bottom-right if bottom-left failed (some sets)
    const result2 = await runOCROnRegion(sourceCanvas, { x: 0.57, y: 0.83, w: 0.40, h: 0.14 });
    if (result2.cardNumber) return result2;

    // Return best of the two even without a parsed number
    return result1.confidence >= result2.confidence ? result1 : result2;
}

async function runOCROnRegion(sourceCanvas, region) {
    const cropped    = cropAndPreprocess(sourceCanvas, region);
    const dataUrl    = cropped.toDataURL('image/png');
    const result     = await tesseractWorker.recognize(dataUrl);
    const text       = result.data.text || '';
    const confidence = result.data.confidence || 0;
    const cardNumber = extractCardNumber(text);
    return { text, confidence, cardNumber };
}

// Load image URL into a canvas (upscaled for better OCR)
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

// Crop a region from the card and apply preprocessing
function cropAndPreprocess(sourceCanvas, region) {
    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    const sx = Math.floor(sw * region.x);
    const sy = Math.floor(sh * region.y);
    const sw2 = Math.floor(sw * region.w);
    const sh2 = Math.floor(sh * region.h);

    // 3× upscale — more pixels = better Tesseract accuracy
    const SCALE = 3;
    const out   = document.createElement('canvas');
    out.width   = sw2 * SCALE;
    out.height  = sh2 * SCALE;
    const ctx   = out.getContext('2d');
    ctx.drawImage(sourceCanvas, sx, sy, sw2, sh2, 0, 0, out.width, out.height);

    // Adaptive threshold — handles gradient backgrounds and uneven lighting
    // Better than a fixed cutoff (gray > 128 → white) for card photography
    const imageData = ctx.getImageData(0, 0, out.width, out.height);
    const data      = imageData.data;
    const w         = out.width;
    const h         = out.height;

    // Convert to grayscale
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        gray[i] = Math.round(data[i*4] * 0.299 + data[i*4+1] * 0.587 + data[i*4+2] * 0.114);
    }

    // Build integral image for fast window averages
    const integral = new Float64Array((w+1) * (h+1));
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            integral[(y+1)*(w+1)+(x+1)] = gray[y*w+x]
                + integral[y*(w+1)+(x+1)]
                + integral[(y+1)*(w+1)+x]
                - integral[y*(w+1)+x];
        }
    }

    // Threshold each pixel against local neighbourhood mean
    const half = 10;
    const C    = 8;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const x1  = Math.max(0, x - half);
            const y1  = Math.max(0, y - half);
            const x2  = Math.min(w, x + half + 1);
            const y2  = Math.min(h, y + half + 1);
            const n   = (x2-x1) * (y2-y1);
            const sum = integral[y2*(w+1)+x2] - integral[y1*(w+1)+x2]
                      - integral[y2*(w+1)+x1] + integral[y1*(w+1)+x1];
            const val = gray[y*w+x] < (sum/n - C) ? 0 : 255;
            const idx = (y*w+x)*4;
            data[idx] = data[idx+1] = data[idx+2] = val;
            data[idx+3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);
    return out;
}

// Parse a card number from OCR text with context-aware character repair
function extractCardNumber(text) {
    const upper = text.toUpperCase()
        .replace(/[|!¡]/g, 'I')
        .replace(/\s+/g, ' ')
        .trim();

    const patterns = [
        /\b([A-Z]{2,5})[-–—]\s*(\d{1,4})\b/,
        /\b([A-Z]{2,5})\s+(\d{2,4})\b/,
        /\b([A-Z]{2,5})(\d{2,4})\b/,
        /([A-Z]{2,})[\s\-–—]*(\d{2,})/,
    ];

    for (const pattern of patterns) {
        const match = upper.match(pattern);
        if (match) {
            const prefix  = match[1].replace(/0/g,'O').replace(/8/g,'B').replace(/5/g,'S').replace(/1/g,'I');
            const numPart = match[2].replace(/O/g,'0').replace(/I/g,'1').replace(/B/g,'8').replace(/S/g,'5');
            return `${prefix}-${numPart}`;
        }
    }
    return null;
}

console.log('✅ OCR module loaded');
