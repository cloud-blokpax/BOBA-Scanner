// api/anthropic.js

// Prompts are defined server-side to prevent prompt-injection abuse.
// Keyed by collectionType — the client sends which adapter is active.
// Unknown collection types fall back to the 'boba' prompts.
const PROMPTS = {
  boba: {
    single: `You are analyzing a Bo Jackson trading card. Extract the following information:

CRITICAL LOCATIONS ON THE CARD:
1. CARD NUMBER — BOTTOM LEFT corner. Format: Letters-Numbers e.g. "BLBF-84", "BF-108", "EDLCA-22", "GLBF-12".
   This is NOT the power number in the top right!
2. POWER — TOP RIGHT corner in a circle/badge. Just a number e.g. "125". NOT the card number.
3. HERO NAME — Printed prominently near the top, often all caps.
4. SET NAME — Near bottom or on a banner (e.g. "Battle Arena", "Alpha Edition").
5. YEAR — Usually "2023" or "2024".

Common OCR errors to watch for: 6 vs 8, 0 vs O, 1 vs I, B vs 8, S vs 5.

Also include a confidence score (0-100) for how certain you are about the card number.

Return ONLY valid JSON with no markdown or extra text:
{
  "cardNumber": "BLBF-84",
  "hero": "CHARACTER NAME",
  "year": "2024",
  "set": "Set Name",
  "pose": "Parallel type or Base",
  "weapon": "Weapon name or None",
  "power": "125",
  "confidence": 90
}`,
    dual: `You are analyzing a Bo Jackson trading card. Two images are provided:
1. The full card image — use this for hero name, set, power, pose, weapon, and year.
2. A zoomed, contrast-enhanced crop of the BOTTOM-LEFT card number region — use this for the card number.

CARD NUMBER FORMAT: Letters-Numbers, e.g. "BLBF-84", "BF-108", "EDLCA-22", "GLBF-12".
The card number is NOT the power number in the top right!

Common OCR errors to watch for: 6 vs 8, 0 vs O, 1 vs I, B vs 8, S vs 5.

Return ONLY valid JSON with no markdown or extra text:
{
  "cardNumber": "BLBF-84",
  "hero": "CHARACTER NAME",
  "year": "2024",
  "set": "Set Name",
  "pose": "Parallel type or Base",
  "weapon": "Weapon name or None",
  "power": "125",
  "confidence": 90
}`,
  },
  // Future collections add their prompts here:
  // pokemon: { single: '...', dual: '...' },
};

const RATE_LIMIT_MAX    = 30;
const RATE_LIMIT_WINDOW = 60; // seconds
const MAX_BODY_BYTES    = 10 * 1024 * 1024; // 10 MB — rejects oversized payloads early

// In-memory rate limit fallback — used when Supabase is unreachable.
// Each Vercel instance tracks its own counts; this is a best-effort guard,
// not a replacement for Supabase-backed limits.
const _memoryRateLimits = new Map();

function checkMemoryRateLimit(identifier) {
  const now = Date.now();
  const windowMs = RATE_LIMIT_WINDOW * 1000;
  let entry = _memoryRateLimits.get(identifier);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { windowStart: now, count: 0 };
    _memoryRateLimits.set(identifier, entry);
  }
  entry.count++;
  // Evict stale entries periodically (keep map bounded)
  if (_memoryRateLimits.size > 10000) {
    for (const [key, val] of _memoryRateLimits) {
      if (now - val.windowStart > windowMs) _memoryRateLimits.delete(key);
    }
  }
  return entry.count <= RATE_LIMIT_MAX;
}

// Supabase-backed rate limiting — works across all serverless instances.
// Falls back to in-memory limiter if Supabase is unavailable.
async function checkRateLimit(identifier) {
  const supabaseUrl     = process.env.SUPABASE_URL;
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return checkMemoryRateLimit(identifier);

  try {
    const now        = Math.floor(Date.now() / 1000);
    const windowStart = now - RATE_LIMIT_WINDOW;

    // Count requests in the current window
    const countRes = await fetch(
      `${supabaseUrl}/rest/v1/rate_limits?select=id&identifier=eq.${encodeURIComponent(identifier)}&created_at=gte.${new Date(windowStart * 1000).toISOString()}`,
      { headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` } }
    );
    if (!countRes.ok) return checkMemoryRateLimit(identifier);

    const rows = await countRes.json();
    if (rows.length >= RATE_LIMIT_MAX) return false;

    // Record this request
    await fetch(`${supabaseUrl}/rest/v1/rate_limits`, {
      method: 'POST',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ identifier, created_at: new Date().toISOString() })
    });

    // Opportunistic cleanup — ~1% of requests prune old rows
    if (Math.random() < 0.01) {
      fetch(`${supabaseUrl}/rest/v1/rate_limits?created_at=lt.${new Date(windowStart * 1000).toISOString()}`, {
        method: 'DELETE',
        headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` }
      }).catch(() => {});
    }

    return true;
  } catch {
    return checkMemoryRateLimit(identifier);
  }
}

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://boba.cards';

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Token');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // Token auth — required on all environments
  const expectedToken = process.env.BOBA_API_SECRET;
  if (!expectedToken) {
    console.error('BOBA_API_SECRET not configured — rejecting request');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  const providedToken = req.headers['x-api-token'];
  if (providedToken !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Rate limiting
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
  if (!await checkRateLimit(clientIp)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  try {
    const { imageData, image, numberRegionData, collectionType } = req.body;
    const finalImageData = imageData || image;

    if (!finalImageData) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    // Reject oversized payloads early — prevents memory exhaustion
    if (finalImageData.length > MAX_BODY_BYTES) {
      return res.status(413).json({ error: 'Image too large. Maximum 10MB.' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY environment variable is not set in Vercel');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Build content array — dual-image when number region is available
    const contentParts = [
      {
        type:   'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: finalImageData }
      }
    ];

    if (numberRegionData) {
      contentParts.push({
        type:   'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: numberRegionData }
      });
    }

    // Select prompt based on collection type (defaults to boba)
    const prompts = PROMPTS[collectionType] || PROMPTS.boba;
    contentParts.push({
      type: 'text',
      text: numberRegionData ? prompts.dual : prompts.single
    });

    const requestBody = JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: contentParts
      }]
    });

    const anthropicHeaders = {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01'
    };

    // Retry up to 3 times on 529 (API overloaded) with short back-off.
    // Vercel Pro functions have a 60 s limit; total wait here is ≤ 6 s.
    // AbortController enforces a 20 s per-request timeout to prevent hanging.
    let response;
    const OVERLOAD_RETRIES = [1000, 2000, 3000];
    const REQUEST_TIMEOUT_MS = 20000;
    for (let attempt = 0; attempt <= OVERLOAD_RETRIES.length; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: anthropicHeaders,
          body: requestBody,
          signal: controller.signal
        });
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        if (fetchErr.name === 'AbortError') {
          console.error(`Anthropic API timed out after ${REQUEST_TIMEOUT_MS}ms (attempt ${attempt + 1})`);
          if (attempt === OVERLOAD_RETRIES.length) {
            return res.status(504).json({ error: 'AI service timed out. Please try again.' });
          }
          await new Promise(r => setTimeout(r, OVERLOAD_RETRIES[attempt]));
          continue;
        }
        throw fetchErr;
      }
      clearTimeout(timeoutId);
      if (response.status !== 529 || attempt === OVERLOAD_RETRIES.length) break;
      await new Promise(r => setTimeout(r, OVERLOAD_RETRIES[attempt]));
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', response.status, errorText);
      // 529 = overloaded; surface as 503 so the client knows to retry later
      const clientStatus = response.status === 529 ? 503 : 502;
      return res.status(clientStatus).json({ error: `AI service error: ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error('API handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
