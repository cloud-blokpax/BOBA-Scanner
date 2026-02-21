// js/sync.js — Cloud sync for card collections
// Uses Supabase with no RLS (app-level security via Supabase anon key).
// Syncs on page load and after every card change (debounced 2s).

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

// Strip blob URLs — they are device-local and meaningless on other devices
function stripBlobUrls(collections) {
    return collections.map(col => ({
        ...col,
        cards: col.cards.map(card => ({
            ...card,
            imageUrl: (card.imageUrl && !card.imageUrl.startsWith('blob:'))
                ? card.imageUrl
                : ''
        }))
    }));
}

// Merge two collections arrays by card timestamp, keeping all unique cards
function mergeCollections(local, remote) {
    // Build a map of all collections by id
    const colMap = {};

    for (const col of [...local, ...remote]) {
        if (!colMap[col.id]) {
            colMap[col.id] = { ...col, cards: [] };
        }
    }

    // Merge cards within each collection — dedupe by timestamp+cardNumber
    for (const col of local) {
        for (const card of col.cards) {
            colMap[col.id].cards.push(card);
        }
    }
    for (const col of remote) {
        for (const card of col.cards) {
            // Avoid duplicates: skip if same cardNumber+timestamp already present
            const existing = colMap[col.id].cards;
            const isDupe = existing.some(c =>
                c.cardNumber === card.cardNumber &&
                Math.abs(new Date(c.timestamp) - new Date(card.timestamp)) < 5000
            );
            if (!isDupe) existing.push(card);
        }
    }

    // Rebuild stats for each collection
    return Object.values(colMap).map(col => ({
        ...col,
        stats: {
            scanned:  col.cards.length,
            free:     col.cards.filter(c => c.scanType === 'free').length,
            aiCalls:  col.cards.filter(c => c.scanType === 'ai').length,
            cost:     col.cards.filter(c => c.scanType === 'ai').length * 0.002
        }
    }));
}

async function pushCollections() {
    if (!window.supabaseClient || !currentUser) return;
    try {
        const safe = stripBlobUrls(getCollections());
        const { error } = await window.supabaseClient
            .from('collections')
            .upsert(
                { user_id: currentUser.id, data: safe, updated_at: new Date().toISOString() },
                { onConflict: 'user_id' }
            );
        if (error) throw error;
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
                // No cloud data yet — push what we have locally
                await pushCollections();
            } else {
                throw error;
            }
            return;
        }

        if (!data?.data) return;

        const local  = getCollections();
        const remote = data.data;
        const merged = mergeCollections(local, remote);

        const localTotal  = local.reduce((s, c)  => s + c.cards.length, 0);
        const mergedTotal = merged.reduce((s, c) => s + c.cards.length, 0);

        // Always save merged result
        saveCollections(merged);
        renderCards();
        updateStats();

        if (mergedTotal > localTotal) {
            const added = mergedTotal - localTotal;
            showToast(`Synced ${added} new card${added !== 1 ? 's' : ''} from cloud ☁️`, '☁️');
            console.log(`☁️ Merged ${added} new cards from cloud`);
            // Push merged result back so both devices agree
            await pushCollections();
        } else {
            console.log('☁️ Already up to date');
        }
    } catch (err) {
        console.warn('⚠️ Pull failed:', err.message);
    }
}

console.log('✅ Sync module loaded');
