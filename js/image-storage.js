// js/image-storage.js — Supabase Storage for card images
// Uploads compressed card images to Supabase Storage so they are permanent,
// cross-device, and don't bloat the JSONB collections column.

const IMAGE_BUCKET = 'card-images';

// Upload a base64 JPEG to Supabase Storage.
// Returns the public URL on success, or null on failure.
async function uploadCardImage(base64Jpeg, originalFilename) {
    const user = window.currentUser;
    if (!window.supabaseClient || !user) {
        console.warn('⚠️ uploadCardImage: no supabaseClient or currentUser', { hasClient: !!window.supabaseClient, hasUser: !!user });
        return null;
    }

    try {
        // Convert base64 to Blob
        const byteChars = atob(base64Jpeg);
        const byteNums  = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
            byteNums[i] = byteChars.charCodeAt(i);
        }
        const blob = new Blob([byteNums], { type: 'image/jpeg' });

        // Path: userId/timestamp_filename.jpg
        const safeName = (originalFilename || 'card').replace(/[^a-zA-Z0-9._-]/g, '_');
        const path     = `${user.id}/${Date.now()}_${safeName}.jpg`;

        const { error } = await window.supabaseClient.storage
            .from(IMAGE_BUCKET)
            .upload(path, blob, {
                contentType:  'image/jpeg',
                cacheControl: '31536000', // 1 year cache
                upsert:       false
            });

        if (error) {
            console.warn('⚠️ Image upload failed:', error.message);
            return null;
        }

        // Get public URL
        const { data } = window.supabaseClient.storage
            .from(IMAGE_BUCKET)
            .getPublicUrl(path);

        console.log('☁️ Image uploaded:', data.publicUrl);
        return data.publicUrl;

    } catch (err) {
        console.warn('⚠️ Image upload error:', err.message);
        return null;
    }
}

// Delete a card's image from Supabase Storage when the card is removed.
// Only deletes if the URL belongs to our bucket (not base64 or external).
async function deleteCardImage(imageUrl) {
    if (!window.supabaseClient || !window.currentUser) return;
    if (!imageUrl || imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) return;

    try {
        // Extract path from public URL: .../storage/v1/object/public/card-images/USER/FILE
        const marker = `/object/public/${IMAGE_BUCKET}/`;
        const idx    = imageUrl.indexOf(marker);
        if (idx === -1) return; // Not our bucket

        const path = imageUrl.substring(idx + marker.length);

        const { error } = await window.supabaseClient.storage
            .from(IMAGE_BUCKET)
            .remove([path]);

        if (error) console.warn('⚠️ Image delete failed:', error.message);
        else       console.log('🗑️ Image deleted from storage:', path);

    } catch (err) {
        console.warn('⚠️ Image delete error:', err.message);
    }
}

console.log('✅ Image storage module loaded');
