// js/image-storage.js
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS APPROACH:
//   The app uses Google OAuth directly — NOT Supabase Auth.
//   The browser Supabase client only has the anon key and will never have a
//   Supabase session, so auth.role() is always "anon".
//   Supabase Storage RLS policies requiring auth.role() = 'authenticated'
//   will ALWAYS fail from the browser — retrying is pointless.
//
//   Solution: upload through /api/upload-image (Vercel serverless function)
//   which uses the SERVICE ROLE key server-side, bypassing RLS entirely.
// ─────────────────────────────────────────────────────────────────────────────

async function uploadCardImage(base64Jpeg, originalFilename) {
    const user = window.currentUser;
    if (!user) {
        console.warn('⚠️ uploadCardImage: no currentUser — skipping');
        return null;
    }

    try {
        const headers = { 'Content-Type': 'application/json' };
        const apiToken = (typeof getApiToken === 'function') ? getApiToken() : null;
        if (apiToken) headers['X-Api-Token'] = apiToken;

        const response = await fetch('/api/upload-image', {
            method:  'POST',
            headers,
            body: JSON.stringify({
                base64:   base64Jpeg,
                filename: originalFilename || 'card',
                userId:   user.id
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            console.warn('⚠️ Image upload failed:', err.error || response.status);
            return null;
        }

        const data = await response.json();
        console.log('☁️ Image uploaded via API:', data.url);
        return data.url || null;

    } catch (err) {
        console.warn('⚠️ Image upload error:', err.message);
        return null;
    }
}

// Best-effort delete — non-critical, no-op if no service role exposed on client
async function deleteCardImage(imageUrl) {
    if (!imageUrl || imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) return;
    // Deletion handled server-side if needed; skip silently on client
}

console.log('✅ Image storage module loaded (API-based)');
