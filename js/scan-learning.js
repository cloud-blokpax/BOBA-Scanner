// js/scan-learning.js — Local OCR correction map
// Learns from user corrections to avoid repeated AI calls for the same misreads.
//
// When OCR reads "8F-127" and the user confirms it should be "BF-127",
// the correction is stored locally. Next time OCR reads "8F-127",
// we check the correction map before falling back to AI (free!).

const CORRECTIONS_KEY = 'ocrCorrections';
const MAX_CORRECTIONS = 500;

function getCorrections() {
  try {
    return JSON.parse(localStorage.getItem(CORRECTIONS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveCorrections(corrections) {
  // Prune to MAX_CORRECTIONS if needed (remove oldest by insertion order)
  const keys = Object.keys(corrections);
  if (keys.length > MAX_CORRECTIONS) {
    const toRemove = keys.slice(0, keys.length - MAX_CORRECTIONS);
    for (const key of toRemove) delete corrections[key];
  }
  try {
    localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(corrections));
  } catch (e) {
    console.warn('Could not save OCR corrections:', e);
  }
}

// Normalize OCR text for consistent lookup keys
function normalizeOCRText(text) {
  return (text || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * Check if we have a learned correction for this OCR output.
 * Returns the corrected card number or null.
 */
function checkCorrection(ocrText) {
  if (!ocrText) return null;
  const key = normalizeOCRText(ocrText);
  const corrections = getCorrections();
  const entry = corrections[key];
  if (!entry) return null;

  // Validate the correction is still in the database
  if (typeof findCard === 'function') {
    const card = findCard(entry.cardNumber);
    if (card) {
      // Update hit count for analytics
      entry.hits = (entry.hits || 0) + 1;
      entry.lastUsed = Date.now();
      corrections[key] = entry;
      saveCorrections(corrections);
      console.log(`🧠 Scan learning: "${ocrText}" → "${entry.cardNumber}" (hit #${entry.hits})`);
      return entry.cardNumber;
    }
  }
  return null;
}

/**
 * Record a correction when the user confirms/overrides a scan result.
 * Called from scanner.js when:
 *   1. OCR reads X but AI corrects to Y
 *   2. User manually selects a card after OCR/AI failure
 */
function recordCorrection(ocrText, confirmedCardNumber, source) {
  if (!ocrText || !confirmedCardNumber) return;

  const key = normalizeOCRText(ocrText);
  // Don't record if OCR was already correct
  if (key === normalizeOCRText(confirmedCardNumber)) return;

  const corrections = getCorrections();
  corrections[key] = {
    cardNumber: confirmedCardNumber,
    source: source || 'manual', // 'ai' | 'manual' | 'fuzzy'
    hits: 0,
    recorded: Date.now(),
    lastUsed: Date.now()
  };
  saveCorrections(corrections);
  console.log(`🧠 Learned: "${ocrText}" → "${confirmedCardNumber}" (${source})`);
}

/**
 * Get stats about the correction map for display.
 */
function getCorrectionStats() {
  const corrections = getCorrections();
  const entries = Object.values(corrections);
  const totalHits = entries.reduce((sum, e) => sum + (e.hits || 0), 0);
  return {
    totalCorrections: entries.length,
    totalHits: totalHits,
    estimatedSavings: `$${(totalHits * (typeof config !== 'undefined' ? config.aiCost : 0.002)).toFixed(2)}`,
    topCorrections: entries
      .sort((a, b) => (b.hits || 0) - (a.hits || 0))
      .slice(0, 10)
      .map(e => ({ ...e }))
  };
}

// Expose globally for scanner.js integration
window.checkCorrection    = checkCorrection;
window.recordCorrection   = recordCorrection;
window.getCorrectionStats = getCorrectionStats;

console.log('✅ Scan learning module loaded');
