// ============================================================
// js/ui.js — FIXED
// Changes:
//   - escapeHtml() helper added here as the global utility (used by all modules)
//   - showToast() and showLoading() are the PRIMARY/ONLY implementations
//     (duplicates in state.js have been removed)
//   - All event bindings that were inline in index.html moved to wireUpEvents()
//   - renderCards() uses escapeHtml on user-controlled values
//   - initUploadArea() unchanged (was already correct)
// ============================================================

// ── XSS prevention — global escape helper ────────────────────────────────────
// FIXED: Used everywhere user data is injected into HTML.
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str ?? '').replace(/[&<>"']/g, c => map[c]);
}

// ── Status indicators ─────────────────────────────────────────────────────────
// FIXED: Single definition (removed from state.js).
// Maps to actual element IDs in index.html.
function setStatus(type, state) {
  const idMap = { db: 'dbStatus', ocr: 'ocrStatus', cv: 'cvStatus' };
  const el    = document.getElementById(idMap[type]);
  if (!el) return;
  const icons = { loading: '⏳', ready: '✅', error: '❌' };
  el.textContent = icons[state] || state;
  el.className   = `status-${state}`;
}

// ── Toast — SINGLE implementation ────────────────────────────────────────────
// FIXED: Removed duplicate in state.js. This is the only showToast().
function showToast(message, icon = '✓') {
  const toast        = document.getElementById('toast');
  const toastIcon    = document.getElementById('toastIcon');
  const toastMessage = document.getElementById('toastMessage');

  if (toast && toastIcon && toastMessage) {
    toastIcon.textContent    = icon;
    toastMessage.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  } else {
    // Fallback dynamic toast for early init
    _showDynamicToast(message, icon);
  }

  console.log(`🔔 Toast: ${icon} ${message}`);
}

function _showDynamicToast(message, icon) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:10px;';
    document.body.appendChild(container);
  }

  const t = document.createElement('div');
  t.style.cssText = 'background:white;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;box-shadow:0 4px 12px rgba(0,0,0,.15);display:flex;align-items:center;gap:8px;font-size:14px;max-width:300px;';
  t.innerHTML = `<span>${escapeHtml(icon)}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(t);

  setTimeout(() => t.remove(), 3000);
}

// ── Loading overlay — SINGLE implementation ──────────────────────────────────
// FIXED: Removed duplicate in state.js. This is the only showLoading().
function showLoading(show, text = 'Processing...') {
  const overlay     = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');

  if (!overlay) return;

  if (loadingText) loadingText.textContent = text;
  overlay.classList.toggle('active', show);
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function setProgress(percent) {
  const fill = document.getElementById('progressFill');
  if (fill) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
}

// ── Stats update ──────────────────────────────────────────────────────────────
function updateStats() {
  const collections = getCollections();
  const currentId   = getCurrentCollectionId();
  const collection  = collections.find(c => c.id === currentId);
  if (!collection) return;

  const stats = collection.stats;
  const paid  = Math.max(0, stats.scanned - stats.free);
  const rate  = stats.scanned > 0 ? Math.round((stats.free / stats.scanned) * 100) : 0;

  const el = id => document.getElementById(id);
  if (el('statCost')) el('statCost').textContent = `$${(stats.cost || 0).toFixed(2)}`;
  if (el('statRate')) el('statRate').textContent = `${rate}%`;
}

// ── Card rendering ────────────────────────────────────────────────────────────
function renderCards() {
  console.log('🎨 Rendering cards...');

  const collections = getCollections();
  const currentId   = getCurrentCollectionId();
  const collection  = collections.find(c => c.id === currentId);
  const cards       = collection?.cards || [];

  const grid      = document.getElementById('cardsGrid');
  const empty     = document.getElementById('emptyState');
  const actionBar = document.getElementById('actionBar');

  if (!grid) return;

  if (cards.length === 0) {
    if (empty)     empty.classList.remove('hidden');
    if (actionBar) actionBar.classList.add('hidden');
    grid.innerHTML = '';
    grid.style.display = 'none';
    return;
  }

  if (empty)     empty.classList.add('hidden');
  if (actionBar) actionBar.classList.remove('hidden');
  grid.style.display = 'grid';

  grid.innerHTML = cards.map((card, i) => `
    <div class="card">
      <img class="card-image" src="${escapeHtml(card.imageUrl || '')}" alt="${escapeHtml(card.cardNumber || 'Card')}">
      <div class="card-body">
        <span class="card-badge ${card.scanType === 'free' ? 'badge-free' : 'badge-paid'}">
          ${escapeHtml(card.scanMethod || '')}
        </span>
        <div class="card-fields">
          ${renderField('Card ID', 'cardId',     i, card.cardId,     false)}
          ${renderField('Name',    'hero',        i, card.hero,       true)}
          ${renderField('Year',    'year',        i, card.year,       true)}
          ${renderField('Set',     'set',         i, card.set,        true)}
          ${renderField('Card #',  'cardNumber',  i, card.cardNumber, false)}
          ${renderField('Parallel','pose',        i, card.pose,       true)}
          ${renderField('Weapon',  'weapon',      i, card.weapon,     true)}
          ${renderField('Power',   'power',       i, card.power,      true)}
        </div>
        <button class="btn-remove" data-remove-index="${i}">🗑️ Remove</button>
      </div>
    </div>
  `).join('');

  // Event delegation for remove buttons and field edits
  grid.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => removeCard(parseInt(btn.dataset.removeIndex)));
  });
  grid.querySelectorAll('.field-input').forEach(input => {
    input.addEventListener('change', () => {
      updateCard(parseInt(input.dataset.index), input.dataset.field, input.value);
    });
  });

  console.log(`✅ Rendered ${cards.length} cards`);
}

function renderField(label, field, index, value, autoFilled) {
  return `
    <div class="field">
      <div class="field-label">${escapeHtml(label)}</div>
      <input class="field-input ${autoFilled ? 'auto-filled' : ''}"
             type="text"
             value="${escapeHtml(value || '')}"
             data-index="${index}"
             data-field="${escapeHtml(field)}">
    </div>
  `;
}

// ── Upload area ───────────────────────────────────────────────────────────────
function initUploadArea() {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput  = document.getElementById('fileInput');

  if (!uploadArea || !fileInput) return;

  // Clone to remove any stale event listeners
  const fresh = uploadArea.cloneNode(true);
  uploadArea.parentNode.replaceChild(fresh, uploadArea);

  fresh.addEventListener('click', (e) => {
    // Don't trigger if clicking a button inside the upload area
    if (e.target.closest('button')) return;
    document.getElementById('fileInput')?.click();
  });

  fresh.addEventListener('dragover', (e) => {
    e.preventDefault();
    fresh.classList.add('dragover');
  });

  fresh.addEventListener('dragleave', () => fresh.classList.remove('dragover'));

  fresh.addEventListener('drop', (e) => {
    e.preventDefault();
    fresh.classList.remove('dragover');

    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;

    const input = document.getElementById('fileInput');
    if (input) {
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  console.log('✅ Upload area ready');
}

// ── Wire up all event listeners that were inline in index.html ────────────────
// FIXED: Removes all onclick="..." from HTML — handlers live here instead.
function wireUpEvents() {
  // Sign in button
  document.getElementById('btnSignIn')?.addEventListener('click', () => {
    if (typeof google !== 'undefined' && google.accounts) {
      google.accounts.id.prompt();
    } else if (typeof initGoogleAuth === 'function') {
      initGoogleAuth();
    }
  });

  // Sign out
  document.getElementById('btnSignOut')?.addEventListener('click', signOut);

  // Avatar / user menu toggle
  document.getElementById('userAvatar')?.addEventListener('click', toggleUserMenu);

  // Settings open button in upload area
  document.getElementById('btnSettings')?.addEventListener('click', openSettings);

  // Camera capture button
  document.getElementById('btnCapture')?.addEventListener('click', capturePhoto);

  // Gallery choose button
  document.getElementById('btnChooseImage')?.addEventListener('click', () => {
    document.getElementById('fileInput')?.click();
  });

  // Export buttons
  document.getElementById('btnExportCSV')?.addEventListener('click', exportCurrentCSV);
  document.getElementById('btnExportExcel')?.addEventListener('click', exportExcel);

  // Settings modal close
  document.getElementById('settingsModalClose')?.addEventListener('click', closeSettings);
  document.querySelector('#settingsModal .modal-backdrop')?.addEventListener('click', closeSettings);
  document.getElementById('settingsCloseBtn')?.addEventListener('click', closeSettings);

  // Settings toggles
  document.getElementById('toggleAutoDetect')?.addEventListener('change', function() { updateSetting('autoDetect', this.checked); });
  document.getElementById('togglePerspective')?.addEventListener('change', function() { updateSetting('perspective', this.checked); });
  document.getElementById('toggleRegionOcr')?.addEventListener('change', function() { updateSetting('regionOcr', this.checked); });
  document.getElementById('selectQuality')?.addEventListener('change', function() { updateSetting('quality', this.value); });
  document.getElementById('rangeThreshold')?.addEventListener('input', function() {
    const tv = document.getElementById('thresholdValue');
    if (tv) tv.textContent = this.value;
  });
  document.getElementById('rangeThreshold')?.addEventListener('change', function() { updateSetting('threshold', this.value); });
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
window.openSettings = function() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  modal.classList.add('active');
  if (typeof config !== 'undefined') {
    const el = id => document.getElementById(id);
    if (el('toggleAutoDetect')) el('toggleAutoDetect').checked = config.autoDetect;
    if (el('togglePerspective')) el('togglePerspective').checked = config.perspective;
    if (el('toggleRegionOcr')) el('toggleRegionOcr').checked = config.regionOcr;
    if (el('selectQuality')) el('selectQuality').value = config.quality;
    if (el('rangeThreshold')) el('rangeThreshold').value = config.threshold;
    if (el('thresholdValue')) el('thresholdValue').textContent = config.threshold;
  }
};

window.closeSettings = function() {
  document.getElementById('settingsModal')?.classList.remove('active');
};

window.capturePhoto = function() {
  const input = document.getElementById('fileInput');
  if (!input) return;
  input.setAttribute('capture', 'environment');
  input.setAttribute('accept', 'image/*');
  input.click();
  setTimeout(() => input.removeAttribute('capture'), 100);
};

window.toggleUserMenu = function() {
  document.getElementById('userDropdown')?.classList.toggle('active');
};

window.signOut = function() {
  if (!confirm('Sign out?')) return;
  if (typeof signOutGoogle === 'function') {
    signOutGoogle();
  } else {
    localStorage.clear();
    sessionStorage.clear();
    window.googleUser  = null;
    window.currentUser = null;
    updateAuthUI(null);
    showToast('Signed out', '👋');
    setTimeout(() => window.location.reload(), 1000);
  }
};

window.updateAuthUI = function(user) {
  const btnSignIn        = document.getElementById('btnSignIn');
  const userAuthenticated = document.getElementById('userAuthenticated');
  const userName         = document.getElementById('userName');
  const userEmail        = document.getElementById('userEmail');
  const userAvatar       = document.getElementById('userAvatar');

  if (user) {
    if (btnSignIn)         btnSignIn.style.display        = 'none';
    if (userAuthenticated) userAuthenticated.style.display = 'flex';
    if (userName)          userName.textContent            = user.name  || 'User';
    if (userEmail)         userEmail.textContent           = user.email || '';
    if (userAvatar) {
      userAvatar.src = user.picture || user.profilePicture || '';
      userAvatar.alt = user.name || 'User';
    }
  } else {
    if (btnSignIn)         btnSignIn.style.display        = 'block';
    if (userAuthenticated) userAuthenticated.style.display = 'none';
  }
};

// Announce to screen readers (also defined in ui-enhancements but kept here as primary)
window.announceToScreenReader = function(message) {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.style.cssText = 'position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden;';
  el.textContent   = message;
  document.body.appendChild(el);
  setTimeout(() => el.parentNode?.removeChild(el), 1000);
};

document.addEventListener('DOMContentLoaded', () => {
  wireUpEvents();

  // Restore auth UI state after a brief delay to let auth modules load
  setTimeout(() => {
    const user = (typeof googleUser !== 'undefined' && googleUser) ||
                 (typeof currentUser !== 'undefined' && currentUser) || null;
    updateAuthUI(user);
  }, 300);
});

console.log('✅ UI module loaded');
