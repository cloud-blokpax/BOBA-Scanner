// ============================================================
// ES Module — Collection Stats Dashboard v1.1
// Shows: scan stats, breakdown by set/year/parallel/weapon,
//        condition breakdown, listing status, ready-to-list count
// ============================================================

import { getCollections, getCurrentCollectionId, saveCollections } from './collections.js';
import { updateCard } from '../scanner/scanner.js';
import { escapeHtml } from '../../ui/utils.js';
import { showToast } from '../../ui/toast.js';
import { openExportModal } from '../../features/export/export.js';
import { fetchEbayAvgPrice } from '../../features/ebay/ebay.js';
import { renderCards } from '../../ui/cards-grid.js';

export function showStatsModal() {
  document.getElementById('statsModal')?.remove();

  const cols       = getCollections();
  const currentId  = getCurrentCollectionId();
  const collection = cols.find(c => c.id === currentId);
  if (!collection) return;

  const cards   = collection.cards || [];
  const total   = cards.length;
  const free    = cards.filter(c => c.scanType === 'ocr').length;
  const ai      = cards.filter(c => c.scanType === 'ai' || c.scanType === 'manual').length;
  const rtl     = cards.filter(c => c.readyToList).length;
  const listed  = cards.filter(c => c.listingStatus === 'listed').length;
  const sold    = cards.filter(c => c.listingStatus === 'sold').length;

  // ── Cached eBay price aggregates ──────────────────────────────────────────
  const pricedCards   = cards.filter(c => c.ebayAvgPrice > 0 || c.ebayLowPrice > 0);
  const unpricedCards = cards.filter(c => !c.ebayPriceFetched);
  const collFloor     = pricedCards.reduce((sum, c) => sum + (Number(c.ebayLowPrice) || 0), 0);
  const collAvg       = pricedCards.reduce((sum, c) => sum + (Number(c.ebayAvgPrice) || 0), 0);
  const pricedCount   = pricedCards.length;
  const soldPricedCards = cards.filter(c => c.ebaySoldPrice > 0);
  const collSoldValue   = soldPricedCards.reduce((sum, c) => sum + (Number(c.ebaySoldPrice) || 0), 0);
  const soldPricedCount = soldPricedCards.length;

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

        <!-- eBay Collection Value -->
        <div style="border-top:1px solid #f3f4f6;margin-top:16px;padding-top:16px;">
          <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px;">
            💰 eBay Collection Value
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
            <div style="background:#d1fae5;border-radius:10px;padding:14px;">
              <div style="font-size:11px;font-weight:600;color:#065f46;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Collection Floor</div>
              <div id="statsFloorValue" style="font-size:22px;font-weight:800;color:#065f46;">
                ${pricedCount > 0 ? '$' + collFloor.toFixed(2) : '—'}
              </div>
              <div style="font-size:11px;color:#6b7280;margin-top:2px;">Lowest listed prices</div>
            </div>
            <div style="background:#eff6ff;border-radius:10px;padding:14px;">
              <div style="font-size:11px;font-weight:600;color:#1d4ed8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Collection Average</div>
              <div id="statsAvgValue" style="font-size:22px;font-weight:800;color:#1d4ed8;">
                ${pricedCount > 0 ? '$' + collAvg.toFixed(2) : '—'}
              </div>
              <div style="font-size:11px;color:#6b7280;margin-top:2px;">Avg listed prices</div>
            </div>
            <div style="background:#fef3c7;border-radius:10px;padding:14px;">
              <div style="font-size:11px;font-weight:600;color:#92400e;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Sold Value</div>
              <div id="statsSoldValue" style="font-size:22px;font-weight:800;color:#78350f;">
                ${soldPricedCount > 0 ? '$' + collSoldValue.toFixed(2) : '—'}
              </div>
              <div style="font-size:11px;color:#6b7280;margin-top:2px;">${soldPricedCount} card${soldPricedCount!==1?'s':''} with sold data</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
            <div style="font-size:12px;color:#9ca3af;">
              ${pricedCount > 0
                ? `${pricedCount} of ${total} card${total!==1?'s':''} priced · ${unpricedCards.length} need refresh`
                : `No prices cached yet — open card details to fetch, or use Refresh below`}
            </div>
            ${unpricedCards.length > 0 ? `
            <button id="statsRefreshBtn" onclick="bulkPriceRefresh()"
                    style="padding:7px 14px;background:#1d4ed8;color:white;border:none;
                           border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">
              🔄 Refresh ${unpricedCards.length} card${unpricedCards.length!==1?'s':''}
            </button>` : `
            <button id="statsRefreshBtn" onclick="bulkPriceRefreshAll()"
                    style="padding:7px 14px;background:#f3f4f6;color:#6b7280;border:none;
                           border-radius:8px;font-size:12px;cursor:pointer;">
              🔄 Re-fetch all prices
            </button>`}
          </div>
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
    const val = String(card[field] ?? '').trim() || '(blank)';
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

// ── Bulk Price Refresh — fetches prices for cards that haven't been priced yet ──
window.bulkPriceRefresh = async function() {
  await _bulkFetch(false);
};

window.bulkPriceRefreshAll = async function() {
  await _bulkFetch(true);
};

async function _bulkFetch(refetchAll) {
  const cols       = getCollections();
  const currentId  = getCurrentCollectionId();
  const collection = cols.find(c => c.id === currentId);
  if (!collection) return;

  const targets = (collection.cards || [])
    .map((c, i) => ({ card: c, index: i }))
    .filter(({ card }) => refetchAll || !card.ebayPriceFetched);

  if (targets.length === 0) {
    showToast('All cards already priced!', '✅');
    return;
  }


  const btn = document.getElementById('statsRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = `Fetching 0 / ${targets.length}…`; }
  showToast(`Fetching prices for ${targets.length} cards…`, '🔄');

  let done = 0;
  let floorSum = 0;
  let avgSum   = 0;
  let priced   = 0;

  // Re-read existing cached prices from other cards so totals stay accurate
  (collection.cards || []).forEach((card, i) => {
    if (!targets.find(t => t.index === i) && card.ebayAvgPrice > 0) {
      floorSum += Number(card.ebayLowPrice) || 0;
      avgSum   += Number(card.ebayAvgPrice) || 0;
      priced++;
    }
  });

  for (const { card, index } of targets) {
    try {
      const result = await fetchEbayAvgPrice(card);
      if (result && result.count > 0) {
        updateCard(index, 'ebayAvgPrice',    result.avgPrice);
        updateCard(index, 'ebayLowPrice',    result.lowPrice);
        updateCard(index, 'ebayHighPrice',   result.highPrice);
        updateCard(index, 'ebayListingCount', result.count);
        floorSum += Number(result.lowPrice) || 0;
        avgSum   += Number(result.avgPrice) || 0;
        priced++;
      } else {
        updateCard(index, 'ebayAvgPrice',    null);
        updateCard(index, 'ebayLowPrice',    null);
      }
      updateCard(index, 'ebayPriceFetched', new Date().toISOString());
    } catch { /* skip */ }

    done++;
    if (btn) btn.textContent = `Fetching ${done} / ${targets.length}…`;

    // Update live totals in modal as we go
    const floorEl = document.getElementById('statsFloorValue');
    const avgEl   = document.getElementById('statsAvgValue');
    if (floorEl) floorEl.textContent = priced > 0 ? '$' + floorSum.toFixed(2) : '—';
    if (avgEl)   avgEl.textContent   = priced > 0 ? '$' + avgSum.toFixed(2)   : '—';

    // Small delay to avoid rate-limiting
    if (done < targets.length) await new Promise(r => setTimeout(r, 400));
  }

  if (typeof syncToCloud === 'function') syncToCloud();
  renderCards();
  showToast(`Prices refreshed for ${done} cards`, '✅');
  if (btn) { btn.disabled = false; btn.textContent = '🔄 Re-fetch all prices'; }
}

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
