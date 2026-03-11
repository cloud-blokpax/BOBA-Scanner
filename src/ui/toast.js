// ── src/ui/toast.js ──────────────────────────────────────────────────────────
// Status indicators, toast notifications, loading overlay, and progress bar

export function setStatus(type, state) {
    const el = document.getElementById(`status${type.charAt(0).toUpperCase() + type.slice(1)}`);
    if (el) el.className = `status-dot ${state}`;
}

export function showToast(message, icon = '✓') {
    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toastIcon');
    const toastMessage = document.getElementById('toastMessage');

    if (!toast || !toastIcon || !toastMessage) {
        console.log('Toast elements not found, showing alert:', message);
        return;
    }

    toastIcon.textContent = icon;
    toastMessage.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

export function showLoading(show, text = 'Processing...') {
    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');

    if (!overlay || !loadingText) return;

    loadingText.textContent = text;
    overlay.classList.toggle('active', show);
}

export function setProgress(percent) {
    const progressFill = document.getElementById('progressFill');
    if (progressFill) {
        progressFill.style.width = `${percent}%`;
    }
}

// Expose on window for lazy-loaded modules that can't use ES imports
window.showToast   = showToast;
window.showLoading = showLoading;
