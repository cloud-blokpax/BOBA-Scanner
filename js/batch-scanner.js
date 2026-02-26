// ============================================================
// js/batch-scanner.js — Real batch scanning with queue UI
// Up to 10 cards. OCR + AI runs in background immediately after
// selection. Results held in pendingResults[] until user confirms.
// Nothing written to collection until "Add to Collection" pressed.
// ============================================================

const BATCH_CAP = 10;
let _pendingResults  = [];
let _processingCount = 0;

window.openBatchScanner = async function() {
  if (document.getElementById('batchModal')) return;
  _pendingResults  = [];
  _processingCount = 0;
  // Prompt for tags once upfront — applied to all cards in this batch
  if (typeof promptForTags === 'function') await promptForTags();
  renderBatchModal();
};

function renderBatchModal() {
  document.getElementById('batchModal')?.remove();
  const html = `
    <div class="modal active" id="batchModal">
      <div class="modal-backdrop"></div>
      <div class="modal-content" style="max-width:560px;max-height:90vh;display:flex;flex-direction:column;">
        <div class="modal-header">
          <h2>📸 Batch Scan</h2>
          <div style="display:flex;align-items:center;gap:8px;">
            <span id="batchCount" style="font-size:13px;color:#6b7280;">0 / ${BATCH_CAP} cards</span>
            <button class="modal-close" id="batchCloseBtn">×</button>
          </div>
        </div>
        <div class="modal-body" style="flex:1;overflow-y:auto;padding:16px;">
          <div id="batchQueue" class="batch-queue">
            <div class="batch-empty-hint">
              <div style="font-size:40px;margin-bottom:8px;">📷</div>
              <p style="color:#9ca3af;margin:0;">Tap "Add Cards" to select up to ${BATCH_CAP} images.</p>
              <p style="color:#9ca3af;font-size:12px;margin:4px 0 0;">Cards are scanned immediately in the background.</p>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="flex-direction:column;gap:8px;">
          <div style="display:flex;gap:8px;width:100%;">
            <input type="file" id="batchFileInput" accept="image/*" multiple style="display:none;">
            <button class="btn-secondary" id="batchAddBtn" style="flex:1;">＋ Add Cards</button>
            <button class="btn-primary" id="batchCommitBtn"
                    style="flex:1;display:none;background:linear-gradient(135deg,#10b981,#059669);">
              ✅ Add to Collection
            </button>
          </div>
          <button class="btn-secondary" id="batchCancelBtn" style="width:100%;color:#ef4444;border-color:#ef4444;">
            Cancel
          </button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('batchAddBtn').addEventListener('click', () => {
    if (_pendingResults.length >= BATCH_CAP) { showToast(`Max ${BATCH_CAP} cards per batch`, '⚠️'); return; }
    document.getElementById('batchFileInput').click();
  });
  document.getElementById('batchFileInput').addEventListener('change', handleBatchFiles);
  document.getElementById('batchCommitBtn').addEventListener('click', commitBatch);
  document.getElementById('batchCancelBtn').addEventListener('click', closeBatchModal);
  document.getElementById('batchCloseBtn').addEventListener('click', closeBatchModal);
}

function closeBatchModal() {
  for (const r of _pendingResults) {
    if (r.displayUrl?.startsWith('blob:')) URL.revokeObjectURL(r.displayUrl);
  }
  _pendingResults  = [];
  _processingCount = 0;
  document.getElementById('batchModal')?.remove();
}

async function handleBatchFiles(e) {
  const files = [...(e.target.files || [])].filter(f => f.type.startsWith('image/'));
  e.target.value = '';
  const slots = BATCH_CAP - _pendingResults.length;
  if (slots <= 0) { showToast(`Max ${BATCH_CAP} cards reached`, '⚠️'); return; }
  const toProcess = files.slice(0, slots);
  if (files.length > slots) showToast(`Only ${slots} slot${slots !== 1 ? 's' : ''} remaining`, '⚠️');
  for (const file of toProcess) {
    const id = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const displayUrl = URL.createObjectURL(file);
    const entry = { id, file, displayUrl, status: 'queued', match: null, error: null, confidence: null };
    _pendingResults.push(entry);
    addBatchCard(entry);
  }
  updateBatchUI();
  for (const entry of _pendingResults.filter(r => r.status === 'queued')) {
    processBatchEntry(entry);
  }
}

function addBatchCard(entry) {
  const queue = document.getElementById('batchQueue');
  if (!queue) return;
  queue.querySelector('.batch-empty-hint')?.remove();
  const tile = document.createElement('div');
  tile.className = 'batch-card-tile';
  tile.id        = `btile_${entry.id}`;
  tile.innerHTML = `
    <div class="batch-thumb-wrap">
      <img class="batch-thumb" src="${entry.displayUrl}" alt="card">
      <div class="batch-tile-status" id="bstatus_${entry.id}"><span class="batch-spinner-anim">⏳</span></div>
    </div>
    <div class="batch-tile-info" id="binfo_${entry.id}">
      <span style="font-size:11px;color:#9ca3af;">Scanning...</span>
    </div>
    <button class="batch-tile-remove" onclick="removeBatchEntry('${entry.id}')" title="Remove">✕</button>`;
  queue.appendChild(tile);
}

async function processBatchEntry(entry) {
  entry.status = 'processing';
  _processingCount++;
  updateBatchStatusTile(entry);
  try {
    let waited = 0;
    while (!ready.db && waited < 10000) { await new Promise(r => setTimeout(r, 300)); waited += 300; }
    if (!ready.db) throw new Error('Database not ready');

    const imageBase64 = await compressImage(entry.file);
    entry.imageBase64 = imageBase64;

    // Image upload — non-fatal if it fails (falls back to base64)
    let imageUrl = `data:image/jpeg;base64,${imageBase64}`;
    if (typeof uploadCardImage === 'function') {
      try {
        const uploaded = await uploadCardImage(imageBase64, entry.file.name);
        if (uploaded) imageUrl = uploaded;
      } catch {}
    }
    entry.imageUrl = imageUrl;

    // Batch mode skips OCR entirely — parallel OCR calls destroy the shared
    // Tesseract worker (it's single-instance). Go straight to AI for reliability.
    let match = null;
    const canCall = typeof canMakeApiCall === 'function' ? await canMakeApiCall() : true;
    if (!canCall) throw new Error('API limit reached');

    const extracted = await callAPI(imageBase64);
    if (!extracted?.cardNumber) throw new Error('Card not identified');

    match = findCard(extracted.cardNumber, extracted.hero);
    if (!match) throw new Error(`No match found for "${extracted.cardNumber}"`);

    if (typeof trackApiCall === 'function') await trackApiCall('scan', true, 0.01, 1);

    entry.match      = match;
    entry.scanType   = 'ai';
    entry.confidence = extracted.confidence || 85;
    entry.status     = 'done';

    // Flag duplicates for user awareness
    const allCards = getCollections().flatMap(c => c.cards);
    entry.isDuplicate = allCards.some(c => c.cardId && c.cardId === String(match['Card ID'] || ''));

  } catch (err) {
    entry.status = 'error';
    entry.error  = err.message;
  }
  _processingCount--;
  updateBatchStatusTile(entry);
  updateBatchUI();
}

function updateBatchStatusTile(entry) {
  const statusEl = document.getElementById(`bstatus_${entry.id}`);
  const infoEl   = document.getElementById(`binfo_${entry.id}`);
  const tile     = document.getElementById(`btile_${entry.id}`);
  if (!statusEl || !infoEl) return;
  if (entry.status === 'processing') {
    statusEl.innerHTML = '<span class="batch-spinner-anim">⏳</span>';
    infoEl.innerHTML   = '<span style="font-size:11px;color:#9ca3af;">Scanning...</span>';
  } else if (entry.status === 'done') {
    const dupBadge  = entry.isDuplicate ? '<span style="background:#fef3c7;color:#92400e;font-size:9px;padding:1px 5px;border-radius:4px;margin-left:4px;">DUP</span>' : '';
    const typeBadge = entry.scanType === 'free'
      ? '<span style="background:#d1fae5;color:#065f46;font-size:9px;padding:1px 5px;border-radius:4px;">OCR</span>'
      : '<span style="background:#fef3c7;color:#92400e;font-size:9px;padding:1px 5px;border-radius:4px;">AI</span>';
    statusEl.innerHTML = '✅';
    tile?.classList.add('batch-tile-done');
    infoEl.innerHTML = `
      <span style="font-size:11px;font-weight:600;color:#111;">${escapeHtml(entry.match?.Name || 'Unknown')}</span>
      <span style="font-size:10px;color:#6b7280;">${escapeHtml(entry.match?.['Card Number'] || '')} ${typeBadge}${dupBadge}</span>`;
  } else if (entry.status === 'error') {
    statusEl.innerHTML = '❌';
    tile?.classList.add('batch-tile-error');
    infoEl.innerHTML = `<span style="font-size:11px;color:#ef4444;">${escapeHtml(entry.error || 'Failed')}</span>`;
  }
}

window.removeBatchEntry = function(id) {
  const idx = _pendingResults.findIndex(r => r.id === id);
  if (idx === -1) return;
  const entry = _pendingResults.splice(idx, 1)[0];
  if (entry.displayUrl?.startsWith('blob:')) URL.revokeObjectURL(entry.displayUrl);
  document.getElementById(`btile_${id}`)?.remove();
  updateBatchUI();
  if (_pendingResults.length === 0) {
    const queue = document.getElementById('batchQueue');
    if (queue) queue.innerHTML = `<div class="batch-empty-hint"><div style="font-size:40px;margin-bottom:8px;">📷</div><p style="color:#9ca3af;margin:0;">Tap "Add Cards" to select images.</p></div>`;
  }
};

function updateBatchUI() {
  const total    = _pendingResults.length;
  const done     = _pendingResults.filter(r => r.status === 'done').length;
  const countEl  = document.getElementById('batchCount');
  const commitBtn = document.getElementById('batchCommitBtn');
  const addBtn   = document.getElementById('batchAddBtn');
  if (countEl)  countEl.textContent = `${total} / ${BATCH_CAP} cards`;
  if (addBtn)   addBtn.disabled = total >= BATCH_CAP;
  if (commitBtn) {
    const hasReady = done > 0 && _processingCount === 0;
    commitBtn.style.display = hasReady ? 'flex' : 'none';
    if (hasReady) commitBtn.textContent = `✅ Add ${done} Card${done !== 1 ? 's' : ''} to Collection`;
  }
}

async function commitBatch() {
  let waited = 0;
  while (_processingCount > 0 && waited < 5000) { await new Promise(r => setTimeout(r, 200)); waited += 200; }
  const toAdd = _pendingResults.filter(r => r.status === 'done' && r.match);
  if (toAdd.length === 0) { showToast('No identified cards to add', '⚠️'); return; }
  let added = 0;
  for (const entry of toAdd) {
    const card = {
      cardId: entry.match['Card ID'] || '', hero: entry.match.Name || '',
      year: entry.match.Year || '', set: entry.match.Set || '',
      cardNumber: entry.match['Card Number'] || '', pose: entry.match.Parallel || '',
      weapon: entry.match.Weapon || '', power: entry.match.Power || '',
      imageUrl: entry.imageUrl || '', fileName: entry.file.name,
      scanType: entry.scanType,
      scanMethod: entry.scanType === 'free' ? `Free OCR (${Math.round(entry.confidence || 0)}%)` : 'AI + Database',
      timestamp: new Date().toISOString(), tags: [],
      condition: '', notes: '', readyToList: false, confidence: entry.confidence
    };
    const collections = getCollections();
    const col = collections.find(c => c.id === getCurrentCollectionId());
    if (!col) continue;
    col.cards.push(card);
    col.stats.scanned++;
    if (card.scanType === 'free') col.stats.free++;
    if (card.scanType === 'ai')   col.stats.aiCalls = (col.stats.aiCalls || 0) + 1;
    saveCollections(collections);
    if (typeof addToScanHistory === 'function') {
      addToScanHistory({ hero: card.hero, cardNumber: card.cardNumber, set: card.set,
                         scanType: card.scanType, confidence: card.confidence, success: true });
    }
    added++;
  }
  if (typeof trackCardAdded === 'function') await trackCardAdded();
  if (typeof updateStats    === 'function') updateStats();
  if (typeof renderCards    === 'function') renderCards();
  closeBatchModal();
  showToast(`Added ${added} card${added !== 1 ? 's' : ''} to collection`, '✅');
  if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
}

console.log('✅ Batch scanner module loaded');
