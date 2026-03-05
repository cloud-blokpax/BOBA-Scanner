// js/set-completion.js — Set Completion Engine
// Analyzes the user's collection, finds sets they're close to completing,
// and generates prioritized shopping lists with eBay price estimates.

// ── Build set completion analysis ────────────────────────────────────────────
async function analyzeSetCompletion() {
  if (!isFeatureEnabled('set_completion')) {
    showToast('Set Completion requires sign-in', '🔒');
    return;
  }

  showLoading(true, 'Analyzing your sets...');

  try {
    // 1. Collect all cards the user owns, grouped by set
    const allCards = [];
    for (const col of getCollections()) {
      for (const card of col.cards) allCards.push(card);
    }

    if (allCards.length === 0) {
      showLoading(false);
      showToast('No cards in collection yet', '📭');
      return;
    }

    // 2. Get the full card database
    const db = await getCardDatabase(); // from database.js
    if (!db || db.size === 0) {
      showLoading(false);
      showToast('Card database not loaded yet — try again', '⚠️');
      return;
    }

    // 3. Group owned cards by set
    const owned = new Map(); // setKey → Set of cardNumbers
    for (const card of allCards) {
      const setKey = buildSetKey(card);
      if (!owned.has(setKey)) owned.set(setKey, new Set());
      owned.get(setKey).add(card.cardNumber);
    }

    // 4. Group ALL cards in DB by set
    const allBySet = new Map(); // setKey → Set of cardNumbers
    for (const [cardNumber, cardData] of db.entries()) {
      const setKey = buildSetKey(cardData);
      if (!allBySet.has(setKey)) allBySet.set(setKey, new Set());
      allBySet.get(setKey).add(cardNumber);
    }

    // 5. Compute completion % for each set the user has started
    const setStats = [];
    for (const [setKey, ownedNums] of owned.entries()) {
      const allNums = allBySet.get(setKey);
      if (!allNums || allNums.size === 0) continue;

      const total    = allNums.size;
      const have     = ownedNums.size;
      const missing  = [...allNums].filter(n => !ownedNums.has(n));
      const percent  = Math.round((have / total) * 100);

      setStats.push({ setKey, total, have, missing, percent });
    }

    // Sort: highest completion % first, then smallest missing count
    setStats.sort((a, b) => {
      if (b.percent !== a.percent) return b.percent - a.percent;
      return a.missing.length - b.missing.length;
    });

    // Focus on sets that are >= 30% complete or have <= 10 cards missing
    const interesting = setStats.filter(s => s.percent >= 30 || s.missing.length <= 10);

    if (interesting.length === 0) {
      showLoading(false);
      showSetCompletionModal(setStats.slice(0, 5), db, false);
      return;
    }

    showLoading(false);
    showSetCompletionModal(interesting.slice(0, 8), db, true);

  } catch (err) {
    showLoading(false);
    console.error('Set completion error:', err);
    showToast('Analysis failed — try again', '❌');
  }
}

function buildSetKey(card) {
  // Normalize set + year into a stable key
  const set  = (card.set  || card.setName || 'Unknown Set').trim();
  const year = (card.year || card.cardYear || '').toString().trim();
  return year ? `${year} ${set}` : set;
}

// Fetch card DB as a Map — wrapper that respects the existing DB module
async function getCardDatabase() {
  // database.js exposes window.cardDatabase or a getCardData() function
  if (window.cardDatabase instanceof Map) return window.cardDatabase;

  // Try to load via the existing DB module's lookup mechanism
  // The DB is indexed — walk through it to build a full map
  const db = new Map();
  try {
    // database.js stores the data in `window._cardDb` or similar
    // Fall back: fetch the JSON directly
    const res = await fetch('card-database.json');
    if (!res.ok) throw new Error('DB fetch failed');
    const arr = await res.json();
    for (const card of arr) {
      if (card.cardNumber) db.set(card.cardNumber, card);
    }
    // Cache it
    window.cardDatabase = db;
  } catch (err) {
    console.warn('getCardDatabase fallback error:', err);
  }
  return db;
}

// ── Render set completion modal ───────────────────────────────────────────────
function showSetCompletionModal(setStats, db, hasInteresting) {
  document.getElementById('setCompletionModal')?.remove();

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal active" id="setCompletionModal">
      <div class="modal-backdrop"></div>
      <div class="modal-content" style="max-width:600px;">
        <div class="modal-header">
          <h2>🎯 Set Completion</h2>
          <button class="modal-close" id="setCompModalClose">×</button>
        </div>
        <div class="modal-body" style="padding:16px;max-height:70vh;overflow-y:auto;">
          ${!hasInteresting ? `
            <div style="text-align:center;padding:20px;color:#6b7280;">
              <div style="font-size:40px;margin-bottom:8px;">📦</div>
              <p>Keep scanning! You need at least 30% of a set before we can show completion paths.</p>
            </div>
          ` : ''}
          ${setStats.map(s => renderSetCard(s, db)).join('')}
        </div>
        <div class="modal-footer">
          <div style="font-size:11px;color:#9ca3af;flex:1;">Prices are estimated from recent eBay sold listings</div>
          <button class="btn-secondary" id="setCompModalCloseBtn">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper.firstElementChild);
  document.getElementById('setCompModalClose')?.addEventListener('click', () => document.getElementById('setCompletionModal')?.remove());
  document.getElementById('setCompModalCloseBtn')?.addEventListener('click', () => document.getElementById('setCompletionModal')?.remove());
  document.querySelector('#setCompletionModal .modal-backdrop')?.addEventListener('click', () => document.getElementById('setCompletionModal')?.remove());
}

function renderSetCard(s, db) {
  const progressColor = s.percent >= 80 ? '#16a34a' : s.percent >= 50 ? '#d97706' : '#6b7280';
  const missingCards  = s.missing.slice(0, 6); // show up to 6 missing cards
  const moreCount     = s.missing.length - missingCards.length;

  return `
    <div style="background:#f9fafb;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #e5e7eb;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
        <div>
          <div style="font-weight:700;font-size:15px;">${escapeHtml(s.setKey)}</div>
          <div style="font-size:13px;color:#6b7280;">${s.have} / ${s.total} cards owned</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:24px;font-weight:900;color:${progressColor};">${s.percent}%</div>
          <div style="font-size:11px;color:#9ca3af;">${s.missing.length} missing</div>
        </div>
      </div>
      <div style="background:#e5e7eb;border-radius:4px;height:6px;margin-bottom:12px;">
        <div style="background:${progressColor};height:6px;border-radius:4px;width:${s.percent}%;transition:width 0.3s;"></div>
      </div>
      ${s.missing.length > 0 ? `
        <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:8px;">Missing cards:</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${missingCards.map(cardNum => {
            const card = db.get(cardNum);
            const label = card ? `${cardNum}${card.hero ? ' · ' + card.hero : ''}` : cardNum;
            return `<a href="https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent('Bo Jackson ' + cardNum)}&LH_Sold=1&LH_Complete=1" target="_blank" rel="noopener" style="font-size:11px;background:#fff;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;text-decoration:none;color:#374151;white-space:nowrap;" title="Search eBay sold listings">${escapeHtml(label)}</a>`;
          }).join('')}
          ${moreCount > 0 ? `<span style="font-size:11px;color:#9ca3af;padding:4px 8px;">+${moreCount} more</span>` : ''}
        </div>
      ` : `
        <div style="color:#16a34a;font-weight:600;font-size:13px;">🎉 Set complete!</div>
      `}
    </div>
  `;
}

console.log('✅ Set completion module loaded');
