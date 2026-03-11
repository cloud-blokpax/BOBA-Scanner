// ── src/ui/stats-strip.js ────────────────────────────────────────────────────
// Stats strip: updateStats(), updateCollectionNavCounts(), window assignments,
// and openPriceCheckModal delegation

import { showToast, showLoading } from '../ui/toast.js';
import { on } from '../core/event-bus.js';
import { getCollections, getCurrentCollectionId } from '../core/collection/collections.js';

export function updateStats() {
    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const collection  = collections.find(c => c.id === currentId);
    if (!collection) return;

    const stats  = collection.stats;
    const aiUsed = stats.aiCalls || 0;
    const rate   = stats.scanned > 0 ? Math.round((stats.free / stats.scanned) * 100) : 0;

    // Use actual user limits from userLimits (set after sign-in) or guest defaults
    const isGuest    = typeof window.userLimits === 'undefined' || !window.userLimits;
    const cardLimit  = isGuest ? 5  : (window.userLimits.maxCards    || 5);
    const aiLimit    = isGuest ? 1  : (window.userLimits.maxApiCalls || 1);
    const sublabel   = isGuest ? 'Guest limit' : 'Your limit';

    const statCards      = document.getElementById('statCards');
    const statAI         = document.getElementById('statAI');
    const statCost       = document.getElementById('statCost');
    const statRate       = document.getElementById('statRate');
    const statCardsLabel = document.getElementById('statCardsLabel');
    const statAILabel    = document.getElementById('statAILabel');

    if (statCards)      statCards.textContent      = `${stats.scanned} / ${cardLimit}`;
    if (statAI)         statAI.textContent          = `${aiUsed} / ${aiLimit}`;
    if (statCost)       statCost.textContent        = `$${(stats.cost || 0).toFixed(2)}`;
    if (statRate)       statRate.textContent        = `${rate}%`;
    if (statCardsLabel) statCardsLabel.textContent  = sublabel;
    if (statAILabel)    statAILabel.textContent     = `${aiLimit - aiUsed} remaining`;

    // Update stats strip summary line — total across ALL collections
    const allCollections = getCollections();
    const totalCards = allCollections.reduce((sum, c) => sum + (c.cards?.length || 0), 0);
    const summary = document.getElementById('statsStripSummary');
    if (summary) summary.textContent = `${totalCards} card${totalCards !== 1 ? 's' : ''}`;
}

// Update the card counts on the Collection / Price Check nav buttons
export function updateCollectionNavCounts() {
    try {
        const collections = getCollections();
        const mainCol = collections.find(c => c.id === 'default') || collections.find(c => c.id !== 'price_check' && c.id !== 'deck_building');
        const pcCol   = collections.find(c => c.id === 'price_check');
        const dbCol   = collections.find(c => c.id === 'deck_building');

        const mainCount = mainCol?.cards?.length || 0;
        const pcCount   = pcCol?.cards?.length   || 0;
        const dbCount   = dbCol?.cards?.length   || 0;

        const mainEl = document.getElementById('collectionNavCount');
        const pcEl   = document.getElementById('priceCheckNavCount');
        const dbEl   = document.getElementById('deckBuilderNavCount');

        if (mainEl) mainEl.textContent = mainCount > 0 ? ` (${mainCount})` : '';
        if (pcEl)   pcEl.textContent   = pcCount   > 0 ? ` (${pcCount})`   : '';
        if (dbEl)   dbEl.textContent   = dbCount   > 0 ? ` (${dbCount})`   : '';

        // Update More sheet collection badge
        const moreCollBadge = document.getElementById('moreCollectionCount');
        if (moreCollBadge) moreCollBadge.textContent = mainCount > 0 ? String(mainCount) : '';

        // Also refresh the slider counts
        if (typeof window.updateCollectionSlider === 'function') window.updateCollectionSlider();
    } catch(e) {}
}
window.updateStats = updateStats;
window.updateCollectionNavCounts = updateCollectionNavCounts;
window.showLoading = showLoading;
window.showToast = showToast;

// Open Price Check modal — delegates to the dedicated function in tags.js
window.openPriceCheckModal = function() {
    if (typeof window.openPriceCheckCollectionModal === 'function') {
        window.openPriceCheckCollectionModal();
    }
};

// ── Event bus subscriptions ─────────────────────────────────────────────────
// Respond to collection/card changes from any module without typeof guards.
on('cards:changed', () => {
    updateStats();
    updateCollectionNavCounts();
});
on('auth:changed', () => {
    updateStats();
});
