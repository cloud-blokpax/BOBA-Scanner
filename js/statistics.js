// ============================================================
// js/statistics.js — Collection Stats Dashboard v1.1
// Shows: scan stats, breakdown by set/year/parallel/weapon,
//        condition breakdown, listing status, ready-to-list count
// ============================================================

function showStatsModal() {
  document.getElementById('statsModal')?.remove();

  const cols       = getCollections();
  const currentId  = getCurrentCollectionId();
  const collection = cols.find(c => c.id === currentId);
  if (!collection) return;

  const cards   = collection.cards || [];
  const total   = cards.length;
  const free    = cards.filter(c => c.scanType === 'free').length;
  const ai      = cards.filter(c => c.scanType === 'ai' || c.scanType === 'manual').length;
  const rtl     = cards.filter(c => c.readyToList).length;
  const listed  = cards.filter(c => c.listingStatus === 'listed').length;
  const sold    = cards.filter(c => c.listingStatus === 'sold').length;

  // --- Set breakdown ---
  const bySett = _tally(cards, 'set');
  // --- Year breakdown ---
  const byYear = _tally(cards, 'year');
  // --- Parallel breakdown ---
  const byPose = _tally(cards, 'pose');
  // --- Condition breakdown ---
  const byCond = _tally(cards, 'condition');

  const topSets = _topN(bySett, 8);
  const topYear = _topN(byYear, 6);
  const topPose = _topN(byPose, 6);
  const topCond = _topN(byCond, 6);

  const html = `
  <div class="modal active" id="statsModal">
    <div class="modal-backdrop" onclick="document.getElementById('statsModal').remove()"></div>
    <div class="modal-content" style="max-width:560px;max-height:90vh;display:flex;flex-direction:column;">
      <div class="modal-header">
        <h2>📊 Stats — ${escapeHtml(collection.name)}</h2>
        <button class="modal-close" onclick="document.getElementById('statsModal').remove()">×</button>
      </div>
      <div class="modal-body" style="flex:1;overflow-y:auto;padding:20px;">

        <!-- Top metrics -->
        <div class="stats-top-grid">
          ${_statBox('Total Cards', total, '🃏')}
          ${_statBox('Free OCR', free, '🆓', total ? `${Math.round(free/total*100)}%` : null)}
          ${_statBox('AI Scans', ai, '🤖')}
          ${_statBox('Ready to List', rtl, '🏷️')}
          ${_statBox('Listed', listed, '🟢')}
          ${_statBox('Sold', sold, '🔴')}
        </div>

        <!-- Breakdowns -->
        ${total === 0 ? '<p style="text-align:center;color:#9ca3af;padding:32px;">Scan some cards to see stats!</p>' : `
          <div class="stats-sections">
            ${_breakdownSection('By Set', topSets, total)}
            ${_breakdownSection('By Year', topYear, total)}
            ${_breakdownSection('By Parallel', topPose, total)}
            ${byCond && Object.keys(byCond).some(k => k) ? _breakdownSection('By Condition', topCond, total) : ''}
          </div>
        `}

        <!-- Bulk price refresh placeholder -->
        <div style="border-top:1px solid #f3f4f6;margin-top:16px;padding-top:16px;">
          <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
            💰 Pricing (Coming Soon)
          </div>
          <p style="font-size:12px;color:#9ca3af;margin:0;">
            Bulk price refresh and estimated collection value will be available once
            Radish Price Guide integration is active.
          </p>
          <button onclick="showToast('Radish integration coming soon!', '⏳')"
                  style="margin-top:10px;padding:8px 16px;background:#f3f4f6;border:none;
                         border-radius:8px;font-size:13px;cursor:pointer;color:#6b7280;">
            🔄 Refresh Prices (Soon)
          </button>
        </div>

      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="document.getElementById('statsModal').remove()" style="flex:1;">Close</button>
        <button class="btn-tag-add" onclick="document.getElementById('statsModal').remove();openExportModal()">📄 Export</button>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
}

function _tally(cards, field) {
  return cards.reduce((acc, card) => {
    const val = (card[field] || '').trim() || '(blank)';
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
}

function _topN(obj, n) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function _statBox(label, value, icon, sub = null) {
  return `
    <div class="stats-box">
      <div class="stats-box-icon">${icon}</div>
      <div class="stats-box-value">${value}</div>
      <div class="stats-box-label">${label}</div>
      ${sub ? `<div class="stats-box-sub">${sub}</div>` : ''}
    </div>`;
}

function _breakdownSection(title, entries, total) {
  if (!entries.length) return '';
  return `
    <div class="stats-breakdown">
      <div class="stats-breakdown-title">${title}</div>
      ${entries.map(([name, count]) => {
        const pct = total ? Math.round(count / total * 100) : 0;
        return `
          <div class="stats-bar-row">
            <span class="stats-bar-label">${escapeHtml(name)}</span>
            <div class="stats-bar-track">
              <div class="stats-bar-fill" style="width:${pct}%"></div>
            </div>
            <span class="stats-bar-count">${count}</span>
          </div>`;
      }).join('')}
    </div>`;
}

// ── Bulk Price Refresh (stub — unlocks when Radish integration is live) ────────
window.bulkPriceRefresh = async function() {
  showToast('Radish integration coming soon — check back!', '⏳');
};

console.log('Statistics module loaded (v1.1)');
window.openStatsModal = showStatsModal;
window.openReadyToListView = function() {
  const cols = getCollections();
  const allRTL = cols.flatMap(c => c.cards).filter(c => c.readyToList);
  if (!allRTL.length) { showToast('No cards marked Ready to List yet', '🏷️'); return; }
  // Open export modal pre-filtered to RTL
  openExportModal();
  setTimeout(() => {
    const filter = document.getElementById('exportFilter');
    if (filter) { filter.value = 'rtl'; }
  }, 100);
};
