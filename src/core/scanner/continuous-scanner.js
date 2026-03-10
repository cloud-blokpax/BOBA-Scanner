// continuous-scanner.js — Real-time camera card scanning (ES Module)
// Opens the device camera, detects cards in the live viewfinder,
// and auto-captures when a card is stable in frame.

import { showToast } from '../../ui/toast.js';

let _stream = null;
let _scanning = false;
let _detectionInterval = null;
let _stableFrames = 0;
const STABLE_THRESHOLD = 3; // frames card must be stable before auto-capture
const DETECTION_INTERVAL_MS = 600;

/**
 * Opens the continuous scanner modal with live camera preview.
 */
function openContinuousScanner() {
  if (_scanning) return;
  closeContinuousScanner(); // clean up any stale state

  const html = `
    <div class="modal active" id="continuousScanModal" style="z-index:10003;">
      <div class="modal-backdrop" id="continuousScanBackdrop"></div>
      <div class="modal-content" style="max-width:500px;padding:0;overflow:hidden;background:#000;">
        <div style="position:relative;">
          <video id="continuousScanVideo" autoplay playsinline muted
                 style="width:100%;display:block;max-height:70vh;object-fit:cover;"></video>
          <!-- Card detection overlay -->
          <div id="continuousScanOverlay" style="
            position:absolute;top:0;left:0;right:0;bottom:0;
            border:3px solid transparent;
            transition:border-color 0.3s;
            pointer-events:none;
          "></div>
          <!-- Status indicator -->
          <div id="continuousScanStatus" style="
            position:absolute;bottom:12px;left:50%;transform:translateX(-50%);
            background:rgba(0,0,0,0.75);color:#e2e8f0;
            padding:8px 20px;border-radius:999px;font-size:13px;font-weight:600;
            white-space:nowrap;backdrop-filter:blur(8px);
          ">Point camera at a card...</div>
        </div>
        <div style="display:flex;gap:8px;padding:12px;background:#0d1524;">
          <button id="continuousScanCapture" class="btn-scan-primary" style="flex:1;">
            <span class="btn-icon">📸</span>
            <span>Capture Now</span>
          </button>
          <button id="continuousScanClose" class="btn-secondary" style="flex:0 0 auto;padding:10px 16px;">
            Close
          </button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  const video    = document.getElementById('continuousScanVideo');
  const overlay  = document.getElementById('continuousScanOverlay');
  const status   = document.getElementById('continuousScanStatus');
  const closeBtn = document.getElementById('continuousScanClose');
  const capture  = document.getElementById('continuousScanCapture');
  const backdrop = document.getElementById('continuousScanBackdrop');

  closeBtn?.addEventListener('click', closeContinuousScanner);
  backdrop?.addEventListener('click', closeContinuousScanner);
  capture?.addEventListener('click', () => captureFrame(video));

  // Start camera
  startCamera(video, overlay, status);
}

async function startCamera(video, overlay, status) {
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width:  { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });
    video.srcObject = _stream;
    _scanning = true;

    // Start card detection loop
    video.addEventListener('loadeddata', () => {
      _detectionInterval = setInterval(() => {
        detectCardInFrame(video, overlay, status);
      }, DETECTION_INTERVAL_MS);
    }, { once: true });

  } catch (err) {
    console.error('Camera access failed:', err);
    showToast('Camera access denied. Please allow camera permissions.', '❌');
    closeContinuousScanner();
  }
}

/**
 * Detect if a card-like rectangle is visible in the current video frame.
 * Uses a lightweight edge detection approach.
 */
function detectCardInFrame(video, overlay, status) {
  if (!_scanning || video.readyState < 2) return;

  const canvas = document.createElement('canvas');
  const scale = 0.25; // Work at 1/4 resolution for speed
  canvas.width  = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const hasCard = _detectCardPresence(ctx, canvas.width, canvas.height);

  if (hasCard) {
    _stableFrames++;
    overlay.style.borderColor = _stableFrames >= STABLE_THRESHOLD ? '#22c55e' : '#f59e0b';
    status.textContent = _stableFrames >= STABLE_THRESHOLD
      ? 'Card detected! Capturing...'
      : 'Card detected — hold steady...';

    if (_stableFrames >= STABLE_THRESHOLD) {
      _stableFrames = 0;
      captureFrame(video);
    }
  } else {
    _stableFrames = 0;
    overlay.style.borderColor = 'transparent';
    status.textContent = 'Point camera at a card...';
  }
}

/**
 * Simple card presence detection using edge density analysis.
 * A card in frame creates a rectangular region with distinct edges.
 */
function _detectCardPresence(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // Convert to grayscale and compute horizontal/vertical edge strength
  let edgeCount = 0;
  const threshold = 30;
  const totalPixels = w * h;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      const gray = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;

      // Horizontal edge (Sobel simplified)
      const leftIdx = (y * w + (x - 1)) * 4;
      const rightIdx = (y * w + (x + 1)) * 4;
      const grayLeft  = data[leftIdx] * 0.299 + data[leftIdx + 1] * 0.587 + data[leftIdx + 2] * 0.114;
      const grayRight = data[rightIdx] * 0.299 + data[rightIdx + 1] * 0.587 + data[rightIdx + 2] * 0.114;

      const dx = Math.abs(grayRight - grayLeft);

      // Vertical edge
      const topIdx = ((y - 1) * w + x) * 4;
      const botIdx = ((y + 1) * w + x) * 4;
      const grayTop = data[topIdx] * 0.299 + data[topIdx + 1] * 0.587 + data[topIdx + 2] * 0.114;
      const grayBot = data[botIdx] * 0.299 + data[botIdx + 1] * 0.587 + data[botIdx + 2] * 0.114;

      const dy = Math.abs(grayBot - grayTop);

      if (dx > threshold || dy > threshold) edgeCount++;
    }
  }

  // A card typically creates edges covering 5-25% of the frame
  const edgeRatio = edgeCount / totalPixels;
  return edgeRatio > 0.04 && edgeRatio < 0.35;
}

/**
 * Capture the current video frame and send it through the scan pipeline.
 */
async function captureFrame(video) {
  if (!video || video.readyState < 2) return;

  // Pause detection while processing
  clearInterval(_detectionInterval);
  _detectionInterval = null;

  const status = document.getElementById('continuousScanStatus');
  if (status) status.textContent = 'Processing...';

  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  // Convert to blob and process through normal scan pipeline
  canvas.toBlob(async (blob) => {
    if (!blob) {
      if (status) status.textContent = 'Capture failed — try again';
      resumeDetection(video);
      return;
    }

    // Create a File object from the blob for the scan pipeline
    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });

    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate([15, 50, 15]);

    // Close the scanner modal before processing
    closeContinuousScanner();

    // Process through the existing pipeline
    if (typeof processImage === 'function') {
      try {
        await processImage(file);
      } catch (err) {
        console.error('Continuous scan processing error:', err);
        showToast('Scan failed — please try again', '❌');
      }
    }
  }, 'image/jpeg', 0.85);
}

function resumeDetection(video) {
  if (_scanning && !_detectionInterval) {
    const overlay = document.getElementById('continuousScanOverlay');
    const status  = document.getElementById('continuousScanStatus');
    _detectionInterval = setInterval(() => {
      detectCardInFrame(video, overlay, status);
    }, DETECTION_INTERVAL_MS);
  }
}

function closeContinuousScanner() {
  _scanning = false;
  _stableFrames = 0;
  clearInterval(_detectionInterval);
  _detectionInterval = null;

  if (_stream) {
    _stream.getTracks().forEach(track => track.stop());
    _stream = null;
  }

  document.getElementById('continuousScanModal')?.remove();
}

// Check if device has a camera
function hasCameraSupport() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Expose globally
window.openContinuousScanner = openContinuousScanner;
window.closeContinuousScanner = closeContinuousScanner;
window.hasCameraSupport = hasCameraSupport;

export { openContinuousScanner, closeContinuousScanner, hasCameraSupport };

console.log('✅ Continuous scanner module loaded');
