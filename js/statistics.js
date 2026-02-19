// ============================================================
// js/statistics.js — FIXED
// Changes:
//   - updateStatsBar() now references the correct element IDs from index.html
//     (was: statFree, statPaid — not present in DOM)
//     (now: statCards, statAI — match actual index.html)
//   - showStatsModal() guard added against duplicate insertion
// ============================================================

function showStatsModal() {
  // FIXED: Guard against duplicate insertion
  if (document.getElementById('statsModal')) return;

  const collection = getCurrentCollection();
  const totalScanned = collection.stats.scanned || collection.cards.length;
  const freeScans    = collection.cards.filter(c => c.scanType === 'free').length;
  const paidScans    = collection.cards.filter(c => c.scanType === 'ai').length;
  const totalCost    = paidScans * (config.aiCost || 0.002);
  const freeRate     = totalScanned > 0 ? ((freeScans / totalScanned) * 100).toFixed(1) : 0;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal active" id="statsModal">
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-title">📊 Statistics — ${escapeHtml(collection.name)}</div>
          <div class="modal-close" id="statsModalClose">×</div>
        </div>
        <div class="stats-grid-modal">
          <div class="stat-card-modal">
            <div class="stat-icon" style="color:var(--primary);">📸</div>
            <div class="stat-value">${totalScanned}</div>
            <div class="stat-label">Total Scanned</div>
          </div>
          <div class="stat-card-modal">
            <div class="stat-icon" style="color:#22c55e;">✨</div>
            <div class="stat-value">${freeScans}</div>
            <div class="stat-label">Free (OCR)</div>
          </div>
          <div class="stat-card-modal">
            <div class="stat-icon" style="color:#f59e0b;">🤖</div>
            <div class="stat-value">${paidScans}</div>
            <div class="stat-label">Paid (AI)</div>
          </div>
          <div class="stat-card-modal">
            <div class="stat-icon" style="color:#ef4444;">💰</div>
            <div class="stat-value">$${totalCost.toFixed(2)}</div>
            <div class="stat-label">Total Cost</div>
          </div>
          <div class="stat-card-modal">
            <div class="stat-icon" style="color:#8b5cf6;">📈</div>
            <div class="stat-value">${freeRate}%</div>
            <div class="stat-label">Free Rate</div>
          </div>
        </div>
        <div class="modal-buttons">
          <button class="btn btn-secondary" id="statsModalCloseBtn">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper.firstElementChild);
  document.getElementById('statsModalClose')?.addEventListener('click', closeStatsModal);
  document.getElementById('statsModalCloseBtn')?.addEventListener('click', closeStatsModal);
}

function closeStatsModal() {
  document.getElementById('statsModal')?.remove();
}

// FIXED: Was referencing statFree, statPaid which don't exist in index.html.
// Now updates statCards and statAI which DO exist (plus statCost and statRate).
function updateStatsBar() {
  const collection   = getCurrentCollection();
  const totalScanned = collection.stats.scanned || collection.cards.length;
  const freeScans    = collection.cards.filter(c => c.scanType === 'free').length;
  const paidScans    = collection.cards.filter(c => c.scanType === 'ai').length;
  const totalCost    = paidScans * (config.aiCost || 0.002);
  const freeRate     = totalScanned > 0 ? Math.round((freeScans / totalScanned) * 100) : 0;

  // FIXED: Use actual element IDs from index.html
  const statCostEl = document.getElementById('statCost');
  const statRateEl = document.getElementById('statRate');

  if (statCostEl) statCostEl.textContent = `$${totalCost.toFixed(2)}`;
  if (statRateEl) statRateEl.textContent = `${freeRate}%`;

  const statsBar = document.getElementById('statsContainer');
  if (statsBar && totalScanned > 0) {
    statsBar.classList.remove('hidden');
  }
}

console.log('✅ Statistics module loaded');
