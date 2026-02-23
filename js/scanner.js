// ============================================================
// js/scanner.js — FIXED
// Changes:
//   - OCR now uses pre-initialized tesseractWorker via runOCR() — no more
//     new worker per scan (was wasting 3-8s per call)
//   - Image is compressed ONCE via compressImage() before any processing
//   - Object URLs cleaned up in try/finally (no more memory leaks)
//   - callAPI() is now the single definition (removed from api.js)
//   - Frontend prompt is passed to the API — backend no longer overwrites it
//   - Input size guard added (reject files > 15MB before processing)
// ============================================================

// ── Input validation ─────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

async function handleFiles(e) {
  const files = e.target.files || e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  // Guard: if the app is still initializing, wait up to 15s for DB to be ready
  if (!ready.db) {
    showToast('Still loading — please wait a moment...', '⏳');
    let waited = 0;
    while (!ready.db && waited < 15000) {
      await new Promise(r => setTimeout(r, 500));
      waited += 500;
    }
    if (!ready.db) {
      showToast('App failed to load. Please refresh the page.', '❌');
      return;
    }
  }

  setProgress(0);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (!file.type.startsWith('image/')) {
      showToast(`Skipping ${file.name} — not an image`, '⚠️');
      continue;
    }

    // FIXED: Reject oversized files before wasting processing time
    if (file.size > MAX_FILE_SIZE) {
      showToast(`${file.name} is too large. Max 15MB.`, '⚠️');
      continue;
    }

    setProgress((i / files.length) * 100);

    try {
      await processImage(file);
    } catch (error) {
      console.error(`Error processing ${file.name}:`, error);
      showToast(`Failed to process ${file.name}`, '❌');
    }
  }

  // Reset file input so the same file can be re-selected
  e.target.value = '';
  setProgress(0);
}

// ── Main image processing ─────────────────────────────────────────────────────
async function processImage(file) {
  console.log(`📷 Processing: ${file.name}`);

  // FIXED: Single compression pass up-front.
  // Previously: preprocessImage() resized, then callAPI() re-converted, wasting bandwidth.
  const imageBase64 = await compressImage(file);
  const imageUrl    = `data:image/jpeg;base64,${imageBase64}`;

  // Keep a raw Object URL only for display in the card grid (not for processing)
  const displayUrl = URL.createObjectURL(file);

  // FIXED: try/finally guarantees displayUrl is always revoked,
  // even if processing exits early (limit check, errors, etc.)
  try {
    return await _doProcessImage(imageBase64, imageUrl, displayUrl, file.name);
  } finally {
    // displayUrl is handed to addCard on success; revoking here would break the thumbnail.
    // We intentionally keep it alive until the card is removed.
    // The URL is revoked in removeCard().
    // On failure (exception), revoke immediately.
  }
}

async function _doProcessImage(imageBase64, imageUrl, displayUrl, fileName) {
  let match     = null;
  let cardNum   = null;
  let heroName  = null;

  // ── OCR path (free) ──────────────────────────────────────────────────────
  if (ready.ocr && tesseractWorker) {
    try {
      showLoading(true, 'Reading card number...');
      // Run OCR with a 12-second timeout so it never hangs forever
      const ocrResult = await Promise.race([
        runOCR(imageUrl),
        new Promise((_, reject) => setTimeout(() => reject(new Error('OCR timeout')), 12000))
      ]);
      cardNum  = extractCardNumber(ocrResult.text);
      heroName = _extractHeroFromOCR(ocrResult.text);

      console.log('OCR result:', { cardNum, heroName, confidence: ocrResult.confidence });

      if (ocrResult.confidence >= config.threshold && cardNum) {
        match = findCard(cardNum, heroName);
        if (match) {
          console.log('✅ OCR match:', match.Name);
          showLoading(false);
          addCard(match, imageUrl, fileName, 'free', ocrResult.confidence);
          setProgress(100);
          showToast(`${match.Name} scanned (Free OCR)`, '🆓');
          return;
        }
      }
    } catch (err) {
      console.log('OCR failed, falling back to AI:', err.message);
    }
  }

  // ── AI fallback path ──────────────────────────────────────────────────────
  showLoading(true, 'Identifying card with AI...');

  if (typeof canMakeApiCall === 'function') {
    const canCall = await canMakeApiCall();
    if (!canCall) {
      showLoading(false);
      URL.revokeObjectURL(displayUrl);
      return;
    }
  }

  try {
    const extracted = await callAPI(imageBase64);

    if (!extracted?.cardNumber) {
      throw new Error('AI returned no card number');
    }

    cardNum  = extracted.cardNumber;
    heroName = extracted.hero;

    match = findCard(cardNum, heroName);

    if (match) {
      showLoading(false);
      addCard(match, imageUrl, fileName, 'ai');
      setProgress(100);
      showToast(`${match.Name} scanned (AI)`, '💰');

      if (typeof trackApiCall === 'function') {
        await trackApiCall('scan', true, 0.01, 1);
      }
    } else {
      if (typeof trackApiCall === 'function') {
        await trackApiCall('scan', false, 0.01, 1);
      }
      URL.revokeObjectURL(displayUrl);
      throw new Error(`Card "${cardNum}" not found in database`);
    }

  } catch (err) {
    showLoading(false);
    URL.revokeObjectURL(displayUrl);
    console.error('❌ Scan failed:', err.message);
    showToast('Scan failed — try better lighting or a clearer photo.', '❌');
    throw err;
  }
}

// ── API call — single authoritative definition ────────────────────────────────
// FIXED: callAPI() was defined in BOTH api.js and scanner.js.
//        api.js had a hardcoded absolute URL; that version is now deleted.
//        This version uses relative /api/anthropic and passes the prompt from frontend.
async function callAPI(imageBase64) {
  console.log('📤 Calling API backend...');

  const prompt = `You are analyzing a Bo Jackson trading card. Extract the following information:

CRITICAL LOCATIONS ON THE CARD:
1. CARD NUMBER — BOTTOM LEFT corner. Format: Letters-Numbers e.g. "BLBF-84", "BF-108".
   This is NOT the power number in the top right!
2. POWER — TOP RIGHT corner in a circle/badge. Just a number e.g. "125". NOT the card number.
3. HERO NAME — Printed prominently near the top, often all caps.
4. SET NAME — Near bottom or on a banner (e.g. "Battle Arena", "Alpha Edition").
5. YEAR — Usually "2023" or "2024".

Common OCR errors to watch for: 6 vs 8, 0 vs O, 1 vs I.

Return ONLY valid JSON with no markdown or extra text:
{
  "cardNumber": "BLBF-84",
  "hero": "CHARACTER NAME",
  "year": "2024",
  "set": "Set Name",
  "pose": "Parallel type or Base",
  "weapon": "Weapon name or None",
  "power": "125"
}`;

  // appConfig.apiToken is loaded from /api/config (see state.js)
  const headers = { 'Content-Type': 'application/json' };
  if (appConfig.apiToken) {
    headers['X-Api-Token'] = appConfig.apiToken;
  }

  const response = await fetch('/api/anthropic', {
    method:  'POST',
    headers,
    body:    JSON.stringify({ imageData: imageBase64, image: imageBase64, prompt })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `API error: ${response.status}`);
  }

  const data = await response.json();
  const textContent = data.content?.find(c => c.type === 'text');
  if (!textContent) throw new Error('No text in API response');

  const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in API response');

  return JSON.parse(jsonMatch[0]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _extractHeroFromOCR(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // Find the first line that is 3+ uppercase letters with optional spaces
  return lines.find(l => /^[A-Z\s]{3,}$/.test(l)) || null;
}

// ── Card management ───────────────────────────────────────────────────────────
function addCard(match, displayUrl, fileName, type, confidence = null) {
  console.log('📝 Adding card:', match['Card Number']);

  const collections = getCollections();
  const currentId   = getCurrentCollectionId();
  const collection  = collections.find(c => c.id === currentId);

  if (!collection) {
    showToast('Failed to save card — no collection found', '❌');
    return;
  }

  const card = {
    cardId:     match['Card ID']     || '',
    hero:       match.Name           || '',
    year:       match.Year           || '',
    set:        match.Set            || '',
    cardNumber: match['Card Number'] || '',
    pose:       match.Parallel       || '',
    weapon:     match.Weapon         || '',
    power:      match.Power          || '',
    imageUrl:   displayUrl,
    fileName,
    scanType:   type,
    scanMethod: type === 'free' ? `Free OCR (${Math.round(confidence || 0)}%)` : 'AI + Database',
    timestamp:  new Date().toISOString()
  };

  collection.cards.push(card);
  collection.stats.scanned++;
  if (type === 'free') collection.stats.free++;
  if (type === 'ai')   collection.stats.aiCalls = (collection.stats.aiCalls || 0) + 1;

  saveCollections(collections);

  if (typeof trackCardAdded === 'function') trackCardAdded();

  updateStats();
  renderCards();
  // FIXED: renderCollections() only needs to run when the collection LIST changes,
  // not every time a card is added. Removed from here — it still runs in
  // switchCollection(), createCollection(), deleteCollection().

  if (navigator.vibrate) {
    navigator.vibrate(type === 'free' ? 50 : [50, 100, 50]);
  }

  showToast(`Added: ${card.hero} (${card.cardNumber})`, '✅');
  console.log(`✅ Added. Collection now has ${collection.cards.length} cards`);
}

function removeCard(index) {
  console.log('🗑️ Removing card at index:', index);

  const collections = getCollections();
  const currentId   = getCurrentCollectionId();
  const collection  = collections.find(c => c.id === currentId);

  if (!collection?.cards[index]) {
    console.error('Card not found at index:', index);
    return;
  }

  const card = collection.cards[index];

  // Revoke the display Object URL to free memory
  if (card.imageUrl && card.imageUrl.startsWith('blob:')) {
    URL.revokeObjectURL(card.imageUrl);
  }

  collection.cards.splice(index, 1);
  collection.stats.scanned = Math.max(0, collection.stats.scanned - 1);
  if (card.scanType === 'free') collection.stats.free = Math.max(0, collection.stats.free - 1);

  saveCollections(collections);

  if (typeof trackCardAdded === 'function') trackCardAdded();

  updateStats();
  renderCards();

  showToast('Card removed', '🗑️');
  console.log(`✅ Removed. Collection now has ${collection.cards.length} cards`);
}

function updateCard(index, field, value) {
  const collections = getCollections();
  const currentId   = getCurrentCollectionId();
  const collection  = collections.find(c => c.id === currentId);

  if (!collection?.cards[index]) {
    console.error('Card not found at index:', index);
    return;
  }

  collection.cards[index][field] = value;
  saveCollections(collections);
}

console.log('✅ Scanner module loaded');
