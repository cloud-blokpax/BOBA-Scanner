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

function getCollections() {
  try {
    const stored = localStorage.getItem('collections');
    if (stored && stored !== 'undefined' && stored !== 'null') {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        if (!parsed.find(c => c.id === 'default')) {
          parsed.unshift({ ...DEFAULT_COLLECTION });
        }
        return parsed;
      }
    }
  } catch (err) {
    console.error('Error loading collections:', err);
  }
  return [{ ...DEFAULT_COLLECTION, cards: [], stats: { scanned: 0, free: 0, cost: 0, aiCalls: 0 } }];
}

function saveCollections(collections) {
  try {
    localStorage.setItem('collections', JSON.stringify(collections));
    // Push to cloud after every save (debounced 2s)
    if (typeof schedulePush === 'function') schedulePush();
  } catch (err) {
    console.error('Error saving collections:', err);
    showToast('Storage full — export your collection to free space', '⚠️');
  }
}

// One-time migration: strip base64 imageUrls from existing cards to free localStorage space.
// Base64 data URLs start with "data:" and can be hundreds of KB each.
// Cards get their image from Supabase Storage — base64 is only needed during scan, not for storage.
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
  if (!confirm('Delete this collection? All cards will be lost.')) return;

  let collections = getCollections().filter(c => c.id !== id);
  if (getCurrentCollectionId() === id) setCurrentCollectionId('default');

  saveCollections(collections);
  renderCollections();
  renderCards();
  showToast('Collection deleted', '🗑️');
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
  const mainCols     = collections.filter(c => c.id !== 'price_check');
  const priceCheck   = collections.find(c => c.id === 'price_check');
  const mainCount    = mainCols.reduce((sum, c) => sum + c.cards.length, 0);
  const pcCount      = priceCheck ? priceCheck.cards.length : 0;

  // Show slider only if price check collection exists and has cards, or is active
  if (!priceCheck && currentId !== 'price_check') {
    wrap.style.display = 'none';
  } else {
    wrap.style.display = 'block';
  }

  const isPC = currentId === 'price_check';

  // Update counts
  const elC  = document.getElementById('sliderCountCollection');
  const elPC = document.getElementById('sliderCountPriceCheck');
  const btnC  = document.getElementById('sliderBtnCollection');
  const btnPC = document.getElementById('sliderBtnPriceCheck');
  const thumb = document.getElementById('sliderThumb');

  if (elC)  elC.textContent  = mainCount;
  if (elPC) elPC.textContent = pcCount;

  if (thumb) {
    thumb.style.transform = isPC ? 'translateX(100%)' : 'translateX(0)';
  }

  if (btnC) {
    btnC.style.color     = isPC ? '#9ca3af' : '#1e3a5f';
    btnC.style.fontWeight = isPC ? '600' : '800';
  }
  if (btnPC) {
    btnPC.style.color     = isPC ? '#1e3a5f' : '#9ca3af';
    btnPC.style.fontWeight = isPC ? '800' : '600';
  }
  if (elC) {
    elC.style.background = isPC ? '#d1d5db' : '#2563eb';
    elC.style.color      = isPC ? '#374151' : 'white';
  }
  if (elPC) {
    elPC.style.background = isPC ? '#059669' : '#d1d5db';
    elPC.style.color      = isPC ? 'white'   : '#374151';
  }
}

window.updateCollectionSlider = updateCollectionSlider;

window.sliderSwitch = function(targetId) {
  if (targetId === 'price_check') {
    const collections = getCollections();
    const pc = collections.find(c => c.id === 'price_check');
    if (!pc) return;
    switchCollection('price_check');
  } else {
    // Switch to default collection
    switchCollection('default');
  }
  updateCollectionSlider();
  if (typeof renderCards === 'function') renderCards();
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
  migrateStripBase64Images(); // run once to free up any base64 images from old scans
  initCollections();
});

console.log('✅ Collections module loaded');
