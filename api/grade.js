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

const RATE_LIMIT_MAX    = 20;  // grading is more expensive — lower limit
const RATE_LIMIT_WINDOW = 60;

async function checkRateLimit(identifier) {
  const supabaseUrl    = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return true;

  try {
    const now         = Math.floor(Date.now() / 1000);
    const windowStart = now - RATE_LIMIT_WINDOW;

    const countRes = await fetch(
      `${supabaseUrl}/rest/v1/rate_limits?select=id&identifier=eq.${encodeURIComponent('grade:' + identifier)}&created_at=gte.${new Date(windowStart * 1000).toISOString()}`,
      { headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` } }
    );
    if (!countRes.ok) return true;

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
    return true;
  } catch {
    return true;
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
    const { imageData } = req.body;
    if (!imageData) return res.status(400).json({ error: 'Missing image data' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Server configuration error' });

    // Use Sonnet for grading — better visual analysis than Haiku
    const requestBody = JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageData }
          },
          { type: 'text', text: GRADE_PROMPT }
        ]
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
