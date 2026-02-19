// ============================================================
// js/batch-scanner.js — FIXED
// Changes:
//   - BATCH_CONFIG constants were defined but never used — removed dead code
//   - processBatchImage() was an alias for processImage() — documented clearly
//   - showBatchGuide() unchanged (it's just a modal)
//   - TODO comment added for the real implementation path
// ============================================================

// TODO: Real batch scanning requires OpenCV contour detection to split a
// grid photo into individual card images. Re-enable opencv.js and implement:
//   1. cv.findContours() on a thresholded image
//   2. Filter contours by card aspect ratio (~0.71)
//   3. Perspective-correct each detected card
//   4. Process each sub-image through processImage()
//
// Until that's built, batch mode processes the image as a single card.
async function processBatchImage(file) {
  return await processImage(file);
}

function showBatchGuide() {
  if (document.getElementById('batchGuideModal')) return;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal active" id="batchGuideModal">
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-title">📸 Batch Scan Guide</div>
          <div class="modal-close" id="batchGuideClose">×</div>
        </div>
        <div style="padding:20px;">
          <h4>How to scan multiple cards:</h4>
          <ol style="margin-left:20px;line-height:1.8;">
            <li>Arrange cards in a grid (2×2, 3×3, etc.)</li>
            <li>Leave 1–2 inches of space between cards</li>
            <li>Take photo from directly above</li>
            <li>Ensure good lighting with no shadows</li>
            <li>White or solid background works best</li>
          </ol>
          <p style="margin-top:16px;color:#888;">
            <strong>Note:</strong> Full batch detection is in development.
            Currently processes the image as a single card.
          </p>
        </div>
        <div class="modal-buttons">
          <button class="btn btn-primary" id="batchGuideOkBtn">Got It!</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper.firstElementChild);
  document.getElementById('batchGuideClose')?.addEventListener('click', closeBatchGuide);
  document.getElementById('batchGuideOkBtn')?.addEventListener('click', closeBatchGuide);
}

function closeBatchGuide() {
  document.getElementById('batchGuideModal')?.remove();
}

console.log('✅ Batch scanner module loaded');
