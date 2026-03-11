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
1. The full card image — use for overall assessment, surface condition, and centering.
2. A 2×2 grid showing all 4 corners zoomed in (top-left, top-right in top row; bottom-left, bottom-right in bottom row). Use these zoomed views for precise corner and edge assessment.`
    : `One card image is provided. Use it for all assessment.`;

  const cornersInstr = hasCornersGrid
    ? `1. CORNERS — Using the zoomed corner grid, assess EACH corner individually:
   - Top-left: sharp/crisp, slightly rounded, moderately rounded, or clearly dinged/damaged?
   - Top-right: same assessment
   - Bottom-left: same assessment
   - Bottom-right: same assessment
   Compare corners — are some worse than others? Note any whitening (white spots where surface layer wears away on colored borders), fuzzing/fraying (fibrous appearance), rounding (loss of 90° angle), dings, bends, or chipping.`
    : `1. CORNERS — Assess each corner (top-left, top-right, bottom-left, bottom-right): sharp/crisp, slightly rounded, or clearly rounded/dinged? Note any whitening, fraying, or damage and which corners are affected.`;

  const edgesInstr = hasCornersGrid
    ? `2. EDGES — Using the zoomed corners AND full card image, inspect all four edges:
   - Which specific edges (top, bottom, left, right) show wear?
   - Defect types: whitening/chipping (surface layer loss revealing white cardstock), nicks (small indentations), roughness, fraying (fiber separation), peeling
   - IMPORTANT: For dark-bordered or colored-bordered cards, even tiny white chips on edges are dramatically visible and significantly lower the grade. Weight edge defects more heavily on such cards.`
    : `2. EDGES — Check all four edges for chips, nicks, roughness, fraying, or whitening. Note which edges show wear. For dark/colored borders, any whitening on edges is especially grade-impacting.`;

  // Centering block — either inject measured values or instruct AI to estimate
  let centeringBlock;
  if (centeringData && centeringData.lr && centeringData.tb) {
    centeringBlock = `4. CENTERING (pre-measured from original scan geometry):
   Front Left/Right: ${centeringData.lr}
   Front Top/Bottom: ${centeringData.tb}
   These values were computed from the card's position in the original photo before cropping. Use these exact values for front centering in your response and factor them into the grade using PSA centering thresholds.
   For back centering: visually inspect if the card back is visible in the image; otherwise note "not assessed".`;
  } else {
    centeringBlock = `4. CENTERING — This card image has been pre-cropped with artificial uniform padding. Do NOT measure from the image edges — those are artificial.
   Look for the card's own PRINTED borders within the image:
   - FRONT centering: estimate left/right and top/bottom border ratios from the card's own printed border widths (e.g. "52/48 L/R, 54/46 T/B"). The larger number goes first.
   - BACK centering: if the card back is visible assess it separately; otherwise note "not assessed".
   - Full-bleed art (no visible printed borders): respond "50/50 L/R, 50/50 T/B" and note centering cannot be assessed due to full-bleed design.`;
  }

  return `You are an expert trading card grader with 20 years of experience grading cards for PSA and BGS.

${imageContext}

NOTE: This card image has been cropped from a larger photo with padding added around the card edges. The outermost border you see is artificial background, not part of the card. Focus your analysis on the card itself.

Evaluate these specific attributes. Be honest, precise, and SPECIFIC to THIS card:
${cornersInstr}
${edgesInstr}
3. SURFACE — Examine carefully for:
   - Scratches: hairline (visible only under angled light), moderate (visible without magnification), heavy (penetrating gloss layer). Note location and length.
   - CRITICAL DISTINCTION — Print lines vs. scratches: PRINT LINES are factory defects — fine, straight, parallel lines from manufacturing rollers, uniform in one direction; they are graded more leniently. SCRATCHES from handling are irregular, often curved, varied in direction; they are graded more harshly. Identify which you observe.
   - Creases: even a single light crease typically caps a card at PSA 4–6. Note crease length (under/over 1 inch) and depth (visible ridge or breaking through layers).
   - Staining: wax, water, or gum stains — note location (front vs. back) and severity. Back staining is more tolerated than front staining.
   - Gloss: full original gloss? Partial loss? Complete absence?
   - Print defects: color dots, registration issues, ink spots.
${centeringBlock}

PSA GRADE SCALE — use these EXACT thresholds (front centering / back centering):
PSA 10  Gem Mint:       Perfect card. Four sharp corners, full gloss, no staining. Front ≤55/45, back ≤75/25.
PSA 9   Mint:           ONE minor flaw only (tiny wax stain reverse, slight printing imperfection, or slightly off-white borders). Front ≤60/40, back ≤90/10.
PSA 8.5 (NM-MT+):      High-end NM-MT — clearly exceeds PSA 8 minimums. Front ≤62/38, back ≤90/10.
PSA 8   Near Mint-Mint: Slightest fraying on 1–2 corners (sharp at first glance, shows softness under magnification). Front ≤65/35, back ≤90/10.
PSA 7.5 (NM+):         High-end NM — clearly exceeds PSA 7 minimums. Front ≤67/33, back ≤90/10.
PSA 7   Near Mint:     Slight fraying on 2–3 corners visible to naked eye. Minor surface wear. Front ≤70/30, back ≤90/10.
PSA 6.5 (EX-MT+):      High-end EX-MT. Front ≤75/25, back ≤90/10.
PSA 6   Excellent-Mint: Visible graduated corner fraying, very slight edge notching, light surface scratch only on close inspection. Front ≤80/20, back ≤90/10.
PSA 5.5 (EX+):         High-end EX. Front ≤82/18, back ≤90/10.
PSA 5   Excellent:     Visible corner rounding beginning. Minor edge chipping. Several light scratches visible. Front ≤85/15, back ≤90/10.
PSA 4.5 (VG-EX+):      High-end VG-EX.
PSA 4   VG-EX:         Slightly rounded corners. Light scuffing/scratches. Possible light crease visible. Some gloss retained. Front ≤85/15.
PSA 3.5 (VG+):         High-end VG.
PSA 3   Very Good:     Obvious corner rounding. Possible crease visible. Much gloss lost. Borders may be yellowed. Centering ≤90/10.
PSA 2   Good:          Accelerated rounding. Scratching, scuffing, staining, chipping. Several creases possible. Gloss may be absent.
PSA 1.5 Fair:          Extreme wear. Heavy creases, advanced scuffing/scratching/pitting/staining. Card fully intact (no missing pieces).
PSA 1   Poor:          Eye appeal nearly vanished. May be missing small pieces. Extreme discoloration or creases breaking through cardboard.

HALF GRADES (.5): Assign a half grade ONLY when:
- The card clearly exceeds the base grade minimum on centering by 5–10% AND has no flaws pushing it to the next full grade
- Only ~2–5% of cards within a grade earn the half-point bump
- NEVER assign PSA 9.5 — PSA does not have this grade

PSA QUALIFIERS — assign when one attribute is significantly worse than others (card otherwise meets higher grade):
- "OC" (Off Center): centering clearly worse than minimum for the grade
- "MC" (Miscut): atypical cut or partial portion of another card visible
- "MK" (Marks): writing, ink, pencil marks or impressions on the card
- "ST" (Staining): staining clearly below minimum for the grade
- "PD" (Print Defect): significant printing defect
- "OF" (Out of Focus): focus/registration clearly below minimum
A qualified card has ~2 full grades lower market value (e.g. PSA 9 OC ≈ PSA 7 market value). Only apply when genuinely warranted.

GRADING GUIDELINES:
- Apply "weakest criterion limits the grade" — the worst single attribute determines the final grade.
- Describe SPECIFIC defects observed (which corner, which edge, severity, location). No generic descriptions.
- A PSA 7 is NOT a default grade. Most raw pack-fresh cards grade 7–9; assess carefully where this card falls.
- Factor BOTH front and back centering — a card with perfect front but severe back miscentering cannot be PSA 10.

Return ONLY valid JSON with no markdown formatting:
{
  "grade": <1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, or 10>,
  "grade_label": "<grade name, e.g. 'Near Mint-Mint' or 'Near Mint-Mint+' for half grades>",
  "qualifier": <null, or one of "OC", "MC", "MK", "ST", "PD", "OF">,
  "confidence": <0-100>,
  "front_centering": "<L/R> L/R, <T/B> T/B",
  "back_centering": "<L/R> L/R, <T/B> T/B or 'not assessed'",
  "corners": "<describe each corner: TL, TR, BL, BR — specific wear observed>",
  "edges": "<describe edge condition — which edges show wear and what defect type>",
  "surface": "<describe surface — note scratches vs. print lines, crease depth/length, gloss level>",
  "summary": "<2-3 sentence assessment of this specific card>",
  "submit_recommendation": "yes|maybe|no"
}

submit_recommendation rules:
- "yes": grade 8+ unqualified, or 9+ with minor qualifier — worth the grading fee
- "maybe": grade 7–8 unqualified, or 8–9 with qualifier — borderline, could go either way
- "no": grade 6 or below, or any qualified card under 8, or qualifier significantly impacts value`;
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
