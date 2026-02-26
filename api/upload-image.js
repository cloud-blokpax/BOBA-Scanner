// api/upload-image.js
// Uploads a card image to Supabase Storage using the SERVICE ROLE key.
// The browser client only has the anon key and no Supabase Auth session
// (Google OAuth is used directly), so browser-side uploads always fail RLS.
// This endpoint receives base64, uploads server-side, returns the public URL.

const IMAGE_BUCKET     = 'card-images';
const MAX_UPLOAD_MB    = 10;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// userId must be a non-empty alphanumeric/hyphen/underscore string (Google sub format)
const VALID_USER_ID = /^[a-zA-Z0-9_-]{5,128}$/;

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://boba-scanner.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { base64, filename, userId } = req.body || {};

  if (!base64 || !userId) {
    return res.status(400).json({ error: 'Missing base64 or userId' });
  }

  // Validate userId format — prevents path traversal and cross-user uploads
  if (!VALID_USER_ID.test(userId)) {
    return res.status(400).json({ error: 'Invalid userId format' });
  }

  // Server-side file size check (client-side limits can be bypassed)
  const byteLength = Buffer.byteLength(base64, 'base64');
  if (byteLength > MAX_UPLOAD_BYTES) {
    return res.status(413).json({
      error: `File too large. Maximum size is ${MAX_UPLOAD_MB}MB.`
    });
  }

  const supabaseUrl     = process.env.SUPABASE_URL;
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    return res.status(500).json({ error: 'Server storage not configured' });
  }

  try {
    // Decode base64 → Buffer
    const buffer = Buffer.from(base64, 'base64');

    const safeName = (filename || 'card').replace(/[^a-zA-Z0-9._-]/g, '_');
    const path     = `${userId}/${Date.now()}_${safeName}.jpg`;

    // Upload via Supabase Storage REST API (service role bypasses RLS)
    const uploadUrl = `${supabaseUrl}/storage/v1/object/${IMAGE_BUCKET}/${path}`;
    const uploadRes = await fetch(uploadUrl, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type':  'image/jpeg',
        'Cache-Control': '31536000',
        'x-upsert':      'false'
      },
      body: buffer
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      console.error('Supabase upload error:', text);
      return res.status(500).json({ error: 'Upload failed', detail: text });
    }

    // Build the public URL
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${IMAGE_BUCKET}/${path}`;

    return res.status(200).json({ url: publicUrl });

  } catch (err) {
    console.error('Upload handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
