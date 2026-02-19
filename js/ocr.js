// ============================================================
// js/ocr.js — FIXED
// Changes:
//   - initTesseract assigns to the global tesseractWorker (shared state)
//   - runOCR always uses the pre-initialized worker, never Tesseract.recognize()
//   - extractRegion improved: higher contrast binarization option
// ============================================================

async function initTesseract() {
  setStatus('ocr', 'loading');
  try {
    // Wait for the Tesseract CDN script to be available
    let attempts = 0;
    while (typeof Tesseract === 'undefined' && attempts < 50) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }
    if (typeof Tesseract === 'undefined') throw new Error('Tesseract library not loaded');

    // FIXED: Store in the shared global tesseractWorker (declared in state.js)
    // scanner.js will use this same worker instead of calling Tesseract.recognize() directly.
    tesseractWorker = await Tesseract.createWorker('eng');

    ready.ocr = true;
    setStatus('ocr', 'ready');
    console.log('✅ OCR ready (worker initialized)');
  } catch (err) {
    console.error('❌ OCR failed:', err);
    setStatus('ocr', 'error');
  }
}

// FIXED: This function is now the ONLY way OCR is called.
// scanner.js previously called Tesseract.recognize() directly, creating a
// new worker on every scan and wasting 3-8 seconds per call.
async function runOCR(imageUrl) {
  if (!ready.ocr || !tesseractWorker) {
    throw new Error('OCR not ready — worker not initialized');
  }

  let targetImage = imageUrl;

  // Apply region cropping if enabled — focus on the card number area (bottom-left)
  if (config.regionOcr) {
    targetImage = await extractRegion(imageUrl, config.region);
  }

  const result = await tesseractWorker.recognize(targetImage);
  return {
    text:       result.data.text,
    confidence: result.data.confidence
  };
}

// Crop and binarize a region of an image for better OCR accuracy.
function extractRegion(imageUrl, region) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx    = canvas.getContext('2d');

      const x = img.width  * region.x;
      const y = img.height * region.y;
      const w = img.width  * region.w;
      const h = img.height * region.h;

      // Scale up the region 2× so Tesseract has more pixels to work with
      canvas.width  = w * 2;
      canvas.height = h * 2;
      ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);

      // Binarize (black/white) — improves OCR accuracy on card text
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray     = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
        const adjusted = gray > 128 ? 255 : 0;
        data[i] = data[i + 1] = data[i + 2] = adjusted;
      }
      ctx.putImageData(imageData, 0, 0);

      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = () => reject(new Error('extractRegion: failed to load image'));
    img.src = imageUrl;
  });
}

// Parse a card number from raw OCR text.
function extractCardNumber(text) {
  const cleaned = text
    .replace(/[|]/g, 'I')
    .replace(/[O]/g, '0')
    .toUpperCase();

  const patterns = [
    /\b([A-Z]{2,4})[-–—]\s*(\d{2,4})\b/,
    /\b([A-Z]{2,4})\s+(\d{2,4})\b/,
    /\b([A-Z]{2,4})(\d{2,4})\b/
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match && match[1].length >= 2 && match[2].length >= 2) {
      return `${match[1]}-${match[2]}`;
    }
  }

  const fallback = cleaned.match(/\b([A-Z]{2,})[^\w]*(\d{2,})\b/);
  return fallback ? `${fallback[1]}-${fallback[2]}` : null;
}

console.log('✅ OCR module loaded');
