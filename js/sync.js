// js/sync.js — Cloud sync for card collections

const SYNC_DEBOUNCE_MS = 2000;
let _syncTimer = null;

// ── Tombstones ────────────────────────────────────────────────────────────────
// A tombstone records a deliberate card deletion so the merge won't re-add it.
// Key: cardNumber + ":" + timestamp (the card's own timestamp, not deletion time)

function getDeletedCards() {
    try {
        return JSON.parse(localStorage.getItem('deletedCards') || '[]');
    } catch { return []; }
}

function saveDeletedCards(list) {
    try {
        localStorage.setItem('deletedCards', JSON.stringify(list));
    } catch (e) { console.warn('Could not save tombstones:', e); }
}

function recordDeletedCard(card) {
    const key = cardTombstoneKey(card);
    const list = getDeletedCards();
    if (!list.includes(key)) {
        list.push(key);
        saveDeletedCards(list);
    }
    // Also push immediately so other devices learn about this deletion ASAP
    schedulePush();
}

function cardTombstoneKey(card) {
    // Use cardNumber + timestamp as a stable unique key for each scanned card
    return (card.cardNumber || '') + ':' + (card.timestamp || '');
}

function isDeleted(card, tombstones) {
    return tombstones.includes(cardTombstoneKey(card));
}

// Prune tombstones older than 30 days to prevent unbounded localStorage growth.
// Tombstone keys embed the card's ISO timestamp: "cardNumber:isoTimestamp"
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function pruneTombstones(list) {
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    return list.filter(key => {
        const colonIdx = key.indexOf(':');
        if (colonIdx === -1) return true; // malformed — keep (safe default)
        const ts = new Date(key.slice(colonIdx + 1)).getTime();
        return isNaN(ts) || ts > cutoff; // keep if unparseable or recent
    });
}

// ── Setup ─────────────────────────────────────────────────────────────────────
function setupAutoSync() {
    if (isGuestMode() || !window.supabaseClient) {
        console.log('⏭️ Sync skipped (guest mode or no Supabase)');
        return;
    }
    pullCollections().then(() => {
        console.log('✅ Auto-sync active');
    });
}

function schedulePush() {
    if (isGuestMode() || !window.supabaseClient || !currentUser) return;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(pushCollections, SYNC_DEBOUNCE_MS);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function stripBlobUrls(collections) {
    return collections.map(col => ({
        ...col,
        cards: col.cards.map(card => ({
            ...card,
            imageUrl: (card.imageUrl && !card.imageUrl.startsWith('blob:'))
                ? card.imageUrl : ''
        }))
    }));
}

// Merge two card arrays, respecting tombstones from BOTH devices
function mergeCardArrays(localCards, remoteCards, tombstones) {
    // Start with local cards that haven't been deleted
    const merged = localCards.filter(c => !isDeleted(c, tombstones));

    for (const remoteCard of remoteCards) {
        // Skip if this card was deleted on any device
        if (isDeleted(remoteCard, tombstones)) continue;

        // Check for duplicate (same card scanned at same time)
        const existingIdx = merged.findIndex(c =>
            c.cardNumber === remoteCard.cardNumber &&
            Math.abs(new Date(c.timestamp) - new Date(remoteCard.timestamp)) < 10000
        );

        if (existingIdx === -1) {
            // New card — add it
            merged.push(remoteCard);
        } else {
            // Duplicate card — merge tags from BOTH versions so neither device loses edits.
            // Union of local tags + remote tags, deduplicated.
            const localTags  = merged[existingIdx].tags || [];
            const remoteTags = remoteCard.tags || [];
            if (remoteTags.length > 0) {
                merged[existingIdx] = {
                    ...merged[existingIdx],
                    tags: [...new Set([...localTags, ...remoteTags])]
                };
            }
        }
    }
    return merged;
}

function mergeCollections(local, remote, tombstones) {
    const colMap = {};

    for (const col of local) {
        colMap[col.id] = { ...col, cards: [...col.cards] };
    }

    for (const remoteCol of remote) {
        if (!colMap[remoteCol.id]) {
            colMap[remoteCol.id] = { ...remoteCol, cards: [...remoteCol.cards] };
        } else {
            colMap[remoteCol.id].cards = mergeCardArrays(
                colMap[remoteCol.id].cards,
                remoteCol.cards,
                tombstones
            );
        }
    }

    // Apply tombstones to any collection that only exists remotely
    for (const id of Object.keys(colMap)) {
        colMap[id].cards = colMap[id].cards.filter(c => !isDeleted(c, tombstones));
    }

    return Object.values(colMap).map(col => ({
        ...col,
        stats: {
            scanned: col.cards.length,
            free:    col.cards.filter(c => c.scanType === 'free').length,
            aiCalls: col.cards.filter(c => c.scanType === 'ai').length,
            cost:    col.cards.filter(c => c.scanType === 'ai').length * 0.002
        }
    }));
}

// ── Push ──────────────────────────────────────────────────────────────────────
// Read cloud → merge with local (respecting tombstones) → write back
async function pushCollections() {
    if (!window.supabaseClient || !currentUser) return;
    try {
        const { data, error } = await window.supabaseClient
            .from('collections')
            .select('data')
            .eq('user_id', currentUser.id)
            .single();

        const local      = getCollections();
        // Prune old tombstones before syncing to keep localStorage lean
        const rawTombstones = getDeletedCards();
        const tombstones = pruneTombstones(rawTombstones);
        if (tombstones.length !== rawTombstones.length) saveDeletedCards(tombstones);
        let toSave = stripBlobUrls(local);

        if (!error && data?.data) {
            // Merge with cloud, tombstones remove deleted cards from both sides
            const cloudTombstones = data.deletedCards || [];
            const allTombstones = [...new Set([...tombstones, ...cloudTombstones])];
            saveDeletedCards(allTombstones); // adopt cloud deletions locally too
            toSave = stripBlobUrls(mergeCollections(local, data.data, allTombstones));
        }

        const { error: writeError } = await window.supabaseClient
            .from('collections')
            .upsert(
                {
                    user_id:       currentUser.id,
                    data:          toSave,
                    deleted_cards: getDeletedCards(),
                    user_tags:     (typeof getAllTags === 'function') ? getAllTags() : [],
                    updated_at:    new Date().toISOString()
                },
                { onConflict: 'user_id' }
            );

        if (writeError) throw writeError;
        console.log('☁️ Pushed to cloud');
    } catch (err) {
        console.warn('⚠️ Push failed:', err.message);
    }
}

// ── Pull ──────────────────────────────────────────────────────────────────────
async function pullCollections() {
    if (!window.supabaseClient || !currentUser) return;
    try {
        const { data, error } = await window.supabaseClient
            .from('collections')
            .select('data, deleted_cards, user_tags, updated_at')
            .eq('user_id', currentUser.id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                await pushCollections();
            } else {
                throw error;
            }
            return;
        }

        if (!data?.data) return;

        // Merge tombstones from cloud with local tombstones, then prune old ones
        const localTombstones  = getDeletedCards();
        const cloudTombstones  = data.deleted_cards || [];
        const mergedTombstones = [...new Set([...localTombstones, ...cloudTombstones])];
        const allTombstones    = pruneTombstones(mergedTombstones);
        saveDeletedCards(allTombstones);

        // Merge user tags from cloud
        if (typeof saveAllTags === 'function' && data.user_tags?.length) {
            const localTags    = getAllTags();
            const mergedTags   = [...new Set([...localTags, ...data.user_tags])];
            saveAllTags(mergedTags);
        }

        const local            = getCollections();
        const mergedCollections = mergeCollections(local, data.data, allTombstones);

        const localTotal  = local.reduce((s, c) => s + c.cards.length, 0);
        const mergedTotal = mergedCollections.reduce((s, c) => s + c.cards.length, 0);

        localStorage.setItem('collections', JSON.stringify(mergedCollections));

        if (typeof renderCards === 'function') renderCards();
        if (typeof updateStats === 'function') updateStats();

        const diff = mergedTotal - localTotal;
        if (diff > 0) {
            showToast(`Synced +${diff} card${diff !== 1 ? 's' : ''} from cloud`, '☁️');
            console.log(`☁️ Merged +${diff} cards from cloud`);
            await pushCollections(); // write merged + tombstones back
        } else if (diff < 0) {
            showToast(`Removed ${Math.abs(diff)} deleted card${Math.abs(diff) !== 1 ? 's' : ''}`, '🗑️');
            console.log(`☁️ Applied ${Math.abs(diff)} deletions from cloud`);
            await pushCollections();
        } else {
            console.log('☁️ Already up to date');
        }
    } catch (err) {
        console.warn('⚠️ Pull failed:', err.message);
    }
}

// ── Force Sync ────────────────────────────────────────────────────────────────
async function forceSync() {
    if (isGuestMode()) {
        showToast('Sign in to sync across devices', '🔒');
        return;
    }
    if (!window.supabaseClient || !currentUser) {
        showToast('Not connected — try refreshing', '⚠️');
        return;
    }

    const btn = document.getElementById('btnForceSync');
    if (btn) { btn.classList.add('syncing'); btn.textContent = '⏳'; }

    try {
        const { data, error } = await window.supabaseClient
            .from('collections')
            .select('data, deleted_cards, user_tags')
            .eq('user_id', currentUser.id)
            .single();

        const local           = getCollections();
        const localTombstones = getDeletedCards();
        const cloudTombstones = (!error && data?.deleted_cards) ? data.deleted_cards : [];
        const allTombstones   = [...new Set([...localTombstones, ...cloudTombstones])];
        saveDeletedCards(allTombstones);

        // Merge tags
        if (typeof saveAllTags === 'function' && data?.user_tags?.length) {
            saveAllTags([...new Set([...getAllTags(), ...data.user_tags])]);
        }

        const localTotal  = local.reduce((s, c) => s + c.cards.length, 0);
        let merged        = local;
        let cloudTotal    = 0;

        if (!error && data?.data) {
            cloudTotal = data.data.reduce((s, c) => s + c.cards.length, 0);
            merged     = mergeCollections(local, data.data, allTombstones);
        }

        const mergedTotal = merged.reduce((s, c) => s + c.cards.length, 0);

        localStorage.setItem('collections', JSON.stringify(merged));

        const safe = stripBlobUrls(merged);
        await window.supabaseClient
            .from('collections')
            .upsert(
                {
                    user_id:       currentUser.id,
                    data:          safe,
                    deleted_cards: allTombstones,
                    user_tags:     (typeof getAllTags === 'function') ? getAllTags() : [],
                    updated_at:    new Date().toISOString()
                },
                { onConflict: 'user_id' }
            );

        if (typeof renderCards === 'function') renderCards();
        if (typeof updateStats === 'function') updateStats();

        const fromCloud = mergedTotal - localTotal;
        const toCloud   = mergedTotal - cloudTotal;
        if (fromCloud === 0 && toCloud <= 0 && mergedTotal === localTotal) {
            showToast('Already in sync ✓', '✅');
        } else {
            const parts = [];
            if (fromCloud > 0) parts.push(`+${fromCloud} from cloud`);
            if (toCloud   > 0) parts.push(`+${toCloud} to cloud`);
            if (mergedTotal < localTotal) parts.push(`${localTotal - mergedTotal} deletions applied`);
            showToast(`Sync complete — ${parts.join(', ')}`, '✅');
        }

    } catch (err) {
        showToast('Sync failed — check connection', '❌');
        console.error('Force sync error:', err);
    } finally {
        if (btn) { btn.classList.remove('syncing'); btn.textContent = '☁️ Sync'; }
    }
}

// ── Collection Modal ── (rendered by tags.js)
// closeCollectionModal kept here for the backdrop onclick in HTML
function closeCollectionModal() {
    const modal = document.getElementById('collectionModal');
    if (modal) modal.classList.remove('active');
    // Reset title to default in case Price Check modal was open
    const titleEl = document.getElementById('collectionModalTitle');
    if (titleEl && titleEl.textContent.includes('Price Check')) {
        titleEl.textContent = '🎴 My Collection';
    }
}

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeCollectionModal();
});

// Legacy stub — real implementation in tags.js
function _syncRenderCollectionModal_LEGACY() {
    const body  = document.getElementById('collectionModalBody');
    const count = document.getElementById('collectionCount');
    if (!body) return;

    const allCards = [];
    for (const col of getCollections()) {
        for (const card of col.cards) allCards.push(card);
    }
    allCards.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (count) count.textContent = `(${allCards.length} card${allCards.length !== 1 ? 's' : ''})`;

    if (allCards.length === 0) {
        body.innerHTML = `
            <div class="collection-empty">
                <div class="collection-empty-icon">📭</div>
                <h3>No cards yet</h3>
                <p>Scan your first Bo Jackson card to get started!</p>
            </div>`;
        return;
    }

    body.innerHTML = `<div class="collection-grid">${allCards.map(card => {
        const hasImage = card.imageUrl && !card.imageUrl.startsWith('blob:') && card.imageUrl.length > 10;
        return `
            <div class="collection-card">
                ${hasImage
                    ? `<img class="collection-card-image" src="${card.imageUrl}" alt="${escapeHtml(card.cardNumber)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
                    : ''}
                <div class="collection-card-image no-image" style="${hasImage ? 'display:none' : ''}">🎴</div>
                <div class="collection-card-info">
                    <div class="collection-card-name">${escapeHtml(card.hero || 'Unknown')}</div>
                    <div class="collection-card-meta">${escapeHtml(card.cardNumber || '')} · ${escapeHtml(card.set || '')}</div>
                    <span class="collection-card-badge ${card.scanType === 'free' ? 'free' : 'ai'}">
                        ${card.scanType === 'free' ? 'Free OCR' : 'AI'}
                    </span>
                </div>
            </div>`;
    }).join('')}</div>`;
}

console.log('✅ Sync module loaded');
