// ============================================================
// js/collections.js — FIXED
// Changes:
//   - renderCollections() no longer called inside addCard (done in scanner.js)
//   - Added null safety throughout
//   - createCollection() prompt replaced with a cleaner pattern (inline modal)
// ============================================================

const DEFAULT_COLLECTION = {
  id: 'default',
  name: 'My Collection',
  cards: [],
  stats: { scanned: 0, free: 0, cost: 0, aiCalls: 0 }
};

// In-memory cache — avoids repeated JSON.parse on every operation.
// Invalidated on saveCollections() and on cross-tab storage events.
let _collectionsCache = null;

function getCollections() {
  if (_collectionsCache) return _collectionsCache;
  try {
    const stored = localStorage.getItem('collections');
    if (stored && stored !== 'undefined' && stored !== 'null') {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        if (!parsed.find(c => c.id === 'default')) {
          parsed.unshift({ ...DEFAULT_COLLECTION });
        }
        _collectionsCache = parsed;
        return parsed;
      }
    }
  } catch (err) {
    console.error('Error loading collections:', err);
  }
  const fresh = [{ ...DEFAULT_COLLECTION, cards: [], stats: { scanned: 0, free: 0, cost: 0, aiCalls: 0 } }];
  _collectionsCache = fresh;
  return fresh;
}

function saveCollections(collections) {
  try {
    localStorage.setItem('collections', JSON.stringify(collections));
    _collectionsCache = collections; // update cache only after successful write
    // Push to cloud after every save (debounced 2s)
    if (typeof schedulePush === 'function') schedulePush();
  } catch (err) {
    // localStorage write failed (e.g. quota exceeded) — keep cache in sync
    // with what we WANTED to save so the current session doesn't lose data,
    // but warn the user that persistence is at risk.
    _collectionsCache = collections;
    console.error('Error saving collections:', err);
    showToast('Storage full — export your collection to free space', '⚠️');
  }
}

// Invalidate cache when another tab writes to localStorage
window.addEventListener('storage', (e) => {
  if (e.key === 'collections') _collectionsCache = null;
});

// One-time migration: strip base64 imageUrls from existing cards to free localStorage space.
// Base64 data URLs start with "data:" and can be hundreds of KB each.
// Cards get their image from Supabase Storage — base64 is only needed during scan, not for storage.
function migrateBackfillAthletes() {
  // One-time migration: add athlete field to cards that were scanned before
  // heroes.js was added or before the batch scanner was updated.
  try {
    if (typeof getAthleteForHero !== 'function') return;
    if (localStorage.getItem('athletesBackfilled') === 'v1') return; // already done
    const cols = JSON.parse(localStorage.getItem('collections') || '[]');
    if (!Array.isArray(cols)) return;
    let changed = false;
    for (const col of cols) {
      for (const card of (col.cards || [])) {
        if (!card.athlete && card.hero) {
          const athlete = getAthleteForHero(card.hero);
          if (athlete) { card.athlete = athlete; changed = true; }
        }
      }
    }
    if (changed) {
      localStorage.setItem('collections', JSON.stringify(cols));
      console.log('🏃 Migrated: backfilled athlete names on existing cards');
    }
    localStorage.setItem('athletesBackfilled', 'v1');
  } catch(e) { console.warn('Athlete backfill error (non-fatal):', e); }
}

function migrateStripBase64Images() {
  try {
    const stored = localStorage.getItem('collections');
    if (!stored) return;
    const cols = JSON.parse(stored);
    if (!Array.isArray(cols)) return;
    let changed = false;
    for (const col of cols) {
      if (!Array.isArray(col.cards)) continue;
      for (const card of col.cards) {
        if (card.imageUrl && card.imageUrl.startsWith('data:')) {
          card.imageUrl = ''; // drop the base64, keep the rest of the card
          changed = true;
        }
      }
    }
    if (changed) {
      localStorage.setItem('collections', JSON.stringify(cols));
      console.log('🧹 Migrated: stripped base64 images from localStorage');
    }
  } catch (e) {
    console.warn('Migration error (non-fatal):', e);
  }
}

function getCurrentCollectionId() {
  return localStorage.getItem('currentCollectionId') || 'default';
}

function setCurrentCollectionId(id) {
  localStorage.setItem('currentCollectionId', id);
}

function getCurrentCollection() {
  const collections = getCollections();
  const currentId   = getCurrentCollectionId();
  return collections.find(c => c.id === currentId) || collections[0] || { ...DEFAULT_COLLECTION };
}

function createCollection(name) {
  if (!name || !name.trim()) return null;

  const collections = getCollections();
  const newCollection = {
    id:    `collection_${Date.now()}`,
    name:  name.trim(),
    cards: [],
    stats: { scanned: 0, free: 0, cost: 0, aiCalls: 0 }
  };
  collections.push(newCollection);
  saveCollections(collections);
  renderCollections();
  showToast(`Created: ${newCollection.name}`, '📂');
  return newCollection;
}

function deleteCollection(id) {
  if (id === 'default') {
    showToast('Cannot delete the default collection', '⚠️');
    return;
  }
  // Use custom modal instead of blocking confirm()
  showDeleteCollectionModal(id);
}

function showDeleteCollectionModal(id) {
  document.getElementById('deleteColModal')?.remove();
  const col = getCollections().find(c => c.id === id);
  const name = col ? escapeHtml(col.name) : 'this collection';
  const html = `
    <div class="modal active" id="deleteColModal" style="z-index:10002;">
      <div class="modal-backdrop" id="deleteColBackdrop"></div>
      <div class="modal-content" style="max-width:360px;">
        <div class="modal-header">
          <h2>🗑️ Delete Collection</h2>
          <button class="modal-close" id="deleteColClose">×</button>
        </div>
        <div class="modal-body" style="padding:20px;text-align:center;">
          <p style="color:#374151;font-size:15px;margin:0 0 8px;">Delete <strong>${name}</strong>?</p>
          <p style="color:#6b7280;font-size:13px;margin:0;">All cards in this collection will be permanently lost.</p>
        </div>
        <div class="modal-footer" style="gap:8px;">
          <button class="btn-secondary" id="deleteColCancel" style="flex:1;">Cancel</button>
          <button class="btn-tag-add" id="deleteColConfirm" style="flex:1;background:#ef4444;">Delete</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const close = () => document.getElementById('deleteColModal')?.remove();
  document.getElementById('deleteColClose')?.addEventListener('click', close);
  document.getElementById('deleteColCancel')?.addEventListener('click', close);
  document.getElementById('deleteColBackdrop')?.addEventListener('click', close);
  document.getElementById('deleteColConfirm')?.addEventListener('click', () => {
    close();
    let collections = getCollections().filter(c => c.id !== id);
    if (getCurrentCollectionId() === id) setCurrentCollectionId('default');
    saveCollections(collections);
    renderCollections();
    renderCards();
    showToast('Collection deleted', '🗑️');
  });
}

function renameCollection(id, newName) {
  if (!newName || !newName.trim()) return;
  const collections = getCollections();
  const col = collections.find(c => c.id === id);
  if (col) {
    col.name = newName.trim();
    saveCollections(collections);
    renderCollections();
  }
}

function switchCollection(id) {
  const collections = getCollections();
  const collection  = collections.find(c => c.id === id);
  if (!collection) return;

  setCurrentCollectionId(id);
  renderCollections();
  renderCards();
  updateStats();
  showToast(`Switched to ${collection.name}`, '📂');
}

// addCardToCollection and removeCardFromCollection kept for external callers
function addCardToCollection(card) {
  const collections = getCollections();
  const col = collections.find(c => c.id === getCurrentCollectionId());
  if (!col) return;

  col.cards.push(card);
  col.stats.scanned++;
  if (card.scanType === 'free') col.stats.free++;
  if (card.cost) col.stats.cost = (col.stats.cost || 0) + card.cost;
  if (card.scanMethod === 'AI') col.stats.aiCalls = (col.stats.aiCalls || 0) + 1;

  saveCollections(collections);
}

function renderCollections() {
  // Update the new slider UI instead of old pills
  updateCollectionSlider();
}

function updateCollectionSlider() {
  const wrap = document.getElementById('collectionSliderWrap');
  if (!wrap) return;

  const collections  = getCollections();
  const currentId    = getCurrentCollectionId();
  const mainCols     = collections.filter(c => c.id !== 'price_check' && c.id !== 'deck_building');
  const priceCheck   = collections.find(c => c.id === 'price_check');
  const deckBuilding = collections.find(c => c.id === 'deck_building');
  const mainCount    = mainCols.reduce((sum, c) => sum + c.cards.length, 0);
  const pcCount      = priceCheck   ? priceCheck.cards.length   : 0;
  const dbCount      = deckBuilding ? deckBuilding.cards.length : 0;

  // Show slider whenever any secondary collection exists or is active
  const hasSecondary = priceCheck || deckBuilding ||
                       currentId === 'price_check' || currentId === 'deck_building';
  wrap.style.display = hasSecondary ? 'block' : 'none';

  const isPC = currentId === 'price_check';
  const isDB = currentId === 'deck_building';
  const isColl = !isPC && !isDB;

  // Counts
  const elC  = document.getElementById('sliderCountCollection');
  const elPC = document.getElementById('sliderCountPriceCheck');
  const elDB = document.getElementById('sliderCountDeckBuilder');
  if (elC)  elC.textContent  = mainCount;
  if (elPC) elPC.textContent = pcCount;
  if (elDB) elDB.textContent = dbCount;

  // Thumb position — each tab is 1/3 of the slider width
  // thumb width = calc(33.333% - 4px), so stepping right by one slot = translate by 33.333% of the container
  // We use a CSS custom property trick: set left dynamically instead of transform
  const thumb = document.getElementById('sliderThumb');
  if (thumb) {
    if (isColl) {
      thumb.style.left      = '4px';
      thumb.style.transform = 'translateX(0)';
    } else if (isPC) {
      thumb.style.left      = 'calc(33.333%)';
      thumb.style.transform = 'translateX(0)';
    } else {
      thumb.style.left      = 'calc(66.666%)';
      thumb.style.transform = 'translateX(0)';
    }
  }

  // Button colours
  const btnC  = document.getElementById('sliderBtnCollection');
  const btnPC = document.getElementById('sliderBtnPriceCheck');
  const btnDB = document.getElementById('sliderBtnDeckBuilder');

  const activeStyle   = { color: '#e2e8f0', fontWeight: '800' };
  const inactiveStyle = { color: '#64748b', fontWeight: '600' };

  [btnC, btnPC, btnDB].forEach(btn => {
    if (!btn) return;
    const isActive = (btn === btnC && isColl) || (btn === btnPC && isPC) || (btn === btnDB && isDB);
    btn.style.color      = isActive ? activeStyle.color      : inactiveStyle.color;
    btn.style.fontWeight = isActive ? activeStyle.fontWeight : inactiveStyle.fontWeight;
  });

  // Badge colours
  if (elC)  { elC.style.background  = isColl ? 'rgba(245,158,11,0.85)' : 'rgba(148,163,184,0.15)'; elC.style.color  = isColl ? '#0d1524' : '#94a3b8'; }
  if (elPC) { elPC.style.background = isPC   ? 'rgba(16,185,129,0.85)' : 'rgba(148,163,184,0.15)'; elPC.style.color = isPC   ? 'white'   : '#94a3b8'; }
  if (elDB) { elDB.style.background = isDB   ? 'rgba(124,58,237,0.85)' : 'rgba(148,163,184,0.15)'; elDB.style.color = isDB   ? 'white'   : '#94a3b8'; }
}

window.updateCollectionSlider = updateCollectionSlider;
window.switchCollection = switchCollection;
window.setCurrentCollectionId = setCurrentCollectionId;

window.sliderSwitch = function(targetId) {
  if (targetId === 'price_check') {
    const collections = getCollections();
    if (!collections.find(c => c.id === 'price_check')) return;
    switchCollection('price_check');
    updateCollectionSlider();
    if (typeof renderCards === 'function') renderCards();
  } else if (targetId === 'deck_building') {
    // Show deck cards in the main grid (same experience as My Collection and Price Check)
    if (typeof window.ensureDeckBuildingCollection === 'function') {
      window.ensureDeckBuildingCollection();
    }
    const deckCols = getCollections();
    if (!deckCols.find(c => c.id === 'deck_building')) return;
    switchCollection('deck_building');
    updateCollectionSlider();
    if (typeof renderCards === 'function') renderCards();
  } else {
    switchCollection('default');
    updateCollectionSlider();
    if (typeof renderCards === 'function') renderCards();
  }
};

function loadCollections(collectionsData) {
  if (collectionsData) {
    try {
      const parsed = typeof collectionsData === 'string'
        ? JSON.parse(collectionsData)
        : collectionsData;
      if (Array.isArray(parsed)) {
        if (!parsed.find(c => c.id === 'default')) parsed.unshift({ ...DEFAULT_COLLECTION });
        saveCollections(parsed);
      }
    } catch (err) {
      console.error('Error loading collections data:', err);
    }
  }
  renderCollections();
}

function initCollections() {
  const collections = getCollections();
  if (!collections.find(c => c.id === 'default')) {
    collections.unshift({ ...DEFAULT_COLLECTION });
    saveCollections(collections);
  }
  const currentId = getCurrentCollectionId();
  if (!collections.find(c => c.id === currentId)) {
    setCurrentCollectionId('default');
  }
  renderCollections();
}

function exportCollections() {
  const collections = getCollections();
  const blob = new Blob([JSON.stringify(collections, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `boba-collections-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Collections exported', '📥');
}

function importCollections(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error('Invalid format');

      const existing = getCollections();
      const merged   = [...existing];

      for (const impCol of imported) {
        if (impCol.id === 'default') continue;
        const idx = merged.findIndex(c => c.id === impCol.id);
        if (idx >= 0) {
          if (confirm(`Collection "${impCol.name}" already exists. Replace it?`)) {
            merged[idx] = impCol;
          }
        } else {
          merged.push(impCol);
        }
      }

      saveCollections(merged);
      renderCollections();
      showToast('Collections imported', '📤');
    } catch (err) {
      console.error('Import error:', err);
      showToast('Failed to import collections', '❌');
    }
  };
  reader.readAsText(file);
}

document.addEventListener('DOMContentLoaded', () => {
  migrateStripBase64Images();   // free up base64 images from old scans
  // Athletes backfill runs after heroes.js loads — DOMContentLoaded is safe
  setTimeout(migrateBackfillAthletes, 500);
  initCollections();
});

// ── Cross-collection card movement ─────────────────────────────────────────
// Copy a card into a target collection (if not already present there).
// Returns true if the card was actually added.
window.copyCardToCollection = function(card, targetCollectionId) {
  const cols = getCollections();

  // Ensure target exists (auto-create price_check / deck_building if needed)
  let target = cols.find(c => c.id === targetCollectionId);
  if (!target) {
    if (targetCollectionId === 'price_check' && typeof ensurePriceCheckCollection === 'function') {
      ensurePriceCheckCollection();
      target = getCollections().find(c => c.id === 'price_check');
    } else if (targetCollectionId === 'deck_building' && typeof ensureDeckBuildingCollection === 'function') {
      ensureDeckBuildingCollection();
      target = getCollections().find(c => c.id === 'deck_building');
    }
  }
  if (!target) return false;

  // Check for duplicate in target
  const isDupe = target.cards.some(c =>
    (card.cardId && c.cardId === card.cardId) ||
    (card.cardNumber && c.cardNumber === card.cardNumber && c.set === card.set)
  );
  if (isDupe) return false;

  target.cards.push({ ...card });
  target.stats.scanned++;
  saveCollections(cols);
  return true;
};

// Remove a card from a specific collection by index.
window.removeCardFromCollectionByIndex = function(collectionId, cardIndex) {
  const cols = getCollections();
  const col  = cols.find(c => c.id === collectionId);
  if (!col || !col.cards[cardIndex]) return false;

  col.cards.splice(cardIndex, 1);
  col.stats.scanned = Math.max(0, (col.stats.scanned || 0) - 1);
  saveCollections(cols);
  return true;
};

console.log('✅ Collections module loaded');
