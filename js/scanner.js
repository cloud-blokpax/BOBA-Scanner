// ============================================================
// js/scanner.js — UPDATED v1.2
// New features:
//   - Condition grading field per card
//   - Notes field per card
//   - Duplicate detection with warning
//   - Confidence indicator (yellow flag on low-confidence scans)
//   - Manual override / card search modal on scan failure
//   - Scan history logging (success + failure)
//   - Ready to List flag per card
// ============================================================

const MAX_FILE_SIZE = 15 * 1024 * 1024;
// scanMode: 'collection' (default) or 'pricecheck'
window.scanMode = window.scanMode || 'collection';

async function handleFiles(e) {
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

  if (typeof promptForTags === 'function') {
    await promptForTags();
  }

  const imageBase64 = await compressImage(file);

  // Use blob URL for immediate display — stored temporarily on the card for this session.
  // Supabase upload happens async AFTER the card is saved, then updates the card record.
  // This means images always show immediately, even if upload is slow or user isn't logged in yet.
  const displayUrl = URL.createObjectURL(file);

  try {
    // Pass displayUrl as imageUrl — card shows immediately, blob URL lasts for session
    return await _doProcessImage(imageBase64, displayUrl, displayUrl, file.name, imageBase64);
  } finally {}
}

async function _doProcessImage(imageBase64, imageUrl, displayUrl, fileName, storedBase64 = null) {
  let match      = null;
  let cardNum    = null;
  let heroName   = null;
  let confidence = null;

  // ── OCR path ──────────────────────────────────────────────────────────────
  if (ready.ocr && tesseractWorker) {
    try {
      showLoading(true, 'Reading card number...');
      const ocrResult = await Promise.race([
        runOCR(imageUrl),
        new Promise((_, reject) => setTimeout(() => reject(new Error('OCR timeout')), 12000))
      ]);
      cardNum    = extractCardNumber(ocrResult.text);
      heroName   = _extractHeroFromOCR(ocrResult.text);
      confidence = ocrResult.confidence;

      console.log('OCR result:', { cardNum, heroName, confidence });

      if (ocrResult.confidence >= config.threshold && cardNum) {
        match = findCard(cardNum, heroName);
        if (match) {
          console.log('OCR match:', match.Name);
          showLoading(false);
          addCard(match, imageUrl, fileName, 'free', ocrResult.confidence, false, storedBase64);
          setProgress(100);
          if (typeof addToScanHistory === 'function') {
            addToScanHistory({
              hero: match.Name, cardNumber: match['Card Number'],
              set: match.Set, scanType: 'free', confidence: ocrResult.confidence
            });
          }
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

    if (!extracted?.cardNumber) throw new Error('AI returned no card number');

    cardNum    = extracted.cardNumber;
    heroName   = extracted.hero;
    confidence = extracted.confidence || 85;
    const visualTheme = extracted.visualTheme || '';

    match = findCard(cardNum, heroName, visualTheme);

    if (match) {
      showLoading(false);
      const lowConf = confidence < 70;
      addCard(match, imageUrl, fileName, 'ai', confidence, lowConf, storedBase64);
      setProgress(100);

      if (typeof addToScanHistory === 'function') {
        addToScanHistory({
          hero: match.Name, cardNumber: match['Card Number'],
          set: match.Set, scanType: 'ai', confidence
        });
      }

      if (typeof trackApiCall === 'function') await trackApiCall('scan', true, 0.01, 1);
    } else {
      if (typeof trackApiCall === 'function') await trackApiCall('scan', false, 0.01, 1);
      if (typeof addToScanHistory === 'function') {
        addToScanHistory({ hero: heroName || 'Unknown', cardNumber: cardNum || '?', scanType: 'ai', success: false });
      }
      showLoading(false);
      showManualSearchModal(cardNum, heroName, imageUrl, fileName);
      URL.revokeObjectURL(displayUrl);
    }
  } catch (err) {
    showLoading(false);
    URL.revokeObjectURL(displayUrl);
    console.error('Scan failed:', err.message);
    if (typeof addToScanHistory === 'function') {
      addToScanHistory({ hero: 'Failed', cardNumber: '?', scanType: 'ai', success: false });
    }
    showManualSearchModal(null, null, imageUrl, fileName);
  }
}

// ── Manual Override Modal ─────────────────────────────────────────────────────

function showManualSearchModal(suggestedCardNum, suggestedHero, imageUrl, fileName) {
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
  window._manualSearchContext = { imageUrl, fileName };

  const input = document.getElementById('manualSearchInput');
  const searchBtn = document.getElementById('manualSearchBtn');
  const closeBtn = document.getElementById('manualSearchClose');
  const cancelBtn = document.getElementById('manualSearchCancel');
  const backdrop = document.getElementById('manualSearchBackdrop');

  // Live search — fires on every keystroke (debounced 180ms).
  // This bypasses all iOS button-tap/keyboard-dismiss timing issues entirely.
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
    // Focus after a short delay so iOS keyboard has time to appear
    setTimeout(() => { try { input.focus(); } catch(_) {} }, 120);
  }

  // Button still works as a fallback (pointerdown fires before blur)
  if (searchBtn) {
    searchBtn.addEventListener('pointerdown', e => { e.preventDefault(); clearTimeout(_searchDebounce); runManualSearch(); });
  }

  if (closeBtn)  closeBtn.addEventListener('click', () => closeManualSearch());
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeManualSearch());
  if (backdrop)  backdrop.addEventListener('click', () => closeManualSearch());

  // If scanner already filled in a card number, run immediately
  if (suggestedCardNum) setTimeout(runManualSearch, 100);
}

window.runManualSearch = function() {
  const input = document.getElementById('manualSearchInput');
  const el    = document.getElementById('manualSearchResults');
  if (!el) return;

  const query = (input?.value || '').trim();

  // Show feedback immediately so the user knows the tap registered
  el.style.display = 'block';

  if (!query) {
    el.innerHTML = `<p style="text-align:center;color:#f59e0b;padding:16px 0;">⚠️ Please type a card number or name first</p>`;
    return;
  }

  if (!ready.db || !database.length) {
    el.innerHTML = `<p style="text-align:center;color:#6b7280;padding:16px 0;">⏳ Database still loading — try again in a moment</p>`;
    // Auto-retry once db is ready
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

  // Event delegation — covers both tap and click, safe on mobile
  el.onclick = function(e) {
    const row = e.target.closest('[data-card-id]');
    if (row) selectManualCard(row.dataset.cardId);
  };
  el.addEventListener('touchend', function(e) {
    const row = e.target.closest('[data-card-id]');
    if (row) { e.preventDefault(); selectManualCard(row.dataset.cardId); }
  });
};

window.selectManualCard = function(cardId) {
  const card = database.find(c => String(c['Card ID']) === String(cardId));
  if (!card) { showToast('Card not found', '❌'); return; }
  const ctx = window._manualSearchContext || {};
  addCard(card, ctx.imageUrl || '', ctx.fileName || 'manual', 'manual', 100);
  if (typeof addToScanHistory === 'function') {
    addToScanHistory({ hero: card.Name, cardNumber: card['Card Number'], set: card.Set, scanType: 'manual' });
  }
  closeManualSearch();
};

window.closeManualSearch = function() {
  document.getElementById('manualSearchModal')?.remove();
  delete window._manualSearchContext;
};

function searchDatabase(query) {
  if (!ready.db || !database.length) return [];
  const q = query.toUpperCase().trim();
  return database.filter(card => {
    return (card['Card Number'] || '').toUpperCase().includes(q) ||
           (card.Name || '').toUpperCase().includes(q) ||
           (card.Set  || '').toUpperCase().includes(q);
  });
}

// ── API call ──────────────────────────────────────────────────────────────────

async function callAPI(imageBase64) {
  console.log('Calling API backend...');

  const prompt = `You are analyzing a Bo Jackson trading card. Extract the following information:

CRITICAL LOCATIONS ON THE CARD:
1. CARD NUMBER — BOTTOM LEFT corner. Format: Letters-Numbers e.g. "BLBF-84", "BF-108".
   This is NOT the power number in the top right!
2. POWER — TOP RIGHT corner in a circle/badge. Just a number e.g. "125". NOT the card number.
3. HERO NAME — Printed prominently near the top, often all caps.
4. SET NAME — Near bottom or on a banner (e.g. "Battle Arena", "Alpha Edition").
5. YEAR — Usually "2023" or "2024".

Common OCR errors to watch for: 6 vs 8, 0 vs O, 1 vs I.

Also include a confidence score (0-100) for how certain you are about the card number.

Return ONLY valid JSON with no markdown or extra text:
{
  "cardNumber": "BLBF-84",
  "hero": "CHARACTER NAME",
  "year": "2024",
  "set": "Set Name",
  "pose": "Parallel type or Base",
  "weapon": "Weapon name or None",
  "power": "125",
  "confidence": 90
}`;

  const headers = { 'Content-Type': 'application/json' };
  if (appConfig.apiToken) headers['X-Api-Token'] = appConfig.apiToken;

  const response = await fetch('/api/anthropic', {
    method:  'POST',
    headers,
    body:    JSON.stringify({ imageData: imageBase64, image: imageBase64, prompt })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `API error: ${response.status}`);
  }

  const data        = await response.json();
  const textContent = data.content?.find(c => c.type === 'text');
  if (!textContent) throw new Error('No text in API response');

  const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in API response');

  return JSON.parse(jsonMatch[0]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _extractHeroFromOCR(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.find(l => /^[A-Z\s]{3,}$/.test(l)) || null;
}

// ── Add card ──────────────────────────────────────────────────────────────────

// ── Price Check Collection ────────────────────────────────────────────────────
// Ensures a dedicated "Price Check" collection exists for eBay price lookups
function ensurePriceCheckCollection() {
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
    return collections; // return the live array (avoids a second localStorage read)
}
window.ensurePriceCheckCollection = ensurePriceCheckCollection;

// Retry Supabase image upload up to 8 times over 20 seconds.
// On mobile, the auth session may not be restored yet when a scan finishes.
async function uploadWithRetry(imageBase64, fileName, maxAttempts = 8, delayMs = 2500) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
    if (typeof uploadCardImage !== 'function') return null;
    const url = await uploadCardImage(imageBase64, fileName);
    if (url) return url;
    // If currentUser still null, keep waiting
    console.log(`⏳ Image upload attempt ${attempt + 1}/${maxAttempts} — waiting for auth...`);
  }
  return null;
}
window.uploadWithRetry = uploadWithRetry;

function addCard(match, displayUrl, fileName, type, confidence = null, lowConfidence = false, imageBase64 = null) {
  console.log('Adding card:', match['Card Number']);

  // Determine target collection based on scan mode
  const isPriceCheck = (window.scanMode === 'pricecheck');
  let collections = isPriceCheck
    ? ensurePriceCheckCollection()  // returns live array with price_check guaranteed
    : getCollections();

  const targetId = isPriceCheck ? 'price_check' : getCurrentCollectionId();
  let collection = collections.find(c => c.id === targetId);

  // Safety net: if default collection somehow missing, create it in-memory
  if (!collection && !isPriceCheck) {
    const defaultCol = { id: 'default', name: 'My Collection', cards: [], stats: { scanned: 0, free: 0, cost: 0, aiCalls: 0 } };
    collections.unshift(defaultCol);
    saveCollections(collections);
    collection = defaultCol;
  }

  if (!collection) {
    showToast('Failed to save card — no collection found', '❌');
    return;
  }

  // ── Duplicate detection ──────────────────────────────────────────────────
  const cardId  = match['Card ID']     || '';
  const cardNum = match['Card Number'] || '';
  const dupeCount = collections.reduce((total, col) =>
    total + col.cards.filter(c =>
      (cardId  && c.cardId    === String(cardId))  ||
      (cardNum && c.cardNumber === cardNum)
    ).length, 0);

  if (dupeCount > 0) {
    const proceed = confirm(
      `⚠️ Duplicate detected!\n\nYou already have ${dupeCount} copy(ies) of ` +
      `"${match.Name || cardNum}" in your collection.\n\nAdd anyway?`
    );
    if (!proceed) {
      showToast('Card skipped (duplicate)', '⚠️');
      return;
    }
  }

  const card = {
    cardId:        String(match['Card ID']     || ''),
    hero:          match.Name                  || '',
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
    // Feature fields
    condition:     '',
    notes:         '',
    readyToList:   false,
    listingStatus: null,
    listingUrl:    null,
    listingPrice:  null,
    soldAt:        null
  };

  if (typeof clearPendingTags === 'function') clearPendingTags();

  collection.cards.push(card);
  collection.stats.scanned++;
  if (type === 'free') collection.stats.free++;
  if (type === 'ai')   collection.stats.aiCalls = (collection.stats.aiCalls || 0) + 1;

  const newCardIndex = collection.cards.length - 1; // index of the card we just pushed

  saveCollections(collections);

  // Async Supabase upload — uses retry so mobile auth delays don't lose the image.
  // Card is already saved with blob URL for instant display; URL is swapped when upload succeeds.
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
        renderCards();
        if (typeof renderCollectionModal === 'function') renderCollectionModal();
        // Refresh detail modal image if still open
        const detailImg = document.querySelector('#cardDetailModal img[data-card-index]');
        if (detailImg && parseInt(detailImg.dataset.cardIndex) === newCardIndex) {
          detailImg.src = uploadedUrl;
        }
      }
    }).catch(() => {});
  }

  if (typeof trackCardAdded === 'function') trackCardAdded();

  // Update nav counts on the quick-access buttons
  if (typeof updateCollectionNavCounts === 'function') updateCollectionNavCounts();

  updateStats();
  renderCards();

  if (navigator.vibrate) navigator.vibrate(type === 'free' ? 50 : [50, 100, 50]);

  const dupeNote = dupeCount > 0 ? ` (copy #${dupeCount + 1})` : '';
  const confNote = lowConfidence ? ' ⚠️ low confidence — please verify' : '';

  // Auto-open card detail after every single-card scan
  if (typeof openCardDetail === 'function') {
    if (isPriceCheck) {
      // Switch slider to price_check so the view and openCardDetail are in sync
      if (typeof setCurrentCollectionId === 'function') setCurrentCollectionId('price_check');
      if (typeof updateCollectionSlider === 'function') updateCollectionSlider();
      renderCards();
    }
    setTimeout(() => openCardDetail(newCardIndex), 200);
  }

  if (isPriceCheck) {
    // Auto-fetch eBay prices for price check cards
    showToast(`Price Check: ${card.hero} (${card.cardNumber}) — fetching eBay prices...`, '💰');
    if (typeof fetchEbayAvgPrice === 'function') {
      fetchEbayAvgPrice(card).then(priceData => {
        if (priceData && priceData.count > 0) {
          // Save prices back onto the card
          const cols2 = getCollections();
          const pc    = cols2.find(c => c.id === 'price_check');
          if (pc) {
            const savedCard = pc.cards[pc.cards.length - 1];
            if (savedCard) {
              savedCard.ebayAvgPrice    = priceData.avgPrice;
              savedCard.ebayLowPrice    = priceData.lowPrice;
              savedCard.ebayHighPrice   = priceData.highPrice;
              savedCard.ebayPriceFetched = new Date().toISOString();
              saveCollections(cols2);
              renderCards();
              showToast(
                `${card.hero}: Avg $${priceData.avgPrice?.toFixed(2)} · Low $${priceData.lowPrice?.toFixed(2)} (${priceData.count} listing${priceData.count!==1?'s':''})`,
                '💰'
              );
            }
          }
        } else {
          showToast(`${card.hero}: No eBay listings found`, '⚠️');
        }
      }).catch(() => showToast(`${card.hero}: eBay price lookup failed`, '⚠️'));
    }
    // Reset scan mode after price check
    window.scanMode = 'collection';
  } else {
    showToast(`Added: ${card.hero} (${card.cardNumber})${dupeNote}${confNote}`,
              lowConfidence ? '⚠️' : '✅');
  }

  console.log(`Added to ${isPriceCheck ? 'Price Check' : 'Collection'}. Cards: ${collection.cards.length}`);
}

function removeCard(index) {
  const collections = getCollections();
  const currentId   = getCurrentCollectionId();
  const collection  = collections.find(c => c.id === currentId);
  if (!collection?.cards[index]) return;

  const card = collection.cards[index];
  recordDeletedCard(card);
  if (typeof deleteCardImage === 'function') deleteCardImage(card.imageUrl);
  if (card.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(card.imageUrl);

  collection.cards.splice(index, 1);
  collection.stats.scanned = Math.max(0, collection.stats.scanned - 1);
  if (card.scanType === 'free') collection.stats.free = Math.max(0, collection.stats.free - 1);

  saveCollections(collections);
  if (typeof trackCardAdded === 'function') trackCardAdded();
  updateStats();
  renderCards();
  showToast('Card removed', '🗑️');
}

function updateCard(index, field, value) {
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
