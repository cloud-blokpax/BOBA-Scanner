// api/grade.js — AI Condition Grader endpoint
// Uses Claude Vision to estimate PSA/BGS grade for a trading card image.
// Completely server-side prompt — client only sends the image + optional metadata.

// ── Prompt builder ──────────────────────────────────────────────────────────
// Builds the grading prompt dynamically based on:
//   - whether a zoomed corner grid is provided (dual-image mode)
//   - whether programmatic centering data was computed at scan time

function buildGradePrompt(hasCornersGrid, centeringData) {
  const imageContext = hasCornersGrid
    ? `Two images are provided:
1. The full card image — use for overall assessment and surface condition.
2. A 2×2 grid showing all 4 corners zoomed in (top-left, top-right in top row; bottom-left, bottom-right in bottom row). Use these zoomed views for precise corner and edge assessment.`
    : `One card image is provided. Use it for all assessment.`;

  const cornersInstr = hasCornersGrid
    ? `1. CORNERS — Using the zoomed corner grid, assess EACH corner individually: Is it sharp/crisp, slightly rounded, moderately rounded, or clearly dinged/damaged? Compare corners to each other — are some worse than others?`
    : `1. CORNERS — Assess each corner: sharp, slightly rounded, or clearly rounded/dinged?`;

  const edgesInstr = hasCornersGrid
    ? `2. EDGES — Using the zoomed corners AND full card image, inspect all four edges for chips, nicks, roughness, fraying, or whitening. Note which specific edges show wear.`
    : `2. EDGES — Check for chips, nicks, roughness, or fraying along all edges.`;

  // Centering block — either inject measured values or instruct AI to estimate
  let centeringBlock;
  if (centeringData && centeringData.lr && centeringData.tb) {
    centeringBlock = `4. CENTERING (pre-measured from original scan geometry):
   Left/Right: ${centeringData.lr}
   Top/Bottom: ${centeringData.tb}
   These values were computed from the card's position in the original photo before cropping. Use these exact values in your response. Factor them into the grade using PSA centering thresholds.`;
  } else {
    centeringBlock = `4. CENTERING — This card image has been pre-cropped with artificial uniform padding around the card edges. The image edges do NOT represent the card's actual borders.
   Look for the card's own PRINTED borders within the image. If you can see them, estimate the left/right and top/bottom ratios.
   If the card has full-bleed art with no visible printed borders, respond with "N/A (full-bleed)".
   Do NOT measure from the image edges — those are artificial.`;
  }

  return `You are an expert trading card grader with 20 years of experience grading cards for PSA and BGS.

${imageContext}

NOTE: This card image has been cropped from a larger photo with padding added around the card edges. The outermost border you see is artificial background, not part of the card. Focus your analysis on the card itself.

Evaluate these specific attributes. Be honest, precise, and SPECIFIC to THIS card:
${cornersInstr}
${edgesInstr}
3. SURFACE — Examine carefully for scratches, print defects, stains, creases, loss of gloss, or color issues. Note the specific location and severity of any defects found.
${centeringBlock}

Grade scale (PSA standards):
- PSA 10 (Gem Mint): Perfect in every way, centering within 55/45 or better on both axes
- PSA 9 (Mint): One minor flaw only, centering within 60/40 or better
- PSA 8 (Near Mint-Mint): Very slight wear on one or two corners, centering within 65/35 or better
- PSA 7 (Near Mint): Slight wear on multiple corners/edges visible to naked eye, minor surface issues allowed
- PSA 6 (Excellent-Mint): Visible corner wear, minor edge nicks, light surface wear
- PSA 5 (Excellent): Obvious wear, no major creases or stains
- PSA 4 and below: Significant wear, creases, stains, or damage

IMPORTANT GRADING GUIDELINES:
- Each card is UNIQUE. Describe the SPECIFIC defects (or perfections) you observe on THIS card.
- Do NOT use generic or templated descriptions. If corners are sharp, say so specifically. If one corner is worse than others, identify which one.
- A PSA 7 is NOT a default grade. Carefully assess whether the card is better or worse than Near Mint.
- Be critical but fair. Most raw cards from packs grade between PSA 7-9, but variation within that range matters.

Return ONLY valid JSON with no markdown formatting:
{
  "grade": <1-10>,
  "grade_label": "<grade name>",
  "confidence": <0-100>,
  "centering": "<L/R> L/R, <T/B> T/B",
  "corners": "<describe what you see on EACH corner specifically>",
  "edges": "<describe actual edge condition — which edges show wear?>",
  "surface": "<describe actual surface condition — location of any defects>",
  "summary": "<2-3 sentence assessment of this specific card>",
  "submit_recommendation": "yes|maybe|no"
}

submit_recommendation: "yes" = grade 8+ likely, worth the grading fee; "maybe" = borderline 7-8, could go either way; "no" = grade 6 or below, not cost-effective to submit`;
}

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

  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
  if (!await checkRateLimit(clientIp)) {
    return res.status(429).json({ error: 'Too many grading requests. Please wait a moment.' });
  }

  try {
    const { imageData, cornerRegionData, centeringData } = req.body;
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

    // Build prompt dynamically based on available metadata
    const prompt = buildGradePrompt(!!cornerRegionData, centeringData || null);
    contentParts.push({ type: 'text', text: prompt });

    const requestBody = JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
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
