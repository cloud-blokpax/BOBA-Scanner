// ============================================================
// src/core/scanner/scanner.js — ES Module
// Card scanning pipeline: OCR → DB lookup → AI fallback → collection
// ============================================================

import { ready, database, tesseractWorker, getApiToken } from '../state.js';
import { showToast, showLoading, setProgress } from '../../ui/toast.js';
import { escapeHtml } from '../../ui/utils.js';
import { config } from '../config.js';
import { emit } from '../event-bus.js';
import { findCard } from '../database/database.js';
import { cropToCard, compressImage, cropCardNumberRegion } from './image-processing.js';
import { runOCR } from '../ocr/ocr.js';
import { checkCorrection, recordCorrection } from '../database/scan-learning.js';
import { getAthleteForHero } from '../../collections/boba/heroes.js';
import { getCollections, saveCollections, getCurrentCollectionId, setCurrentCollectionId } from '../collection/collections.js';

const MAX_FILE_SIZE = 15 * 1024 * 1024;
// scanMode: 'collection' (default) or 'pricecheck'
window.scanMode = window.scanMode || 'collection';

export async function handleFiles(e) {
  const files = e.target.files || e.dataTransfer?.files;
  if (!files || files.length === 0) return;

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
    if (file.size > MAX_FILE_SIZE) {
      showToast(`${file.name} is too large. Max 15MB.`, '⚠️');
      continue;
    }
    setProgress((i / files.length) * 100);
    try {
      await processImage(file);
    } catch (error) {
      console.error(`Error processing ${file.name}:`, error);
    }
  }

  e.target.value = '';
  setProgress(0);
}

async function processImage(file) {
  console.log(`Processing: ${file.name}`);

  const cropped  = await cropToCard(file);
  const src      = cropped ? cropped.blob : file;
  const centeringData = cropped?.centering || null;
  const cardBounds    = cropped?.cardBounds || null;

  const imageBase64 = await compressImage(src);

  const numberRegionBase64 = await cropCardNumberRegion(src).catch(() => null);

  const displayUrl = URL.createObjectURL(src);
  const revokeTimer = setTimeout(() => URL.revokeObjectURL(displayUrl), 5 * 60 * 1000);
  try {
    return await _doProcessImage(imageBase64, displayUrl, displayUrl, file.name, imageBase64, numberRegionBase64, centeringData, cardBounds);
  } catch (err) {
    clearTimeout(revokeTimer);
    URL.revokeObjectURL(displayUrl);
    throw err;
  }
}

async function _doProcessImage(imageBase64, imageUrl, displayUrl, fileName, storedBase64 = null, numberRegionBase64 = null, centeringData = null, cardBounds = null) {
  let match      = null;
  let cardNum    = null;
  let heroName   = null;
  let confidence = null;

  // ── OCR-first path (free, fast) ───────────────────────────────────────────
  if (ready.ocr && tesseractWorker) {
    showLoading(true, 'Reading card number (OCR)...');
    const ocrStart = performance.now();
    try {
      const ocrResult = await Promise.race([
        runOCR(displayUrl),
        new Promise((_, reject) => setTimeout(() => reject(new Error('OCR timeout')), 3000))
      ]);
      const ocrMs = Math.round(performance.now() - ocrStart);
      console.log(`⏱️ OCR took ${ocrMs}ms — result:`, ocrResult);

      if (ocrResult.cardNumber) {
        match = findCard(ocrResult.cardNumber);
        if (match) {
          showLoading(false);
          const ocrConf = ocrResult.confidence || 70;
          addCard(match, imageUrl, fileName, 'ocr', ocrConf, ocrConf < 70, storedBase64, false, centeringData, cardBounds);
          setProgress(100);
          if (typeof addToScanHistory === 'function') {
            addToScanHistory({
              hero: match.Name, cardNumber: match['Card Number'],
              set: match.Set, scanType: 'ocr', confidence: ocrConf
            });
          }
          console.log(`✅ OCR match in ${ocrMs}ms — skipped AI ($0.00)`);
          return;
        }

        // ── Scan Learning: check local correction map before AI fallback ──
        const corrected = checkCorrection(ocrResult.cardNumber);
        if (corrected) {
          match = findCard(corrected);
          if (match) {
            showLoading(false);
            addCard(match, imageUrl, fileName, 'ocr', 80, false, storedBase64, false, centeringData, cardBounds);
            setProgress(100);
            if (typeof addToScanHistory === 'function') {
              addToScanHistory({
                hero: match.Name, cardNumber: match['Card Number'],
                set: match.Set, scanType: 'learned', confidence: 80
              });
            }
            console.log(`🧠 Scan learning match: "${ocrResult.cardNumber}" → "${corrected}" (free!)`);
            return;
          }
        }

        console.log(`⚠️ OCR found "${ocrResult.cardNumber}" but no DB match — falling back to AI`);
      }
    } catch (ocrErr) {
      console.log('⚠️ OCR failed/timed out, falling back to AI:', ocrErr.message);
    }
  }

  // ── AI identification path (fallback) ─────────────────────────────────────
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
    const extracted = await callAPI(imageBase64, numberRegionBase64);

    if (!extracted?.cardNumber) throw new Error('AI returned no card number');

    cardNum    = extracted.cardNumber;
    heroName   = extracted.hero;
    confidence = extracted.confidence || 85;
    const visualTheme = extracted.visualTheme || '';

    match = findCard(cardNum, heroName, visualTheme);

    if (match) {
      showLoading(false);
      const lowConf = confidence < 70;
      addCard(match, imageUrl, fileName, 'ai', confidence, lowConf, storedBase64, false, centeringData, cardBounds);
      setProgress(100);

      recordCorrection(cardNum, match['Card Number'], 'ai');

      if (typeof addToScanHistory === 'function') {
        addToScanHistory({
          hero: match.Name, cardNumber: match['Card Number'],
          set: match.Set, scanType: 'ai', confidence
        });
      }

      if (typeof trackApiCall === 'function') await trackApiCall('scan', true, config.aiCost, 1);
    } else {
      if (typeof trackApiCall === 'function') await trackApiCall('scan', false, config.aiCost, 1);
      if (typeof addToScanHistory === 'function') {
        addToScanHistory({ hero: heroName || 'Unknown', cardNumber: cardNum || '?', scanType: 'ai', success: false });
      }
      showLoading(false);
      showManualSearchModal(cardNum, heroName, imageUrl, fileName, storedBase64);
      if (window.scanMode !== 'deckbuilder') URL.revokeObjectURL(displayUrl);
    }
  } catch (err) {
    showLoading(false);
    if (window.scanMode !== 'deckbuilder') URL.revokeObjectURL(displayUrl);
    console.error('Scan failed:', err.message);
    if (typeof addToScanHistory === 'function') {
      addToScanHistory({ hero: 'Failed', cardNumber: '?', scanType: 'ai', success: false });
    }
    showManualSearchModal(null, null, imageUrl, fileName, storedBase64);
  }
}

// ── Manual Override Modal ─────────────────────────────────────────────────────

function showManualSearchModal(suggestedCardNum, suggestedHero, imageUrl, fileName, imageBase64) {
  document.getElementById('manualSearchModal')?.remove();

  const html = `
    <div class="modal active" id="manualSearchModal">
      <div class="modal-backdrop" id="manualSearchBackdrop"></div>
      <div class="modal-content" style="max-width:480px;">
        <div class="modal-header">
          <h2>🔍 Identify Card Manually</h2>
          <button class="modal-close" id="manualSearchClose">×</button>
        </div>
        <div class="modal-body" style="padding:20px;">
          <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">
            The scanner couldn't automatically identify this card.
            Search by card number or hero name to find it manually.
          </p>
          ${suggestedCardNum ? `
            <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;
                        padding:10px 14px;margin-bottom:14px;font-size:13px;color:#92400e;">
              <strong>Scanner read:</strong> "${escapeHtml(suggestedCardNum)}"
              ${suggestedHero ? ` · "${escapeHtml(suggestedHero)}"` : ''}
              — may be partially correct
            </div>` : ''}
          <div style="display:flex;gap:8px;margin-bottom:12px;">
            <input type="text" id="manualSearchInput"
                   placeholder="e.g. BF-108 or Unibrow"
                   value="${escapeHtml(suggestedCardNum || '')}"
                   style="flex:1;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;"
                   autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
            <button type="button" id="manualSearchBtn" class="btn-tag-add">Search</button>
          </div>
          <div id="manualSearchResults" style="max-height:320px;overflow-y:auto;"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" id="manualSearchCancel">Cancel</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  window._manualSearchContext = { imageUrl, fileName, imageBase64 };

  const input = document.getElementById('manualSearchInput');
  const searchBtn = document.getElementById('manualSearchBtn');
  const closeBtn = document.getElementById('manualSearchClose');
  const cancelBtn = document.getElementById('manualSearchCancel');
  const backdrop = document.getElementById('manualSearchBackdrop');

  let _searchDebounce = null;
  function scheduleSearch() {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(runManualSearch, 180);
  }

  if (input) {
    input.addEventListener('input', scheduleSearch);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(_searchDebounce); runManualSearch(); }
    });
    setTimeout(() => { try { input.focus(); } catch(_) {} }, 120);
  }

  if (searchBtn) {
    searchBtn.addEventListener('pointerdown', e => { e.preventDefault(); clearTimeout(_searchDebounce); runManualSearch(); });
  }

  if (closeBtn)  closeBtn.addEventListener('click', () => closeManualSearch());
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeManualSearch());
  if (backdrop)  backdrop.addEventListener('click', () => closeManualSearch());

  if (suggestedCardNum) setTimeout(runManualSearch, 100);
}

function runManualSearch() {
  const input = document.getElementById('manualSearchInput');
  const el    = document.getElementById('manualSearchResults');
  if (!el) return;

  const query = (input?.value || '').trim();
  el.style.display = 'block';

  if (!query) {
    el.innerHTML = `<p style="text-align:center;color:#f59e0b;padding:16px 0;">⚠️ Please type a card number or name first</p>`;
    return;
  }

  if (!ready.db || !database.length) {
    el.innerHTML = `<p style="text-align:center;color:#6b7280;padding:16px 0;">⏳ Database still loading — try again in a moment</p>`;
    const retryPoll = setInterval(() => {
      if (ready.db && database.length) {
        clearInterval(retryPoll);
        runManualSearch();
      }
    }, 500);
    setTimeout(() => clearInterval(retryPoll), 15000);
    return;
  }

  el.innerHTML = `<p style="text-align:center;color:#6b7280;padding:8px 0;">Searching...</p>`;

  const results = searchDatabase(query);

  if (results.length === 0) {
    el.innerHTML = `<p style="text-align:center;color:#9ca3af;padding:20px 0;">No cards found for "<strong>${escapeHtml(query)}</strong>"<br><span style="font-size:12px;">Try the card number (e.g. BF-108) or just the hero name</span></p>`;
    return;
  }

  el.innerHTML = results.slice(0, 20).map(card => `
    <div class="manual-search-row" data-card-id="${escapeHtml(String(card['Card ID']))}">
      <div class="manual-search-info">
        <div class="manual-search-name">${escapeHtml(card.Name || '')}</div>
        <div class="manual-search-meta">
          ${escapeHtml(card['Card Number'] || '')} · ${escapeHtml(card.Year || '')} · ${escapeHtml(card.Set || '')}
          ${card.Parallel && card.Parallel !== 'Base' ? `· ${escapeHtml(card.Parallel)}` : ''}
        </div>
      </div>
      <span class="btn-tag-add" style="font-size:12px;padding:6px 12px;cursor:pointer;white-space:nowrap;">+ Add</span>
    </div>
  `).join('');

  el.onclick = function(e) {
    const row = e.target.closest('[data-card-id]');
    if (row) selectManualCard(row.dataset.cardId);
  };
  el.addEventListener('touchend', function(e) {
    const row = e.target.closest('[data-card-id]');
    if (row) { e.preventDefault(); selectManualCard(row.dataset.cardId); }
  });
}
window.runManualSearch = runManualSearch;

function selectManualCard(cardId) {
  const card = database.find(c => String(c['Card ID']) === String(cardId));
  if (!card) { showToast('Card not found', '❌'); return; }
  const ctx = window._manualSearchContext || {};

  const searchInput = document.getElementById('manualSearchInput');
  if (searchInput?.value) {
    recordCorrection(searchInput.value.trim(), card['Card Number'], 'manual');
  }

  if (window.scanMode === 'deckbuilder' && typeof window.deckBuilderOnCardScanned === 'function') {
    window.deckBuilderOnCardScanned(card, ctx.imageUrl || '', ctx.fileName || 'manual', ctx.imageBase64 || null);
    closeManualSearch();
    return;
  }
  addCard(card, ctx.imageUrl || '', ctx.fileName || 'manual', 'manual', 100);
  if (typeof addToScanHistory === 'function') {
    addToScanHistory({ hero: card.Name, cardNumber: card['Card Number'], set: card.Set, scanType: 'manual' });
  }
  closeManualSearch();
}
window.selectManualCard = selectManualCard;

function closeManualSearch() {
  document.getElementById('manualSearchModal')?.remove();
  delete window._manualSearchContext;
}
window.closeManualSearch = closeManualSearch;

export function searchDatabase(query) {
  if (!ready.db || !database.length) return [];
  const q = query.toUpperCase().trim();
  return database.filter(card => {
    return String(card['Card Number'] ?? '').toUpperCase().includes(q) ||
           String(card.Name           ?? '').toUpperCase().includes(q) ||
           String(card.Set            ?? '').toUpperCase().includes(q);
  });
}

// ── Scan result cache ─────────────────────────────────────────────────────────
const _scanCache     = new Map();
const _CACHE_TTL_MS  = 5 * 60 * 1000;
const _CACHE_MAX     = 20;

function _cacheKey(b64) {
  const len = b64.length;
  return b64.slice(80, 120) + '|' + b64.slice((len >> 1) - 16, (len >> 1) + 16) + '|' + b64.slice(-40);
}
function _cacheGet(b64) {
  const entry = _scanCache.get(_cacheKey(b64));
  if (!entry) return null;
  if (Date.now() - entry.ts > _CACHE_TTL_MS) { _scanCache.delete(_cacheKey(b64)); return null; }
  return entry.result;
}
function _cacheSet(b64, result) {
  if (_scanCache.size >= _CACHE_MAX) _scanCache.delete(_scanCache.keys().next().value);
  _scanCache.set(_cacheKey(b64), { result, ts: Date.now() });
}

// ── API call ──────────────────────────────────────────────────────────────────

async function callAPI(imageBase64, numberRegionBase64 = null) {
  console.log('Calling API backend...');

  const cached = _cacheGet(imageBase64);
  if (cached) {
    console.log('📦 Scan cache hit — skipping API call');
    return cached;
  }

  const headers = { 'Content-Type': 'application/json' };
  const apiToken = getApiToken();
  if (apiToken) headers['X-Api-Token'] = apiToken;

  const bodyObj = { imageData: imageBase64 };
  if (numberRegionBase64) bodyObj.numberRegionData = numberRegionBase64;

  const MAX_RETRIES  = 2;
  const RETRY_DELAYS = [1000, 2000];
  const CLIENT_TIMEOUT_MS = 25000;
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      showLoading(true, `Retrying (${attempt}/${MAX_RETRIES})...`);
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]));
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
      let response;
      try {
        response = await fetch('/api/anthropic', {
          method:  'POST',
          headers,
          body:    JSON.stringify(bodyObj),
          signal:  controller.signal
        });
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        if (fetchErr.name === 'AbortError') throw new Error('Request timed out — please try again');
        throw fetchErr;
      }
      clearTimeout(timeoutId);

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const errMsg = err.error || `API error: ${response.status}`;
        if (response.status >= 400 && response.status < 500) throw new Error(errMsg);
        lastError = new Error(errMsg);
        continue;
      }

      const data        = await response.json();
      const textContent = data.content?.find(c => c.type === 'text');
      if (!textContent) throw new Error('No text in API response');

      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in API response');

      const parsed = JSON.parse(jsonMatch[0]);
      _cacheSet(imageBase64, parsed);
      return parsed;
    } catch (err) {
      if (err.message.includes('API error: 4')) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

// ── Price Check Collection ────────────────────────────────────────────────────
export function ensurePriceCheckCollection() {
    const collections = getCollections();
    if (!collections.find(c => c.id === 'price_check')) {
        collections.push({
            id:    'price_check',
            name:  '💰 Price Check',
            cards: [],
            stats: { scanned: 0, free: 0, cost: 0, aiCalls: 0 }
        });
        saveCollections(collections);
        console.log('✅ Price Check collection created');
    }
    return collections;
}
window.ensurePriceCheckCollection = ensurePriceCheckCollection;

async function uploadWithRetry(imageBase64, fileName, maxAttempts = 8, delayMs = 2500) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
    if (typeof uploadCardImage !== 'function') return null;
    const url = await uploadCardImage(imageBase64, fileName);
    if (url) return url;
    console.log(`⏳ Image upload attempt ${attempt + 1}/${maxAttempts} — waiting for auth...`);
  }
  return null;
}
window.uploadWithRetry = uploadWithRetry;


// ── Duplicate detection modal ──────────────────────────────────────────────
function showDuplicateModal(dupeCount, cardName, onConfirm) {
  document.getElementById('dupeModal')?.remove();
  const html = `
    <div class="modal active" id="dupeModal" style="z-index:10001;">
      <div class="modal-backdrop" id="dupeBackdrop"></div>
      <div class="modal-content" style="max-width:380px;">
        <div class="modal-header">
          <h2>⚠️ Duplicate Detected</h2>
          <button class="modal-close" id="dupeClose">×</button>
        </div>
        <div class="modal-body" style="padding:20px;text-align:center;">
          <p style="color:#374151;font-size:15px;margin:0 0 8px;">
            You already have <strong>${dupeCount}</strong> cop${dupeCount === 1 ? 'y' : 'ies'} of
          </p>
          <p style="color:#1e3a5f;font-size:17px;font-weight:700;margin:0 0 16px;">
            ${escapeHtml(cardName)}
          </p>
          <p style="color:#6b7280;font-size:13px;margin:0;">
            Add another copy anyway?
          </p>
        </div>
        <div class="modal-footer" style="gap:8px;">
          <button class="btn-secondary" id="dupeSkip" style="flex:1;">Skip</button>
          <button class="btn-tag-add" id="dupeAdd" style="flex:1;">Add Anyway</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const close = () => {
    document.getElementById('dupeModal')?.remove();
    showToast('Card skipped (duplicate)', '⚠️');
  };
  document.getElementById('dupeClose')?.addEventListener('click', close);
  document.getElementById('dupeSkip')?.addEventListener('click', close);
  document.getElementById('dupeBackdrop')?.addEventListener('click', close);
  document.getElementById('dupeAdd')?.addEventListener('click', () => {
    document.getElementById('dupeModal')?.remove();
    onConfirm();
  });
}

export function addCard(match, displayUrl, fileName, type, confidence = null, lowConfidence = false, imageBase64 = null, _skipDupeCheck = false, centeringData = null, cardBounds = null) {
  console.log('Adding card:', match['Card Number']);

  // ── Deck Builder intercept ─────────────────────────────────────────────
  if (window.scanMode === 'deckbuilder') {
    if (typeof window.deckBuilderOnCardScanned === 'function') {
      window.deckBuilderOnCardScanned(match, displayUrl, fileName, imageBase64);
    }
    return;
  }

  const isPriceCheck = (window.scanMode === 'pricecheck');
  let collections = isPriceCheck
    ? ensurePriceCheckCollection()
    : getCollections();

  const targetId = isPriceCheck ? 'price_check' : getCurrentCollectionId();
  let collection = collections.find(c => c.id === targetId);

  if (!collection && !isPriceCheck) {
    if (targetId !== 'default') {
      console.warn(`⚠️ Collection "${targetId}" not found — falling back to default`);
      collection = collections.find(c => c.id === 'default');
      if (collection) {
        setCurrentCollectionId('default');
      }
    }
    if (!collection) {
      const defaultCol = { id: 'default', name: 'My Collection', cards: [], stats: { scanned: 0, free: 0, cost: 0, aiCalls: 0 } };
      collections.unshift(defaultCol);
      saveCollections(collections);
      collection = defaultCol;
    }
  }

  if (!collection) {
    showToast('Failed to save card — no collection found', '❌');
    return;
  }

  const cardId  = match['Card ID']     || '';
  const cardNum = match['Card Number'] || '';
  const cardIdSet  = new Set();
  const cardNumSet = new Set();
  for (const col of collections) {
    for (const c of col.cards) {
      if (c.cardId)     cardIdSet.add(c.cardId);
      if (c.cardNumber) cardNumSet.add(c.cardNumber);
    }
  }
  const dupeCount = collections.reduce((total, col) =>
    total + col.cards.filter(c =>
      (cardId  && c.cardId    === String(cardId))  ||
      (cardNum && c.cardNumber === cardNum)
    ).length, 0);

  if (dupeCount > 0 && !_skipDupeCheck) {
    return void showDuplicateModal(dupeCount, match.Name || cardNum, () => {
      addCard(match, displayUrl, fileName, type, confidence, lowConfidence, imageBase64, true, centeringData, cardBounds);
    });
  }

  const card = {
    cardId:        String(match['Card ID']     || ''),
    hero:          match.Name                  || '',
    athlete:       getAthleteForHero(match.Name) || '',
    year:          match.Year                  || '',
    set:           match.Set                   || '',
    cardNumber:    match['Card Number']        || '',
    pose:          match.Parallel              || '',
    weapon:        match.Weapon                || '',
    power:         match.Power                 || '',
    imageUrl:      displayUrl,
    fileName,
    scanType:      type,
    scanMethod:    type === 'free'   ? `Free OCR (${Math.round(confidence || 0)}%)` :
                   type === 'manual' ? 'Manual Search' : 'AI + Database',
    confidence,
    lowConfidence,
    timestamp:     new Date().toISOString(),
    tags:          (typeof getPendingTags === 'function') ? getPendingTags() : [],
    condition:     '',
    notes:         '',
    readyToList:   false,
    listingStatus: null,
    listingUrl:    null,
    listingPrice:  null,
    soldAt:        null,
    centeringData,
    cardBounds
  };

  if (typeof clearPendingTags === 'function') clearPendingTags();

  collection.cards.push(card);
  collection.stats.scanned++;
  if (type === 'free') collection.stats.free++;
  if (type === 'ai')   collection.stats.aiCalls = (collection.stats.aiCalls || 0) + 1;

  const newCardIndex = collection.cards.length - 1;

  saveCollections(collections);

  emit('scan:complete', { card, index: newCardIndex });

  if (imageBase64) {
    const savedColId = isPriceCheck ? 'price_check' : getCurrentCollectionId();
    uploadWithRetry(imageBase64, fileName).then(uploadedUrl => {
      if (!uploadedUrl) {
        console.warn('⚠️ Image upload failed after retries — image will not persist across sessions');
        return;
      }
      const cols = getCollections();
      const col  = cols.find(c => c.id === savedColId);
      if (col && col.cards[newCardIndex]) {
        col.cards[newCardIndex].imageUrl = uploadedUrl;
        saveCollections(cols);
        if (typeof renderCards === 'function') renderCards();
        if (typeof renderCollectionModal === 'function') renderCollectionModal();
        const modal = document.getElementById('cardDetailModal');
        if (modal) {
          const detailImg = modal.querySelector('img[data-card-index]');
          if (detailImg && parseInt(detailImg.dataset.cardIndex) === newCardIndex) {
            detailImg.src = uploadedUrl;
          } else {
            const noImgDiv = modal.querySelector('#detailNoImgMsg');
            if (noImgDiv) {
              const wrap = noImgDiv.parentElement;
              if (wrap) {
                wrap.outerHTML = `<div id="detailImgWrap" style="position:relative;text-align:center;margin-bottom:16px;cursor:zoom-in;">
                  <img id="detailCardImg" data-card-index="${newCardIndex}"
                       src="${uploadedUrl}" style="width:100%;max-height:240px;object-fit:contain;border-radius:10px;background:#f9fafb;">
                  <div id="detailZoomHint" style="position:absolute;bottom:6px;right:8px;background:rgba(0,0,0,.45);color:#fff;font-size:10px;border-radius:4px;padding:2px 6px;">Tap to zoom</div>
                </div>`;
              }
            }
          }
        }
      }
    }).catch(() => {});
  }

  if (typeof trackCardAdded === 'function') trackCardAdded();

  if (isPriceCheck) {
    setCurrentCollectionId('price_check');
    if (typeof updateCollectionSlider === 'function') updateCollectionSlider();
  }

  if (typeof updateCollectionNavCounts === 'function') updateCollectionNavCounts();

  if (typeof updateStats === 'function') updateStats();
  if (typeof renderCards === 'function') renderCards();

  if (typeof window.openCollectionCardDetail === 'function') {
    const popupColId = isPriceCheck ? 'price_check' : getCurrentCollectionId();
    setTimeout(() => window.openCollectionCardDetail(popupColId, newCardIndex), 150);
  }

  if (navigator.vibrate) navigator.vibrate(type === 'free' ? 50 : [50, 100, 50]);

  const dupeNote = dupeCount > 0 ? ` (copy #${dupeCount + 1})` : '';
  const confNote = lowConfidence ? ' ⚠️ low confidence — please verify' : '';

  if (isPriceCheck) {
    showToast(`Price Check: ${card.hero} (${card.cardNumber}) — fetching eBay prices...`, '💰');
    if (typeof fetchEbayAvgPrice === 'function') {
      const soldPromise = (typeof fetchEbaySoldData === 'function')
        ? fetchEbaySoldData(card).catch(() => null) : Promise.resolve(null);

      Promise.all([fetchEbayAvgPrice(card), soldPromise]).then(([priceData, soldData]) => {
        const cols2 = getCollections();
        const pc    = cols2.find(c => c.id === 'price_check');
        if (!pc) return;
        const savedCard = pc.cards[pc.cards.length - 1];
        if (!savedCard) return;

        if (priceData && priceData.count > 0) {
          savedCard.ebayAvgPrice    = priceData.avgPrice;
          savedCard.ebayLowPrice    = priceData.lowPrice;
          savedCard.ebayHighPrice   = priceData.highPrice;
          savedCard.ebayPriceFetched = new Date().toISOString();
        }

        if (soldData && soldData.lastSold) {
          savedCard.ebaySoldPrice    = soldData.lastSold.price;
          savedCard.ebaySoldDate     = soldData.lastSold.date || null;
          savedCard.ebaySoldUrl      = soldData.lastSold.url  || null;
          savedCard.ebaySoldAvgPrice = soldData.avgSoldPrice;
          savedCard.ebaySoldCount    = soldData.soldCount;
          savedCard.ebaySoldFetched  = new Date().toISOString();
        }

        saveCollections(cols2);
        if (typeof renderCards === 'function') renderCards();

        const parts = [];
        if (priceData?.count > 0) {
          parts.push(`Avg $${priceData.avgPrice?.toFixed(2)} · Low $${priceData.lowPrice?.toFixed(2)} (${priceData.count} active)`);
        }
        if (soldData?.lastSold) {
          parts.push(`Last sold $${soldData.lastSold.price.toFixed(2)}${soldData.lastSold.date ? ' (' + soldData.lastSold.date + ')' : ''}`);
        }
        if (parts.length > 0) {
          showToast(`${card.hero}: ${parts.join(' · ')}`, '💰');
        } else {
          showToast(`${card.hero}: No eBay listings found`, '⚠️');
        }
      }).catch(() => showToast(`${card.hero}: eBay price lookup failed`, '⚠️'));
    }
    window.scanMode = 'collection';
  } else {
    showToast(`Added: ${card.hero} (${card.cardNumber})${dupeNote}${confNote}`,
              lowConfidence ? '⚠️' : '✅');
  }

  console.log(`Added to ${isPriceCheck ? 'Price Check' : 'Collection'}. Cards: ${collection.cards.length}`);
}

export function removeCard(index) {
  const collections = getCollections();
  const currentId   = getCurrentCollectionId();
  const collection  = collections.find(c => c.id === currentId);
  if (!collection?.cards[index]) return;

  const card = collection.cards[index];
  if (typeof recordDeletedCard === 'function') recordDeletedCard(card);
  if (typeof deleteCardImage === 'function') deleteCardImage(card.imageUrl);
  if (card.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(card.imageUrl);

  collection.cards.splice(index, 1);
  collection.stats.scanned = Math.max(0, collection.stats.scanned - 1);
  if (card.scanType === 'free') collection.stats.free = Math.max(0, collection.stats.free - 1);

  saveCollections(collections);
  if (typeof trackCardAdded === 'function') trackCardAdded();
  if (typeof updateStats === 'function') updateStats();
  if (typeof renderCards === 'function') renderCards();
  showToast('Card removed', '🗑️');
}

export function updateCard(index, field, value) {
  const collections = getCollections();
  const currentId   = getCurrentCollectionId();
  const collection  = collections.find(c => c.id === currentId);
  if (!collection?.cards[index]) return;
  collection.cards[index][field] = value;
  saveCollections(collections);
}

window.toggleReadyToList = function(index) {
  const collections = getCollections();
  const currentId   = getCurrentCollectionId();
  const collection  = collections.find(c => c.id === currentId);
  if (!collection?.cards[index]) return;
  const newVal = !collection.cards[index].readyToList;
  collection.cards[index].readyToList = newVal;
  saveCollections(collections);
  const btn  = document.getElementById(`rtl_btn_${index}`);
  const badge = document.getElementById(`rtl_badge_${index}`);
  if (btn) { btn.classList.toggle('active', newVal); btn.title = newVal ? 'Remove from listing queue' : 'Mark ready to list'; }
  if (badge) badge.style.display = newVal ? 'inline-flex' : 'none';
  showToast(newVal ? 'Marked ready to list' : 'Removed from listing queue', newVal ? '🏷️' : '✓');
};

console.log('Scanner module loaded (v1.1)');
