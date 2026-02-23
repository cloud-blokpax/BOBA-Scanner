// js/sync.js — Cloud sync for card collections

const SYNC_DEBOUNCE_MS = 2000;
let _syncTimer = null;

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

// Merge two card arrays — dedupe by cardNumber+timestamp
function mergeCardArrays(localCards, remoteCards) {
    const merged = [...localCards];
    for (const remoteCard of remoteCards) {
        const isDupe = merged.some(c =>
            c.cardNumber === remoteCard.cardNumber &&
            Math.abs(new Date(c.timestamp) - new Date(remoteCard.timestamp)) < 10000
        );
        if (!isDupe) merged.push(remoteCard);
    }
    return merged;
}

function mergeCollections(local, remote) {
    const colMap = {};

    // Seed with local
    for (const col of local) {
        colMap[col.id] = { ...col, cards: [...col.cards] };
    }

    // Merge remote into each collection
    for (const remoteCol of remote) {
        if (!colMap[remoteCol.id]) {
            colMap[remoteCol.id] = { ...remoteCol, cards: [...remoteCol.cards] };
        } else {
            colMap[remoteCol.id].cards = mergeCardArrays(
                colMap[remoteCol.id].cards,
                remoteCol.cards
            );
        }
    }

    // Rebuild stats
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

// Push = read cloud first, merge, then write
// This prevents any device from overwriting another device's cards
async function pushCollections() {
    if (!window.supabaseClient || !currentUser) return;
    try {
        // 1. Read current cloud state
        const { data, error } = await window.supabaseClient
            .from('collections')
            .select('data')
            .eq('user_id', currentUser.id)
            .single();

        const local = stripBlobUrls(getCollections());

        let toSave = local;
        if (!error && data?.data) {
            // 2. Merge cloud into local before writing
            toSave = mergeCollections(local, data.data);
        }

        // 3. Write merged result
        const { error: writeError } = await window.supabaseClient
            .from('collections')
            .upsert(
                { user_id: currentUser.id, data: toSave, updated_at: new Date().toISOString() },
                { onConflict: 'user_id' }
            );

        if (writeError) throw writeError;
        console.log('☁️ Pushed to cloud');
    } catch (err) {
        console.warn('⚠️ Push failed:', err.message);
    }
}

async function pullCollections() {
    if (!window.supabaseClient || !currentUser) return;
    try {
        const { data, error } = await window.supabaseClient
            .from('collections')
            .select('data, updated_at')
            .eq('user_id', currentUser.id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                // No cloud data yet — push local up
                await pushCollections();
            } else {
                throw error;
            }
            return;
        }

        if (!data?.data) return;

        const local  = getCollections();
        const merged = mergeCollections(local, data.data);

        const localTotal  = local.reduce((s, c) => s + c.cards.length, 0);
        const mergedTotal = merged.reduce((s, c) => s + c.cards.length, 0);

        // Save merged without triggering another push (avoid loop)
        try {
            localStorage.setItem('collections', JSON.stringify(merged));
        } catch (e) {
            console.error('Storage full:', e);
        }

        if (typeof renderCards  === 'function') renderCards();
        if (typeof updateStats  === 'function') updateStats();

        if (mergedTotal > localTotal) {
            const added = mergedTotal - localTotal;
            showToast(`Synced ${added} new card${added !== 1 ? 's' : ''} from cloud`, '☁️');
            console.log(`☁️ Merged ${added} new cards from cloud`);
            // Push the merged result back so cloud is complete
            await pushCollections();
        } else {
            console.log('☁️ Already up to date');
        }
    } catch (err) {
        console.warn('⚠️ Pull failed:', err.message);
    }
}

// Manual sync — called by the ☁️ FAB button
async function manualSync() {
    if (isGuestMode()) {
        showToast('Sign in to sync across devices', '🔒');
        return;
    }
    if (!window.supabaseClient || !currentUser) {
        showToast('Not connected — try refreshing', '⚠️');
        return;
    }

    const btn = document.getElementById('fabSync');
    if (btn) btn.classList.add('syncing');
    showToast('Syncing...', '☁️');

    try {
        await pullCollections();
        showToast('Sync complete ✓', '✅');
    } catch (err) {
        showToast('Sync failed — check connection', '❌');
        console.error('Manual sync error:', err);
    } finally {
        if (btn) btn.classList.remove('syncing');
    }
}

console.log('✅ Sync module loaded');
