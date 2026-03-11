// continuous-scanner.js — World-class real-time camera card scanning (ES Module)
// Full-screen viewfinder with L-shaped corner brackets, animated scan line,
// auto-detect + auto-capture, foil mode, blur prevention, and bottom sheet results.

import { showToast } from '../../ui/toast.js';
import { processImage } from './scanner.js';
import { showScanResultSheet } from '../../ui/scan-result-sheet.js';

let _stream = null;
let _scanning = false;
let _detectionInterval = null;
let _stableFrames = 0;
let _foilMode = false;
let _foilCaptures = [];
let _torchOn = false;
let _lastGuidanceChange = 0;
let _lastGuidanceText = '';

const STABLE_THRESHOLD = 3;           // frames card must be stable before auto-capture
const DETECTION_INTERVAL_MS = 500;     // check every 500ms
const GUIDANCE_RATE_LIMIT_MS = 1500;   // min time between guidance text changes
const BLUR_THRESHOLD = 50;            // Laplacian variance below this = blurry
const FOIL_CAPTURES_NEEDED = 3;

// ── Open the full-screen viewfinder ─────────────────────────────────────────

function openContinuousScanner() {
  if (_scanning) return;
  closeContinuousScanner();

  const html = `
    <div class="viewfinder-overlay" id="continuousScanModal">
      <video class="viewfinder-video" id="vfVideo" autoplay playsinline muted></video>

      <!-- Dark overlay outside scan zone -->
      <div class="viewfinder-mask" id="vfMask"></div>

      <!-- Corner brackets (positioned by JS) -->
      <div class="viewfinder-brackets" id="vfBrackets">
        <div class="viewfinder-corner viewfinder-corner--tl"></div>
        <div class="viewfinder-corner viewfinder-corner--tr"></div>
        <div class="viewfinder-corner viewfinder-corner--bl"></div>
        <div class="viewfinder-corner viewfinder-corner--br"></div>
        <!-- Scan line animates inside brackets -->
        <div class="viewfinder-scanline" id="vfScanline"></div>
      </div>

      <!-- Glare overlay for foil mode -->
      <canvas class="viewfinder-glare-overlay" id="vfGlareCanvas"></canvas>

      <!-- Shutter flash -->
      <div class="viewfinder-flash" id="vfFlash"></div>

      <!-- Top toolbar -->
      <div class="viewfinder-toolbar">
        <button class="viewfinder-tool-btn" id="vfFoilBtn" title="Foil Mode">✨</button>
        <button class="viewfinder-tool-btn" id="vfTorchBtn" title="Toggle Flash">⚡</button>
        <button class="viewfinder-tool-btn" id="vfCloseBtn" title="Close">✕</button>
      </div>

      <!-- Guidance text -->
      <div class="viewfinder-guidance" id="vfGuidance">Point camera at a card</div>

      <!-- Foil mode hint (hidden by default) -->
      <div class="viewfinder-foil-hint" id="vfFoilHint" style="display:none;">
        <div>Tilt your phone slightly between captures</div>
        <div class="viewfinder-foil-counter" id="vfFoilCounter">0 / ${FOIL_CAPTURES_NEEDED}</div>
      </div>

      <!-- Bottom actions -->
      <div class="viewfinder-actions">
        <button class="viewfinder-close-btn" id="vfCloseBtn2">✕</button>
        <button class="viewfinder-capture-btn" id="vfCaptureBtn" title="Capture"></button>
        <div style="width:44px;"></div> <!-- spacer for centering -->
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  document.body.style.overflow = 'hidden';

  // Wire up buttons
  document.getElementById('vfCloseBtn')?.addEventListener('click', closeContinuousScanner);
  document.getElementById('vfCloseBtn2')?.addEventListener('click', closeContinuousScanner);
  document.getElementById('vfCaptureBtn')?.addEventListener('click', () => {
    const video = document.getElementById('vfVideo');
    if (video) captureFrame(video);
  });
  document.getElementById('vfFoilBtn')?.addEventListener('click', toggleFoilMode);
  document.getElementById('vfTorchBtn')?.addEventListener('click', toggleTorch);

  // Start camera
  const video = document.getElementById('vfVideo');
  startCamera(video);

  // Position brackets after video loads
  video?.addEventListener('loadedmetadata', () => {
    positionBrackets();
    window.addEventListener('resize', positionBrackets);
  });
}

// ── Position brackets at 5:7 aspect ratio, 78% of screen width ─────────────

function positionBrackets() {
  const brackets = document.getElementById('vfBrackets');
  const mask = document.getElementById('vfMask');
  if (!brackets) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const cardW = Math.round(vw * 0.78);
  const cardH = Math.round(cardW * (7 / 5));
  const left = Math.round((vw - cardW) / 2);
  const top = Math.round((vh - cardH) / 2) - 20; // shift up slightly for thumb zone

  brackets.style.cssText = `
    position:absolute; left:${left}px; top:${top}px;
    width:${cardW}px; height:${cardH}px;
    pointer-events:none;
  `;

  // Set clip-path on mask to cut out the card rectangle
  if (mask) {
    mask.style.clipPath = `polygon(
      0% 0%, 100% 0%, 100% 100%, 0% 100%,
      0% ${top}px,
      ${left}px ${top}px,
      ${left}px ${top + cardH}px,
      ${left + cardW}px ${top + cardH}px,
      ${left + cardW}px ${top}px,
      0% ${top}px
    )`;
  }

  // Store bounds for detection
  brackets._bounds = { left, top, width: cardW, height: cardH };
}

// ── Camera initialization ───────────────────────────────────────────────────

async function startCamera(video) {
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { exact: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      }
    });
    video.srcObject = _stream;
    _scanning = true;

    video.addEventListener('loadeddata', () => {
      _detectionInterval = setInterval(() => {
        detectCardInFrame(video);
      }, DETECTION_INTERVAL_MS);
    }, { once: true });

  } catch (err) {
    // Fallback: try without exact facing mode (some devices don't support it)
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      video.srcObject = _stream;
      _scanning = true;

      video.addEventListener('loadeddata', () => {
        _detectionInterval = setInterval(() => {
          detectCardInFrame(video);
        }, DETECTION_INTERVAL_MS);
      }, { once: true });
    } catch (err2) {
      console.error('Camera access failed:', err2);
      showToast('Camera access denied. Please allow camera permissions.', '❌');
      closeContinuousScanner();
    }
  }
}

// ── Card detection with blur prevention ─────────────────────────────────────

function detectCardInFrame(video) {
  if (!_scanning || video.readyState < 2) return;

  const canvas = document.createElement('canvas');
  const scale = 0.25;
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const hasCard = _detectCardPresence(ctx, canvas.width, canvas.height);
  const blurScore = _measureBlur(ctx, canvas.width, canvas.height);
  const isBlurry = blurScore < BLUR_THRESHOLD;

  const brackets = document.getElementById('vfBrackets');

  if (hasCard && !isBlurry) {
    _stableFrames++;

    if (brackets) {
      brackets.classList.remove('partial');
      brackets.classList.add('detected');
    }

    if (_stableFrames >= STABLE_THRESHOLD) {
      updateGuidance('Card detected! Capturing...');
      _stableFrames = 0;

      if (_foilMode) {
        captureFoilFrame(video);
      } else {
        captureFrame(video);
      }
    } else {
      updateGuidance('Hold steady...');
    }
  } else if (hasCard && isBlurry) {
    _stableFrames = 0;
    if (brackets) {
      brackets.classList.add('partial');
      brackets.classList.remove('detected');
    }
    updateGuidance('Hold steady — image is blurry');
  } else {
    _stableFrames = 0;
    if (brackets) {
      brackets.classList.remove('detected', 'partial');
    }
    updateGuidance('Point camera at a card');
  }

  // Glare detection (for foil mode visual feedback)
  if (_foilMode) {
    detectGlare(video);
  }
}

// ── Guidance text with rate limiting ────────────────────────────────────────

function updateGuidance(text) {
  const now = Date.now();
  if (text === _lastGuidanceText) return;
  if (now - _lastGuidanceChange < GUIDANCE_RATE_LIMIT_MS) return;

  const el = document.getElementById('vfGuidance');
  if (el) {
    el.style.opacity = '0';
    setTimeout(() => {
      el.textContent = text;
      el.style.opacity = '1';
    }, 150);
  }
  _lastGuidanceText = text;
  _lastGuidanceChange = now;
}

// ── Edge detection (unchanged from original) ────────────────────────────────

function _detectCardPresence(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  let edgeCount = 0;
  const threshold = 30;
  const totalPixels = w * h;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      const gray = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      const leftIdx = (y * w + (x - 1)) * 4;
      const rightIdx = (y * w + (x + 1)) * 4;
      const grayLeft  = data[leftIdx] * 0.299 + data[leftIdx + 1] * 0.587 + data[leftIdx + 2] * 0.114;
      const grayRight = data[rightIdx] * 0.299 + data[rightIdx + 1] * 0.587 + data[rightIdx + 2] * 0.114;
      const dx = Math.abs(grayRight - grayLeft);
      const topIdx = ((y - 1) * w + x) * 4;
      const botIdx = ((y + 1) * w + x) * 4;
      const grayTop = data[topIdx] * 0.299 + data[topIdx + 1] * 0.587 + data[topIdx + 2] * 0.114;
      const grayBot = data[botIdx] * 0.299 + data[botIdx + 1] * 0.587 + data[botIdx + 2] * 0.114;
      const dy = Math.abs(grayBot - grayTop);

      if (dx > threshold || dy > threshold) edgeCount++;
    }
  }

  const edgeRatio = edgeCount / totalPixels;
  return edgeRatio > 0.04 && edgeRatio < 0.35;
}

// ── Blur detection using Laplacian variance ─────────────────────────────────

function _measureBlur(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  // Laplacian kernel on grayscale
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      const gray = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;

      const topIdx = ((y - 1) * w + x) * 4;
      const botIdx = ((y + 1) * w + x) * 4;
      const leftIdx = (y * w + (x - 1)) * 4;
      const rightIdx = (y * w + (x + 1)) * 4;

      const grayTop = data[topIdx] * 0.299 + data[topIdx + 1] * 0.587 + data[topIdx + 2] * 0.114;
      const grayBot = data[botIdx] * 0.299 + data[botIdx + 1] * 0.587 + data[botIdx + 2] * 0.114;
      const grayLeft = data[leftIdx] * 0.299 + data[leftIdx + 1] * 0.587 + data[leftIdx + 2] * 0.114;
      const grayRight = data[rightIdx] * 0.299 + data[rightIdx + 1] * 0.587 + data[rightIdx + 2] * 0.114;

      const laplacian = grayTop + grayBot + grayLeft + grayRight - 4 * gray;
      sum += laplacian;
      sumSq += laplacian * laplacian;
      count++;
    }
  }

  const mean = sum / count;
  return (sumSq / count) - (mean * mean); // variance
}

// ── Glare detection (highlights overexposed regions in red) ──────────────────

function detectGlare(video) {
  const glareCanvas = document.getElementById('vfGlareCanvas');
  if (!glareCanvas) return;

  const brackets = document.getElementById('vfBrackets');
  glareCanvas.width = video.videoWidth;
  glareCanvas.height = video.videoHeight;
  glareCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;';

  const ctx = glareCanvas.getContext('2d');
  ctx.clearRect(0, 0, glareCanvas.width, glareCanvas.height);

  // Sample at reduced resolution
  const tmpCanvas = document.createElement('canvas');
  const scale = 0.15;
  tmpCanvas.width = Math.round(video.videoWidth * scale);
  tmpCanvas.height = Math.round(video.videoHeight * scale);
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.drawImage(video, 0, 0, tmpCanvas.width, tmpCanvas.height);

  const imgData = tmpCtx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height);
  const data = imgData.data;
  const GLARE_THRESHOLD = 240;

  ctx.fillStyle = 'rgba(244, 67, 54, 0.3)';

  for (let y = 0; y < tmpCanvas.height; y++) {
    for (let x = 0; x < tmpCanvas.width; x++) {
      const idx = (y * tmpCanvas.width + x) * 4;
      if (data[idx] > GLARE_THRESHOLD && data[idx + 1] > GLARE_THRESHOLD && data[idx + 2] > GLARE_THRESHOLD) {
        const realX = x / scale;
        const realY = y / scale;
        ctx.fillRect(realX, realY, 1 / scale, 1 / scale);
      }
    }
  }
}

// ── Foil mode ───────────────────────────────────────────────────────────────

function toggleFoilMode() {
  _foilMode = !_foilMode;
  _foilCaptures = [];

  const btn = document.getElementById('vfFoilBtn');
  const hint = document.getElementById('vfFoilHint');
  const glareCanvas = document.getElementById('vfGlareCanvas');

  if (btn) btn.classList.toggle('active', _foilMode);
  if (hint) hint.style.display = _foilMode ? '' : 'none';
  if (glareCanvas && !_foilMode) {
    const ctx = glareCanvas.getContext('2d');
    ctx.clearRect(0, 0, glareCanvas.width, glareCanvas.height);
  }

  updateFoilCounter();
  showToast(_foilMode ? 'Foil Mode ON — tilt between captures' : 'Foil Mode OFF', _foilMode ? '✨' : '📷');
}

function updateFoilCounter() {
  const el = document.getElementById('vfFoilCounter');
  if (el) el.textContent = `${_foilCaptures.length} / ${FOIL_CAPTURES_NEEDED}`;
}

async function captureFoilFrame(video) {
  if (!video || video.readyState < 2) return;

  clearInterval(_detectionInterval);
  _detectionInterval = null;

  // Capture this frame
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  const imgData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  _foilCaptures.push(imgData);
  updateFoilCounter();

  // Flash effect
  triggerFlash();
  if (navigator.vibrate) navigator.vibrate(50);

  if (_foilCaptures.length >= FOIL_CAPTURES_NEEDED) {
    updateGuidance('Compositing captures...');

    // Composite using darkest-pixel technique
    const composite = compositeFoilCaptures(_foilCaptures, canvas.width, canvas.height);
    const compCanvas = document.createElement('canvas');
    compCanvas.width = canvas.width;
    compCanvas.height = canvas.height;
    compCanvas.getContext('2d').putImageData(composite, 0, 0);

    _foilCaptures = [];
    updateFoilCounter();

    compCanvas.toBlob(async (blob) => {
      if (!blob) {
        resumeDetection(video);
        return;
      }
      const file = new File([blob], `foil-${Date.now()}.jpg`, { type: 'image/jpeg' });
      await processCapturedFile(file);
    }, 'image/jpeg', 0.9);
  } else {
    // Wait for next capture
    updateGuidance(`Tilt slightly... (${_foilCaptures.length}/${FOIL_CAPTURES_NEEDED})`);
    setTimeout(() => resumeDetection(video), 800);
  }
}

// ── Darkest-pixel composite (removes specular highlights) ───────────────────

function compositeFoilCaptures(captures, w, h) {
  const result = new ImageData(w, h);
  const rData = result.data;

  // Initialize with first capture
  const first = captures[0].data;
  for (let i = 0; i < rData.length; i++) {
    rData[i] = first[i];
  }

  // For each subsequent capture, take the darker pixel value per channel
  for (let c = 1; c < captures.length; c++) {
    const cData = captures[c].data;
    for (let i = 0; i < rData.length; i += 4) {
      const brightness1 = rData[i] + rData[i + 1] + rData[i + 2];
      const brightness2 = cData[i] + cData[i + 1] + cData[i + 2];
      if (brightness2 < brightness1) {
        rData[i]     = cData[i];
        rData[i + 1] = cData[i + 1];
        rData[i + 2] = cData[i + 2];
      }
    }
  }

  return result;
}

// ── Torch toggle ────────────────────────────────────────────────────────────

async function toggleTorch() {
  if (!_stream) return;
  const track = _stream.getVideoTracks()[0];
  if (!track) return;

  try {
    _torchOn = !_torchOn;
    await track.applyConstraints({ advanced: [{ torch: _torchOn }] });
    const btn = document.getElementById('vfTorchBtn');
    if (btn) btn.classList.toggle('active', _torchOn);
  } catch {
    showToast('Flash not available on this device', '⚠️');
    _torchOn = false;
  }
}

// ── Capture frame ───────────────────────────────────────────────────────────

async function captureFrame(video) {
  if (!video || video.readyState < 2) return;

  clearInterval(_detectionInterval);
  _detectionInterval = null;

  const status = document.getElementById('vfGuidance');
  if (status) status.textContent = 'Processing...';

  // Flash + haptic
  triggerFlash();
  if (navigator.vibrate) navigator.vibrate(50);

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  canvas.toBlob(async (blob) => {
    if (!blob) {
      if (status) status.textContent = 'Capture failed — try again';
      resumeDetection(video);
      return;
    }

    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
    await processCapturedFile(file);
  }, 'image/jpeg', 0.85);
}

// ── Process captured file through scan pipeline ─────────────────────────────

async function processCapturedFile(file) {
  try {
    // Process the image — scanner.js returns the result
    const result = await processImage(file, { returnResult: true });

    if (result && result.card) {
      // Show the bottom sheet scan result over the live camera
      showScanResultSheet(result, {
        onAddToCollection: () => {
          // processImage already adds to collection by default
          showToast('Card added to collection!', '✅');
          const video = document.getElementById('vfVideo');
          if (video) resumeDetection(video);
        },
        onDismiss: () => {
          const video = document.getElementById('vfVideo');
          if (video) resumeDetection(video);
        },
        onClose: () => {
          closeContinuousScanner();
        }
      });
    } else {
      // Fallback: if no result returned (legacy processImage flow), resume
      const video = document.getElementById('vfVideo');
      if (video) resumeDetection(video);
    }
  } catch (err) {
    console.error('Continuous scan processing error:', err);
    showToast('Scan failed — please try again', '❌');
    const video = document.getElementById('vfVideo');
    if (video) resumeDetection(video);
  }
}

// ── Shutter flash effect ────────────────────────────────────────────────────

function triggerFlash() {
  const flash = document.getElementById('vfFlash');
  if (!flash) return;
  flash.classList.remove('active');
  void flash.offsetWidth; // force reflow
  flash.classList.add('active');
  setTimeout(() => flash.classList.remove('active'), 200);
}

// ── Resume detection loop ───────────────────────────────────────────────────

function resumeDetection(video) {
  if (_scanning && !_detectionInterval) {
    _stableFrames = 0;
    _detectionInterval = setInterval(() => {
      detectCardInFrame(video);
    }, DETECTION_INTERVAL_MS);
  }
}

// ── Close scanner ───────────────────────────────────────────────────────────

function closeContinuousScanner() {
  _scanning = false;
  _stableFrames = 0;
  _foilMode = false;
  _foilCaptures = [];
  _torchOn = false;
  _lastGuidanceText = '';
  clearInterval(_detectionInterval);
  _detectionInterval = null;

  if (_stream) {
    _stream.getTracks().forEach(track => track.stop());
    _stream = null;
  }

  window.removeEventListener('resize', positionBrackets);
  document.getElementById('continuousScanModal')?.remove();
  document.body.style.overflow = '';
}

function hasCameraSupport() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Expose globally
window.openContinuousScanner = openContinuousScanner;
window.closeContinuousScanner = closeContinuousScanner;
window.hasCameraSupport = hasCameraSupport;

export { openContinuousScanner, closeContinuousScanner, hasCameraSupport };

console.log('✅ Continuous scanner module loaded (world-class viewfinder)');
