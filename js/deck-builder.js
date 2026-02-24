// ============================================================
// js/deck-builder.js — Deck Builder v1.0
//
// Workflow:
//  1. User opens Deck Builder modal
//  2. Scans cards one at a time (photo or upload)
//  3. Play Parallel     → plays queue  (max 30, must be unique)
//  4. Bonus Play Parallel → bonus queue (max 15, must be unique)
//  5. On Complete Deck  → prompt for name → tag all scanned cards
//                         → upsert into "Deck Building" collection
//
// BoBA API: GET https://www.bobaleagues.com/api/cards
// Returns DBS score, Cost, Ability per card.
//
// Export: handled in export.js — "BoBA Deck" template, slot 1–30 / B1–B15
// ============================================================

const DECK_BUILDING_COLLECTION_ID = 'deck_building';
const BOBA_API_BASE = 'https://www.bobaleagues.com/api/cards';
const MAX_PLAYS = 30;
const MAX_BONUS = 15;

// ── In-memory deck being built ─────────────────────────────────────────────
// Each entry: { card, dbsData: { dbs, cost, ability }, parallel: 'play'|'bonus', timestamp }
window._deckBuilderQueue  = window._deckBuilderQueue  || [];
window._deckBuilderActive = window._deckBuilderActive || false;

// ── Ensure the Deck Building collection exists ─────────────────────────────
function ensureDeckBuildingCollection() {
  const cols = getCollections();
  if (!cols.find(c => c.id === DECK_BUILDING_COLLECTION_ID)) {
    cols.push({
      id:    DECK_BUILDING_COLLECTION_ID,
      name:  '🃏 Deck Building',
      cards: [],
      stats: { scanned: 0, free: 0, cost: 0, aiCalls: 0 }
    });
    saveCollections(cols);
    console.log('✅ Deck Building collection created');
  }
  return getCollections();
}
window.ensureDeckBuildingCollection = ensureDeckBuildingCollection;

// ── Identify parallel type ─────────────────────────────────────────────────
function getParallelType(match) {
  const p = (match.Parallel || match.pose || '').toLowerCase();
  if (p.includes('bonus')) return 'bonus';
  if (p.includes('play'))  return 'play';
  return null; // not a play card
}

// ── BoBA API lookup ────────────────────────────────────────────────────────
// Fetches DBS score, Cost, and Ability for a card from the BoBA Leagues API.
// Tries ?card_number= first, then bare list + client-side match as fallback.
async function lookupBobaCard(card) {
  const cardNum = (card.cardNumber || card['Card Number'] || '').trim();
  if (!cardNum) return null;

  // Attempt 1: filtered by card number
  const urls = [
    `${BOBA_API_BASE}?card_number=${encodeURIComponent(cardNum)}`,
    `${BOBA_API_BASE}?cardNumber=${encodeURIComponent(cardNum)}`,
    `${BOBA_API_BASE}?number=${encodeURIComponent(cardNum)}`,
    BOBA_API_BASE,  // full list fallback
  ];

  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        // Some APIs need credentials omitted for cross-origin
        credentials: 'omit',
      });
      if (!resp.ok) continue;

      const raw = await resp.text();
      if (!raw || raw.trim() === '') continue;

      let data;
      try { data = JSON.parse(raw); } catch { continue; }

      // Normalise to array
      const list = Array.isArray(data)
        ? data
        : (data.cards || data.data || data.results || (data.card ? [data.card] : [data]));

      if (!Array.isArray(list) || !list.length) continue;

      // Best match on card number (case-insensitive)
      const numLower = cardNum.toLowerCase();
      const match = list.find(r => {
        const rNum = (r.card_number || r.cardNumber || r.number || r.card_num || '').toString().trim().toLowerCase();
        return rNum === numLower;
      }) || (url === BOBA_API_BASE ? null : list[0]); // only use list[0] for filtered URLs

      if (!match) continue;

      // Extract fields — handle many possible key names
      const dbs     = match.dbs     ?? match.DBS     ?? match.score     ?? match.dbs_score ?? null;
      const cost    = match.cost    ?? match.Cost    ?? match.mana_cost ?? match.manaCost  ?? null;
      const ability = match.ability ?? match.Ability ?? match.text      ?? match.card_text ?? match.description ?? match.effect ?? null;

      console.log(`🃏 BoBA API match for ${cardNum}:`, { dbs, cost, ability });
      return { dbs, cost, ability };

    } catch (err) {
      console.warn(`BoBA API attempt failed for ${url}:`, err.message);
      continue;
    }
  }

  console.warn(`🃏 BoBA API: no match found for card "${cardNum}"`);
  return null;
}

// ── Open the Deck Builder modal ────────────────────────────────────────────
window.openDeckBuilder = function() {
  if (typeof checkUserLimit === 'function') {
    // Allow entry — actual per-card limits checked in addCard
  }
  window._deckBuilderActive = true;
  window._deckBuilderQueue  = [];
  renderDeckBuilderModal();
};

// ── Card scanned callback — registered on open, cleared on close ───────────
// scanner.js calls this when scanMode === 'deckbuilder' instead of addCard.
window.deckBuilderOnCardScanned = async function(match, imageUrl, fileName, imageBase64) {
  const pType = getParallelType(match);

  if (!pType) {
    showToast('Not a Play card — only Play and Bonus Play parallels can be added to a deck', '⚠️');
    refreshDeckBuilderUI();
    return;
  }

  const queue = window._deckBuilderQueue;
  const plays  = queue.filter(e => e.parallel === 'play');
  const bonuses = queue.filter(e => e.parallel === 'bonus');

  // ── Capacity check ─────────────────────────────────────────────────────
  if (pType === 'play'  && plays.length  >= MAX_PLAYS) {
    showToast(`Deck already has ${MAX_PLAYS} plays — slot full`, '⚠️'); refreshDeckBuilderUI(); return;
  }
  if (pType === 'bonus' && bonuses.length >= MAX_BONUS) {
    showToast(`Deck already has ${MAX_BONUS} bonus plays — slot full`, '⚠️'); refreshDeckBuilderUI(); return;
  }

  // ── Uniqueness check — same card number + set = duplicate ──────────────
  const isDupe = queue.some(e =>
    e.card.cardNumber === (match['Card Number'] || '') &&
    e.card.set        === (match.Set || '')
  );
  if (isDupe) {
    showToast(`${match.Name} (${match['Card Number']}) is already in this deck`, '⚠️');
    refreshDeckBuilderUI();
    return;
  }

  // ── Build card object (mirrors scanner.js addCard) ─────────────────────
  const card = {
    cardId:      String(match['Card ID']     || ''),
    hero:        match.Name                  || '',
    athlete:     (typeof getAthleteForHero === 'function') ? (getAthleteForHero(match.Name) || '') : '',
    year:        match.Year                  || '',
    set:         match.Set                   || '',
    cardNumber:  match['Card Number']        || '',
    pose:        match.Parallel              || '',
    weapon:      match.Weapon                || '',
    power:       match.Power                 || '',
    imageUrl:    imageUrl                    || '',
    fileName:    fileName                    || '',
    scanType:    'deck',
    scanMethod:  'Deck Builder',
    confidence:  null,
    timestamp:   new Date().toISOString(),
    tags:        [],
    condition:   '',
    notes:       '',
    readyToList: false,
    listingStatus: null,
    // DBS fields — populated after API call
    dbs:     null,
    dbsCost: null,
    ability: null,
  };

  // Add to queue immediately so UI feels responsive
  const entry = { card, dbsData: null, parallel: pType, imageBase64 };
  queue.push(entry);
  refreshDeckBuilderUI();
  showToast(`${pType === 'play' ? '🎴' : '⭐'} Added: ${card.hero} (${card.cardNumber})`, '✅');

  // Upload image async
  if (imageBase64 && typeof uploadWithRetry === 'function') {
    uploadWithRetry(imageBase64, fileName).then(url => {
      if (url) { entry.card.imageUrl = url; }
    }).catch(() => {});
  }

  // Fetch DBS data async — update queue entry and UI when done
  lookupBobaCard(card).then(dbsData => {
    if (dbsData) {
      entry.dbsData      = dbsData;
      entry.card.dbs     = dbsData.dbs;
      entry.card.dbsCost = dbsData.cost;
      entry.card.ability = dbsData.ability;
      refreshDeckBuilderUI();
    }
  });

  // Auto-complete if full
  const plays2  = queue.filter(e => e.parallel === 'play').length;
  const bonuses2 = queue.filter(e => e.parallel === 'bonus').length;
  if (plays2 >= MAX_PLAYS && bonuses2 >= MAX_BONUS) {
    showToast('Deck is full (30 plays + 15 bonus plays)!', '🎉');
    refreshDeckBuilderUI();
  }
};

// ── Render / re-render the modal ───────────────────────────────────────────
function renderDeckBuilderModal() {
  document.getElementById('deckBuilderModal')?.remove();

  const queue   = window._deckBuilderQueue;
  const plays   = queue.filter(e => e.parallel === 'play');
  const bonuses = queue.filter(e => e.parallel === 'bonus');
  const total   = queue.length;
  const isFull  = plays.length >= MAX_PLAYS && bonuses.length >= MAX_BONUS;

  const queueHtml = total === 0
    ? `<div style="text-align:center;padding:28px 16px;color:#9ca3af;font-size:14px;">
         <div style="font-size:32px;margin-bottom:8px;">🃏</div>
         No cards scanned yet. Start by scanning a Play or Bonus Play card.
       </div>`
    : `
      ${plays.length > 0 ? `
        <div style="margin-bottom:12px;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
            ▶ Plays (${plays.length}/${MAX_PLAYS})
          </div>
          ${plays.map((e, i) => renderQueueRow(e, i, 'play')).join('')}
        </div>` : ''}
      ${bonuses.length > 0 ? `
        <div>
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
            ⭐ Bonus Plays (${bonuses.length}/${MAX_BONUS})
          </div>
          ${bonuses.map((e, i) => renderQueueRow(e, i, 'bonus')).join('')}
        </div>` : ''}`;

  const progressPct = Math.round((total / (MAX_PLAYS + MAX_BONUS)) * 100);

  const html = `
  <div class="modal active" id="deckBuilderModal">
    <div class="modal-backdrop" id="deckBuilderBackdrop"></div>
    <div class="modal-content" style="max-width:520px;max-height:92vh;display:flex;flex-direction:column;">
      <div class="modal-header">
        <div>
          <h2>🃏 Deck Builder</h2>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">
            ${plays.length}/${MAX_PLAYS} plays · ${bonuses.length}/${MAX_BONUS} bonus plays
          </div>
        </div>
        <button class="modal-close" id="deckBuilderClose">×</button>
      </div>

      <!-- Progress bar -->
      <div style="padding:0 24px 12px;border-bottom:1px solid #e5e7eb;">
        <div style="height:6px;background:#f1f5f9;border-radius:99px;overflow:hidden;">
          <div style="height:100%;background:linear-gradient(90deg,#2563eb,#7c3aed);border-radius:99px;
                      width:${progressPct}%;transition:width .3s ease;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;margin-top:4px;">
          <span>${total} card${total !== 1 ? 's' : ''} added</span>
          <span>${MAX_PLAYS + MAX_BONUS - total} slots remaining</span>
        </div>
      </div>

      <!-- Queue -->
      <div class="modal-body" style="flex:1;overflow-y:auto;padding:16px 20px;" id="deckQueueContainer">
        ${queueHtml}
      </div>

      <!-- Scan buttons -->
      <div style="padding:12px 20px;border-top:1px solid #f3f4f6;border-bottom:1px solid #f3f4f6;background:#fafafa;">
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <label id="deckScanPhotoLabel" style="
            display:inline-flex;align-items:center;gap:6px;
            padding:10px 18px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;
            background:linear-gradient(135deg,#2563eb,#1d4ed8);color:white;
            box-shadow:0 4px 12px rgba(37,99,235,0.35);transition:all .15s;
            ${isFull ? 'opacity:.4;pointer-events:none;' : ''}">
            📷 Take Photo
            <input type="file" id="deckScanPhoto" accept="image/*" capture="environment" style="display:none;">
          </label>
          <label id="deckScanUploadLabel" style="
            display:inline-flex;align-items:center;gap:6px;
            padding:10px 18px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;
            background:linear-gradient(135deg,#7c3aed,#6d28d9);color:white;
            box-shadow:0 4px 12px rgba(124,58,237,0.35);transition:all .15s;
            ${isFull ? 'opacity:.4;pointer-events:none;' : ''}">
            🖼️ Upload Image
            <input type="file" id="deckScanUpload" accept="image/*" style="display:none;">
          </label>
        </div>
        ${isFull ? `<p style="text-align:center;font-size:12px;color:#10b981;margin:8px 0 0;font-weight:600;">
            ✅ Deck is full! Click Complete Deck to finish.
          </p>` : `<p style="text-align:center;font-size:11px;color:#9ca3af;margin:6px 0 0;">
            Scan Play or Bonus Play parallel cards only
          </p>`}
      </div>

      <!-- Footer -->
      <div class="modal-footer" style="gap:8px;">
        <button class="btn-secondary" id="deckBuilderCancel" style="flex:1;">Cancel</button>
        ${total > 0 ? `<button id="deckCompleteBtn" class="btn-tag-add" style="flex:2;padding:12px;font-size:14px;">
          Complete Deck (${total} card${total !== 1 ? 's' : ''})
        </button>` : ''}
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  wireDeckBuilderEvents();
}

function renderQueueRow(entry, idx, type) {
  const { card, dbsData } = entry;
  const slotLabel = type === 'play'
    ? `Slot ${idx + 1}`
    : `B${idx + 1}`;
  const hasApiData = dbsData !== null;

  return `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;
                background:${type === 'play' ? '#eff6ff' : '#f5f3ff'};
                border-radius:10px;margin-bottom:6px;border:1px solid ${type === 'play' ? '#bfdbfe' : '#ddd6fe'};">
      <div style="flex-shrink:0;width:36px;height:36px;border-radius:8px;overflow:hidden;background:#e5e7eb;">
        ${card.imageUrl
          ? `<img src="${card.imageUrl}" style="width:100%;height:100%;object-fit:cover;">`
          : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:16px;">🎴</div>`}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(card.hero)}
        </div>
        <div style="font-size:11px;color:#6b7280;display:flex;gap:6px;flex-wrap:wrap;">
          <span>${escapeHtml(card.cardNumber)}</span>
          <span>·</span>
          <span>${escapeHtml(card.set)}</span>
          ${hasApiData && dbsData.dbs   != null ? `<span>· DBS: <strong>${escapeHtml(String(dbsData.dbs))}</strong></span>` : ''}
          ${hasApiData && dbsData.cost  != null ? `<span>· Cost: <strong>${escapeHtml(String(dbsData.cost))}</strong></span>` : ''}
          ${!hasApiData ? `<span style="color:#d97706;">⏳ loading DBS...</span>` : ''}
        </div>
        ${hasApiData && dbsData.ability ? `<div style="font-size:11px;color:#4b5563;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(dbsData.ability)}">${escapeHtml(dbsData.ability.substring(0, 60))}${dbsData.ability.length > 60 ? '…' : ''}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
        <span style="font-size:11px;font-weight:700;color:${type === 'play' ? '#1d4ed8' : '#7c3aed'};
                     background:${type === 'play' ? '#dbeafe' : '#ede9fe'};
                     padding:2px 7px;border-radius:99px;">${slotLabel}</span>
        <button data-remove-idx="${window._deckBuilderQueue.indexOf(entry)}"
                style="background:none;border:none;cursor:pointer;font-size:14px;color:#9ca3af;padding:2px;" title="Remove">✕</button>
      </div>
    </div>`;
}

// ── Wire events after every render ────────────────────────────────────────
function wireDeckBuilderEvents() {
  // Close / cancel
  document.getElementById('deckBuilderClose')?.addEventListener('click', closeDeckBuilder);
  document.getElementById('deckBuilderBackdrop')?.addEventListener('click', closeDeckBuilder);
  document.getElementById('deckBuilderCancel')?.addEventListener('click', closeDeckBuilder);

  // Complete deck
  document.getElementById('deckCompleteBtn')?.addEventListener('click', promptDeckName);

  // File inputs — delegate scan to the deck builder callback
  ['deckScanPhoto', 'deckScanUpload'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      await processDeckScan(file);
    });
  });

  // Remove buttons (event delegation on queue container)
  document.getElementById('deckQueueContainer')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-idx]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.removeIdx);
    if (!isNaN(idx)) removeDeckEntry(idx);
  });
}

// ── Process a scanned file through the normal scan pipeline ───────────────
async function processDeckScan(file) {
  if (!file.type.startsWith('image/')) { showToast('Not an image', '⚠️'); return; }
  if (file.size > 15 * 1024 * 1024)    { showToast('Image too large (max 15MB)', '⚠️'); return; }

  // Set scan mode so addCard routes back to us instead of saving to collection
  window.scanMode = 'deckbuilder';

  showLoading(true, 'Scanning card...');

  try {
    // Re-use the same compression + scan pipeline
    if (typeof compressImage !== 'function' || typeof _doProcessImage !== 'function') {
      showToast('Scanner not ready — please wait', '⚠️');
      showLoading(false);
      return;
    }
    const imageBase64 = await compressImage(file);
    const displayUrl  = URL.createObjectURL(file);
    await _doProcessImage(imageBase64, displayUrl, displayUrl, file.name, imageBase64);
  } catch (err) {
    console.error('Deck scan error:', err);
    showToast('Scan failed — try again', '❌');
  } finally {
    showLoading(false);
    window.scanMode = 'collection'; // always reset
  }
}

// ── Remove a card from the queue ──────────────────────────────────────────
function removeDeckEntry(idx) {
  const entry = window._deckBuilderQueue[idx];
  if (!entry) return;
  window._deckBuilderQueue.splice(idx, 1);
  showToast(`Removed: ${entry.card.hero}`, '🗑️');
  refreshDeckBuilderUI();
}

// ── Refresh UI without closing the modal ─────────────────────────────────
function refreshDeckBuilderUI() {
  if (!document.getElementById('deckBuilderModal')) return;
  // Full re-render is simplest and most reliable
  renderDeckBuilderModal();
}

// ── Prompt for deck name and finalize ─────────────────────────────────────
function promptDeckName() {
  document.getElementById('deckNameModal')?.remove();

  const html = `
  <div class="modal active" id="deckNameModal" style="z-index:10002;">
    <div class="modal-backdrop" id="deckNameBackdrop"></div>
    <div class="modal-content" style="max-width:400px;">
      <div class="modal-header">
        <h2>🏷️ Name Your Deck</h2>
        <button class="modal-close" id="deckNameClose">×</button>
      </div>
      <div class="modal-body" style="padding:20px;">
        <p style="font-size:13px;color:#6b7280;margin:0 0 14px;">
          This name will be added as a tag to all ${window._deckBuilderQueue.length} cards and saved to the Deck Building collection.
        </p>
        <input type="text" id="deckNameInput"
               placeholder="e.g. Fire Deck v1, Tournament Build..."
               autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false"
               style="width:100%;box-sizing:border-box;padding:11px 14px;border:1.5px solid #d1d5db;
                      border-radius:10px;font-size:15px;font-family:inherit;"
               autofocus>
        <div id="deckNameError" style="color:#ef4444;font-size:12px;margin-top:6px;display:none;"></div>
      </div>
      <div class="modal-footer" style="gap:8px;">
        <button class="btn-secondary" id="deckNameCancel" style="flex:1;">Back</button>
        <button class="btn-tag-add" id="deckNameSave" style="flex:2;padding:12px;font-size:14px;">
          💾 Save Deck
        </button>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  const closeModal = () => document.getElementById('deckNameModal')?.remove();
  document.getElementById('deckNameClose')?.addEventListener('click', closeModal);
  document.getElementById('deckNameBackdrop')?.addEventListener('click', closeModal);
  document.getElementById('deckNameCancel')?.addEventListener('click', closeModal);

  document.getElementById('deckNameInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') finalizeDeck();
  });
  document.getElementById('deckNameSave')?.addEventListener('click', finalizeDeck);

  setTimeout(() => document.getElementById('deckNameInput')?.focus(), 80);
}

// ── Finalize: save all cards to Deck Building collection ──────────────────
async function finalizeDeck() {
  const nameInput = document.getElementById('deckNameInput');
  const deckName  = (nameInput?.value || '').trim();
  const errEl     = document.getElementById('deckNameError');

  if (!deckName) {
    if (errEl) { errEl.textContent = 'Please enter a deck name.'; errEl.style.display = 'block'; }
    nameInput?.focus();
    return;
  }

  // Sanitize the tag (no pipes or commas that break tag storage)
  const deckTag = deckName.replace(/[|,]/g, '-').trim();

  document.getElementById('deckNameSave').disabled = true;
  document.getElementById('deckNameSave').textContent = 'Saving...';

  const cols = ensureDeckBuildingCollection();
  const deckCol = cols.find(c => c.id === DECK_BUILDING_COLLECTION_ID);
  const queue   = window._deckBuilderQueue;
  let added = 0, updated = 0;

  for (const entry of queue) {
    const { card } = entry;

    // Apply the deck tag and DBS data
    if (!Array.isArray(card.tags)) card.tags = [];
    if (!card.tags.includes(deckTag)) card.tags.push(deckTag);

    // Find existing card in Deck Building collection (same cardNumber + set)
    const existingIdx = deckCol.cards.findIndex(c =>
      c.cardNumber === card.cardNumber && c.set === card.set
    );

    if (existingIdx >= 0) {
      // Append the new deck tag only — don't duplicate the card
      const existing = deckCol.cards[existingIdx];
      if (!Array.isArray(existing.tags)) existing.tags = [];
      if (!existing.tags.includes(deckTag)) {
        existing.tags.push(deckTag);
        updated++;
      }
      // Also update DBS data if we now have it and didn't before
      if (!existing.dbs     && card.dbs)     existing.dbs     = card.dbs;
      if (!existing.dbsCost && card.dbsCost) existing.dbsCost = card.dbsCost;
      if (!existing.ability && card.ability) existing.ability = card.ability;
    } else {
      deckCol.cards.push(card);
      deckCol.stats.scanned++;
      added++;
    }
  }

  saveCollections(getCollections().map(c =>
    c.id === DECK_BUILDING_COLLECTION_ID ? deckCol : c
  ));

  // Close both modals
  document.getElementById('deckNameModal')?.remove();
  document.getElementById('deckBuilderModal')?.remove();

  // Reset state
  window._deckBuilderQueue  = [];
  window._deckBuilderActive = false;
  window.scanMode = 'collection';

  showToast(
    `Deck "${deckName}" saved — ${added} new, ${updated} updated`,
    '🎉'
  );

  // Refresh UI
  if (typeof renderCards === 'function') renderCards();
  if (typeof updateCollectionNavCounts === 'function') updateCollectionNavCounts();

  console.log(`🃏 Deck "${deckName}" saved: ${added} new cards, ${updated} tag updates`);
}

// ── Close deck builder ─────────────────────────────────────────────────────
function closeDeckBuilder() {
  if (window._deckBuilderQueue.length > 0) {
    // Inline confirm — don't use native confirm() on mobile
    document.getElementById('deckAbandonModal')?.remove();
    const html = `
    <div class="modal active" id="deckAbandonModal" style="z-index:10002;">
      <div class="modal-backdrop" id="deckAbandonBackdrop"></div>
      <div class="modal-content" style="max-width:360px;">
        <div class="modal-header"><h2>⚠️ Abandon Deck?</h2></div>
        <div class="modal-body" style="padding:20px;text-align:center;">
          <p style="color:#374151;font-size:14px;">
            You have <strong>${window._deckBuilderQueue.length} card${window._deckBuilderQueue.length !== 1 ? 's' : ''}</strong> in the queue.
            Closing will discard them.
          </p>
        </div>
        <div class="modal-footer" style="gap:8px;">
          <button class="btn-secondary" id="deckAbandonCancel" style="flex:1;">Keep Editing</button>
          <button style="flex:1;padding:10px;border-radius:8px;border:none;background:#ef4444;color:white;font-weight:600;cursor:pointer;" id="deckAbandonConfirm">Discard</button>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('deckAbandonCancel')?.addEventListener('click', () => document.getElementById('deckAbandonModal')?.remove());
    document.getElementById('deckAbandonBackdrop')?.addEventListener('click', () => document.getElementById('deckAbandonModal')?.remove());
    document.getElementById('deckAbandonConfirm')?.addEventListener('click', () => {
      document.getElementById('deckAbandonModal')?.remove();
      document.getElementById('deckBuilderModal')?.remove();
      window._deckBuilderQueue  = [];
      window._deckBuilderActive = false;
      window.scanMode = 'collection';
    });
  } else {
    document.getElementById('deckBuilderModal')?.remove();
    window._deckBuilderActive = false;
    window.scanMode = 'collection';
  }
}

// ── Get all deck tags from the Deck Building collection ────────────────────
// Used by export.js to populate the Deck Export dropdown.
window.getDeckTags = function() {
  const cols = getCollections();
  const deckCol = cols.find(c => c.id === DECK_BUILDING_COLLECTION_ID);
  if (!deckCol) return [];

  const tagSet = new Set();
  for (const card of deckCol.cards) {
    if (Array.isArray(card.tags)) {
      card.tags.forEach(t => t && tagSet.add(t));
    }
  }
  return [...tagSet].sort();
};

// ── Get all cards in the Deck Building collection for a specific deck tag ──
window.getDeckCards = function(deckTag) {
  const cols = getCollections();
  const deckCol = cols.find(c => c.id === DECK_BUILDING_COLLECTION_ID);
  if (!deckCol) return [];
  return deckCol.cards.filter(c =>
    Array.isArray(c.tags) && c.tags.includes(deckTag)
  );
};

console.log('✅ Deck Builder module loaded');
