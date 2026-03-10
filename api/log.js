// api/log.js — Error tracking endpoint
// Receives batched client-side errors via sendBeacon and stores in Supabase.

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://boba.cards';

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  try {
    const errors = req.body;
    if (!Array.isArray(errors) || errors.length === 0) {
      return res.status(400).json({ error: 'Expected array of error objects' });
    }

    // Rate limit: max 50 errors per request
    const batch = errors.slice(0, 50);

    const supabaseUrl    = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceRoleKey) {
      // Store in Supabase error_logs table
      const rows = batch.map(err => ({
        type:       (err.type || 'error').slice(0, 50),
        message:    (err.message || '').slice(0, 1000),
        file:       (err.file || '').slice(0, 500),
        line:       err.line || 0,
        col:        err.col || 0,
        stack:      (err.stack || '').slice(0, 2000),
        url:        (err.url || '').slice(0, 500),
        user_agent: (err.ua || '').slice(0, 300),
        session_id: (err.session || '').slice(0, 20),
        created_at: new Date().toISOString()
      }));

      await fetch(`${supabaseUrl}/rest/v1/error_logs`, {
        method: 'POST',
        headers: {
          'apikey':        serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal'
        },
        body: JSON.stringify(rows)
      });
    } else {
      // Fallback: log to console (Vercel captures stdout)
      for (const err of batch) {
        console.error(`[CLIENT ${err.type}] ${err.message} @ ${err.file}:${err.line}`);
      }
    }

    return res.status(204).end();
  } catch (error) {
    console.error('Error log handler failed:', error);
    return res.status(500).end();
  }
}
