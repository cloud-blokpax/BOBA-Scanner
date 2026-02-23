// ============================================================
// js/scanner.js — UPDATED v1.1
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

  let imageUrl = `data:image/jpeg;base64,${imageBase64}`;
  if (typeof uploadCardImage === 'function') {
    const uploadedUrl = await uploadCardImage(imageBase64, file.name);
    if (uploadedUrl) imageUrl = uploadedUrl;
  }

  const displayUrl = URL.createObjectURL(file);

  try {
    return await _doProcessImage(imageBase64, imageUrl, displayUrl, file.name);
  } finally {}
}

async function _doProcessImage(imageBase64, imageUrl, displayUrl, fileName) {
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
          addCard(match, imageUrl, fileName, 'free', ocrResult.confidence);
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

    match = findCard(cardNum, heroName);

    if (match) {
      showLoading(false);
      const lowConf = confidence < 70;
      addCard(match, imageUrl, fileName, 'ai', confidence, lowConf);
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
      <div class="modal-backdrop" onclick="closeManualSearch()"></div>
      <div class="modal-content" style="max-width:480px;">
        <div class="modal-header">
          <h2>🔍 Identify Card Manually</h2>
          <button class="modal-close" onclick="closeManualSearch()">×</button>
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
                   placeholder="e.g. BF-108 or Bo Jackson"
                   value="${escapeHtml(suggestedCardNum || '')}"
                   style="flex:1;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
            <button onclick="runManualSearch()" class="btn-tag-add">Search</button>
          </div>
          <div id="manualSearchResults" style="max-height:320px;overflow-y:auto;display:none;"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="closeManualSearch()">Cancel</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  window._manualSearchContext = { imageUrl, fileName };

  const input = document.getElementById('manualSearchInput');
  if (input) {
    input.focus();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') runManualSearch(); });
  }
  if (suggestedCardNum) setTimeout(runManualSearch, 100);
}

window.runManualSearch = function() {
  const query = document.getElementById('manualSearchInput')?.value.trim();
  if (!query) return;
  const results = searchDatabase(query);
  const el = document.getElementById('manualSearchResults');
  if (!el) return;

  if (results.length === 0) {
    el.style.display = 'block';
    el.innerHTML = `<p style="text-align:center;color:#9ca3af;padding:20px 0;">No cards found for "${escapeHtml(query)}"</p>`;
    return;
  }

  el.style.display = 'block';
  el.innerHTML = results.slice(0, 20).map(card => `
    <div class="manual-search-row" onclick="selectManualCard('${escapeHtml(String(card['Card ID']))}')">
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

function addCard(match, displayUrl, fileName, type, confidence = null, lowConfidence = false) {
  console.log('Adding card:', match['Card Number']);

  const collections = getCollections();
  const currentId   = getCurrentCollectionId();
  const collection  = collections.find(c => c.id === currentId);

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

  saveCollections(collections);

  if (typeof trackCardAdded === 'function') trackCardAdded();

  updateStats();
  renderCards();

  if (navigator.vibrate) navigator.vibrate(type === 'free' ? 50 : [50, 100, 50]);

  const dupeNote = dupeCount > 0 ? ` (copy #${dupeCount + 1})` : '';
  const confNote = lowConfidence ? ' ⚠️ low confidence — please verify' : '';
  showToast(`Added: ${card.hero} (${card.cardNumber})${dupeNote}${confNote}`,
            lowConfidence ? '⚠️' : '✅');

  console.log(`Added. Collection now has ${collection.cards.length} cards`);
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
