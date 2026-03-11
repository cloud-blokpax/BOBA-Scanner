// scan-result-sheet.js — Bottom sheet for scan results (ES Module)
// Slides up over the live camera viewfinder showing the identified card,
// price, confidence level, and quick-action buttons.

import { escapeHtml } from './utils.js';
import { showToast } from './toast.js';

let _currentSheet = null;

/**
 * Show the scan result bottom sheet.
 * @param {Object} result - { card, confidence, matchType, alternatives }
 * @param {Object} callbacks - { onAddToCollection, onDismiss, onClose }
 */
function showScanResultSheet(result, callbacks = {}) {
  // Remove any existing sheet
  dismissScanResultSheet();

  const card = result.card || {};
  const confidence = result.confidence || 0;
  const matchType = result.matchType || 'unknown';
  const alternatives = result.alternatives || [];

  // Determine confidence tier
  const confTier = confidence >= 85 ? 'high' : confidence >= 60 ? 'medium' : 'low';

  // Determine rarity class from card parallel/type
  const rarityClass = getRarityClass(card);

  // Build confidence HTML
  const confHtml = buildConfidenceHtml(confTier, confidence);

  // Build alternatives HTML (medium/low confidence)
  const altHtml = confTier !== 'high' && alternatives.length > 0
    ? buildAlternativesHtml(alternatives)
    : '';

  // Build price HTML
  const priceHtml = buildPriceHtml(card);

  // Determine if we should use the flip animation (uncommon+)
  const useFlip = rarityClass !== 'common' && rarityClass !== '';

  const html = `
    <div class="scan-result-sheet active" id="scanResultSheet">
      <div class="scan-result-sheet-handle" id="scanResultHandle"></div>
      <div class="scan-result-content">
        ${useFlip ? `
        <div class="card-flip flipped" id="scanResultFlip">
          <div class="card-flip-inner">
            <div class="card-flip-front"></div>
            <div class="card-flip-back">
              ${card.imageUrl ? `<img src="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(card.hero || 'Card')}">` : ''}
            </div>
          </div>
        </div>` : `
        ${card.imageUrl ? `<img class="scan-result-card-image" src="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(card.hero || 'Card')}">` : ''}
        `}

        <div class="scan-result-name">${escapeHtml(card.hero || 'Unknown Card')}</div>
        <div class="scan-result-meta">
          ${card.cardNumber ? escapeHtml(card.cardNumber) : ''}${card.set ? ' · ' + escapeHtml(card.set) : ''}${card.year ? ' · ' + card.year : ''}
        </div>

        ${card.parallel ? `<span class="rarity-badge rarity-${rarityClass}">${escapeHtml(card.parallel)}</span>` : ''}

        ${confHtml}
        ${priceHtml}
        ${altHtml}

        ${confTier === 'low' ? `
        <button class="scan-result-manual-search" id="scanResultManualSearch">
          None of these? Search manually
        </button>` : ''}

        <div class="scan-result-actions">
          <button class="scan-result-action-btn primary" id="scanResultAdd">
            <span class="action-icon">+</span> Collection
          </button>
          <button class="scan-result-action-btn" id="scanResultPrice">
            <span class="action-icon">$</span> Price
          </button>
          <button class="scan-result-action-btn" id="scanResultDismiss">
            <span class="action-icon">✕</span> Next
          </button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  _currentSheet = document.getElementById('scanResultSheet');

  // Wire action buttons
  document.getElementById('scanResultAdd')?.addEventListener('click', () => {
    if (callbacks.onAddToCollection) callbacks.onAddToCollection();
    dismissScanResultSheet();
  });

  document.getElementById('scanResultPrice')?.addEventListener('click', () => {
    // Open eBay search if available
    if (typeof window.openEbaySearch === 'function' && card._index !== undefined) {
      window.openEbaySearch(card._index);
    } else if (card.hero && card.cardNumber) {
      const query = encodeURIComponent(`BOBA ${card.hero} ${card.cardNumber}`);
      window.open(`https://www.ebay.com/sch/i.html?_nkw=${query}&LH_Sold=1`, '_blank');
    }
    showToast('Opening price search...', '🛒');
  });

  document.getElementById('scanResultDismiss')?.addEventListener('click', () => {
    dismissScanResultSheet();
    if (callbacks.onDismiss) callbacks.onDismiss();
  });

  document.getElementById('scanResultManualSearch')?.addEventListener('click', () => {
    dismissScanResultSheet();
    if (typeof window.openManualSearchModal === 'function') {
      window.openManualSearchModal();
    }
    if (callbacks.onDismiss) callbacks.onDismiss();
  });

  // Swipe-down to dismiss
  let touchStartY = 0;
  _currentSheet?.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  _currentSheet?.addEventListener('touchend', (e) => {
    const delta = e.changedTouches[0].clientY - touchStartY;
    if (delta > 80) {
      dismissScanResultSheet();
      if (callbacks.onDismiss) callbacks.onDismiss();
    }
  }, { passive: true });

  // Trigger flip animation after a short delay
  if (useFlip) {
    const flipEl = document.getElementById('scanResultFlip');
    if (flipEl) {
      flipEl.classList.remove('flipped');
      setTimeout(() => flipEl.classList.add('flipped'), 50);
    }
  }
}

function dismissScanResultSheet() {
  if (_currentSheet) {
    _currentSheet.classList.remove('active');
    setTimeout(() => {
      _currentSheet?.remove();
      _currentSheet = null;
    }, 250);
  }
}

function buildConfidenceHtml(tier, confidence) {
  if (tier === 'high') {
    return `<div class="scan-result-confidence high">✓ Match found</div>`;
  } else if (tier === 'medium') {
    return `<div class="scan-result-confidence medium">⚠ Likely match (${Math.round(confidence)}%)</div>`;
  } else {
    return `<div class="scan-result-confidence low">? Best guess (${Math.round(confidence)}%)</div>`;
  }
}

function buildAlternativesHtml(alternatives) {
  const cards = alternatives.slice(0, 5).map(alt => `
    <div class="scan-result-alt-card" data-alt-card="${escapeHtml(alt.cardNumber || '')}">
      ${alt.imageUrl ? `<img src="${escapeHtml(alt.imageUrl)}" alt="${escapeHtml(alt.hero || '')}">` : '<div style="width:60px;height:84px;background:var(--bg-elevated);border-radius:6px;display:flex;align-items:center;justify-content:center;">🎴</div>'}
      <div class="alt-name">${escapeHtml(alt.hero || 'Unknown')}</div>
      <div class="alt-conf">${alt.confidence ? Math.round(alt.confidence) + '%' : ''}</div>
    </div>
  `).join('');

  return `
    <div style="font-size:12px;color:var(--text-muted);margin:8px 0 4px;">Other possible matches:</div>
    <div class="scan-result-alternatives">${cards}</div>
  `;
}

function buildPriceHtml(card) {
  const avg = card.ebayAvgPrice;
  const low = card.ebayLowPrice;
  const high = card.ebayHighPrice;

  if (!avg && !low && !high) return '';

  let rangeHtml = '';
  if (low && high && avg) {
    const range = high - low;
    const pos = range > 0 ? ((avg - low) / range) * 100 : 50;
    rangeHtml = `
      <div class="scan-result-price-range">
        <span class="scan-result-price-range-label">$${Number(low).toFixed(2)}</span>
        <div class="scan-result-price-range-bar">
          <div class="scan-result-price-range-dot" style="left:${pos}%"></div>
        </div>
        <span class="scan-result-price-range-label">$${Number(high).toFixed(2)}</span>
      </div>`;
  }

  return `
    <div class="scan-result-price">${avg ? '$' + Number(avg).toFixed(2) : ''}</div>
    <div class="scan-result-price-label">Market Price</div>
    ${rangeHtml}
  `;
}

function getRarityClass(card) {
  const parallel = (card.parallel || '').toLowerCase();
  if (parallel.includes('legend') || parallel.includes('gold') || parallel.includes('1/1')) return 'legendary';
  if (parallel.includes('epic') || parallel.includes('holo') || parallel.includes('refractor')) return 'epic';
  if (parallel.includes('rare') || parallel.includes('battlefoil')) return 'rare';
  if (parallel.includes('first edition') || parallel.includes('uncommon')) return 'uncommon';
  if (parallel) return 'uncommon'; // Any parallel is at least uncommon
  return '';
}

// Expose globally for scanner
window.showScanResultSheet = showScanResultSheet;
window.dismissScanResultSheet = dismissScanResultSheet;

export { showScanResultSheet, dismissScanResultSheet };
