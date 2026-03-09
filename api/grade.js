// api/grade.js — AI Condition Grader endpoint
// Uses Claude Vision to estimate PSA/BGS grade for a trading card image.
// Completely server-side prompt — client only sends the image.

const GRADE_PROMPT = `You are an expert trading card grader with 20 years of experience grading cards for PSA and BGS.

Analyze this trading card image carefully and estimate its condition grade.

Evaluate these specific attributes (be honest and precise):
1. CORNERS — Are they sharp, slightly rounded, or clearly rounded/dinged?
2. EDGES — Any chips, nicks, roughness, or fraying?
3. SURFACE — Any scratches, print defects, stains, creases, or loss of gloss?
4. CENTERING — Estimate the left/right and top/bottom border ratios (e.g. 55/45)

Grade scale:
- PSA 10 (Gem Mint): Perfect in every way, centering 55/45 or better
- PSA 9 (Mint): Minimal imperfections, centering 60/40 or better
- PSA 8 (Near Mint-Mint): Light wear on corners/edges, centering 65/35 or better
- PSA 7 (Near Mint): Slight corner/edge wear visible under magnification
- PSA 6 (Excellent-Mint): Minor visible corner/edge wear, light surface issues
- PSA 5 (Excellent): Obvious wear but no major defects
- PSA 4 and below: Significant wear, creases, damage, or heavy print defects

IMPORTANT: Carefully measure the actual centering of THIS specific card by comparing left vs right border widths and top vs bottom border widths. Do NOT default to example values — every card is different. Report the actual ratios you observe.

Return ONLY valid JSON with no markdown. Example format (use YOUR measurements, not these):
{
  "grade": <1-10>,
  "grade_label": "<grade name>",
  "confidence": <0-100>,
  "centering": "<actual L/R ratio> L/R, <actual T/B ratio> T/B",
  "corners": "<describe what you actually see on each corner>",
  "edges": "<describe actual edge condition>",
  "surface": "<describe actual surface condition>",
  "summary": "<your assessment of this specific card>",
  "submit_recommendation": "yes|maybe|no"
}

submit_recommendation values: "yes" (worth grading), "maybe" (borderline), "no" (not cost-effective)`;

const GRADE_PROMPT_DUAL = `You are an expert trading card grader with 20 years of experience grading cards for PSA and BGS.

Two images are provided:
1. The full card image — use for overall assessment, centering, and surface condition.
2. A 2×2 grid showing all 4 corners zoomed in (top-left, top-right in top row; bottom-left, bottom-right in bottom row). Use these zoomed views for precise corner and edge assessment.

Evaluate these specific attributes (be honest and precise):
1. CORNERS — Using the zoomed corner grid, assess each corner: sharp, slightly rounded, or clearly rounded/dinged?
2. EDGES — Using the zoomed corners AND full card, check for chips, nicks, roughness, or fraying along all edges.
3. SURFACE — Any scratches, print defects, stains, creases, or loss of gloss?
4. CENTERING — Estimate the left/right and top/bottom border ratios (e.g. 55/45)

Grade scale:
- PSA 10 (Gem Mint): Perfect in every way, centering 55/45 or better
- PSA 9 (Mint): Minimal imperfections, centering 60/40 or better
- PSA 8 (Near Mint-Mint): Light wear on corners/edges, centering 65/35 or better
- PSA 7 (Near Mint): Slight corner/edge wear visible under magnification
- PSA 6 (Excellent-Mint): Minor visible corner/edge wear, light surface issues
- PSA 5 (Excellent): Obvious wear but no major defects
- PSA 4 and below: Significant wear, creases, damage, or heavy print defects

IMPORTANT: Carefully measure the actual centering of THIS specific card. Do NOT default to example values.

Return ONLY valid JSON with no markdown:
{
  "grade": <1-10>,
  "grade_label": "<grade name>",
  "confidence": <0-100>,
  "centering": "<actual L/R ratio> L/R, <actual T/B ratio> T/B",
  "corners": "<describe what you see on each corner using the zoomed grid>",
  "edges": "<describe actual edge condition>",
  "surface": "<describe actual surface condition>",
  "summary": "<your assessment of this specific card>",
  "submit_recommendation": "yes|maybe|no"
}

submit_recommendation values: "yes" (worth grading), "maybe" (borderline), "no" (not cost-effective)`;

const RATE_LIMIT_MAX    = 20;  // grading is more expensive — lower limit
const RATE_LIMIT_WINDOW = 60;

// In-memory rate limit fallback — used when Supabase is unreachable.
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
  if (_memoryRateLimits.size > 10000) {
    for (const [key, val] of _memoryRateLimits) {
      if (now - val.windowStart > windowMs) _memoryRateLimits.delete(key);
    }
  }
  return entry.count <= RATE_LIMIT_MAX;
}

async function checkRateLimit(identifier) {
  const supabaseUrl    = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return checkMemoryRateLimit(identifier);

  try {
    const now         = Math.floor(Date.now() / 1000);
    const windowStart = now - RATE_LIMIT_WINDOW;

    const countRes = await fetch(
      `${supabaseUrl}/rest/v1/rate_limits?select=id&identifier=eq.${encodeURIComponent('grade:' + identifier)}&created_at=gte.${new Date(windowStart * 1000).toISOString()}`,
      { headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` } }
    );
    if (!countRes.ok) return checkMemoryRateLimit(identifier);

    const rows = await countRes.json();
    if (rows.length >= RATE_LIMIT_MAX) return false;

    await fetch(`${supabaseUrl}/rest/v1/rate_limits`, {
      method: 'POST',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ identifier: 'grade:' + identifier, created_at: new Date().toISOString() })
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
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://boba-scanner.vercel.app';

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Token');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // Token auth — same pattern as ebay endpoints
  const expectedToken = process.env.BOBA_API_SECRET;
  if (expectedToken) {
    const providedToken = req.headers['x-api-token'];
    if (providedToken !== expectedToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
  if (!await checkRateLimit(clientIp)) {
    return res.status(429).json({ error: 'Too many grading requests. Please wait a moment.' });
  }

  try {
    const { imageData, cornerRegionData } = req.body;
    if (!imageData) return res.status(400).json({ error: 'Missing image data' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Server configuration error' });

    // Build content array — dual-image when corner grid is available
    const contentParts = [
      {
        type:   'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: imageData }
      }
    ];

    if (cornerRegionData) {
      contentParts.push({
        type:   'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: cornerRegionData }
      });
    }

    contentParts.push({
      type: 'text',
      text: cornerRegionData ? GRADE_PROMPT_DUAL : GRADE_PROMPT
    });

    const requestBody = JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: contentParts
      }]
    });

    let response;
    const OVERLOAD_RETRIES = [1000, 2000, 3000];
    for (let attempt = 0; attempt <= OVERLOAD_RETRIES.length; attempt++) {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: requestBody
      });
      if (response.status !== 529 || attempt === OVERLOAD_RETRIES.length) break;
      await new Promise(r => setTimeout(r, OVERLOAD_RETRIES[attempt]));
    }

    if (!response.ok) {
      const clientStatus = response.status === 529 ? 503 : 502;
      return res.status(clientStatus).json({ error: `AI service error: ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error('Grade API handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
