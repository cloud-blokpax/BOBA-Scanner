// ============================================================
// js/api.js — FIXED
// Changes:
//   - REMOVED duplicate callAPI() — scanner.js is the single definition
//   - REMOVED saveApiKey / clearApiKey / toggleApiSection / updateApiToggle
//     These referenced DOM elements that don't exist in index.html.
//   - KEPT compressImage() — still used for image preparation
// ============================================================

// Compress and resize an image File before sending to the API.
// This is the single compression pass — scanner.js calls this instead of
// doing its own resize AND then re-converting.
async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        // Respect config.maxSize (default 1000px on longest edge)
        const maxDim = config.maxSize || 1000;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height / width) * maxDim);
            width  = maxDim;
          } else {
            width  = Math.round((width / height) * maxDim);
            height = maxDim;
          }
        }

        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

        // Return base64 without the data: prefix
        resolve(canvas.toDataURL('image/jpeg', config.quality).split(',')[1]);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

console.log('✅ API module loaded');
