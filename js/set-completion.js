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

    // 2. Get the full card database — uses the globally loaded `database` array
    const db = await getCardDatabase();
    if (!db || db.size === 0) {
      showLoading(false);
      showToast('Card database is still loading — try again in a moment', '⚠️');
      return;
    }

    // 3. Group owned cards by set (collection cards use .cardNumber, .set, .year)
    const owned = new Map(); // setKey → Set of card numbers (lowercase)
    for (const card of allCards) {
      const setKey = buildSetKey(card);
      if (!owned.has(setKey)) owned.set(setKey, new Set());
      if (card.cardNumber) owned.get(setKey).add(card.cardNumber.trim().toUpperCase());
    }

    // 4. Group ALL DB cards by set (DB cards use card['Card Number'], card['Set'], card['Year'])
    const allBySet = new Map(); // setKey → Set of card numbers
    for (const [cardNumber, cardData] of db.entries()) {
      const setKey = buildSetKeyFromDb(cardData);
      if (!allBySet.has(setKey)) allBySet.set(setKey, new Set());
      allBySet.get(setKey).add(cardNumber.trim().toUpperCase());
    }

    // 5. Compute completion % for each set the user has started
    const setStats = [];
    for (const [setKey, ownedNums] of owned.entries()) {
      // Try to find the matching DB set (case-insensitive match on set key)
      let allNums = allBySet.get(setKey);
      if (!allNums) {
        // Try case-insensitive match
        for (const [dbSetKey, nums] of allBySet.entries()) {
          if (dbSetKey.toLowerCase() === setKey.toLowerCase()) {
            allNums = nums;
            break;
          }
        }
      }
      if (!allNums || allNums.size === 0) continue;

      const total   = allNums.size;
      const have    = [...ownedNums].filter(n => allNums.has(n)).length;
      const missing = [...allNums].filter(n => !ownedNums.has(n));
      const percent = Math.round((have / total) * 100);

      setStats.push({ setKey, total, have, missing, percent });
    }

    // Sort: highest completion % first, then smallest missing count
    setStats.sort((a, b) => {
      if (b.percent !== a.percent) return b.percent - a.percent;
      return a.missing.length - b.missing.length;
    });

    // Focus on sets that are >= 20% complete or have <= 15 cards missing
    const interesting = setStats.filter(s => s.percent >= 20 || s.missing.length <= 15);

    showLoading(false);
    showSetCompletionModal(interesting.length > 0 ? interesting.slice(0, 8) : setStats.slice(0, 5), db, interesting.length > 0);

  } catch (err) {
    showLoading(false);
    console.error('Set completion error:', err);
    showToast('Analysis failed — try again', '❌');
  }
}

// Build set key from a collection card object (uses .set / .year)
function buildSetKey(card) {
  const set  = (card.set  || card.setName  || 'Unknown Set').trim();
  const year = (card.year || card.cardYear || '').toString().trim();
  return year ? `${year} ${set}` : set;
}

// Build set key from a database card object (uses card['Set'] / card['Year'])
function buildSetKeyFromDb(card) {
  const set  = (card['Set']  || card.set  || 'Unknown Set').trim();
  const year = (card['Year'] || card.year || '').toString().trim();
  return year ? `${year} ${set}` : set;
}

// Get the card database as a Map<cardNumber → cardData>
// Uses the global `database` array from database.js (already loaded at app start)
async function getCardDatabase() {
  // `database` is the global array populated by loadDatabase() in database.js
  if (typeof database !== 'undefined' && Array.isArray(database) && database.length > 0) {
    const db = new Map();
    for (const card of database) {
      const num = card['Card Number'];
      if (num) db.set(num.trim().toUpperCase(), card);
    }
    window._setCompletionDb = db; // cache for subsequent calls
    return db;
  }

  // Return cached version if DB was already converted
  if (window._setCompletionDb instanceof Map && window._setCompletionDb.size > 0) {
    return window._setCompletionDb;
  }

  // DB not loaded yet — wait up to 5s for ready.db flag
  if (typeof ready !== 'undefined') {
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (ready.db && typeof database !== 'undefined' && database.length > 0) {
        const db = new Map();
        for (const card of database) {
          const num = card['Card Number'];
          if (num) db.set(num.trim().toUpperCase(), card);
        }
        window._setCompletionDb = db;
        return db;
      }
    }
  }

  return new Map(); // Empty — caller will show "try again" message
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
              <p>Keep scanning! You need cards from at least 20% of a set before we can show completion paths.</p>
              <p style="font-size:12px;margin-top:8px;">Showing your most complete sets below:</p>
            </div>
          ` : ''}
          ${setStats.length === 0
            ? `<p style="text-align:center;color:#9ca3af;padding:24px;">Scan more cards to see set completion analysis.</p>`
            : setStats.map(s => renderSetCard(s, db)).join('')
          }
        </div>
        <div class="modal-footer">
          <div style="font-size:11px;color:#9ca3af;flex:1;">Tap any missing card to search eBay sold listings</div>
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
  const missingCards  = s.missing.slice(0, 8);
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
            const card = db.get(cardNum.toUpperCase());
            const name = card ? (card['Name'] || card['Hero'] || '') : '';
            const label = name ? `${cardNum} · ${name}` : cardNum;
            const query = encodeURIComponent('Bo Jackson ' + (name || cardNum));
            return `<a href="https://www.ebay.com/sch/i.html?_nkw=${query}&LH_Sold=1&LH_Complete=1" target="_blank" rel="noopener" style="font-size:11px;background:#fff;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;text-decoration:none;color:#374151;white-space:nowrap;" title="Search eBay sold listings for ${escapeHtml(cardNum)}">${escapeHtml(label)}</a>`;
          }).join('')}
          ${moreCount > 0 ? `<span style="font-size:11px;color:#9ca3af;padding:4px 8px;">+${moreCount} more</span>` : ''}
        </div>
      ` : `
        <div style="color:#16a34a;font-weight:600;font-size:13px;">🎉 Set complete!</div>
      `}
    </div>
  `;
}

window.analyzeSetCompletion = analyzeSetCompletion;

console.log('✅ Set completion module loaded');
