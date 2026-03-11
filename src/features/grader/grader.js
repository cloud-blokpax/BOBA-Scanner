// js/grader.js — AI Condition Grader
// Estimates PSA/BGS card grade using Claude Vision via /api/grade

import { compressImageForGrading, cropGradingRegions, measureAndVisualizeCentering } from '../../core/scanner/image-processing.js';
import { showToast, showLoading } from '../../ui/toast.js';
import { escapeHtml } from '../../ui/utils.js';

// ── Grade a card from a base64 image ─────────────────────────────────────────
async function gradeCard(imageData, cornerRegionData = null, centeringData = null, centeringImageData = null) {
  const cfg = window.appConfig || {};
  const apiBase = cfg.apiBase || 'https://boba.cards/api';

  const headers = { 'Content-Type': 'application/json' };
  const apiToken = cfg.apiToken || (typeof window.getApiToken === 'function' ? window.getApiToken() : null);
  if (apiToken) headers['X-Api-Token'] = apiToken;

  const bodyObj = { imageData };
  if (cornerRegionData)    bodyObj.cornerRegionData    = cornerRegionData;
  if (centeringData)       bodyObj.centeringData       = centeringData;
  if (centeringImageData)  bodyObj.centeringImageData  = centeringImageData;

  const res = await fetch(`${apiBase}/grade`, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyObj)
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
function showGradeModal(result, cardName, cardIndex) {
  document.getElementById('gradeModal')?.remove();

  const grade = result.grade || 0;
  const gradeDisplay = (grade % 1 !== 0) ? grade.toFixed(1) : String(grade);
  const gradeColor = grade >= 9 ? '#16a34a' : grade >= 8 ? '#22c55e' : grade >= 7 ? '#d97706' : grade >= 5 ? '#ea580c' : '#dc2626';

  // Qualifier badge — shown when AI detected a grading qualifier (OC, MC, MK, ST, PD, OF)
  const qualifierLabels = {
    OC: 'Off Center', MC: 'Miscut', MK: 'Marks',
    ST: 'Staining',   PD: 'Print Defect', OF: 'Out of Focus'
  };
  const qualifierHtml = result.qualifier
    ? `<div style="display:inline-block;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:3px 10px;font-size:12px;font-weight:600;color:#92400e;margin-top:6px;">
        ${result.qualifier} — ${escapeHtml(qualifierLabels[result.qualifier] || result.qualifier)}
        <span style="font-weight:400;color:#b45309;"> (~2 grade market reduction)</span>
       </div>`
    : '';

  // Centering — use new split front/back fields, fall back to legacy centering field
  const frontCentering = result.front_centering || result.centering || null;
  const backCentering  = (result.back_centering && result.back_centering !== 'not assessed') ? result.back_centering : null;
  const centeringDisplay = (frontCentering && backCentering)
    ? `Front: ${frontCentering} · Back: ${backCentering}`
    : frontCentering;

  const submitBadge = {
    yes:   { label: 'Worth Submitting',   color: '#16a34a', icon: '✅', bg: '#f0fdf4', border: '#d1fae5' },
    maybe: { label: 'Borderline',         color: '#d97706', icon: '⚠️', bg: '#fffbeb', border: '#fde68a' },
    no:    { label: 'Not Cost-Effective', color: '#6b7280', icon: '💡', bg: '#f9fafb', border: '#e5e7eb' }
  }[result.submit_recommendation] || { label: 'Unknown', color: '#6b7280', icon: '❓', bg: '#f9fafb', border: '#e5e7eb' };

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
            <div style="font-size:72px;font-weight:900;color:${gradeColor};line-height:1;">${gradeDisplay}</div>
            <div style="font-size:18px;font-weight:700;color:${gradeColor};margin-top:4px;">PSA ${gradeDisplay} · ${escapeHtml(result.grade_label || '')}</div>
            ${qualifierHtml}
            <div style="font-size:13px;color:#6b7280;margin-top:4px;">Confidence: ${result.confidence || 0}%</div>
          </div>

          <div style="display:grid;gap:10px;margin-bottom:16px;">
            ${renderGradeRow('📐', 'Centering', centeringDisplay)}
            ${renderGradeRow('🔻', 'Corners',   result.corners)}
            ${renderGradeRow('📏', 'Edges',     result.edges)}
            ${renderGradeRow('✨', 'Surface',   result.surface)}
          </div>

          <div style="background:#f9fafb;border-radius:10px;padding:14px;margin-bottom:14px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Grader Summary</div>
            <div style="font-size:13px;color:#374151;line-height:1.5;">${escapeHtml(result.summary || '')}</div>
          </div>

          <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:${submitBadge.bg};border-radius:8px;border:1px solid ${submitBadge.border};">
            <span style="font-size:18px;">${submitBadge.icon}</span>
            <div>
              <div style="font-size:13px;font-weight:600;color:${submitBadge.color};">${submitBadge.label}</div>
              <div style="font-size:12px;color:#6b7280;">Submission recommendation</div>
            </div>
          </div>

        </div>
        ${(!result.gradeVersion || result.gradeVersion < 3) && cardIndex !== undefined ? `<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin:0 16px 12px;font-size:12px;color:#92400e;display:flex;align-items:center;gap:8px;">
            <span style="font-size:16px;">✨</span>
            <span>New grading engine available with improved accuracy. <strong id="gradeUpgradeLink" style="cursor:pointer;text-decoration:underline;">Re-grade now</strong></span>
          </div>` : ''}
        <div class="modal-footer">
          <div style="font-size:11px;color:#9ca3af;flex:1;">AI estimate only — not a certified grade</div>
          ${cardIndex !== undefined ? `<button class="btn-secondary" id="gradeRegradeBtn" style="white-space:nowrap;">🔄 Re-grade</button>` : ''}
          <button class="btn-secondary" id="gradeModalCloseBtn">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper.firstElementChild);
  document.getElementById('gradeModalClose')?.addEventListener('click', () => document.getElementById('gradeModal')?.remove());
  document.getElementById('gradeModalCloseBtn')?.addEventListener('click', () => document.getElementById('gradeModal')?.remove());
  document.querySelector('#gradeModal .modal-backdrop')?.addEventListener('click', () => document.getElementById('gradeModal')?.remove());
  if (cardIndex !== undefined) {
    document.getElementById('gradeRegradeBtn')?.addEventListener('click', () => {
      document.getElementById('gradeModal')?.remove();
      gradeCardFromDetail(cardIndex, true);
    });
    document.getElementById('gradeUpgradeLink')?.addEventListener('click', () => {
      document.getElementById('gradeModal')?.remove();
      gradeCardFromDetail(cardIndex, true);
    });
  }
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

// ── Prepare high-res image + corner grid + centering overlay for grading ──────
// Accepts either a card object (with imageUrl, centeringData, cardBounds) or a
// plain URL string for backward compatibility (scan-preview grading).
async function prepareGradingImages(cardOrUrl) {
  const url           = (typeof cardOrUrl === 'string') ? cardOrUrl : cardOrUrl.imageUrl;
  const storedCentering = (typeof cardOrUrl === 'object') ? (cardOrUrl.centeringData || null) : null;
  const cardBounds    = (typeof cardOrUrl === 'object') ? (cardOrUrl.cardBounds    || null) : null;

  const blob = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
    return r.blob();
  });

  // Use higher-quality compression for grading (2000px, quality 0.92)
  const imageData = await compressImageForGrading(blob);

  // Generate 2×2 corner grid — pass cardBounds so corners are extracted
  // from the actual card area, not the artificial padding
  const cornerRegionData = await cropGradingRegions(blob, cardBounds).catch(() => null);

  // Measure centering from the card's printed border widths — this mirrors PSA
  // and TAG methodology (border width left vs right, top vs bottom).
  // Only attempt on cards that went through cropToCard (have artificial padding).
  let centeringData = storedCentering;
  let centeringImageData = null;
  if (cardBounds) {
    const measured = await measureAndVisualizeCentering(blob).catch(() => ({ centering: null, centeringImageData: null }));
    if (measured.centering) centeringData = measured.centering;
    centeringImageData = measured.centeringImageData;
  }

  return { imageData, cornerRegionData, centeringData, centeringImageData };
}

// ── Grade a specific card by index (from card detail modal or card grid) ──────
async function gradeCardFromDetail(index, forceRegrade = false) {
  const collections = (typeof window.getCollections === 'function') ? window.getCollections() : [];
  const currentId   = (typeof window.getCurrentCollectionId === 'function') ? window.getCurrentCollectionId() : 'default';
  const collection  = collections.find(c => c.id === currentId);
  const card        = collection?.cards[index];
  if (!card) { showToast('Card not found', '❌'); return; }

  // If already graded and not forcing a re-grade, show the cached result immediately
  if (card.aiGrade && !forceRegrade) {
    showGradeModal(card.aiGrade, card.hero || card.cardNumber || 'Card', index);
    return;
  }

  if (!card.imageUrl) {
    showToast('No image for this card — re-attach a photo first', '⚠️');
    return;
  }

  // Disable the Grade button and show a spinner so the user knows work is happening
  const gradeBtn = document.getElementById('btnGradeFromDetail');
  const origText = gradeBtn?.innerHTML || '🔬 Grade';
  if (gradeBtn) { gradeBtn.disabled = true; gradeBtn.innerHTML = '⏳ Analyzing…'; }

  showLoading(true, 'Analyzing card condition...');
  try {
    const { imageData, cornerRegionData, centeringData, centeringImageData } = await prepareGradingImages(card);
    const result = await gradeCard(imageData, cornerRegionData, centeringData, centeringImageData);
    showLoading(false);
    if (gradeBtn) { gradeBtn.disabled = false; gradeBtn.innerHTML = origText; }

    // Stamp grade version so the UI can detect old vs new grading engine
    result.gradeVersion = 3;

    // Persist grade to card object
    card.aiGrade = result;
    if (typeof window.saveCollections === 'function') window.saveCollections(collections);

    showGradeModal(result, card.hero || card.cardNumber || 'Card', index);
  } catch (err) {
    showLoading(false);
    if (gradeBtn) { gradeBtn.disabled = false; gradeBtn.innerHTML = origText; }
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
  if (!window.isFeatureEnabled('condition_grader')) {
    showToast('Condition Grader requires membership', '🔒');
    return;
  }
  window.showCardPickerModal('🔬 Grade Card', 'Select a card to grade', async (index) => {
    await gradeCardFromDetail(index);
  });
}

// ── triggerGradeCard: still works if a scan image is visible, else shows picker
async function triggerGradeCard() {
  if (!window.isFeatureEnabled('condition_grader')) {
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
      // Scan-preview path — no stored card, so no centering/bounds metadata
      const { imageData, cornerRegionData, centeringData } = await prepareGradingImages(previewImg.src);
      const result = await gradeCard(imageData, cornerRegionData, centeringData);
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

window.triggerGradeCard = triggerGradeCard;
window.triggerGradeCardWithPicker = triggerGradeCardWithPicker;
window.gradeCardFromDetail = gradeCardFromDetail;

console.log('✅ Grader module loaded');
