// api/upload-image.js
// Uploads a card image to Supabase Storage using the SERVICE ROLE key.
// The browser client only has the anon key and no Supabase Auth session
// (Google OAuth is used directly), so browser-side uploads always fail RLS.
// This endpoint receives base64, uploads server-side, returns the public URL.

const IMAGE_BUCKET = 'card-images';

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://boba-scanner.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Optional auth check — reuse the same shared secret as the Claude endpoint
  const apiSecret = process.env.BOBA_API_SECRET;
  if (apiSecret) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${apiSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const { base64, filename, userId } = req.body || {};

  if (!base64 || !userId) {
    return res.status(400).json({ error: 'Missing base64 or userId' });
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
