// ============================================================
// api/config.js — NEW FILE
// Safely delivers environment-driven config to the frontend.
// This avoids hardcoding Supabase URLs/keys directly in JS files
// that ship to every browser.
//
// Vercel env vars to set:
//   SUPABASE_URL        — your Supabase project URL
//   SUPABASE_ANON_KEY   — your Supabase anon/publishable key
//   BOBA_API_SECRET     — shared token for /api/* endpoint auth
//   ALLOWED_ORIGIN      — your production domain
//   GOOGLE_CLIENT_ID    — Google OAuth client ID
// ============================================================

export default function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://boba.cards';

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'public, max-age=300'); // Cache 5 min

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Only expose what the client actually needs.
  // NEVER expose ANTHROPIC_API_KEY here.
  // BOBA_API_SECRET is exposed as apiToken so the client can authenticate
  // to /api/anthropic, /api/ebay-*, /api/grade, and /api/upload-image.
  return res.status(200).json({
    supabaseUrl:    process.env.SUPABASE_URL      || '',
    supabaseKey:    process.env.SUPABASE_ANON_KEY  || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID   || '',
    apiToken:       process.env.BOBA_API_SECRET    || ''
  });
}
