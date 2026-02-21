// js/sync.js — Cloud sync for card collections
// Stores the full collections array as a single JSON blob in Supabase.
// Called automatically after every card add/remove and on page load.

const SYNC_DEBOUNCE_MS = 2000; // wait 2s after last change before pushing
let   _syncTimer       = null;

// ── Called by app.js on startup ──────────────────────────────────────────────
function setupAutoSync() {
    if (isGuestMode() || !window.supabaseClient) {
        console.log('⏭️ Sync skipped (guest mode or no Supabase)');
        return;
    }
    // Pull remote data on startup, then push on every save
    pullCollections().then(() => {
        console.log('✅ Auto-sync enabled');
    });
}

// ── Push local → Supabase (debounced) ────────────────────────────────────────
function schedulePush() {
    if (isGuestMode() || !window.supabaseClient || !currentUser) return;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(pushCollections, SYNC_DEBOUNCE_MS);
}

async function pushCollections() {
    if (!window.supabaseClient || !currentUser) return;
    try {
        const collections = getCollections();
        // Strip blob: image URLs before saving — they don't survive across devices
        const safe = collections.map(col => ({
            ...col,
            cards: col.cards.map(card => ({
                ...card,
                imageUrl: card.imageUrl?.startsWith('blob:') ? '' : (card.imageUrl || '')
            }))
        }));

        const { error } = await window.supabaseClient
            .from('collections')
            .upsert(
                { user_id: currentUser.id, data: safe, updated_at: new Date().toISOString() },
                { onConflict: 'user_id' }
            );

        if (error) throw error;
        console.log('☁️ Collections pushed to cloud');
    } catch (err) {
        console.warn('⚠️ Push failed:', err.message);
    }
}

// ── Pull Supabase → local ─────────────────────────────────────────────────────
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
                // No row yet — first time this user syncs, push local data up
                await pushCollections();
            } else {
                throw error;
            }
            return;
        }

        if (!data?.data) return;

        // Merge: use whichever version has more cards, to avoid overwriting newer local data
        const local  = getCollections();
        const remote = data.data;

        const localTotal  = local.reduce((s, c)  => s + c.cards.length, 0);
        const remoteTotal = remote.reduce((s, c) => s + c.cards.length, 0);

        if (remoteTotal > localTotal) {
            saveCollections(remote);
            renderCards();
            updateStats();
            console.log(`☁️ Pulled ${remoteTotal} cards from cloud`);
            showToast(`Synced ${remoteTotal} card${remoteTotal !== 1 ? 's' : ''} from cloud`, '☁️');
        } else {
            console.log('☁️ Local is up to date');
        }
    } catch (err) {
        console.warn('⚠️ Pull failed:', err.message);
    }
}

console.log('✅ Sync module loaded');
