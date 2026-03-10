// ============================================================
// js/database.js — FIXED
// Changes:
//   - Pre-computed card number index built at load time (O(1) prefix lookup)
//   - Fuzzy matching only runs on pre-filtered candidates (not all 17k cards)
//   - Levenshtein performance is now acceptable even on large databases
// ============================================================

// ── IndexedDB cache for card database ─────────────────────────────────────────
// On first load: fetch card-database.json, store in IDB.
// On subsequent loads: read from IDB, only re-fetch if version.json is newer.
const IDB_NAME    = 'boba-scanner';
const IDB_STORE   = 'card-db';
const IDB_VERSION = 1;

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function idbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

async function loadDatabase() {
  setStatus('db', 'loading');
  try {
    let idb = null;
    let remoteVersion = null;
    try { idb = await openIDB(); } catch (e) { console.warn('IndexedDB unavailable, fetching from network:', e.message); }

    if (idb) {
      // Check current remote version
      try {
        const vRes = await fetch('./version.json', { cache: 'no-store' });
        if (vRes.ok) {
          const vData = await vRes.json();
          remoteVersion = vData.version || vData.timestamp || null;
        }
      } catch (e) { console.warn('version.json check failed, skipping cache:', e.message); }

      const cachedVersion = await idbGet(idb, 'version');
      const cachedData    = await idbGet(idb, 'data');

      if (cachedData && cachedVersion && cachedVersion === remoteVersion) {
        // Cache hit — use stored data
        database = cachedData;
        buildCardIndex();
        ready.db = true;
        setStatus('db', 'ready');
        console.log(`✅ DB: ${database.length} cards loaded from IndexedDB cache`);
        return;
      }
    }

    // Cache miss or IDB unavailable — fetch from network
    const res = await fetch('./card-database.json');
    if (!res.ok) throw new Error('DB not found');
    database = await res.json();

    if (idb) {
      // Store in IDB for next visit — reuse remoteVersion from the cache check
      // above instead of fetching version.json a second time.
      try {
        await idbPut(idb, 'data', database);
        if (remoteVersion) await idbPut(idb, 'version', remoteVersion);
      } catch (e) { console.warn('IDB write failed:', e); }
    }

    // FIXED: Build a lookup index at load time so searches are fast.
    buildCardIndex();

    ready.db = true;
    setStatus('db', 'ready');
    console.log(`✅ DB: ${database.length} cards loaded, index built`);
  } catch (err) {
    console.error('❌ DB failed:', err);
    setStatus('db', 'error');
  }
}

// ── Card index ────────────────────────────────────────────────────────────────
// cardIndex: Map<normalizedCardNumber, Card[]>
// prefixIndex: Map<2-char-prefix, Card[]>  — for fast fuzzy pre-filtering
let cardIndex  = new Map();
let prefixIndex = new Map();

function buildCardIndex() {
  cardIndex.clear();
  prefixIndex.clear();

  for (const card of database) {
    const num = normalizeCardNum(card['Card Number'] || '');
    if (!num) continue;

    // Exact lookup index
    if (!cardIndex.has(num)) cardIndex.set(num, []);
    cardIndex.get(num).push(card);

    // Prefix index (first 2 chars) for fuzzy pre-filtering
    const prefix = num.slice(0, 2);
    if (!prefixIndex.has(prefix)) prefixIndex.set(prefix, []);
    prefixIndex.get(prefix).push(card);
  }
}

function normalizeCardNum(val) {
  return String(val).toUpperCase().trim();
}

// ── Levenshtein (unchanged algorithm, but now only called on small candidate sets) ──
function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: n + 1 }, (_, i) => i);

  for (let j = 1; j <= m; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= n; i++) {
      const temp = dp[i];
      dp[i] = a[j - 1] === b[i - 1]
        ? prev
        : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

// FIXED: Pre-filter by prefix before running expensive Levenshtein.
// Instead of O(17000 × len²), we now do O(~50 × len²) in the typical case.
function findSimilarCardNumbers(searchNumber, maxDistance = 2) {
  const normalized = normalizeCardNum(searchNumber);
  const prefix = normalized.slice(0, 2);

  // Gather candidates: same prefix + adjacent prefixes to tolerate prefix OCR errors
  const candidateSet = new Set();
  for (const [key, cards] of prefixIndex) {
    if (levenshteinDistance(key, prefix) <= 1) {
      for (const c of cards) candidateSet.add(c);
    }
  }

  const results = [];
  for (const card of candidateSet) {
    const cardNum  = normalizeCardNum(card['Card Number'] || '');
    const distance = levenshteinDistance(normalized, cardNum);
    if (distance <= maxDistance) {
      results.push({
        card,
        cardNumber: cardNum,
        distance,
        score: 1 - (distance / Math.max(normalized.length, cardNum.length))
      });
    }
  }

  results.sort((a, b) => a.distance - b.distance);
  return results;
}

// ── Main findCard ─────────────────────────────────────────────────────────────
function findCard(cardNumber, heroName = null, visualTheme = '') {
  if (!ready.db || !cardNumber) {
    console.error('findCard called but:', { dbReady: ready.db, cardNumber });
    return null;
  }

  const normalizedCardNum = normalizeCardNum(cardNumber);
  const normalizedHero    = heroName ? normalizeCardNum(heroName) : null;
  const theme             = (visualTheme || '').toLowerCase();

  console.log('🔍 Searching for card:', { cardNumber: normalizedCardNum, hero: normalizedHero, visualTheme: theme });

  // STEP 1: Exact match via index (O(1))
  const exactMatches = cardIndex.get(normalizedCardNum) || [];
  console.log(`Found ${exactMatches.length} exact match(es) for "${normalizedCardNum}"`);

  // STEP 2: Fuzzy match if no exact result
  if (exactMatches.length === 0) {
    console.log('⚠️ No exact match, trying fuzzy...');
    const similar = findSimilarCardNumbers(normalizedCardNum, 2);

    if (similar.length === 0) {
      console.log('❌ No cards found (exact or fuzzy)');
      return null;
    }

    console.log(`🔍 ${similar.length} fuzzy candidate(s):`,
      similar.slice(0, 5).map(s => `${s.cardNumber} (d=${s.distance})`)
    );

    // Hero-informed fuzzy match
    if (normalizedHero) {
      const heroMatch = similar.find(s => {
        const dbHero = normalizeCardNum(s.card.Name || '');
        return dbHero === normalizedHero ||
               dbHero.includes(normalizedHero) ||
               normalizedHero.includes(dbHero);
      });
      if (heroMatch) {
        showToast(`OCR corrected: ${normalizedCardNum} → ${heroMatch.cardNumber}`, '🔧');
        return heroMatch.card;
      }
    }

    // Auto-correct single unambiguous close match
    if (similar.length === 1 && similar[0].distance <= 1) {
      showToast(`OCR corrected: ${normalizedCardNum} → ${similar[0].cardNumber}`, '🔧');
      return similar[0].card;
    }

    console.log('⚠️ Multiple fuzzy matches — need hero name to disambiguate');
    return null;
  }

  // STEP 3: Single exact match
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  // STEP 4: Multiple exact matches — score candidates using hero name + visual theme
  // Visual theme maps: fire/red/orange/flame → "grill" type cards
  //                    ice/blue/frost/snow   → "chill" type cards
  function visualThemeScore(card) {
    if (!theme) return 0;
    const name = (card.Name || '').toLowerCase();
    const parallel = (card.Parallel || '').toLowerCase();
    const combined = name + ' ' + parallel;

    // Fire/heat keywords → match cards with fire/grill/heat names
    const isFireTheme = /fire|red|orange|flame|grill|heat|blaze|lava/.test(theme);
    // Ice/cold keywords → match cards with ice/chill/frost names
    const isIceTheme  = /ice|blue|frost|snow|chill|freeze|frozen/.test(theme);

    if (isFireTheme && /grill|fire|heat|blaze|flame/.test(combined)) return 30;
    if (isIceTheme  && /chill|ice|frost|freeze|cold/.test(combined)) return 30;
    // Penalize the opposite
    if (isFireTheme && /chill|ice|frost|freeze|cold/.test(combined)) return -30;
    if (isIceTheme  && /grill|fire|heat|blaze|flame/.test(combined)) return -30;
    return 0;
  }

  function heroScore(card) {
    if (!normalizedHero) return 0;
    const dbHero = normalizeCardNum(card.Name || '');
    if (dbHero === normalizedHero) return 100;
    if (dbHero.includes(normalizedHero) || normalizedHero.includes(dbHero)) return 50;
    return 0;
  }

  const scored = exactMatches.map(c => ({
    card: c,
    score: heroScore(c) + visualThemeScore(c)
  }));
  scored.sort((a, b) => b.score - a.score);

  console.log('🎯 Scored candidates:', scored.map(s => `${s.card.Name} (${s.score})`));

  // Return best-scoring candidate if it's meaningfully better than runner-up
  if (scored[0].score > 0 && (scored.length === 1 || scored[0].score > scored[1].score)) {
    return scored[0].card;
  }

  // Fallback: pure hero name match
  const exact = exactMatches.find(c => normalizeCardNum(c.Name || '') === normalizedHero);
  if (exact) return exact;

  const partial = exactMatches.find(c => {
    const dbHero = normalizeCardNum(c.Name || '');
    return dbHero.includes(normalizedHero || '') || (normalizedHero || '').includes(dbHero);
  });
  if (partial) return partial;

  console.error('❌ Could not disambiguate. Available:', exactMatches.map(c => c.Name));
  return null;
}

console.log('✅ Database module loaded');
