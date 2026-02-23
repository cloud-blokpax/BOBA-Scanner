// ============================================================
// js/database.js — FIXED
// Changes:
//   - Pre-computed card number index built at load time (O(1) prefix lookup)
//   - Fuzzy matching only runs on pre-filtered candidates (not all 17k cards)
//   - Levenshtein performance is now acceptable even on large databases
// ============================================================

async function loadDatabase() {
  setStatus('db', 'loading');
  try {
    const res = await fetch('./card-database.json');
    if (!res.ok) throw new Error('DB not found');
    database = await res.json();

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
function findCard(cardNumber, heroName = null) {
  if (!ready.db || !cardNumber) {
    console.error('findCard called but:', { dbReady: ready.db, cardNumber });
    return null;
  }

  const normalizedCardNum = normalizeCardNum(cardNumber);
  const normalizedHero    = heroName ? normalizeCardNum(heroName) : null;

  console.log('🔍 Searching for card:', { cardNumber: normalizedCardNum, hero: normalizedHero });

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

  // STEP 4: Multiple exact matches — disambiguate by hero name
  if (!normalizedHero) {
    console.error('❌ Multiple matches but no hero name');
    return null;
  }

  const exact = exactMatches.find(c => normalizeCardNum(c.Name || '') === normalizedHero);
  if (exact) return exact;

  const partial = exactMatches.find(c => {
    const dbHero = normalizeCardNum(c.Name || '');
    return dbHero.includes(normalizedHero) || normalizedHero.includes(dbHero);
  });

  if (partial) return partial;

  console.error('❌ Hero name mismatch. Available:', exactMatches.map(c => c.Name));
  return null;
}

console.log('✅ Database module loaded');
