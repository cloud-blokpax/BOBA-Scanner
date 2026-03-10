// ============================================================
// js/scan-history.js — Scan history log
// Records every scan attempt (success and failure) in localStorage.
// Separate from the collection — this is a chronological activity log.
// ============================================================

const HISTORY_KEY  = 'scanHistory';
const MAX_HISTORY  = 100;

// ── Storage ───────────────────────────────────────────────────────────────────

function getScanHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}

function addToScanHistory(entry) {
  const history = getScanHistory();
  history.unshift({
    id:         `sh_${Date.now()}`,
    timestamp:  new Date().toISOString(),
    success:    true,
    ...entry
  });
  if (history.length > MAX_HISTORY) history.splice(MAX_HISTORY);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
}

window.addToScanHistory = addToScanHistory;

function clearScanHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

// ── Modal ─────────────────────────────────────────────────────────────────────

window.openScanHistoryModal = function() {
  if (document.getElementById('scanHistoryModal')) return;
  renderScanHistoryModal();
};

function renderScanHistoryModal() {
  document.getElementById('scanHistoryModal')?.remove();

  const history = getScanHistory();

  const rows = history.length === 0
    ? `<div style="text-align:center;padding:48px 20px;color:#9ca3af;">
         <div style="font-size:48px;margin-bottom:12px;">🕐</div>
         <p>No scans yet — start scanning cards!</p>
       </div>`
    : history.map(entry => {
        const ago    = timeAgo(entry.timestamp);
        const icon   = entry.success ? '✅' : '❌';
        const badge  = entry.scanType === 'free'
          ? '<span style="background:#d1fae5;color:#065f46;padding:2px 7px;border-radius:99px;font-size:11px;font-weight:600;">OCR</span>'
          : entry.scanType === 'ai'
          ? '<span style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:99px;font-size:11px;font-weight:600;">AI</span>'
          : '<span style="background:#fee2e2;color:#991b1b;padding:2px 7px;border-radius:99px;font-size:11px;font-weight:600;">Failed</span>';

        const confText = (entry.confidence && entry.scanType === 'free')
          ? `<span style="font-size:11px;color:#9ca3af;">${Math.round(entry.confidence)}% conf</span>`
          : '';

        return `
          <div class="history-row">
            <span class="history-icon">${icon}</span>
            <div class="history-info">
              <div class="history-card-name">${escapeHtml(entry.hero || entry.cardNumber || 'Unknown')}</div>
              <div class="history-card-meta">
                ${escapeHtml(entry.cardNumber || '')}
                ${entry.set ? `· ${escapeHtml(entry.set)}` : ''}
                ${badge} ${confText}
              </div>
            </div>
            <span class="history-time">${ago}</span>
          </div>`;
      }).join('');

  const html = `
    <div class="modal active" id="scanHistoryModal">
      <div class="modal-backdrop" onclick="document.getElementById('scanHistoryModal').remove()"></div>
      <div class="modal-content" style="max-width:480px;max-height:80vh;display:flex;flex-direction:column;">
        <div class="modal-header">
          <h2>🕐 Scan History</h2>
          <div style="display:flex;gap:8px;align-items:center;">
            ${history.length > 0 ? `<button onclick="clearScanHistoryConfirm()" style="padding:6px 12px;font-size:12px;border:1px solid #ddd;border-radius:8px;background:white;cursor:pointer;color:#ef4444;">Clear</button>` : ''}
            <button class="modal-close" onclick="document.getElementById('scanHistoryModal').remove()">×</button>
          </div>
        </div>
        <div class="modal-body" style="flex:1;overflow-y:auto;padding:0;">
          ${rows}
        </div>
        <div class="modal-footer" style="font-size:12px;color:#9ca3af;justify-content:center;">
          Last ${Math.min(history.length, MAX_HISTORY)} scans · Stored locally
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
}

window.clearScanHistoryConfirm = function() {
  if (!confirm('Clear all scan history?')) return;
  clearScanHistory();
  document.getElementById('scanHistoryModal')?.remove();
  showToast('Scan history cleared', '🗑️');
};

// ── Time helper ───────────────────────────────────────────────────────────────

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

console.log('✅ Scan history module loaded');
