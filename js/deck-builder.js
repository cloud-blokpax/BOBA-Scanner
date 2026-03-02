// ============================================================
// js/deck-builder.js — Deck Builder v2.0
//
// Workflow:
//  1. User opens Deck Builder → prompted for deck name + composition
//  2. Name becomes the tag applied to all cards in this deck
//  3. User sets target counts: Heroes, Plays, Bonus Plays (each >= 0)
//  4. Scans cards one at a time (photo or upload)
//  5. Manual card additions count toward deck + retain scanned image
//  6. User can finish early before reaching target counts
//  7. On Finish → tag all scanned cards → save to Deck Building collection
//
// BoBA API: GET https://www.bobaleagues.com/api/cards
// Returns DBS score, Cost, Ability per card.
//
// Export: handled in export.js — "BoBA Deck" template
// ============================================================

const DECK_BUILDING_COLLECTION_ID = 'deck_building';
const BOBA_API_BASE = 'https://www.bobaleagues.com/api/cards';

// ── In-memory deck being built ─────────────────────────────────────────────
// Each entry: { card, dbsData: { dbs, cost, ability }, parallel: 'hero'|'play'|'bonus', imageBase64 }
window._deckBuilderQueue  = window._deckBuilderQueue  || [];
window._deckBuilderActive = window._deckBuilderActive || false;
// Config from setup modal: { name, tag, maxHeroes, maxPlays, maxBonus, totalTarget }
window._deckBuilderConfig = window._deckBuilderConfig || null;

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
  return 'hero'; // base cards and other parallels are heroes
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
      }) || (url === BOBA_API_BASE ? null : list[0]);

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

// ── Open the Deck Builder — show setup modal first ──────────────────────────
window.openDeckBuilder = function() {
  window._deckBuilderActive = true;
  window._deckBuilderQueue  = [];
  window._deckBuilderConfig = null;
  showDeckSetupModal();
};

// ── Deck Setup Modal — collect name + composition before scanning ────────────
function showDeckSetupModal() {
  document.getElementById('deckSetupModal')?.remove();

  const html = `
  <div class="modal active" id="deckSetupModal">
    <div class="modal-backdrop" id="deckSetupBackdrop"></div>
    <div class="modal-content" style="max-width:420px;">
      <div class="modal-header">
        <h2>🃏 New Deck</h2>
        <button class="modal-close" id="deckSetupClose">×</button>
      </div>
      <div class="modal-body" style="padding:20px;">
        <p style="font-size:13px;color:#6b7280;margin:0 0 16px;">
          Name your deck and set how many cards you plan to add.
          The name will be applied as a tag to all cards in this deck.
        </p>

        <label for="deckSetupName" style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Deck Name</label>
        <input type="text" id="deckSetupName"
               placeholder="e.g. Fire Deck v1, Tournament Build..."
               autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false"
               style="width:100%;box-sizing:border-box;padding:11px 14px;border:1.5px solid #d1d5db;
                      border-radius:10px;font-size:15px;font-family:inherit;margin-bottom:4px;">
        <div id="deckSetupNameError" style="color:#ef4444;font-size:12px;margin-bottom:12px;display:none;"></div>

        <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">Deck Composition</div>
        <div style="display:flex;gap:10px;margin-bottom:6px;">
          <div style="flex:1;text-align:center;">
            <label for="deckSetupHeroes" style="font-size:12px;color:#6b7280;display:block;margin-bottom:3px;">🦸 Heroes</label>
            <input type="number" id="deckSetupHeroes" min="0" value="0"
                   style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #d1d5db;
                          border-radius:8px;font-size:16px;text-align:center;font-family:inherit;">
          </div>
          <div style="flex:1;text-align:center;">
            <label for="deckSetupPlays" style="font-size:12px;color:#6b7280;display:block;margin-bottom:3px;">▶ Plays</label>
            <input type="number" id="deckSetupPlays" min="0" value="30"
                   style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #d1d5db;
                          border-radius:8px;font-size:16px;text-align:center;font-family:inherit;">
          </div>
          <div style="flex:1;text-align:center;">
            <label for="deckSetupBonus" style="font-size:12px;color:#6b7280;display:block;margin-bottom:3px;">⭐ Bonus</label>
            <input type="number" id="deckSetupBonus" min="0" value="15"
                   style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #d1d5db;
                          border-radius:8px;font-size:16px;text-align:center;font-family:inherit;">
          </div>
        </div>
        <div style="font-size:11px;color:#9ca3af;text-align:center;margin-top:4px;">
          Total target: <strong id="deckSetupTotal">45</strong> cards
        </div>
      </div>
      <div class="modal-footer" style="gap:8px;">
        <button class="btn-secondary" id="deckSetupCancel" style="flex:1;">Cancel</button>
        <button class="btn-tag-add" id="deckSetupStart" style="flex:2;padding:12px;font-size:14px;">
          🃏 Start Building
        </button>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  // Close handlers
  const closeSetup = () => {
    document.getElementById('deckSetupModal')?.remove();
    window._deckBuilderActive = false;
  };
  document.getElementById('deckSetupClose')?.addEventListener('click', closeSetup);
  document.getElementById('deckSetupBackdrop')?.addEventListener('click', closeSetup);
  document.getElementById('deckSetupCancel')?.addEventListener('click', closeSetup);

  // Live total update
  const updateTotal = () => {
    const h = Math.max(0, parseInt(document.getElementById('deckSetupHeroes')?.value) || 0);
    const p = Math.max(0, parseInt(document.getElementById('deckSetupPlays')?.value) || 0);
    const b = Math.max(0, parseInt(document.getElementById('deckSetupBonus')?.value) || 0);
    const el = document.getElementById('deckSetupTotal');
    if (el) el.textContent = h + p + b;
  };
  ['deckSetupHeroes', 'deckSetupPlays', 'deckSetupBonus'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateTotal);
  });

  // Start building
  const startBuilding = () => {
    const nameInput = document.getElementById('deckSetupName');
    const name = (nameInput?.value || '').trim();
    const errEl = document.getElementById('deckSetupNameError');

    if (!name) {
      if (errEl) { errEl.textContent = 'Please enter a deck name.'; errEl.style.display = 'block'; }
      nameInput?.focus();
      return;
    }

    window._deckBuilderConfig = {
      name,
      tag:       name.replace(/[|,]/g, '-').trim(),
      maxHeroes: Math.max(0, parseInt(document.getElementById('deckSetupHeroes')?.value) || 0),
      maxPlays:  Math.max(0, parseInt(document.getElementById('deckSetupPlays')?.value) || 0),
      maxBonus:  Math.max(0, parseInt(document.getElementById('deckSetupBonus')?.value) || 0),
    };
    window._deckBuilderConfig.totalTarget =
      window._deckBuilderConfig.maxHeroes +
      window._deckBuilderConfig.maxPlays +
      window._deckBuilderConfig.maxBonus;

    document.getElementById('deckSetupModal')?.remove();
    renderDeckBuilderModal();
  };

  document.getElementById('deckSetupStart')?.addEventListener('click', startBuilding);
  document.getElementById('deckSetupName')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') startBuilding();
  });

  setTimeout(() => document.getElementById('deckSetupName')?.focus(), 80);
}

// ── Card scanned callback — registered on open, cleared on close ───────────
// scanner.js calls this when scanMode === 'deckbuilder' instead of addCard.
window.deckBuilderOnCardScanned = async function(match, imageUrl, fileName, imageBase64) {
  const cfg   = window._deckBuilderConfig;
  const pType = getParallelType(match);
  const queue = window._deckBuilderQueue;

  const heroes  = queue.filter(e => e.parallel === 'hero');
  const plays   = queue.filter(e => e.parallel === 'play');
  const bonuses = queue.filter(e => e.parallel === 'bonus');

  // Soft capacity warnings — inform user but don't block adding
  if (cfg) {
    if (pType === 'hero'  && cfg.maxHeroes > 0 && heroes.length  >= cfg.maxHeroes) {
      showToast(`Heroes target (${cfg.maxHeroes}) already reached`, '⚠️');
    }
    if (pType === 'play'  && cfg.maxPlays  > 0 && plays.length   >= cfg.maxPlays) {
      showToast(`Plays target (${cfg.maxPlays}) already reached`, '⚠️');
    }
    if (pType === 'bonus' && cfg.maxBonus  > 0 && bonuses.length >= cfg.maxBonus) {
      showToast(`Bonus target (${cfg.maxBonus}) already reached`, '⚠️');
    }
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
  const icon = pType === 'hero' ? '🦸' : pType === 'play' ? '🎴' : '⭐';
  showToast(`${icon} Added: ${card.hero} (${card.cardNumber})`, '✅');

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

  // Check if all targets met
  if (cfg && cfg.totalTarget > 0) {
    const h2 = queue.filter(e => e.parallel === 'hero').length;
    const p2 = queue.filter(e => e.parallel === 'play').length;
    const b2 = queue.filter(e => e.parallel === 'bonus').length;
    const heroMet  = cfg.maxHeroes === 0 || h2 >= cfg.maxHeroes;
    const playMet  = cfg.maxPlays  === 0 || p2 >= cfg.maxPlays;
    const bonusMet = cfg.maxBonus  === 0 || b2 >= cfg.maxBonus;
    if (heroMet && playMet && bonusMet) {
      showToast('All deck targets reached!', '🎉');
    }
  }
};

// ── Render / re-render the modal ───────────────────────────────────────────
function renderDeckBuilderModal() {
  document.getElementById('deckBuilderModal')?.remove();

  const cfg     = window._deckBuilderConfig || { name: 'Deck', maxHeroes: 0, maxPlays: 30, maxBonus: 15, totalTarget: 45 };
  const queue   = window._deckBuilderQueue;
  const heroes  = queue.filter(e => e.parallel === 'hero');
  const plays   = queue.filter(e => e.parallel === 'play');
  const bonuses = queue.filter(e => e.parallel === 'bonus');
  const total   = queue.length;

  // Progress percentage based on total target
  const progressPct = cfg.totalTarget > 0
    ? Math.min(100, Math.round((total / cfg.totalTarget) * 100))
    : (total > 0 ? 100 : 0);

  // All targets met?
  const heroMet  = cfg.maxHeroes === 0 || heroes.length  >= cfg.maxHeroes;
  const playMet  = cfg.maxPlays  === 0 || plays.length   >= cfg.maxPlays;
  const bonusMet = cfg.maxBonus  === 0 || bonuses.length >= cfg.maxBonus;
  const allMet   = heroMet && playMet && bonusMet && total > 0;

  // Build status line for header
  const statusParts = [];
  if (cfg.maxHeroes > 0) statusParts.push(`${heroes.length}/${cfg.maxHeroes} heroes`);
  if (cfg.maxPlays  > 0) statusParts.push(`${plays.length}/${cfg.maxPlays} plays`);
  else statusParts.push(`${plays.length} plays`);
  if (cfg.maxBonus  > 0) statusParts.push(`${bonuses.length}/${cfg.maxBonus} bonus`);
  else statusParts.push(`${bonuses.length} bonus`);

  // Queue HTML — show each section that has cards or a target > 0
  const queueHtml = total === 0
    ? `<div style="text-align:center;padding:28px 16px;color:#9ca3af;font-size:14px;">
         <div style="font-size:32px;margin-bottom:8px;">🃏</div>
         No cards scanned yet. Start by scanning a card.
       </div>`
    : `
      ${heroes.length > 0 || cfg.maxHeroes > 0 ? `
        <div style="margin-bottom:12px;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
            🦸 Heroes (${heroes.length}${cfg.maxHeroes > 0 ? '/' + cfg.maxHeroes : ''})${cfg.maxHeroes > 0 && heroes.length >= cfg.maxHeroes ? ' ✓' : ''}
          </div>
          ${heroes.length > 0
            ? heroes.map((e, i) => renderQueueRow(e, i, 'hero')).join('')
            : '<div style="font-size:12px;color:#d1d5db;padding:4px 10px;">No heroes added yet</div>'}
        </div>` : ''}
      ${plays.length > 0 || cfg.maxPlays > 0 ? `
        <div style="margin-bottom:12px;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
            ▶ Plays (${plays.length}${cfg.maxPlays > 0 ? '/' + cfg.maxPlays : ''})${cfg.maxPlays > 0 && plays.length >= cfg.maxPlays ? ' ✓' : ''}
          </div>
          ${plays.length > 0
            ? plays.map((e, i) => renderQueueRow(e, i, 'play')).join('')
            : '<div style="font-size:12px;color:#d1d5db;padding:4px 10px;">No plays added yet</div>'}
        </div>` : ''}
      ${bonuses.length > 0 || cfg.maxBonus > 0 ? `
        <div>
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
            ⭐ Bonus Plays (${bonuses.length}${cfg.maxBonus > 0 ? '/' + cfg.maxBonus : ''})${cfg.maxBonus > 0 && bonuses.length >= cfg.maxBonus ? ' ✓' : ''}
          </div>
          ${bonuses.length > 0
            ? bonuses.map((e, i) => renderQueueRow(e, i, 'bonus')).join('')
            : '<div style="font-size:12px;color:#d1d5db;padding:4px 10px;">No bonus plays added yet</div>'}
        </div>` : ''}`;

  const html = `
  <div class="modal active" id="deckBuilderModal">
    <div class="modal-backdrop" id="deckBuilderBackdrop"></div>
    <div class="modal-content" style="max-width:520px;max-height:92vh;display:flex;flex-direction:column;">
      <div class="modal-header">
        <div>
          <h2>🃏 ${escapeHtml(cfg.name)}</h2>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">
            ${statusParts.join(' · ')}
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
          <span>${cfg.totalTarget > 0
            ? (cfg.totalTarget - total > 0 ? (cfg.totalTarget - total) + ' remaining' : 'target reached ✓')
            : ''}</span>
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
            box-shadow:0 4px 12px rgba(37,99,235,0.35);transition:all .15s;">
            📷 Take Photo
            <input type="file" id="deckScanPhoto" accept="image/*" capture="environment" style="display:none;">
          </label>
          <label id="deckScanUploadLabel" style="
            display:inline-flex;align-items:center;gap:6px;
            padding:10px 18px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;
            background:linear-gradient(135deg,#7c3aed,#6d28d9);color:white;
            box-shadow:0 4px 12px rgba(124,58,237,0.35);transition:all .15s;">
            🖼️ Upload Image
            <input type="file" id="deckScanUpload" accept="image/*" style="display:none;">
          </label>
        </div>
        ${allMet ? `<p style="text-align:center;font-size:12px;color:#10b981;margin:8px 0 0;font-weight:600;">
            ✅ All targets reached! Click Finish Deck to save.
          </p>` : `<p style="text-align:center;font-size:11px;color:#9ca3af;margin:6px 0 0;">
            Scan any card to add it to your deck
          </p>`}
      </div>

      <!-- Footer -->
      <div class="modal-footer" style="gap:8px;">
        <button class="btn-secondary" id="deckBuilderCancel" style="flex:1;">Cancel</button>
        ${total > 0 ? `<button id="deckCompleteBtn" class="btn-tag-add" style="flex:2;padding:12px;font-size:14px;">
          Finish Deck (${total} card${total !== 1 ? 's' : ''})
        </button>` : ''}
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  wireDeckBuilderEvents();
}

function renderQueueRow(entry, idx, type) {
  const { card, dbsData } = entry;
  const slotLabel = type === 'hero'
    ? `H${idx + 1}`
    : type === 'play'
    ? `Slot ${idx + 1}`
    : `B${idx + 1}`;
  const hasApiData = dbsData !== null;

  const colors = {
    hero:  { bg: '#f0fdf4', border: '#bbf7d0', badge: '#166534', badgeBg: '#dcfce7' },
    play:  { bg: '#eff6ff', border: '#bfdbfe', badge: '#1d4ed8', badgeBg: '#dbeafe' },
    bonus: { bg: '#f5f3ff', border: '#ddd6fe', badge: '#7c3aed', badgeBg: '#ede9fe' },
  };
  const c = colors[type] || colors.play;

  return `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;
                background:${c.bg};
                border-radius:10px;margin-bottom:6px;border:1px solid ${c.border};">
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
        <span style="font-size:11px;font-weight:700;color:${c.badge};
                     background:${c.badgeBg};
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

  // Complete deck — name already collected, go straight to finalize
  document.getElementById('deckCompleteBtn')?.addEventListener('click', finalizeDeck);

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
    // NOTE: Do NOT reset scanMode here. The manual search modal may still be
    // open and needs scanMode='deckbuilder' to route the selection correctly.
    // scanMode is reset when the deck builder is closed or finalized.
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

// ── Finalize: save all cards to Deck Building collection ──────────────────
// Deck name was collected in the setup modal — no second prompt needed.
async function finalizeDeck() {
  const cfg = window._deckBuilderConfig;
  if (!cfg || !cfg.tag) {
    showToast('Deck configuration missing — please try again', '❌');
    return;
  }

  const deckTag  = cfg.tag;
  const deckName = cfg.name;

  // Disable button to prevent double-tap
  const btn = document.getElementById('deckCompleteBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  const cols    = ensureDeckBuildingCollection();
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

  // Close the modal
  document.getElementById('deckBuilderModal')?.remove();

  // Reset state
  window._deckBuilderQueue  = [];
  window._deckBuilderActive = false;
  window._deckBuilderConfig = null;
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
      window._deckBuilderConfig = null;
      window.scanMode = 'collection';
    });
  } else {
    document.getElementById('deckBuilderModal')?.remove();
    window._deckBuilderActive = false;
    window._deckBuilderConfig = null;
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
