// api/anthropic.js

const rateLimitStore = new Map();
const RATE_LIMIT_MAX    = 30;
const RATE_LIMIT_WINDOW = 60_000;

function checkRateLimit(ip) {
  const now   = Date.now();
  const entry = rateLimitStore.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  rateLimitStore.set(ip, entry);
  return true;
}

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://boba-scanner.vercel.app';
  const requestOrigin = req.headers.origin || '';

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Token');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // Auth token check (only enforced if BOBA_API_SECRET is set)
  const expectedToken = process.env.BOBA_API_SECRET;
  if (expectedToken) {
    const sentToken = req.headers['x-api-token'];
    if (!sentToken || sentToken !== expectedToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // Rate limiting
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  try {
    const { imageData, image, prompt } = req.body;
    const finalImageData = imageData || image;

    if (!finalImageData) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY environment variable is not set in Vercel');
      return res.status(500).json({
        error: 'Server configuration error: ANTHROPIC_API_KEY not set. Add it in Vercel Dashboard → Settings → Environment Variables.'
      });
    }

    const cardPrompt = prompt || `Analyze this Bo Jackson trading card and extract:
1. CARD NUMBER from BOTTOM LEFT corner (format: letters-numbers e.g. "BLBF-84", "BF-108")
2. HERO NAME printed prominently near top
3. YEAR (usually 2023 or 2024)
4. SET NAME (near bottom or on a banner)
5. POWER number from TOP RIGHT corner circle (just a number, NOT the card number)

Return ONLY valid JSON, no markdown:
{"cardNumber":"BLBF-84","hero":"NAME","year":"2024","set":"Set Name","pose":"Base","weapon":"None","power":"125"}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-opus-4-5',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            {
              type:   'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: finalImageData }
            },
            { type: 'text', text: cardPrompt }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', response.status, errorText);
      return res.status(502).json({ error: `AI service error: ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error('API handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
