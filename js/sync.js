// js/sync.js — Cloud sync for card collections

const SYNC_DEBOUNCE_MS = 2000;
const TOMBSTONE_DELIM  = '|||';   // safe delimiter — colons appear in card numbers
let _syncTimer    = null;
let _syncLock     = false;        // prevents push-during-pull and pull-during-push
let _pushFailures = 0;            // consecutive push failure counter

// ── Tombstones ────────────────────────────────────────────────────────────────
// A tombstone records a deliberate card deletion so the merge won't re-add it.
// Key: cardNumber + "|||" + timestamp (the card's own timestamp, not deletion time)

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
    // Use cardNumber + card timestamp as a stable unique key for each scanned card.
    // The deletion timestamp is appended separately for pruning (see pruneTombstones).
    // Delimiter is ||| because colons can appear in card numbers (e.g. "1999:P1000").
    // Format: "cardNumber|||cardTimestamp|||deletionTimestamp"
    // The deletionTimestamp is used for pruning (NOT the card's scan timestamp),
    // so deleting old cards still keeps the tombstone alive for the full TTL.
    return (card.cardNumber || '') + TOMBSTONE_DELIM + (card.timestamp || '') + TOMBSTONE_DELIM + new Date().toISOString();
}

function isDeleted(card, tombstones) {
    // Match by the card's identity (cardNumber + cardTimestamp), ignoring the
    // deletion timestamp suffix that may or may not be present.
    const cardId = (card.cardNumber || '') + TOMBSTONE_DELIM + (card.timestamp || '');
    for (const key of tombstones) {
        // New 3-part format: "cardNum|||cardTs|||deletionTs" — match first two parts
        // Old 2-part format: "cardNum|||cardTs" — exact match
        if (key === cardId || key.startsWith(cardId + TOMBSTONE_DELIM)) return true;
    }
    // Backward compat: also check old colon-delimited key format
    const oldKey = (card.cardNumber || '') + ':' + (card.timestamp || '');
    return tombstones.includes(oldKey);
}

// Prune tombstones older than 30 days to prevent unbounded localStorage growth.
// New format: "cardNumber|||cardTimestamp|||deletionTimestamp"
// Old format: "cardNumber|||cardTimestamp" or "cardNumber:cardTimestamp"
// IMPORTANT: We prune by DELETION timestamp (when the card was deleted), not
// the card's scan timestamp. This prevents the bug where deleting an old card
// caused the tombstone to be immediately pruned and the card to re-sync.
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function pruneTombstones(list) {
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    return list.filter(key => {
        let tsStr;

        // New 3-part format: use the DELETION timestamp (third part)
        const parts = key.split(TOMBSTONE_DELIM);
        if (parts.length >= 3) {
            tsStr = parts[2]; // deletion timestamp
        } else if (parts.length === 2) {
            // Old 2-part format: only has card timestamp — use it as fallback
            tsStr = parts[1];
        } else {
            // Legacy colon format
            const match = key.match(/^(.+?)(\d{4}-\d{2}-\d{2}T.+)$/);
            if (match) {
                tsStr = match[2];
            } else {
                return true; // can't parse — keep (safe default)
            }
        }
        const ts = new Date(tsStr).getTime();
        return isNaN(ts) || ts > cutoff; // keep if unparseable or recent
    });
}

// Migrate old colon-delimited tombstones to new ||| delimiter
function migrateTombstoneKeys(list) {
    return list.map(key => {
        if (key.includes(TOMBSTONE_DELIM)) return key; // already new format
        // Old format: cardNumber:ISOtimestamp — find the ISO date boundary
        const match = key.match(/^(.+?)(\d{4}-\d{2}-\d{2}T.+)$/);
        if (match) {
            // Remove trailing colon from cardNumber part if present
            const cardNum = match[1].replace(/:$/, '');
            return cardNum + TOMBSTONE_DELIM + match[2];
        }
        return key; // can't parse — keep as-is
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
    _syncTimer = setTimeout(() => {
        // Don't push while a pull or another push is in progress
        if (_syncLock) {
            console.log('☁️ Push deferred — sync in progress');
            schedulePush(); // re-schedule
            return;
        }
        pushCollections();
    }, SYNC_DEBOUNCE_MS);
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
    if (_syncLock) { schedulePush(); return; }
    _syncLock = true;
    try {
        const { data, error } = await window.supabaseClient
            .from('collections')
            .select('data, deleted_cards, user_tags')
            .eq('user_id', currentUser.id)
            .single();

        const local      = getCollections();
        // Prune & migrate old tombstones before syncing
        const rawTombstones = migrateTombstoneKeys(getDeletedCards());
        const tombstones = pruneTombstones(rawTombstones);
        if (tombstones.length !== rawTombstones.length) saveDeletedCards(tombstones);
        let toSave = stripBlobUrls(local);

        if (!error && data?.data) {
            // Merge with cloud, tombstones remove deleted cards from both sides
            const cloudTombstones = migrateTombstoneKeys(data.deleted_cards || []);
            const allTombstones = [...new Set([...tombstones, ...cloudTombstones])];
            saveDeletedCards(allTombstones); // adopt cloud deletions locally too
            toSave = stripBlobUrls(mergeCollections(local, data.data, allTombstones));
        }

        // ── Tag merge on push (symmetric with pull) ──
        // Merge local tags with cloud tags so neither device loses edits
        let mergedTags = (typeof getAllTags === 'function') ? getAllTags() : [];
        if (!error && data?.user_tags?.length) {
            mergedTags = [...new Set([...mergedTags, ...data.user_tags])];
            if (typeof saveAllTags === 'function') saveAllTags(mergedTags);
        }

        const { error: writeError } = await window.supabaseClient
            .from('collections')
            .upsert(
                {
                    user_id:       currentUser.id,
                    data:          toSave,
                    deleted_cards: getDeletedCards(),
                    user_tags:     mergedTags,
                    updated_at:    new Date().toISOString()
                },
                { onConflict: 'user_id' }
            );

        if (writeError) throw writeError;
        _pushFailures = 0;
        console.log('☁️ Pushed to cloud');
    } catch (err) {
        _pushFailures++;
        console.warn(`⚠️ Push failed (attempt ${_pushFailures}):`, err.message);
        if (_pushFailures >= 3 && typeof showToast === 'function') {
            showToast('Sync issues — check connection', '⚠️');
            _pushFailures = 0; // reset so we don't spam toasts
        }
    } finally {
        _syncLock = false;
    }
}

// ── Pull ──────────────────────────────────────────────────────────────────────
async function pullCollections() {
    if (!window.supabaseClient || !currentUser) return;
    if (_syncLock) { console.log('☁️ Pull deferred — sync in progress'); return; }
    _syncLock = true;
    try {
        const { data, error } = await window.supabaseClient
            .from('collections')
            .select('data, deleted_cards, user_tags, updated_at')
            .eq('user_id', currentUser.id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                _syncLock = false; // release before push acquires it
                await pushCollections();
            } else {
                throw error;
            }
            return;
        }

        if (!data?.data) return;

        // Merge & migrate tombstones from cloud with local, then prune old ones
        const localTombstones  = migrateTombstoneKeys(getDeletedCards());
        const cloudTombstones  = migrateTombstoneKeys(data.deleted_cards || []);
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

        // Use saveCollections so the in-memory cache stays in sync with localStorage.
        // Previously this wrote directly to localStorage, leaving _collectionsCache stale.
        // When the cache was later invalidated (e.g. storage event from another tab),
        // getCollections() would re-read from localStorage — but any cards added between
        // the pull and the invalidation lived only in the stale cache and were lost.
        saveCollections(mergedCollections);

        if (typeof renderCards === 'function') renderCards();
        if (typeof updateStats === 'function') updateStats();

        const diff = mergedTotal - localTotal;
        if (diff > 0) {
            showToast(`Synced +${diff} card${diff !== 1 ? 's' : ''} from cloud`, '☁️');
            console.log(`☁️ Merged +${diff} cards from cloud`);
            _syncLock = false; // release before push acquires it
            await pushCollections(); // write merged + tombstones back
        } else if (diff < 0) {
            showToast(`Removed ${Math.abs(diff)} deleted card${Math.abs(diff) !== 1 ? 's' : ''}`, '🗑️');
            console.log(`☁️ Applied ${Math.abs(diff)} deletions from cloud`);
            _syncLock = false;
            await pushCollections();
        } else {
            console.log('☁️ Already up to date');
        }
    } catch (err) {
        console.warn('⚠️ Pull failed:', err.message);
    } finally {
        _syncLock = false;
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

    _syncLock = true;
    try {
        const { data, error } = await window.supabaseClient
            .from('collections')
            .select('data, deleted_cards, user_tags')
            .eq('user_id', currentUser.id)
            .single();

        const local           = getCollections();
        const localTombstones = migrateTombstoneKeys(getDeletedCards());
        const cloudTombstones = migrateTombstoneKeys((!error && data?.deleted_cards) ? data.deleted_cards : []);
        const allTombstones   = pruneTombstones([...new Set([...localTombstones, ...cloudTombstones])]);
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

        saveCollections(merged);

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
        _syncLock = false;
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

window.forceSync = forceSync;

console.log('✅ Sync module loaded');
