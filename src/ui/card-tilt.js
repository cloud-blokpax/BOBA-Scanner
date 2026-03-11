// card-tilt.js — 3D parallax tilt + holographic shimmer effect (ES Module)
// Tracks pointer position relative to card center and applies perspective
// rotation for a tactile, Instagram-worthy interaction.

const MAX_ANGLE = 12; // degrees
const RESET_MS = 400;

/**
 * Attach 3D tilt effect to an element.
 * @param {HTMLElement} el - The element to make tiltable
 * @param {Object} [opts] - { maxAngle, shimmer }
 * @returns {Function} cleanup - call to remove listeners
 */
function attachCardTilt(el, opts = {}) {
  if (!el) return () => {};

  // Respect prefers-reduced-motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};

  const maxAngle = opts.maxAngle || MAX_ANGLE;
  const enableShimmer = opts.shimmer !== false;

  // Add shimmer overlay class
  if (enableShimmer) {
    el.classList.add('card-shimmer-wrap');
  }

  el.style.transformStyle = 'preserve-3d';
  el.style.transition = `transform ${RESET_MS}ms ease-out`;

  function handleMove(clientX, clientY) {
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Normalize to -1 to 1
    const normX = (clientX - centerX) / (rect.width / 2);
    const normY = (clientY - centerY) / (rect.height / 2);

    // Clamp
    const clampedX = Math.max(-1, Math.min(1, normX));
    const clampedY = Math.max(-1, Math.min(1, normY));

    // Apply rotation (note: rotateX for vertical movement, rotateY for horizontal)
    const rotateX = -clampedY * maxAngle;
    const rotateY = clampedX * maxAngle;

    el.style.transition = 'none';
    el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
  }

  function handleReset() {
    el.style.transition = `transform ${RESET_MS}ms ease-out`;
    el.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
  }

  // Mouse events
  function onMouseMove(e) { handleMove(e.clientX, e.clientY); }
  function onMouseLeave() { handleReset(); }

  // Touch events
  function onTouchMove(e) {
    if (e.touches.length === 1) {
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }
  function onTouchEnd() { handleReset(); }

  el.addEventListener('mousemove', onMouseMove);
  el.addEventListener('mouseleave', onMouseLeave);
  el.addEventListener('touchmove', onTouchMove, { passive: true });
  el.addEventListener('touchend', onTouchEnd, { passive: true });
  el.addEventListener('touchcancel', onTouchEnd, { passive: true });

  // Cleanup function
  return function cleanup() {
    el.removeEventListener('mousemove', onMouseMove);
    el.removeEventListener('mouseleave', onMouseLeave);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
    el.removeEventListener('touchcancel', onTouchEnd);
    el.classList.remove('card-shimmer-wrap');
    el.style.transform = '';
    el.style.transformStyle = '';
    el.style.transition = '';
  };
}

/**
 * Trigger confetti celebration.
 * @param {number} [count=40] - number of pieces
 */
function triggerConfetti(count = 40) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);

  const colors = ['#f59e0b', '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#ec4899'];

  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    piece.style.animationDuration = `${1 + Math.random() * 1}s`;
    container.appendChild(piece);
  }

  setTimeout(() => container.remove(), 3000);
}

/**
 * Show an undo snackbar.
 * @param {string} message
 * @param {Function} onUndo
 * @param {number} [duration=5000]
 */
function showUndoSnackbar(message, onUndo, duration = 5000) {
  // Remove any existing snackbar
  document.querySelector('.undo-snackbar')?.remove();

  const html = `
    <div class="undo-snackbar" id="undoSnackbar">
      <span class="undo-snackbar-text">${message}</span>
      <button class="undo-snackbar-btn" id="undoSnackbarBtn">UNDO</button>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  const snackbar = document.getElementById('undoSnackbar');
  requestAnimationFrame(() => snackbar?.classList.add('show'));

  let dismissed = false;

  document.getElementById('undoSnackbarBtn')?.addEventListener('click', () => {
    if (dismissed) return;
    dismissed = true;
    if (onUndo) onUndo();
    snackbar?.classList.remove('show');
    setTimeout(() => snackbar?.remove(), 300);
  });

  setTimeout(() => {
    if (dismissed) return;
    dismissed = true;
    snackbar?.classList.remove('show');
    setTimeout(() => snackbar?.remove(), 300);
  }, duration);
}

window.attachCardTilt = attachCardTilt;
window.triggerConfetti = triggerConfetti;
window.showUndoSnackbar = showUndoSnackbar;

export { attachCardTilt, triggerConfetti, showUndoSnackbar };
