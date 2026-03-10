// ── src/ui/card-actions.js ───────────────────────────────────────────────────
// Cross-collection card copy: moveCardToCollection() from the detail modal.
// No imports/exports — all files share global scope via Vite concat.

// ── Cross-collection card copy from detail modal ────────────────────────────
window.moveCardToCollection = function(cardIndex, targetCollectionId) {
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
    if (typeof updateCollectionSlider === 'function') updateCollectionSlider();
    if (typeof updateCollectionNavCounts === 'function') updateCollectionNavCounts();
  } else {
    showToast('Already in that collection', '⚠️');
  }
};
