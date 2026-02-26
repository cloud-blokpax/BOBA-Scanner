// ============================================================
// js/api.js — FIXED
// Changes:
//   - REMOVED duplicate callAPI() — scanner.js is the single definition
//   - REMOVED saveApiKey / clearApiKey / toggleApiSection / updateApiToggle
//     These referenced DOM elements that don't exist in index.html.
//   - KEPT compressImage() — still used for image preparation
// ============================================================

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
