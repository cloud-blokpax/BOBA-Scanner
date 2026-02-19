// ============================================================
// api/anthropic.js — FIXED
// Changes:
//   - CORS restricted to your actual domain (not wildcard)
//   - Request size limit (5MB max)
//   - Token-based authentication via BOBA_API_SECRET env var
//   - Per-IP in-memory rate limiting (upgrade to Upstash Redis for prod)
//   - Prompt passed through from frontend instead of hardcoded duplicate
//   - Error responses no longer leak stack traces in production
// ============================================================

// In-memory rate limit store: { ip: { count, windowStart } }
// NOTE: This resets between cold starts. For production, swap with Upstash Redis.
const rateLimitStore = new Map();
const RATE_LIMIT_MAX    = 30;   // max requests
const RATE_LIMIT_WINDOW = 60_000; // per 60 seconds

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip) || { count: 0, windowStart: now };

  if (now - entry.windowStart > RATE_LIMIT_WINDOW) {
    // Window expired — reset
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) return false;

  entry.count++;
  rateLimitStore.set(ip, entry);
  return true;
}

export default async function handler(req, res) {
  // ── CORS ────────────────────────────────────────────────────────────────────
  // FIXED: Was '*' — now restricted to your actual domain.
  // Update ALLOWED_ORIGIN in your Vercel env vars for staging/prod separation.
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://boba-scanner.vercel.app';
  const requestOrigin = req.headers.origin || '';

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Token');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Origin check ────────────────────────────────────────────────────────────
  if (requestOrigin && requestOrigin !== allowedOrigin) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────
  // FIXED: Requires a shared secret token so the endpoint isn't open to the world.
  // Set BOBA_API_SECRET in Vercel env vars.
  // The frontend reads it from /api/config (see api/config.js) and sends in X-Api-Token.
  const expectedToken = process.env.BOBA_API_SECRET;
  if (expectedToken) {
    const sentToken = req.headers['x-api-token'];
    if (!sentToken || sentToken !== expectedToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // ── Rate limiting ────────────────────────────────────────────────────────────
  const clientIp =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  // ── Payload size check ───────────────────────────────────────────────────────
  // FIXED: Was no limit — a large image could be sent repeatedly.
  const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB
  const contentLength  = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Payload too large. Max image size is 5MB.' });
  }

  try {
    // FIXED: Accept imageData OR image (frontend sends both keys for compatibility)
    const { imageData, image, prompt } = req.body;
    const finalImageData = imageData || image;

    if (!finalImageData) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    // Extra size check on the decoded field itself
    if (finalImageData.length > MAX_BODY_BYTES * 1.4) { // base64 overhead ~1.37x
      return res.status(413).json({ error: 'Image data too large.' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // FIXED: Use the prompt sent from the frontend if provided.
    // The frontend's prompt is more detailed and accurate (includes card anatomy).
    // Fall back to a sensible default only if none was sent.
    const cardPrompt = prompt || `You are analyzing a Bo Jackson trading card. Extract the following information:

CRITICAL LOCATIONS ON THE CARD:
1. CARD NUMBER — Look at the BOTTOM LEFT corner.
   Format: Letters + dash + numbers (e.g., "BLBF-84", "BF-108")
   This is NOT the power number in the top right.

2. POWER — Look at the TOP RIGHT corner in a circle/badge.
   This is just a number (e.g., "125", "140"). NOT the card number.

3. HERO NAME — Printed prominently near the top, often all caps.

4. SET NAME — Near bottom or on a banner (e.g., "Battle Arena", "Alpha Edition").

5. YEAR — Usually "2023" or "2024".

Return ONLY valid JSON — no markdown, no explanation:
{
  "cardNumber": "BLBF-84",
  "hero": "CHARACTER NAME",
  "year": "2024",
  "set": "Set Name",
  "pose": "Parallel type or Base",
  "weapon": "Weapon name or None",
  "power": "125"
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: finalImageData
              }
            },
            { type: 'text', text: cardPrompt }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', response.status, errorText);
      return res.status(response.status).json({
        error: `Claude API error: ${response.status}`
        // FIXED: Don't expose errorText to client in production — it may contain sensitive details
      });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error('API Handler Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      // FIXED: Only include stack in development
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
}
