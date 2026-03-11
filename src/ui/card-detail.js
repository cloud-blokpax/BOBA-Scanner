// ── src/ui/card-detail.js ────────────────────────────────────────────────────
// ES Module — Card Detail Modal: openCardDetail, openCollectionCardDetail,
// removeCardFromDetail, scrollToCard, updateCardDetailField,
// clearCardListingStatus, addDetailTag, removeDetailTag,
// and the IIFE that calls wireUpEvents + initUploadArea on load.

import { getCollections, getCurrentCollectionId, setCurrentCollectionId, saveCollections } from '../core/collection/collections.js';
import { escapeHtml } from './utils.js';
import { showToast } from './toast.js';
import { compressImage } from '../core/scanner/image-processing.js';
import { renderCards } from './cards-grid.js';
import { wireUpEvents } from './events.js';
import { initUploadArea } from './upload-area.js';
import { buildEbaySearchUrl, buildEbaySoldUrl, fetchEbayAvgPrice } from '../features/marketplace/ebay.js';
import { isFeatureEnabled } from '../core/infra/feature-flags.js';
import { updateCard, removeCard } from '../core/scanner/scanner.js';
import { updateAuthUI } from '../core/auth/google-auth.js';
import { attachCardTilt } from './card-tilt.js';
import { getActiveAdapter } from '../collections/registry.js';

// ── Card Detail Modal ────────────────────────────────────────────────────────

window.openCardDetail = function(index) {
    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const collection  = collections.find(c => c.id === currentId);
    if (!collection?.cards[index]) return;

    const card = collection.cards[index];
    document.getElementById('cardDetailModal')?.remove();

    const ebayUrl  = buildEbaySearchUrl(card);
    const ebaySoldUrl = buildEbaySoldUrl(card);
    const ebayBtn  = ebayUrl
        ? `<a href="${ebayUrl}" target="_blank" rel="noopener" class="btn-ebay" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;">🛒 Search eBay</a>`
        : '';

    const conditionOptions = [
        '', 'Raw', 'PSA 1','PSA 2','PSA 3','PSA 4','PSA 5',
        'PSA 6','PSA 7','PSA 8','PSA 9','PSA 10',
        'BGS 7','BGS 7.5','BGS 8','BGS 8.5','BGS 9','BGS 9.5','BGS 10',
        'SGC 7','SGC 8','SGC 9','SGC 10'
    ].map(o => `<option value="${o}" ${card.condition===o?'selected':''}>${o||'Select condition...'}</option>`).join('');

    const scannedDate = card.timestamp
        ? new Date(card.timestamp).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })
        : 'Unknown';

    // ── Listing status with clear button ──────────────────────────────────
    const listingHtml = card.listingStatus === 'listed'
        ? `<div style="background:#d1fae5;border:1px solid #6ee7b7;border-radius:8px;padding:10px 14px;margin-bottom:12px;">
             <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
               <div>
                 <div style="font-weight:700;color:#065f46;margin-bottom:4px;">🟢 Currently Listed on eBay</div>
                 ${card.listingTitle ? `<div style="font-size:12px;color:#374151;margin-bottom:6px;">${escapeHtml(card.listingTitle)}</div>` : ''}
                 <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                   ${card.listingPrice ? `<span style="font-size:16px;font-weight:800;color:#065f46;">${escapeHtml(card.listingPrice)}</span>` : ''}
                   ${card.listingUrl ? `<a href="${escapeHtml(card.listingUrl)}" target="_blank" rel="noopener" style="color:#2563eb;font-size:13px;font-weight:600;text-decoration:none;">View Listing →</a>` : ''}
                 </div>
               </div>
               <button onclick="clearCardListingStatus(${index})" title="Clear listing status"
                       style="background:none;border:1px solid #6ee7b7;border-radius:6px;padding:3px 8px;font-size:11px;color:#065f46;cursor:pointer;white-space:nowrap;flex-shrink:0;">
                 Clear ✕
               </button>
             </div>
           </div>`
        : card.listingStatus === 'sold'
        ? `<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-bottom:12px;">
             <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
               <strong>🔴 Sold${card.soldAt ? ` on ${new Date(card.soldAt).toLocaleDateString()}` : ''}</strong>
               <button onclick="clearCardListingStatus(${index})" title="Remove sold status"
                       style="background:none;border:1px solid #fca5a5;border-radius:6px;padding:3px 8px;font-size:11px;color:#991b1b;cursor:pointer;white-space:nowrap;flex-shrink:0;">
                 Clear ✕
               </button>
             </div>
           </div>`
        : '';

    // ── Tags editor ───────────────────────────────────────────────────────
    const cardTags = Array.isArray(card.tags) ? card.tags.filter(Boolean) : [];
    const tagsHtml = `
        <div style="margin-bottom:12px;">
            <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;">Tags</label>
            <div id="detailTagsContainer" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:24px;">
                ${cardTags.map(t => `
                    <span class="tag-chip" style="display:inline-flex;align-items:center;gap:4px;">
                        ${escapeHtml(t)}
                        <button onclick="removeDetailTag(${index},'${escapeHtml(t).replace(/'/g,"\\'")}',this)"
                                style="background:none;border:none;cursor:pointer;padding:0;font-size:11px;color:#6b7280;line-height:1;">✕</button>
                    </span>`).join('')}
                ${cardTags.length === 0 ? '<span style="font-size:12px;color:#9ca3af;">No tags yet</span>' : ''}
            </div>
            <div style="display:flex;gap:6px;">
                <input type="text" id="detailTagInput" placeholder="Add tag..."
                       style="flex:1;padding:6px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;"
                       onkeydown="if(event.key==='Enter'){addDetailTag(${index});event.preventDefault();}">
                <button onclick="addDetailTag(${index})" class="btn-tag-add" style="padding:6px 12px;">Add</button>
            </div>
        </div>`;

    // ── Metadata display helper ───────────────────────────────────────────
    function buildMetadataHtml(c) {
        const fmtCurrency = v => (v != null && v !== '') ? `$${Number(v).toFixed(2)}` : null;
        const fmtDate     = v => {
            if (!v) return null;
            try { return new Date(v).toLocaleDateString('en-US', {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
            catch { return escapeHtml(String(v)); }
        };
        const fmtUrl      = (v, label) => v ? `<a href="${escapeHtml(v)}" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:none;font-weight:600;">${label||'View →'}</a>` : null;
        const fmtStr      = v => (v != null && v !== '') ? escapeHtml(String(v)) : null;
        const fmtPct      = v => (v != null && v !== '') ? `${Math.round(v)}%` : null;
        const fmtArr      = v => (Array.isArray(v) && v.filter(Boolean).length) ? escapeHtml(v.filter(Boolean).join(', ')) : null;

        // Build Card Info rows dynamically from adapter field definitions
        const _detailAdapter = getActiveAdapter();
        const _fieldDefs = _detailAdapter ? _detailAdapter.getFieldDefinitions() : [];
        const _cardInfoRows = _fieldDefs.length > 0
            ? _fieldDefs.map(f => [f.label, fmtStr(c[f.key])]).concat([['Condition', fmtStr(c.condition)]])
            : [
                ['Hero / Character',    fmtStr(c.hero)],
                ['Athlete',             fmtStr(c.athlete)],
                ['Card Number',         fmtStr(c.cardNumber)],
                ['Year',                fmtStr(c.year)],
                ['Set',                 fmtStr(c.set)],
                ['Parallel / Pose',     fmtStr(c.pose)],
                ['Weapon',              fmtStr(c.weapon)],
                ['Power',               fmtStr(c.power)],
                ['Condition',           fmtStr(c.condition)],
              ];

        const sections = [
            {
                title: 'Card Info', icon: '🃏',
                rows: _cardInfoRows
            },
            {
                title: 'eBay Active Listings', icon: '🛒',
                rows: [
                    ['Avg Price',       fmtCurrency(c.ebayAvgPrice)],
                    ['Low Price',       fmtCurrency(c.ebayLowPrice)],
                    ['High Price',      fmtCurrency(c.ebayHighPrice)],
                    ['# Listings',      c.ebayListingCount != null ? escapeHtml(String(c.ebayListingCount)) : null],
                    ['Last Checked',    fmtDate(c.ebayPriceFetched)],
                ]
            },
            {
                title: 'eBay Sold History', icon: '💰',
                rows: [
                    ['Last Sold Price', fmtCurrency(c.ebaySoldPrice)],
                    ['Sold Date',       fmtStr(c.ebaySoldDate)],
                    ['Avg Sold Price',  fmtCurrency(c.ebaySoldAvgPrice)],
                    ['# Sold',          c.ebaySoldCount != null ? escapeHtml(String(c.ebaySoldCount)) : null],
                    ['Last Checked',    fmtDate(c.ebaySoldFetched)],
                    ['Sold Listing',    fmtUrl(c.ebaySoldUrl, 'View sold listing →')],
                ]
            },
            {
                title: 'Collection', icon: '📦',
                rows: [
                    ['Tags',            fmtArr(c.tags)],
                    ['Notes',           fmtStr(c.notes)],
                    ['Ready to List',   c.readyToList ? 'Yes' : null],
                    ['Listing Status',  fmtStr(c.listingStatus)],
                    ['Listing Title',   fmtStr(c.listingTitle)],
                    ['Listing Price',   fmtStr(c.listingPrice)],
                    ['Listing URL',     fmtUrl(c.listingUrl, 'View listing →')],
                    ['Listing Item ID', fmtStr(c.listingItemId)],
                    ['Sold At',         fmtDate(c.soldAt)],
                ]
            },
            {
                title: 'Scan Info', icon: '📷',
                rows: [
                    ['Scan Method',   fmtStr(c.scanMethod)],
                    ['Scan Type',     fmtStr(c.scanType)],
                    ['Confidence',    fmtPct(c.confidence)],
                    ['Low Confidence',c.lowConfidence ? 'Yes (verify card)' : null],
                    ['File Name',     fmtStr(c.fileName)],
                    ['Scanned',       fmtDate(c.timestamp)],
                ]
            }
        ];

        // AI Grade section — only shown if a grade has been computed
        if (c.aiGrade) {
            const g = c.aiGrade;
            // Prefer programmatic centering from scan geometry, fall back to AI estimate
            const rawCentering = c.centeringData
                ? `${c.centeringData.lr} L/R, ${c.centeringData.tb} T/B`
                : (g.centering || '');
            // Clean up verbose N/A variants from AI
            const displayCentering = rawCentering.toLowerCase().startsWith('n/a') ? null : rawCentering;
            sections.push({
                title: 'AI Grade', icon: '🔬',
                rows: [
                    ['Grade',       g.grade != null ? `PSA ${g.grade}` : null],
                    ['Label',       fmtStr(g.grade_label)],
                    ['Confidence',  fmtPct(g.confidence)],
                    ['Centering',   fmtStr(displayCentering)],
                    ['Corners',     fmtStr(g.corners)],
                    ['Edges',       fmtStr(g.edges)],
                    ['Surface',     fmtStr(g.surface)],
                    ['Submit?',     fmtStr(g.submit_recommendation)],
                    ['Summary',     fmtStr(g.summary)],
                ]
            });
        }

        // Catch-all: any fields on the card object not already covered above
        const knownFields = new Set([
            'hero','athlete','cardNumber','year','set','pose','weapon','power','condition',
            'ebayAvgPrice','ebayLowPrice','ebayHighPrice','ebayListingCount','ebayPriceFetched',
            'ebaySoldPrice','ebaySoldDate','ebaySoldAvgPrice','ebaySoldCount','ebaySoldFetched','ebaySoldUrl',
            'tags','notes','readyToList','listingStatus','listingTitle','listingPrice','listingUrl','listingItemId','soldAt',
            'scanMethod','scanType','confidence','lowConfidence','fileName','timestamp',
            'imageUrl','id','cardId','aiGrade','centeringData','cardBounds',
            // Include adapter-defined fields so they don't appear as "Additional"
            ...(_fieldDefs.map(f => f.key)),
        ]);
        const extraRows = Object.entries(c)
            .filter(([k, v]) => !knownFields.has(k) && v != null && v !== '' && typeof v !== 'object')
            .map(([k, v]) => {
                const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
                return [label, fmtStr(String(v))];
            });
        if (extraRows.length) {
            sections.push({ title: 'Additional Fields', icon: '📋', rows: extraRows });
        }

        return sections.map(section => {
            const visible = section.rows.filter(([, v]) => v != null);
            if (!visible.length) return '';
            return `<div style="margin-bottom:14px;">
                <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.1em;padding-bottom:5px;border-bottom:1px solid #f3f4f6;margin-bottom:6px;">${section.icon} ${section.title}</div>
                <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 14px;">
                    ${visible.map(([label, val]) =>
                        `<span style="color:#9ca3af;font-size:11px;white-space:nowrap;padding-top:1px;">${label}</span>` +
                        `<span style="color:#111827;font-size:12px;font-weight:500;word-break:break-word;">${val}</span>`
                    ).join('')}
                </div>
            </div>`;
        }).join('');
    }

    // ── eBay avg price (loads async after render) ─────────────────────────
    const cachedPrice = card.ebayAvgPrice
        ? `⌀ $${Number(card.ebayAvgPrice).toFixed(2)}  ↓ $${Number(card.ebayLowPrice||0).toFixed(2)}`
        : null;
    const cachedSold = card.ebaySoldPrice
        ? `$${Number(card.ebaySoldPrice).toFixed(2)}${card.ebaySoldDate ? ' · ' + escapeHtml(card.ebaySoldDate) : ''}`
        : null;
    const priceHtml = `
        <div id="detailEbayPrice" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
            <div>
                <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">eBay Market Price</div>
                <div id="detailEbayPriceValue" style="font-size:15px;font-weight:700;color:#111827;">${cachedPrice || 'Loading...'}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;">
                <button id="detailEbayRefresh" title="Refresh eBay prices"
                        style="background:none;border:1px solid #6ee7b7;border-radius:6px;padding:3px 8px;font-size:11px;color:#065f46;cursor:pointer;">🔄 Refresh</button>
                <a id="detailEbayPriceLink" href="${escapeHtml(ebayUrl || '#')}" target="_blank" rel="noopener"
                   style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:600;">View listings →</a>
            </div>
        </div>
        `;

    const html = `
    <div class="modal active" id="cardDetailModal">
        <div class="modal-backdrop" onclick="document.getElementById('cardDetailModal').remove()"></div>
        <div class="modal-content" style="max-width:520px;max-height:90vh;display:flex;flex-direction:column;">
            <div class="modal-header">
                <div>
                    <h2>${escapeHtml(card.hero || 'Card Detail')}</h2>
                    ${card.athlete ? `<div style="font-size:13px;color:#6b7280;margin-top:2px;">${escapeHtml(card.athlete)}</div>` : ''}
                </div>
                <button class="modal-close" onclick="document.getElementById('cardDetailModal').remove()">×</button>
            </div>
            <div class="modal-body" style="flex:1;overflow-y:auto;padding:20px;">
                ${card.imageUrl
                    ? `<div id="detailImgWrap" style="position:relative;text-align:center;margin-bottom:16px;cursor:zoom-in;">
                           <img id="detailCardImg" data-card-index="${index}"
                                src="${card.imageUrl}" alt="${escapeHtml(card.cardNumber)}"
                                style="width:100%;max-height:240px;object-fit:contain;border-radius:10px;background:#f9fafb;"
                                onerror="this.style.display='none';document.getElementById('detailNoImgMsg')?.style.setProperty('display','block')">
                           <div id="detailZoomHint" style="position:absolute;bottom:6px;right:8px;background:rgba(0,0,0,.45);color:#fff;font-size:10px;border-radius:4px;padding:2px 6px;">Tap to zoom</div>
                       </div>`
                    : `<div style="text-align:center;margin-bottom:16px;">
                           <div id="detailNoImgMsg" style="background:#f9fafb;border:2px dashed #d1d5db;border-radius:10px;padding:24px;color:#9ca3af;font-size:13px;">
                               📷 No image — <label id="reAttachLabel" style="color:#2563eb;cursor:pointer;text-decoration:underline;">re-attach photo</label>
                               <input id="reAttachInput" type="file" accept="image/*" style="display:none">
                           </div>
                       </div>`}

                ${listingHtml}
                ${priceHtml}

                ${card.aiGrade ? (() => {
                    const g = card.aiGrade;
                    const gc = g.grade >= 9 ? '#16a34a' : g.grade >= 7 ? '#d97706' : g.grade >= 5 ? '#ea580c' : '#dc2626';
                    // Prefer programmatic centering from scan geometry, fall back to AI estimate
                    const rawCentering = card.centeringData
                        ? `${card.centeringData.lr} L/R, ${card.centeringData.tb} T/B`
                        : (g.centering || 'N/A');
                    // Clean up verbose N/A variants from AI (e.g. "N/A (full-bleed)")
                    const displayCentering = rawCentering.toLowerCase().startsWith('n/a') ? 'N/A' : rawCentering;
                    const isOldGrade = !g.gradeVersion || g.gradeVersion < 2;
                    return `<div style="background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border:1px solid #bbf7d0;border-radius:10px;padding:14px;margin-bottom:16px;">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                            <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">AI Grade</div>
                            <div style="font-size:28px;font-weight:900;color:${gc};line-height:1;">PSA ${g.grade} <span style="font-size:14px;font-weight:600;">${escapeHtml(g.grade_label || '')}</span></div>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;">
                            <div><span style="color:#6b7280;">Centering:</span> <strong style="color:#111827;">${escapeHtml(displayCentering)}</strong></div>
                            <div><span style="color:#6b7280;">Confidence:</span> <strong style="color:#111827;">${g.confidence || 0}%</strong></div>
                            <div style="grid-column:1/-1;"><span style="color:#6b7280;">Corners:</span> <span style="color:#374151;">${escapeHtml(g.corners || 'N/A')}</span></div>
                            <div style="grid-column:1/-1;"><span style="color:#6b7280;">Edges:</span> <span style="color:#374151;">${escapeHtml(g.edges || 'N/A')}</span></div>
                            <div style="grid-column:1/-1;"><span style="color:#6b7280;">Surface:</span> <span style="color:#374151;">${escapeHtml(g.surface || 'N/A')}</span></div>
                        </div>
                        ${g.summary ? `<div style="margin-top:8px;font-size:12px;color:#374151;border-top:1px solid #d1fae5;padding-top:8px;">${escapeHtml(g.summary)}</div>` : ''}
                        ${isOldGrade ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #d1fae5;font-size:11px;color:#92400e;display:flex;align-items:center;gap:6px;">
                            <span>✨</span> Improved grading engine available — <strong id="btnRegradeCard" style="cursor:pointer;text-decoration:underline;">Re-grade</strong>
                        </div>` : ''}
                    </div>`;
                })() : ''}

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
                    ${card.athlete ? `
                    <div style="background:#eff6ff;border-radius:8px;padding:10px;grid-column:1/-1;">
                        <div style="font-size:11px;color:#3b82f6;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Athlete Inspiration</div>
                        <div style="font-size:15px;font-weight:700;color:#1e3a5f;margin-top:2px;">${escapeHtml(card.athlete)}</div>
                    </div>` : ''}
                    ${(() => {
                        const _da = getActiveAdapter();
                        const _defs = _da ? _da.getFieldDefinitions() : [];
                        // Use adapter fields, excluding hero/athlete (shown separately above)
                        const _displayFields = _defs.length > 0
                            ? _defs.filter(f => f.key !== 'hero' && f.key !== 'athlete' && f.key !== 'cardId')
                                   .map(f => [f.label, card[f.key]])
                            : [['Card #', card.cardNumber], ['Year', card.year],
                               ['Set', card.set], ['Parallel', card.pose],
                               ['Weapon', card.weapon], ['Power', card.power]];
                        return _displayFields.map(([label, val]) => val ? `
                            <div style="background:#f9fafb;border-radius:8px;padding:10px;">
                                <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">${label}</div>
                                <div style="font-size:14px;font-weight:600;color:#111827;margin-top:2px;">${escapeHtml(String(val))}</div>
                            </div>` : '').join('');
                    })()}
                </div>

                <div style="margin-bottom:12px;">
                    <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;">Condition</label>
                    <select class="field-input" onchange="updateCard(${index},'condition',this.value);updateCardDetailField(${index},'condition',this.value)"
                            style="width:100%;">
                        ${conditionOptions}
                    </select>
                </div>

                <div style="margin-bottom:12px;">
                    <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;">Notes</label>
                    <textarea class="field-notes" rows="3" style="width:100%;box-sizing:border-box;"
                              placeholder="Purchase price, provenance, grading notes..."
                              onchange="updateCard(${index},'notes',this.value)">${escapeHtml(card.notes || '')}</textarea>
                </div>

                ${tagsHtml}

                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid #f3f4f6;">
                    <div style="font-size:12px;color:#9ca3af;">
                        Scanned ${scannedDate} via ${escapeHtml(card.scanMethod || card.scanType || '')}
                        ${card.confidence ? ` · ${Math.round(card.confidence)}% confidence` : ''}
                    </div>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;font-weight:600;color:#2563eb;">
                        <input type="checkbox" ${card.readyToList ? 'checked' : ''}
                               onchange="toggleReadyToList(${index})" style="width:16px;height:16px;">
                        Ready to List
                    </label>
                </div>

                <!-- All Metadata collapsible -->
                <details open style="margin-top:10px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                    <summary style="padding:10px 14px;font-size:12px;font-weight:700;color:#374151;cursor:pointer;background:#f9fafb;list-style:none;display:flex;align-items:center;gap:6px;">
                        📋 Card Details <span style="font-size:11px;color:#9ca3af;font-weight:400;">(tap to collapse)</span>
                    </summary>
                    <div id="metadataContent" style="padding:12px 14px;background:#fff;max-height:340px;overflow-y:auto;">
                        ${buildMetadataHtml(card)}
                    </div>
                </details>

                <!-- Move/Copy to another collection -->
                <div style="margin-top:12px;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;">
                    <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:8px;">📦 Copy to Collection</div>
                    <div id="moveToButtons" style="display:flex;gap:8px;flex-wrap:wrap;">
                        ${currentId !== 'default' ? '<button class="btn-tag-add" style="font-size:12px;padding:6px 12px;" onclick="moveCardToCollection(' + index + ',\x27default\x27)">📂 My Collection</button>' : ''}
                        ${currentId !== 'price_check' ? '<button class="btn-tag-add" style="font-size:12px;padding:6px 12px;" onclick="moveCardToCollection(' + index + ',\x27price_check\x27)">💰 Price Check</button>' : ''}
                        ${currentId !== 'deck_building' ? '<button class="btn-tag-add" style="font-size:12px;padding:6px 12px;" onclick="moveCardToCollection(' + index + ',\x27deck_building\x27)">🃏 Deck Builder</button>' : ''}
                    </div>
                </div>
            </div>
            <div class="modal-footer" style="gap:8px;flex-wrap:wrap;">
                ${ebayBtn}
                ${isFeatureEnabled('condition_grader')
                    ? `<button class="btn-secondary" id="btnGradeFromDetail" title="AI estimates PSA grade" style="white-space:nowrap;">🔬 Grade</button>`
                    : ''}
                ${isFeatureEnabled('ebay_lister')
                    ? `<button class="btn-secondary" id="btnListFromDetail" title="Generate eBay listing" style="white-space:nowrap;">🛒 List</button>`
                    : ''}
                <button class="btn-secondary" style="flex:1;" onclick="document.getElementById('cardDetailModal').remove()">Close</button>
                <button class="btn-secondary" style="color:#ef4444;border-color:#ef4444;" onclick="removeCardFromDetail(${index})">🗑️ Remove</button>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', html);
    // Record open time so ghost-click guard can block Remove calls within 600ms
    const modalEl = document.getElementById('cardDetailModal');
    if (modalEl) modalEl.dataset.openedAt = Date.now();

    // Refreshes the metadata section with latest card data after async fetches
    function refreshMetadataSection() {
        const el = document.getElementById('metadataContent');
        if (!el) return;
        const cols = getCollections();
        const cId  = getCurrentCollectionId();
        const col  = cols.find(c => c.id === cId);
        const latest = col?.cards[index];
        if (latest) el.innerHTML = buildMetadataHtml(latest);
    }

    // ── Zoom on card image ────────────────────────────────────────────────
    // Uses actual width changes instead of CSS transform so the container
    // gets real scrollbars — transform:scale() doesn't affect layout size,
    // which caused the image to be clipped with no way to scroll to edges.
    const imgWrap = document.getElementById('detailImgWrap');
    const cardImg = document.getElementById('detailCardImg');
    const zoomHint = document.getElementById('detailZoomHint');
    if (imgWrap && cardImg) {
        let zoomLevel = 0; // 0=normal, 1=2x, 2=3x
        imgWrap.addEventListener('click', (e) => {
            // Don't toggle zoom if user is scrolling the zoomed image
            if (zoomLevel > 0 && (imgWrap.scrollTop > 0 || imgWrap.scrollLeft > 0)) {
                // Only reset if tapping near the zoom hint area (bottom-right)
                const rect = imgWrap.getBoundingClientRect();
                const isHintArea = (e.clientX > rect.right - 80) && (e.clientY > rect.bottom - 30);
                if (!isHintArea) return;
            }
            zoomLevel = (zoomLevel + 1) % 3;
            if (zoomLevel === 0) {
                cardImg.style.width = '100%';
                cardImg.style.maxHeight = '240px';
                cardImg.style.transform = '';
                imgWrap.style.cursor = 'zoom-in';
                imgWrap.style.overflow = 'hidden';
                imgWrap.style.maxHeight = '';
                imgWrap.scrollTop = 0;
                imgWrap.scrollLeft = 0;
                if (zoomHint) { zoomHint.style.display = 'block'; zoomHint.textContent = 'Tap to zoom'; }
            } else if (zoomLevel === 1) {
                cardImg.style.width = '200%';
                cardImg.style.maxHeight = 'none';
                cardImg.style.transform = '';
                imgWrap.style.cursor = 'zoom-in';
                imgWrap.style.overflow = 'auto';
                imgWrap.style.maxHeight = '60vh';
                // Center the scroll position
                setTimeout(() => {
                    imgWrap.scrollLeft = (imgWrap.scrollWidth - imgWrap.clientWidth) / 2;
                    imgWrap.scrollTop = (imgWrap.scrollHeight - imgWrap.clientHeight) / 2;
                }, 50);
                if (zoomHint) { zoomHint.style.display = 'block'; zoomHint.textContent = 'Scroll to pan · Tap for 3×'; }
            } else {
                cardImg.style.width = '300%';
                cardImg.style.maxHeight = 'none';
                cardImg.style.transform = '';
                imgWrap.style.cursor = 'zoom-out';
                imgWrap.style.overflow = 'auto';
                imgWrap.style.maxHeight = '60vh';
                setTimeout(() => {
                    imgWrap.scrollLeft = (imgWrap.scrollWidth - imgWrap.clientWidth) / 2;
                    imgWrap.scrollTop = (imgWrap.scrollHeight - imgWrap.clientHeight) / 2;
                }, 50);
                if (zoomHint) { zoomHint.style.display = 'block'; zoomHint.textContent = 'Scroll to pan · Tap to reset'; }
            }
        });
        // Prevent parent modal scroll when scrolling inside zoomed image
        imgWrap.addEventListener('touchmove', (e) => {
            if (zoomLevel > 0) e.stopPropagation();
        }, { passive: true });

        // 3D card tilt effect (only when not zoomed)
        const tiltCleanup = attachCardTilt(imgWrap, { maxAngle: 10, shimmer: true });
        // Clean up tilt when modal is removed
        const observer = new MutationObserver(() => {
            if (!document.getElementById('cardDetailModal')) {
                tiltCleanup();
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true });
    }

    // ── Re-attach photo ───────────────────────────────────────────────────
    const reAttachInput = document.getElementById('reAttachInput');
    const reAttachLabel = document.getElementById('reAttachLabel');
    if (reAttachInput && reAttachLabel) {
        reAttachLabel.addEventListener('click', () => reAttachInput.click());
        reAttachInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            reAttachLabel.textContent = 'Uploading...';
            try {
                const base64 = await compressImage(file);
                const url = await window.uploadWithRetry(base64, file.name, 5, 1000);
                if (url) {
                    updateCard(index, 'imageUrl', url);
                    const noImgDiv = document.getElementById('detailNoImgMsg')?.parentElement;
                    if (noImgDiv) {
                        noImgDiv.innerHTML = `<img id="detailCardImg" data-card-index="${index}"
                            src="${url}" style="width:100%;max-height:240px;object-fit:contain;border-radius:10px;background:#f9fafb;">`;
                    }
                    renderCards();
                } else {
                    reAttachLabel.textContent = 'Upload failed — try again';
                }
            } catch(err) {
                reAttachLabel.textContent = 'Error — try again';
            }
        });
    }

    // ── eBay price refresh button ─────────────────────────────────────────
    function runEbayPriceFetch() {
        const el = document.getElementById('detailEbayPriceValue');
        const refreshBtn = document.getElementById('detailEbayRefresh');
        if (el) { el.textContent = 'Loading...'; el.style.color = '#111827'; }
        if (refreshBtn) refreshBtn.disabled = true;
        fetchEbayAvgPrice(card).then(result => {
            const el2 = document.getElementById('detailEbayPriceValue');
            const rb  = document.getElementById('detailEbayRefresh');
            if (rb) rb.disabled = false;
            if (!el2) return;
            if (!result || result.count === 0) {
                el2.textContent = 'N/A';
                el2.style.color = '#9ca3af';
                document.getElementById('detailEbayPriceLink')?.style.setProperty('display', 'none');
                updateCard(index, 'ebayAvgPrice', null);
                updateCard(index, 'ebayLowPrice', null);
                updateCard(index, 'ebayPriceFetched', new Date().toISOString());
            } else {
                const avg = result.avgPrice, low = result.lowPrice, high = result.highPrice, count = result.count;
                el2.innerHTML = `$${avg.toFixed(2)} avg`
                    + (low !== null ? ` &nbsp;·&nbsp; <span style="color:#065f46;font-weight:700;">↓ $${low.toFixed(2)} low</span>` : '')
                    + (count > 1 ? ` <span style="font-size:11px;color:#6b7280;font-weight:400;">(${count} listings · $${low}–$${high})</span>` : '');
                updateCard(index, 'ebayAvgPrice', avg);
                updateCard(index, 'ebayLowPrice', low);
                updateCard(index, 'ebayHighPrice', high);
                updateCard(index, 'ebayListingCount', count);
                updateCard(index, 'ebayPriceFetched', new Date().toISOString());
                renderCards();
                refreshMetadataSection();
            }
        }).catch(() => {
            const el2 = document.getElementById('detailEbayPriceValue');
            const rb  = document.getElementById('detailEbayRefresh');
            if (el2) { el2.textContent = 'Unavailable'; el2.style.color = '#9ca3af'; }
            if (rb)  rb.disabled = false;
        });
    }

    document.getElementById('detailEbayRefresh')?.addEventListener('click', runEbayPriceFetch);

    // Wire up lazy-loaded feature buttons (Grade, List, Re-grade) via addEventListener
    // so they work even if the lazy module hasn't loaded yet — the lazyWire wrapper on
    // window will trigger the dynamic import on first click.
    document.getElementById('btnGradeFromDetail')?.addEventListener('click', () => {
        if (typeof window.gradeCardFromDetail === 'function') window.gradeCardFromDetail(index);
    });
    document.getElementById('btnListFromDetail')?.addEventListener('click', () => {
        if (typeof window.ebayListFromDetail === 'function') window.ebayListFromDetail(index);
    });
    document.getElementById('btnRegradeCard')?.addEventListener('click', () => {
        if (typeof window.gradeCardFromDetail === 'function') window.gradeCardFromDetail(index, true);
    });

    // Async: fetch eBay avg price after modal renders (skip if we have a recent price)
    const lastFetch = card.ebayPriceFetched ? new Date(card.ebayPriceFetched) : null;
    const ageMs = lastFetch ? (Date.now() - lastFetch.getTime()) : Infinity;
    // Only auto-fetch if no cached price or price is more than 24 hours old
    if (!card.ebayAvgPrice || ageMs > 86400000) {
        runEbayPriceFetch();
    } else {
        const el = document.getElementById('detailEbayPriceValue');
        if (el) el.textContent = `$${Number(card.ebayAvgPrice).toFixed(2)} avg  ↓ $${Number(card.ebayLowPrice||0).toFixed(2)} low`;
    }

};

// Open card detail from collection modal — takes colId + index directly
// (collection modal shows cards from all collections, not just current)
window.openCollectionCardDetail = function(colId, index) {
    const collections = getCollections();
    const collection  = collections.find(c => c.id === colId);
    if (!collection?.cards[index]) return;

    // Temporarily switch active collection so updateCard() / toggleReadyToList()
    // write back to the correct place, then restore previous on close
    const prevId = getCurrentCollectionId();
    if (colId !== prevId) setCurrentCollectionId(colId);

    // Reuse the standard card detail modal — openCardDetail uses getCurrentCollectionId
    window.openCardDetail(index);

    // When the detail modal is closed, restore previous active collection
    if (colId !== prevId) {
        const observer = new MutationObserver(() => {
            if (!document.getElementById('cardDetailModal')) {
                setCurrentCollectionId(prevId);
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: false });
    }
};

window.removeCardFromDetail = function(index) {
    // iOS ghost-click guard: ignore Remove if modal just opened (< 600ms ago).
    const modal = document.getElementById('cardDetailModal');
    if (modal) {
        const age = Date.now() - parseInt(modal.dataset.openedAt || '0', 10);
        if (age < 600) return; // too soon — ghost click, not intentional
    }

    // Non-blocking inline confirmation (replaces native confirm() which is
    // unreliable on iOS Safari and can fire from ghost clicks)
    const btn = modal?.querySelector('.modal-footer button[style*="ef4444"]');
    if (!btn) return;

    // If already showing confirm state, this is the second tap — execute delete
    if (btn.dataset.confirming === 'true') {
        document.getElementById('cardDetailModal')?.remove();
        removeCard(index);
        return;
    }

    // First tap: switch button to confirm state
    btn.dataset.confirming = 'true';
    btn.textContent = 'Tap again to confirm';
    btn.style.background = '#ef4444';
    btn.style.color = '#fff';
    btn.style.borderColor = '#ef4444';

    // Auto-reset after 3 seconds if not confirmed
    setTimeout(() => {
        if (btn.isConnected && btn.dataset.confirming === 'true') {
            btn.dataset.confirming = '';
            btn.textContent = '🗑️ Remove';
            btn.style.background = '';
            btn.style.color = '#ef4444';
            btn.style.borderColor = '#ef4444';
        }
    }, 3000);
};

// Scroll to a specific card in the grid and briefly highlight it
window.scrollToCard = function(index) {
    const el = document.getElementById(`card_item_${index}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'box-shadow 0.3s ease';
    el.style.boxShadow = '0 0 0 3px #10b981, 0 4px 20px rgba(16,185,129,.3)';
    setTimeout(() => { el.style.boxShadow = ''; }, 2500);
};

window.updateCardDetailField = function(index, field, value) {
    // Keep the main card grid select in sync
    const sel = document.querySelector(`#card_item_${index} select`);
    if (sel && field === 'condition') sel.value = value;
};

// Clear sold/listed status from card detail — removes status, dates, listing metadata,
// and removes the "Listed on eBay" / "Sold" tags automatically added by the monitor
window.clearCardListingStatus = function(index) {
    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const collection  = collections.find(c => c.id === currentId);
    if (!collection?.cards[index]) return;

    const card = collection.cards[index];

    // Clear all listing fields
    card.listingStatus  = null;
    card.listingUrl     = null;
    card.listingTitle   = null;
    card.listingPrice   = null;
    card.listingItemId  = null;
    card.soldAt         = null;

    // Remove auto-applied eBay tags
    if (Array.isArray(card.tags)) {
        card.tags = card.tags.filter(t =>
            t !== 'Listed on eBay' && t !== 'Sold'
        );
    }

    saveCollections(collections);
    if (typeof window.syncToCloud === 'function') window.syncToCloud();

    // Re-render the modal with updated card state
    document.getElementById('cardDetailModal')?.remove();
    openCardDetail(index);
    renderCards();
};

// Add tag from detail modal input
window.addDetailTag = function(index) {
    const input = document.getElementById('detailTagInput');
    if (!input) return;
    const tag = input.value.trim();
    if (!tag) return;

    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const collection  = collections.find(c => c.id === currentId);
    if (!collection?.cards[index]) return;

    const card = collection.cards[index];
    if (!Array.isArray(card.tags)) card.tags = [];
    if (!card.tags.includes(tag)) {
        card.tags.push(tag);
        saveCollections(collections);
        if (typeof window.syncToCloud === 'function') window.syncToCloud();
    }

    input.value = '';

    // Re-render tags container in-place
    const container = document.getElementById('detailTagsContainer');
    if (container) {
        container.innerHTML = card.tags.filter(Boolean).map(t => `
            <span class="tag-chip" style="display:inline-flex;align-items:center;gap:4px;">
                ${escapeHtml(t)}
                <button onclick="removeDetailTag(${index},'${escapeHtml(t).replace(/'/g,"\\'")}',this)"
                        style="background:none;border:none;cursor:pointer;padding:0;font-size:11px;color:#6b7280;line-height:1;">✕</button>
            </span>`).join('') || '<span style="font-size:12px;color:#9ca3af;">No tags yet</span>';
    }
    renderCards();
};

// Remove a single tag from the card via the detail modal ✕ button
window.removeDetailTag = function(index, tag, btnEl) {
    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const collection  = collections.find(c => c.id === currentId);
    if (!collection?.cards[index]) return;

    const card = collection.cards[index];
    if (Array.isArray(card.tags)) {
        card.tags = card.tags.filter(t => t !== tag);
    }
    saveCollections(collections);
    if (typeof window.syncToCloud === 'function') window.syncToCloud();

    // Remove the chip from the DOM directly (no full re-render needed)
    btnEl?.closest('.tag-chip')?.remove();
    const container = document.getElementById('detailTagsContainer');
    if (container && !container.querySelector('.tag-chip')) {
        container.innerHTML = '<span style="font-size:12px;color:#9ca3af;">No tags yet</span>';
    }
    renderCards();
};

// Scripts load at bottom of <body>, so DOM is already ready when this runs.
// DOMContentLoaded has already fired — addEventListener for it would never trigger.
// Call directly instead.
// Expose imported functions on window for inline onclick handlers in card detail HTML
window.updateCard = updateCard;
window.removeCard = removeCard;

(function() {
    wireUpEvents();
    initUploadArea();
    setTimeout(() => {
        const user = window.googleUser || window.currentUser || null;
        updateAuthUI(user);
    }, 500);
})();

