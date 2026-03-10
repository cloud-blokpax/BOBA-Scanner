// js/ebay-lister.js — One-Tap eBay Lister
// AI generates an optimized eBay listing then opens a pre-filled draft.

// ── Generate listing via Claude ───────────────────────────────────────────────
async function generateEbayListing(card) {
  const apiBase = (typeof appConfig !== 'undefined' && appConfig.apiBase)
    ? appConfig.apiBase
    : 'https://boba.cards/api';

  const prompt = buildListingPrompt(card);

  const headers = { 'Content-Type': 'application/json' };
  // Reuse the existing /api/anthropic endpoint — send a text-only request
  const res = await fetch(`${apiBase}/anthropic`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      imageData: null,
      textPrompt: prompt,
      mode: 'listing'
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Listing API error: ${res.status}`);
  }

  const data = await res.json();
  const rawText = data.content?.[0]?.text || '';
  const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(jsonStr);
}

function buildListingPrompt(card) {
  const parts = [
    card.hero       && `Hero/Character: ${card.hero}`,
    card.cardNumber && `Card Number: ${card.cardNumber}`,
    card.set        && `Set: ${card.set}`,
    card.year       && `Year: ${card.year}`,
    card.power      && `Power: ${card.power}`,
    card.pose       && `Pose/Parallel: ${card.pose}`,
    card.weapon     && `Weapon: ${card.weapon}`,
    card.condition  && `Condition: ${card.condition}`,
    card.notes      && `Seller notes: ${card.notes}`
  ].filter(Boolean).join('\n');

  return `You are an expert eBay seller specializing in trading cards. Generate an optimized eBay listing for this Bo Jackson trading card:

${parts}

Return ONLY valid JSON (no markdown):
{
  "title": "eBay listing title (max 80 chars, keyword-rich for search)",
  "description": "Full listing description (2-3 paragraphs, include card details, condition, what's in the listing)",
  "suggested_price": 4.99,
  "price_note": "Brief reason for price (e.g. 'Based on recent sold comps')",
  "condition_code": "3000",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

eBay condition codes: 1000=New, 2000=Refurbished, 2500=Like New, 3000=Used, 7000=For parts`;
}

// ── Open eBay sell form with pre-filled data ──────────────────────────────────
function openEbayDraft(listing, card) {
  // eBay's sell form supports some pre-fill via URL (limited fields)
  // The most reliable approach: show a modal with copy-paste fields
  showListingModal(listing, card);
}

// ── Show listing modal ────────────────────────────────────────────────────────
function showListingModal(listing, card) {
  document.getElementById('ebayListingModal')?.remove();

  const ebaySearchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(listing.title)}&LH_Sold=1&LH_Complete=1`;
  const ebayNewUrl    = `https://www.ebay.com/sell/v2/sell?title=${encodeURIComponent(listing.title)}`;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal active" id="ebayListingModal">
      <div class="modal-backdrop"></div>
      <div class="modal-content" style="max-width:560px;">
        <div class="modal-header">
          <h2>🛒 eBay Listing</h2>
          <button class="modal-close" id="listingModalClose">×</button>
        </div>
        <div class="modal-body" style="padding:16px;">

          <div style="margin-bottom:16px;">
            <div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:6px;text-transform:uppercase;">Title (click to copy)</div>
            <div class="listing-copy-field" data-copy="${escapeHtml(listing.title)}" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:14px;cursor:pointer;font-weight:600;position:relative;">
              ${escapeHtml(listing.title)}
              <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:16px;">📋</span>
            </div>
          </div>

          <div style="margin-bottom:16px;">
            <div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:6px;text-transform:uppercase;">Description (click to copy)</div>
            <div class="listing-copy-field" data-copy="${escapeHtml(listing.description)}" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:13px;cursor:pointer;line-height:1.5;max-height:120px;overflow-y:auto;position:relative;">
              ${escapeHtml(listing.description).replace(/\n/g, '<br>')}
              <span style="position:sticky;bottom:0;right:0;float:right;font-size:16px;">📋</span>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
            <div style="background:#f0fdf4;border-radius:8px;padding:12px;text-align:center;">
              <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">Suggested Price</div>
              <div style="font-size:24px;font-weight:700;color:#16a34a;">$${(listing.suggested_price || 0).toFixed(2)}</div>
              <div style="font-size:11px;color:#9ca3af;">${escapeHtml(listing.price_note || '')}</div>
            </div>
            <div style="background:#f9fafb;border-radius:8px;padding:12px;">
              <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">Keywords</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px;">
                ${(listing.keywords || []).map(k => `<span style="font-size:11px;background:#e0e7ff;color:#3730a3;padding:2px 6px;border-radius:4px;">${escapeHtml(k)}</span>`).join('')}
              </div>
            </div>
          </div>

          <div style="display:flex;gap:8px;">
            <a href="${escayHtml(ebayNewUrl)}" target="_blank" rel="noopener" class="btn-primary" style="flex:1;text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;padding:12px;">
              🛒 List on eBay
            </a>
            <a href="${escapeHtml(ebaySearchUrl)}" target="_blank" rel="noopener" class="btn-secondary" style="flex:1;text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;padding:12px;">
              📊 See Sold Comps
            </a>
          </div>

        </div>
        <div class="modal-footer">
          <div style="font-size:11px;color:#9ca3af;flex:1;">Tap any field to copy it to clipboard</div>
          <button class="btn-secondary" id="listingModalCloseBtn">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper.firstElementChild);

  // Wire close buttons
  document.getElementById('listingModalClose')?.addEventListener('click',    () => document.getElementById('ebayListingModal')?.remove());
  document.getElementById('listingModalCloseBtn')?.addEventListener('click', () => document.getElementById('ebayListingModal')?.remove());
  document.querySelector('#ebayListingModal .modal-backdrop')?.addEventListener('click', () => document.getElementById('ebayListingModal')?.remove());

  // Copy-to-clipboard on tap
  document.querySelectorAll('#ebayListingModal .listing-copy-field').forEach(el => {
    el.addEventListener('click', async () => {
      const text = el.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard!', '📋');
      } catch {
        showToast('Copy failed — select text manually', '⚠️');
      }
    });
  });
}

// Fix typo in original implementation — escapeHtml is the correct function
function escayHtml(str) { return escapeHtml(str); }

// ── List a specific card by index (from card detail modal or card grid) ───────
async function ebayListFromDetail(index) {
  const collections = (typeof getCollections === 'function') ? getCollections() : [];
  const currentId   = (typeof getCurrentCollectionId === 'function') ? getCurrentCollectionId() : 'default';
  const collection  = collections.find(c => c.id === currentId);
  const card        = collection?.cards[index];
  if (!card) { showToast('Card not found', '❌'); return; }
  await triggerEbayLister(card);
}

// ── List from card grid (via "⋯ More" menu) ───────────────────────────────────
async function ebayListByIndex(index) {
  await ebayListFromDetail(index);
}

// ── List from More menu (show card picker first) ──────────────────────────────
function triggerEbayListerWithPicker() {
  if (!isFeatureEnabled('ebay_lister')) {
    showToast('eBay Lister requires membership', '🔒');
    return;
  }
  showCardPickerModal('🛒 List on eBay', 'Select a card to generate a listing', async (index) => {
    await ebayListFromDetail(index);
  });
}

// ── Main trigger — accepts a card object or shows picker if none provided ─────
async function triggerEbayLister(card) {
  if (!isFeatureEnabled('ebay_lister')) {
    showToast('eBay Lister requires membership', '🔒');
    return;
  }

  if (!card || !card.cardNumber) {
    triggerEbayListerWithPicker();
    return;
  }

  showLoading(true, 'Generating eBay listing...');
  try {
    const listing = await generateEbayListing(card);
    showLoading(false);
    showListingModal(listing, card);
  } catch (err) {
    showLoading(false);
    console.error('eBay lister error:', err);
    showToast('Listing generation failed — try again', '❌');
  }
}

window.triggerEbayLister = triggerEbayLister;
window.triggerEbayListerWithPicker = triggerEbayListerWithPicker;
window.ebayListFromDetail = ebayListFromDetail;

console.log('✅ eBay lister module loaded');
