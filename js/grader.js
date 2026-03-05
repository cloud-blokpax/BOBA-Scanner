// js/grader.js — AI Condition Grader
// Estimates PSA/BGS card grade using Claude Vision via /api/grade

// ── Grade a card from a base64 image ─────────────────────────────────────────
async function gradeCard(imageData) {
  const apiBase = (typeof appConfig !== 'undefined' && appConfig.apiBase)
    ? appConfig.apiBase
    : 'https://boba-scanner.vercel.app/api';

  const headers = { 'Content-Type': 'application/json' };
  const apiToken = (typeof appConfig !== 'undefined') ? appConfig.apiToken : null;
  if (apiToken) headers['X-Api-Token'] = apiToken;

  const res = await fetch(`${apiBase}/grade`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ imageData })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Grade API error: ${res.status}`);
  }

  const data = await res.json();
  // Claude returns { content: [{ type: 'text', text: '...' }] }
  const rawText = data.content?.[0]?.text || '';
  const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(jsonStr);
}

// ── Show grade result modal ───────────────────────────────────────────────────
function showGradeModal(result, cardName) {
  document.getElementById('gradeModal')?.remove();

  const grade = result.grade || 0;
  const gradeColor = grade >= 9 ? '#16a34a' : grade >= 7 ? '#d97706' : grade >= 5 ? '#ea580c' : '#dc2626';
  const submitBadge = {
    yes:   { label: 'Worth Submitting', color: '#16a34a', icon: '✅' },
    maybe: { label: 'Borderline',       color: '#d97706', icon: '⚠️' },
    no:    { label: 'Not Cost-Effective', color: '#6b7280', icon: '💡' }
  }[result.submit_recommendation] || { label: 'Unknown', color: '#6b7280', icon: '❓' };

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal active" id="gradeModal">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2>🔬 Condition Grade</h2>
          <button class="modal-close" id="gradeModalClose">×</button>
        </div>
        <div class="modal-body" style="padding:16px;">

          <div style="text-align:center;margin-bottom:20px;">
            <div style="font-size:13px;color:#6b7280;margin-bottom:4px;">${escapeHtml(cardName || 'Card')}</div>
            <div style="font-size:72px;font-weight:900;color:${gradeColor};line-height:1;">${grade}</div>
            <div style="font-size:18px;font-weight:700;color:${gradeColor};margin-top:4px;">PSA ${grade} · ${escapeHtml(result.grade_label || '')}</div>
            <div style="font-size:13px;color:#6b7280;margin-top:4px;">Confidence: ${result.confidence || 0}%</div>
          </div>

          <div style="display:grid;gap:10px;margin-bottom:16px;">
            ${renderGradeRow('📐', 'Centering',  result.centering)}
            ${renderGradeRow('🔻', 'Corners',    result.corners)}
            ${renderGradeRow('📏', 'Edges',      result.edges)}
            ${renderGradeRow('✨', 'Surface',    result.surface)}
          </div>

          <div style="background:#f9fafb;border-radius:10px;padding:14px;margin-bottom:14px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Grader Summary</div>
            <div style="font-size:13px;color:#374151;line-height:1.5;">${escapeHtml(result.summary || '')}</div>
          </div>

          <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#f0fdf4;border-radius:8px;border:1px solid #d1fae5;">
            <span style="font-size:18px;">${submitBadge.icon}</span>
            <div>
              <div style="font-size:13px;font-weight:600;color:${submitBadge.color};">${submitBadge.label}</div>
              <div style="font-size:12px;color:#6b7280;">Submission recommendation</div>
            </div>
          </div>

        </div>
        <div class="modal-footer">
          <div style="font-size:11px;color:#9ca3af;flex:1;">AI estimate only — not a certified grade</div>
          <button class="btn-secondary" id="gradeModalCloseBtn">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper.firstElementChild);
  document.getElementById('gradeModalClose')?.addEventListener('click', () => document.getElementById('gradeModal')?.remove());
  document.getElementById('gradeModalCloseBtn')?.addEventListener('click', () => document.getElementById('gradeModal')?.remove());
  document.querySelector('#gradeModal .modal-backdrop')?.addEventListener('click', () => document.getElementById('gradeModal')?.remove());
}

function renderGradeRow(icon, label, value) {
  if (!value) return '';
  return `
    <div style="display:flex;gap:10px;align-items:flex-start;font-size:13px;">
      <span style="flex-shrink:0;width:20px;text-align:center;">${icon}</span>
      <div>
        <span style="font-weight:600;color:#374151;">${label}: </span>
        <span style="color:#6b7280;">${escapeHtml(value)}</span>
      </div>
    </div>`;
}

// ── Grade button trigger ──────────────────────────────────────────────────────
// Called from the scan result area after a successful scan
async function triggerGradeCard() {
  if (!isFeatureEnabled('condition_grader')) {
    showToast('Condition Grader requires membership', '🔒');
    return;
  }

  // Get the most recent scan's image from the scan result area
  const previewImg = document.getElementById('cardPreview') || document.getElementById('scanPreviewImg');
  if (!previewImg || !previewImg.src || previewImg.src.startsWith('data:image/gif')) {
    showToast('No card image to grade — scan a card first', '⚠️');
    return;
  }

  const cardName = document.getElementById('resultHero')?.textContent
    || document.getElementById('heroName')?.textContent
    || 'Card';

  showLoading(true, 'Analyzing card condition...');

  try {
    // Convert img src to base64 if needed (already base64 from scan, or fetch for blob/http)
    let imageData = previewImg.src;
    if (imageData.startsWith('data:image')) {
      imageData = imageData.split(',')[1]; // strip data:image/jpeg;base64,
    } else {
      // Fetch and convert external/blob URL
      const blob = await fetch(previewImg.src).then(r => r.blob());
      imageData = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });
    }

    const result = await gradeCard(imageData);
    showLoading(false);
    showGradeModal(result, cardName);

  } catch (err) {
    showLoading(false);
    console.error('Grade error:', err);
    showToast('Grading failed — try again', '❌');
  }
}

// ── Grade a specific card by index (from card detail modal or card grid) ──────
async function gradeCardFromDetail(index) {
  const collections = (typeof getCollections === 'function') ? getCollections() : [];
  const currentId   = (typeof getCurrentCollectionId === 'function') ? getCurrentCollectionId() : 'default';
  const collection  = collections.find(c => c.id === currentId);
  const card        = collection?.cards[index];
  if (!card) { showToast('Card not found', '❌'); return; }

  if (!card.imageUrl) {
    showToast('No image for this card — re-attach a photo first', '⚠️');
    return;
  }

  showLoading(true, 'Analyzing card condition...');
  try {
    const imageData = await urlToBase64(card.imageUrl);
    const result = await gradeCard(imageData);
    showLoading(false);
    showGradeModal(result, card.hero || card.cardNumber || 'Card');
  } catch (err) {
    showLoading(false);
    console.error('Grade from detail error:', err);
    showToast('Grading failed — try again', '❌');
  }
}

// ── Grade button on card grid (via "⋯ More" menu) ────────────────────────────
async function gradeCardByIndex(index) {
  await gradeCardFromDetail(index);
}

// ── Grade from More menu (show card picker first) ─────────────────────────────
function triggerGradeCardWithPicker() {
  if (!isFeatureEnabled('condition_grader')) {
    showToast('Condition Grader requires membership', '🔒');
    return;
  }
  showCardPickerModal('🔬 Grade Card', 'Select a card to grade', async (index) => {
    await gradeCardFromDetail(index);
  });
}

// ── triggerGradeCard: still works if a scan image is visible, else shows picker
async function triggerGradeCard() {
  if (!isFeatureEnabled('condition_grader')) {
    showToast('Condition Grader requires membership', '🔒');
    return;
  }
  const previewImg = document.getElementById('cardPreview') || document.getElementById('scanPreviewImg');
  if (previewImg && previewImg.src && !previewImg.src.startsWith('data:image/gif') && previewImg.src !== window.location.href) {
    // Image available from scan
    const cardName = document.getElementById('resultHero')?.textContent
      || document.getElementById('heroName')?.textContent
      || 'Card';
    showLoading(true, 'Analyzing card condition...');
    try {
      const imageData = await urlToBase64(previewImg.src);
      const result = await gradeCard(imageData);
      showLoading(false);
      showGradeModal(result, cardName);
    } catch (err) {
      showLoading(false);
      showToast('Grading failed — try again', '❌');
    }
  } else {
    triggerGradeCardWithPicker();
  }
}

// Shared helper: convert any URL (blob, http, data:) to base64 string
async function urlToBase64(url) {
  if (!url) throw new Error('No URL');
  if (url.startsWith('data:image')) return url.split(',')[1];
  const blob = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
    return r.blob();
  });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

console.log('✅ Grader module loaded');
