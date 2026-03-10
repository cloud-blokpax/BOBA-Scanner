// ============================================================
// js/binder-scanner.js — Multi-card binder page scanner
// Photograph a full binder page (3×3, 2×2, 3×4, etc.) and scan
// every card in one shot. Grid overlay lets users confirm cell
// positions before processing. OCR-first for cost savings.
// ============================================================

// Resolve escapeHtml from window (defined in ui.js core bundle)
const escapeHtml = (...args) => window.escapeHtml(...args);

const BINDER_LAYOUTS = [
  { label: '3 × 3', rows: 3, cols: 3, icon: '▦' },
  { label: '2 × 2', rows: 2, cols: 2, icon: '▤' },
  { label: '3 × 4', rows: 3, cols: 4, icon: '▥' },
  { label: '4 × 3', rows: 4, cols: 3, icon: '▧' },
  { label: '1 × 1', rows: 1, cols: 1, icon: '□' },
];

const CONCURRENCY = 2;                // cells processed in parallel
const EMPTY_VARIANCE_THRESHOLD = 800;  // pixel variance below this = empty slot

let _binderState = null;

// ── Entry point ─────────────────────────────────────────────────
window.openBinderScanner = async function () {
  if (document.getElementById('binderModal')) return;

  _binderState = {
    image: null,            // loaded Image element
    fullCanvas: null,       // full-res canvas with the binder photo
    rows: 3, cols: 3,       // current grid dimensions
    skippedCells: new Set(),// cells user toggled off (0-indexed)
    results: [],            // per-cell scan results
    processing: false,
    processed: 0,
    total: 0,
  };

  // Prompt for tags once upfront — applied to all cards in this batch
  if (typeof promptForTags === 'function') await promptForTags();

  _renderBinderModal();
};

// ── Modal HTML ──────────────────────────────────────────────────
function _renderBinderModal() {
  document.getElementById('binderModal')?.remove();

  const layoutBtns = BINDER_LAYOUTS.map((l, i) =>
    `<button class="binder-layout-btn${i === 0 ? ' active' : ''}" data-rows="${l.rows}" data-cols="${l.cols}" title="${l.label}">${l.icon} ${l.label}</button>`
  ).join('');

  const html = `
    <div class="modal active" id="binderModal">
      <div class="modal-backdrop"></div>
      <div class="modal-content" style="max-width:620px;max-height:92vh;display:flex;flex-direction:column;">
        <div class="modal-header">
          <h2>📖 Binder Page Scan</h2>
          <button class="modal-close" id="binderCloseBtn">×</button>
        </div>

        <div class="modal-body" style="flex:1;overflow-y:auto;padding:12px;">
          <!-- Phase 1: Upload -->
          <div id="binderUploadArea" class="binder-upload-area">
            <div style="font-size:48px;margin-bottom:8px;">📖</div>
            <p style="color:#6b7280;margin:0 0 12px;">Take a photo of your binder page or upload an image</p>
            <button class="btn-primary" id="binderChooseBtn" style="padding:10px 24px;">Choose Binder Photo</button>
            <input type="file" id="binderFileInput" accept="image/*" style="display:none;">
          </div>

          <!-- Phase 2: Grid overlay -->
          <div id="binderGridArea" style="display:none;">
            <div class="binder-layout-bar">${layoutBtns}</div>
            <p class="binder-hint">Tap a cell to skip empty slots</p>
            <div class="binder-canvas-wrap" id="binderCanvasWrap">
              <canvas id="binderImageCanvas"></canvas>
              <canvas id="binderOverlayCanvas"></canvas>
            </div>
          </div>

          <!-- Phase 3: Results -->
          <div id="binderResultsArea" style="display:none;">
            <div class="binder-progress-bar">
              <div class="binder-progress-fill" id="binderProgressFill"></div>
            </div>
            <div id="binderResultsGrid" class="batch-queue" style="margin-top:12px;"></div>
          </div>
        </div>

        <div class="modal-footer" style="flex-direction:column;gap:8px;">
          <div style="display:flex;gap:8px;width:100%;">
            <button class="btn-primary" id="binderScanAllBtn" style="flex:1;display:none;background:linear-gradient(135deg,#6366f1,#4f46e5);">
              Scan All Cards
            </button>
            <button class="btn-primary" id="binderCommitBtn"
                    style="flex:1;display:none;background:linear-gradient(135deg,#10b981,#059669);">
              Add to Collection
            </button>
          </div>
          <button class="btn-secondary" id="binderCancelBtn" style="width:100%;color:#ef4444;border-color:#ef4444;">
            Cancel
          </button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  // Wire events
  document.getElementById('binderChooseBtn').addEventListener('click', () =>
    document.getElementById('binderFileInput').click());
  document.getElementById('binderFileInput').addEventListener('change', _handleBinderImage);
  document.getElementById('binderScanAllBtn').addEventListener('click', _processAllCells);
  document.getElementById('binderCommitBtn').addEventListener('click', _commitBinderBatch);
  document.getElementById('binderCancelBtn').addEventListener('click', _closeBinderScanner);
  document.getElementById('binderCloseBtn').addEventListener('click', _closeBinderScanner);

  // Layout preset buttons
  document.querySelectorAll('.binder-layout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.binder-layout-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _binderState.rows = parseInt(btn.dataset.rows);
      _binderState.cols = parseInt(btn.dataset.cols);
      _binderState.skippedCells.clear();
      _renderGridOverlay();
    });
  });
}

// ── Load binder image ───────────────────────────────────────────
async function _handleBinderImage(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || !file.type.startsWith('image/')) return;

  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    _binderState.image = img;

    // Draw full-res image onto hidden canvas for cropping later
    const canvas = document.getElementById('binderImageCanvas');
    const maxDisplay = 560;
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > maxDisplay || h > maxDisplay) {
      if (w > h) { h = Math.round((h / w) * maxDisplay); w = maxDisplay; }
      else       { w = Math.round((w / h) * maxDisplay); h = maxDisplay; }
    }
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);

    // Full-res canvas for cropping
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = img.naturalWidth;
    fullCanvas.height = img.naturalHeight;
    fullCanvas.getContext('2d').drawImage(img, 0, 0);
    _binderState.fullCanvas = fullCanvas;

    // Setup overlay canvas to match
    const overlay = document.getElementById('binderOverlayCanvas');
    overlay.width = w;
    overlay.height = h;

    // Show grid area, hide upload area
    document.getElementById('binderUploadArea').style.display = 'none';
    document.getElementById('binderGridArea').style.display = 'block';
    document.getElementById('binderScanAllBtn').style.display = 'flex';

    _renderGridOverlay();
    _wireOverlayClicks();

    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    if (typeof showToast === 'function') showToast('Failed to load image', '❌');
  };
  img.src = url;
}

// ── Grid overlay rendering ──────────────────────────────────────
function _renderGridOverlay() {
  const overlay = document.getElementById('binderOverlayCanvas');
  if (!overlay) return;
  const ctx = overlay.getContext('2d');
  const w = overlay.width, h = overlay.height;
  const { rows, cols, skippedCells } = _binderState;

  ctx.clearRect(0, 0, w, h);

  const cellW = w / cols;
  const cellH = h / rows;

  // Draw cell overlays for skipped cells
  for (const idx of skippedCells) {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
    ctx.fillRect(col * cellW, row * cellH, cellW, cellH);
  }

  // Draw grid lines — dark stroke with white shadow for visibility on any background
  ctx.lineWidth = 2;
  for (let r = 0; r <= rows; r++) {
    const y = r * cellH;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y + 1); ctx.lineTo(w, y + 1); ctx.stroke();
    ctx.lineWidth = 2;
  }
  for (let c = 0; c <= cols; c++) {
    const x = c * cellW;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 1, 0); ctx.lineTo(x + 1, h); ctx.stroke();
    ctx.lineWidth = 2;
  }

  // Draw cell numbers
  ctx.font = 'bold 16px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const cx = (c + 0.5) * cellW;
      const cy = (r + 0.5) * cellH;
      const skipped = skippedCells.has(idx);

      // Number badge background
      ctx.fillStyle = skipped ? 'rgba(239,68,68,0.8)' : 'rgba(99,102,241,0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fill();

      // Number text
      ctx.fillStyle = '#fff';
      ctx.fillText(skipped ? '✕' : String(idx + 1), cx, cy + 1);
    }
  }
}

// ── Click on overlay to toggle skip ─────────────────────────────
function _wireOverlayClicks() {
  const overlay = document.getElementById('binderOverlayCanvas');
  if (!overlay) return;
  overlay.addEventListener('click', (e) => {
    if (_binderState.processing) return;
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scaleX = overlay.width / rect.width;
    const scaleY = overlay.height / rect.height;
    const col = Math.floor((x * scaleX) / (overlay.width / _binderState.cols));
    const row = Math.floor((y * scaleY) / (overlay.height / _binderState.rows));
    const idx = row * _binderState.cols + col;
    if (idx < 0 || idx >= _binderState.rows * _binderState.cols) return;

    if (_binderState.skippedCells.has(idx)) _binderState.skippedCells.delete(idx);
    else _binderState.skippedCells.add(idx);

    _renderGridOverlay();
  });
}

// ── Extract cell images from full-res canvas ────────────────────
function _extractCellImages() {
  const { fullCanvas, rows, cols, skippedCells } = _binderState;
  const fw = fullCanvas.width, fh = fullCanvas.height;
  const cellW = fw / cols, cellH = fh / rows;
  const cells = [];

  // Add inset padding (5%) to avoid grid lines and binder plastic edges
  const padX = cellW * 0.05;
  const padY = cellH * 0.05;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (skippedCells.has(idx)) {
        cells.push({ idx, skipped: true, canvas: null, blob: null });
        continue;
      }

      const sx = Math.round(c * cellW + padX);
      const sy = Math.round(r * cellH + padY);
      const sw = Math.round(cellW - padX * 2);
      const sh = Math.round(cellH - padY * 2);

      const cellCanvas = document.createElement('canvas');
      cellCanvas.width = sw;
      cellCanvas.height = sh;
      cellCanvas.getContext('2d').drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

      cells.push({ idx, skipped: false, canvas: cellCanvas, blob: null });
    }
  }
  return cells;
}

// ── Check if a cell is empty (low pixel variance) ───────────────
function _isCellEmpty(canvas) {
  const ctx = canvas.getContext('2d');
  // Sample from center 60% of cell to avoid edges
  const sx = Math.floor(canvas.width * 0.2);
  const sy = Math.floor(canvas.height * 0.2);
  const sw = Math.floor(canvas.width * 0.6);
  const sh = Math.floor(canvas.height * 0.6);
  const data = ctx.getImageData(sx, sy, sw, sh).data;

  // Calculate luminance variance
  let sum = 0, sumSq = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    sum += lum;
    sumSq += lum * lum;
  }
  const mean = sum / n;
  const variance = (sumSq / n) - (mean * mean);

  return variance < EMPTY_VARIANCE_THRESHOLD;
}

// ── Process all cells ───────────────────────────────────────────
async function _processAllCells() {
  if (_binderState.processing) return;
  _binderState.processing = true;

  // Hide grid area, show results area
  document.getElementById('binderGridArea').style.display = 'none';
  document.getElementById('binderScanAllBtn').style.display = 'none';
  document.getElementById('binderResultsArea').style.display = 'block';

  const cells = _extractCellImages();
  const activeCells = cells.filter(c => !c.skipped);
  _binderState.total = activeCells.length;
  _binderState.processed = 0;
  _binderState.results = cells.map(c => ({
    idx: c.idx,
    skipped: c.skipped,
    status: c.skipped ? 'skipped' : 'queued',
    match: null,
    error: null,
    scanType: null,
    confidence: null,
    imageBase64: null,
    imageUrl: null,
    displayUrl: null,
    isDuplicate: false,
  }));

  // Render initial tile grid
  _renderResultTiles(cells);

  // Wait for database to be ready
  let waited = 0;
  while (!ready.db && waited < 10000) { await new Promise(r => setTimeout(r, 300)); waited += 300; }
  if (!ready.db) {
    if (typeof showToast === 'function') showToast('Database not ready', '❌');
    _binderState.processing = false;
    return;
  }

  // Process cells with concurrency limit
  const queue = activeCells.slice();
  const workers = [];
  for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
    workers.push(_processCellWorker(queue, cells));
  }
  await Promise.all(workers);

  _binderState.processing = false;
  _updateBinderUI();
}

async function _processCellWorker(queue, allCells) {
  while (queue.length > 0) {
    const cell = queue.shift();
    if (!cell || cell.skipped) continue;

    const result = _binderState.results[cell.idx];
    result.status = 'processing';
    _updateResultTile(result, cell);

    try {
      await _processOneCell(cell, result);
    } catch (err) {
      result.status = 'error';
      result.error = err.message;
    }

    _binderState.processed++;
    _updateResultTile(result, cell);
    _updateProgress();
  }
}

// ── Process a single cell ───────────────────────────────────────
async function _processOneCell(cell, result) {
  // Empty slot detection
  if (_isCellEmpty(cell.canvas)) {
    result.status = 'empty';
    result.error = 'Empty slot';
    return;
  }

  // Convert cell canvas to Blob then compress
  const blob = await new Promise(resolve =>
    cell.canvas.toBlob(resolve, 'image/jpeg', 0.92));
  const imageBase64 = await compressImage(blob);
  result.imageBase64 = imageBase64;

  // Create display URL
  result.displayUrl = URL.createObjectURL(blob);

  // Upload image (non-fatal)
  let imageUrl = `data:image/jpeg;base64,${imageBase64}`;
  if (typeof uploadCardImage === 'function') {
    try {
      const uploaded = await uploadCardImage(imageBase64, `binder_cell_${cell.idx}.jpg`);
      if (uploaded) imageUrl = uploaded;
    } catch (e) { console.warn('Binder cell upload failed:', e.message); }
  }
  result.imageUrl = imageUrl;

  // ── OCR-first path (free) ──────────────────────────────────────
  if (ready.ocr && typeof tesseractWorker !== 'undefined' && tesseractWorker) {
    try {
      const ocrResult = await Promise.race([
        runOCR(result.displayUrl),
        new Promise((_, rej) => setTimeout(() => rej(new Error('OCR timeout')), 4000))
      ]);

      if (ocrResult.cardNumber) {
        let match = findCard(ocrResult.cardNumber);

        // Try scan learning correction
        if (!match && typeof checkCorrection === 'function') {
          const corrected = checkCorrection(ocrResult.cardNumber);
          if (corrected) match = findCard(corrected);
        }

        if (match) {
          result.match = match;
          result.scanType = 'free';
          result.confidence = ocrResult.confidence || 70;
          result.status = 'done';
          _flagDuplicate(result);
          return;
        }
      }
    } catch (ocrErr) {
      console.log(`Cell ${cell.idx}: OCR failed — ${ocrErr.message}`);
    }
  }

  // ── AI fallback ────────────────────────────────────────────────
  const canCall = typeof canMakeApiCall === 'function' ? await canMakeApiCall() : true;
  if (!canCall) {
    result.status = 'error';
    result.error = 'API limit reached';
    return;
  }

  const extracted = await callAPI(imageBase64);
  if (!extracted?.cardNumber) {
    result.status = 'error';
    result.error = 'Card not identified';
    return;
  }

  const match = findCard(extracted.cardNumber, extracted.hero, extracted.visualTheme || '');
  if (!match) {
    result.status = 'error';
    result.error = `No DB match: "${extracted.cardNumber}"`;
    return;
  }

  if (typeof trackApiCall === 'function') await trackApiCall('scan', true, config.aiCost, 1);

  result.match = match;
  result.scanType = 'ai';
  result.confidence = extracted.confidence || 85;
  result.status = 'done';
  _flagDuplicate(result);
}

function _flagDuplicate(result) {
  if (!result.match) return;
  const allCards = getCollections().flatMap(c => c.cards);
  result.isDuplicate = allCards.some(c =>
    c.cardId && c.cardId === String(result.match['Card ID'] || ''));
}

// ── Result tiles UI ─────────────────────────────────────────────
function _renderResultTiles(cells) {
  const grid = document.getElementById('binderResultsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  for (const cell of cells) {
    const result = _binderState.results[cell.idx];
    const tile = document.createElement('div');
    tile.className = 'batch-card-tile';
    tile.id = `binder_tile_${cell.idx}`;

    if (cell.skipped) {
      tile.classList.add('binder-tile-skipped');
      tile.innerHTML = `
        <div class="batch-thumb-wrap" style="display:flex;align-items:center;justify-content:center;background:#f3f4f6;">
          <span style="font-size:24px;opacity:0.4;">✕</span>
        </div>
        <div class="batch-tile-info">
          <span style="font-size:11px;color:#9ca3af;">Skipped</span>
        </div>`;
    } else {
      // Preview from the display canvas
      const thumbSrc = cell.canvas ? cell.canvas.toDataURL('image/jpeg', 0.5) : '';
      tile.innerHTML = `
        <div class="batch-thumb-wrap">
          ${thumbSrc ? `<img class="batch-thumb" src="${thumbSrc}" alt="Cell ${cell.idx + 1}">` : ''}
          <div class="batch-tile-status" id="binder_status_${cell.idx}"><span class="batch-spinner-anim">⏳</span></div>
        </div>
        <div class="batch-tile-info" id="binder_info_${cell.idx}">
          <span style="font-size:11px;color:#9ca3af;">Cell ${cell.idx + 1} — queued</span>
        </div>`;
    }
    grid.appendChild(tile);
  }
}

function _updateResultTile(result, cell) {
  const statusEl = document.getElementById(`binder_status_${result.idx}`);
  const infoEl = document.getElementById(`binder_info_${result.idx}`);
  const tile = document.getElementById(`binder_tile_${result.idx}`);
  if (!statusEl || !infoEl) return;

  if (result.status === 'processing') {
    statusEl.innerHTML = '<span class="batch-spinner-anim">⏳</span>';
    infoEl.innerHTML = '<span style="font-size:11px;color:#6366f1;">Scanning...</span>';
  } else if (result.status === 'done') {
    const dupBadge = result.isDuplicate
      ? '<span style="background:#fef3c7;color:#92400e;font-size:9px;padding:1px 5px;border-radius:4px;margin-left:4px;">DUP</span>'
      : '';
    const typeBadge = result.scanType === 'free'
      ? '<span style="background:#d1fae5;color:#065f46;font-size:9px;padding:1px 5px;border-radius:4px;">FREE</span>'
      : '<span style="background:#fef3c7;color:#92400e;font-size:9px;padding:1px 5px;border-radius:4px;">AI</span>';

    statusEl.innerHTML = '✅';
    tile?.classList.add('batch-tile-done');
    infoEl.innerHTML = `
      <span style="font-size:11px;font-weight:600;color:#111;">${escapeHtml(result.match?.Name || 'Unknown')}</span>
      <span style="font-size:10px;color:#6b7280;">${escapeHtml(result.match?.['Card Number'] || '')} ${typeBadge}${dupBadge}</span>`;
  } else if (result.status === 'empty') {
    statusEl.innerHTML = '⬜';
    tile?.classList.add('binder-tile-skipped');
    infoEl.innerHTML = '<span style="font-size:11px;color:#9ca3af;">Empty slot</span>';
  } else if (result.status === 'error') {
    statusEl.innerHTML = '❌';
    tile?.classList.add('batch-tile-error');
    infoEl.innerHTML = `<span style="font-size:11px;color:#ef4444;">${escapeHtml(result.error || 'Failed')}</span>`;
  }
}

function _updateProgress() {
  const fill = document.getElementById('binderProgressFill');
  if (fill && _binderState.total > 0) {
    const pct = Math.round((_binderState.processed / _binderState.total) * 100);
    fill.style.width = `${pct}%`;
  }
}

function _updateBinderUI() {
  const done = _binderState.results.filter(r => r.status === 'done').length;
  const commitBtn = document.getElementById('binderCommitBtn');
  if (commitBtn) {
    if (done > 0 && !_binderState.processing) {
      commitBtn.style.display = 'flex';
      commitBtn.textContent = `✅ Add ${done} Card${done !== 1 ? 's' : ''} to Collection`;
    } else {
      commitBtn.style.display = 'none';
    }
  }
}

// ── Commit to collection ────────────────────────────────────────
async function _commitBinderBatch() {
  const toAdd = _binderState.results.filter(r => r.status === 'done' && r.match);
  if (toAdd.length === 0) {
    if (typeof showToast === 'function') showToast('No identified cards to add', '⚠️');
    return;
  }

  let added = 0;
  for (const entry of toAdd) {
    const card = {
      cardId: entry.match['Card ID'] || '',
      hero: entry.match.Name || '',
      athlete: entry.match.Athlete || '',
      year: entry.match.Year || '',
      set: entry.match.Set || '',
      cardNumber: entry.match['Card Number'] || '',
      pose: entry.match.Parallel || '',
      weapon: entry.match.Weapon || '',
      power: entry.match.Power || '',
      imageUrl: entry.imageUrl || '',
      fileName: `binder_cell_${entry.idx}.jpg`,
      scanType: entry.scanType === 'free' ? 'free' : 'ai',
      scanMethod: entry.scanType === 'free'
        ? `Free OCR (${Math.round(entry.confidence || 0)}%)`
        : 'AI + Database',
      timestamp: new Date().toISOString(),
      tags: [],
      condition: '',
      notes: 'Scanned via Binder Page Scanner',
      readyToList: false,
      confidence: entry.confidence,
    };

    const collections = getCollections();
    const col = collections.find(c => c.id === getCurrentCollectionId());
    if (!col) continue;

    col.cards.push(card);
    col.stats.scanned++;
    if (card.scanType === 'free') col.stats.free++;
    if (card.scanType === 'ai') col.stats.aiCalls = (col.stats.aiCalls || 0) + 1;
    saveCollections(collections);

    if (typeof addToScanHistory === 'function') {
      addToScanHistory({
        hero: card.hero,
        cardNumber: card.cardNumber,
        set: card.set,
        scanType: card.scanType,
        confidence: card.confidence,
        success: true,
      });
    }
    added++;
  }

  if (typeof trackCardAdded === 'function') await trackCardAdded();
  if (typeof updateStats === 'function') updateStats();
  if (typeof renderCards === 'function') renderCards();

  _closeBinderScanner();

  const freeCount = toAdd.filter(r => r.scanType === 'free').length;
  const aiCount = toAdd.filter(r => r.scanType === 'ai').length;
  const summary = freeCount > 0
    ? `Added ${added} cards (${freeCount} free, ${aiCount} AI)`
    : `Added ${added} cards`;

  if (typeof showToast === 'function') showToast(summary, '📖');
  if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
}

// ── Cleanup & close ─────────────────────────────────────────────
function _closeBinderScanner() {
  if (_binderState) {
    for (const r of _binderState.results) {
      if (r.displayUrl?.startsWith('blob:')) URL.revokeObjectURL(r.displayUrl);
    }
  }
  _binderState = null;
  document.getElementById('binderModal')?.remove();
}

console.log('✅ Binder scanner module loaded');
