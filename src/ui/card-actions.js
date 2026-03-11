// ── src/ui/card-actions.js ───────────────────────────────────────────────────
// ES Module — Cross-collection card copy: moveCardToCollection() from the detail modal.

import { getCollections, getCurrentCollectionId, copyCardToCollection } from '../core/collection/collections.js';
import { showToast } from './toast.js';

// ── Cross-collection card copy from detail modal ────────────────────────────
export function moveCardToCollection(cardIndex, targetCollectionId) {
  const collections = getCollections();
  const currentId   = getCurrentCollectionId();
  const collection  = collections.find(c => c.id === currentId);
  if (!collection?.cards[cardIndex]) {
    showToast('Card not found', '❌');
    return;
  }

  const card = collection.cards[cardIndex];
  const copied = copyCardToCollection(card, targetCollectionId);

  if (copied) {
    const targetNames = { default: 'My Collection', price_check: 'Price Check', deck_building: 'Deck Builder' };
    const name = targetNames[targetCollectionId] || targetCollectionId;
    showToast(`Copied to ${name}`, '✅');
    if (typeof window.updateCollectionSlider === 'function') window.updateCollectionSlider();
    if (typeof window.updateCollectionNavCounts === 'function') window.updateCollectionNavCounts();
  } else {
    showToast('Already in that collection', '⚠️');
  }
}

window.moveCardToCollection = moveCardToCollection;
