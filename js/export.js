// js/export.js — CSV export v1.1
// New: condition, notes, readyToList, listingStatus, suggestedPrice fields
//      Ready-to-List filter option, template save/load, price multiplier

const EXPORT_FIELDS = [
    { key: 'cardId',          label: 'Card ID',                default: true  },
    { key: 'hero',            label: 'Hero Name',              default: true  },
    { key: 'athlete',         label: 'Athlete Inspiration',    default: true  },
    { key: 'year',            label: 'Year',                   default: true  },
    { key: 'set',             label: 'Set',                    default: true  },
    { key: 'cardNumber',      label: 'Card Number',            default: true  },
    { key: 'pose',            label: 'Parallel',               default: true  },
    { key: 'weapon',          label: 'Weapon',                 default: true  },
    { key: 'power',           label: 'Power',                  default: true  },
    { key: 'condition',       label: 'Condition',              default: true  },
    { key: 'notes',           label: 'Notes',                  default: true  },
    { key: 'readyToList',     label: 'Ready to List',          default: false },
    { key: 'listingStatus',   label: 'Listing Status',         default: false },
    { key: 'listingPrice',    label: 'Listing Price',          default: false },
    { key: 'suggestedPrice',  label: 'Suggested Price',        default: false },
    { key: 'ebaySearchUrl',   label: 'eBay Search URL',        default: false },
    { key: 'scanMethod',      label: 'Scan Method',            default: false },
    { key: 'tags',            label: 'Tags',                   default: true  },
    { key: 'ebayAvgPrice',    label: 'eBay Avg Price',         default: false },
    { key: 'ebayLowPrice',    label: 'eBay Low Price',         default: false },
    { key: 'timestamp',       label: 'Date Scanned',           default: false },
    { key: 'imageUrl',        label: 'Image URL',              default: false },
];

const PRICE_MULT_KEY = 'exportPriceMultiplier';

function getPriceMultiplier() {
    return parseFloat(localStorage.getItem(PRICE_MULT_KEY) || '0.9');
}

// Open the export modal
function openExportModal() {
    const allCards = getCollections().flatMap(c => c.cards);
    if (allCards.length === 0) { showToast('No cards to export', '⚠️'); return; }

    document.getElementById('exportModal')?.remove();

    const savedFields = (() => {
        try { return JSON.parse(localStorage.getItem('exportFields') || 'null'); } catch { return null; }
    })();
    const activeFields = new Set(savedFields || EXPORT_FIELDS.filter(f => f.default).map(f => f.key));
    const mult = getPriceMultiplier();

    const rtlCount = allCards.filter(c => c.readyToList).length;

    // ── Deck Export section ───────────────────────────────────────────────
    const deckTags = (typeof window.getDeckTags === 'function') ? window.getDeckTags() : [];
    const deckExportHtml = deckTags.length > 0 ? `
        <div style="background:#1a1033;border:1.5px solid #6d28d9;border-radius:12px;padding:14px 16px;margin-bottom:16px;">
            <div style="font-size:12px;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
                🃏 Deck Export (BoBA Format)
            </div>
            <p style="font-size:12px;color:#94a3b8;margin:0 0 10px;">
                Exports slots 1–30 (plays) + B1–B15 (bonus plays) in BoBA Deck format.
                Field selection above is ignored — deck format is fixed.
            </p>
            <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
                <div style="flex:1;min-width:160px;">
                    <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">Select Deck</label>
                    <select id="deckExportTag" style="width:100%;padding:8px 10px;border:1px solid #6d28d9;border-radius:8px;font-size:13px;background:#0d1524;color:#e2e8f0;">
                        <option value="" style="background:#0d1524;color:#9ca3af;">— choose a deck —</option>
                        ${deckTags.map(t => `<option value="${escapeHtmlAttr(t)}" style="background:#0d1524;color:#e2e8f0;">${escapeHtml(t)}</option>`).join('')}
                    </select>
                </div>
                <button onclick="runDeckExport()" class="btn-tag-add"
                        style="background:linear-gradient(135deg,#7c3aed,#6d28d9);white-space:nowrap;padding:9px 16px;">
                    ⬇ Download Deck CSV
                </button>
            </div>
        </div>` : '';

    // Template section (from templates.js)
    const templateHtml = (typeof renderTemplateSelectorHtml === 'function')
        ? renderTemplateSelectorHtml(activeFields)
        : '';

    const html = `
    <div class="modal active" id="exportModal">
        <div class="modal-backdrop" onclick="document.getElementById('exportModal').remove()"></div>
        <div class="modal-content" style="max-width:460px;max-height:90vh;display:flex;flex-direction:column;">
            <div class="modal-header">
                <h2>📄 Export CSV</h2>
                <button class="modal-close" onclick="document.getElementById('exportModal').remove()">×</button>
            </div>
            <div class="modal-body" style="flex:1;overflow-y:auto;padding:20px;">

                <!-- Templates first — load a template to pre-fill fields below -->
                <div id="exportTemplateSelectorSection" style="margin-bottom:16px;">${templateHtml}</div>

                <p style="color:#666;font-size:13px;margin:0 0 12px;">
                    ${allCards.length} card${allCards.length !== 1 ? 's' : ''} · Select fields to include:
                </p>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
                    ${EXPORT_FIELDS.map(f => `
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                                      padding:8px 10px;border-radius:8px;
                                      border:1.5px solid ${activeFields.has(f.key) ? '#93c5fd' : '#e5e7eb'};
                                      background:${activeFields.has(f.key) ? '#eff6ff' : 'white'};
                                      transition:all .15s;" id="fieldlabel_${f.key}">
                            <input type="checkbox" id="field_${f.key}" value="${f.key}"
                                   ${activeFields.has(f.key) ? 'checked' : ''}
                                   onchange="toggleExportField('${f.key}', this.checked)"
                                   style="width:16px;height:16px;accent-color:#1d4ed8;cursor:pointer;">
                            <span style="font-size:13px;font-weight:500;color:#374151;">${f.label}</span>
                        </label>
                    `).join('')}
                </div>

                <!-- Scope + filter + deck export -->
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
                    <div style="flex:1;min-width:140px;">
                        <label style="font-size:12px;color:#9ca3af;display:block;margin-bottom:4px;">Scope</label>
                        <select id="exportScope" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;">
                            <option value="all">All collections</option>
                            <option value="current">Current collection</option>
                        </select>
                    </div>
                    <div style="flex:1;min-width:140px;">
                        <label style="font-size:12px;color:#9ca3af;display:block;margin-bottom:4px;">Filter</label>
                        <select id="exportFilter" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;">
                            <option value="all">All cards</option>
                            <option value="rtl">Ready to List only (${rtlCount})</option>
                            <option value="unlisted">Not yet listed</option>
                            <option value="listed">Currently listed</option>
                            <option value="sold">Sold</option>
                        </select>
                    </div>
                </div>

                <!-- Deck Export — separate section, bypasses field checkboxes -->
                ${deckExportHtml}

                <!-- Price multiplier -->
                <div style="background:#f9fafb;border-radius:8px;padding:12px;margin-bottom:16px;">
                    <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">
                        Suggested Price Setting
                    </div>
                    <p style="font-size:12px;color:#6b7280;margin:0 0 8px;">
                        Suggested Price = Radish 30-day avg × multiplier (coming soon).
                    </p>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="range" id="priceMult" min="0.5" max="1.2" step="0.05"
                               value="${mult}" oninput="updatePriceMultLabel(this.value)"
                               style="flex:1;">
                        <span id="priceMultLabel" style="font-size:14px;font-weight:700;color:#1d4ed8;min-width:36px;">
                            ${Math.round(mult * 100)}%
                        </span>
                    </div>
                </div>

                <!-- Save current field selection as a new template -->
                <div style="border-top:1px solid #e5e7eb;padding-top:16px;">
                    <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
                        Save as Template
                    </div>
                    <div style="display:flex;gap:8px;">
                        <input type="text" id="saveTemplateName" placeholder="Template name..."
                               style="flex:1;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;">
                        <button onclick="saveExportTemplate()" class="btn-tag-add">Save</button>
                    </div>
                </div>

            </div>
            <div class="modal-footer">
                <button class="btn-secondary" onclick="document.getElementById('exportModal').remove()" style="flex:1;">Cancel</button>
                <button class="btn-tag-add" onclick="runExport()" style="flex:1;">Download CSV</button>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', html);
}

window.updatePriceMultLabel = function(val) {
    const label = document.getElementById('priceMultLabel');
    if (label) label.textContent = Math.round(val * 100) + '%';
};

window.toggleExportField = function(key, checked) {
    const label = document.getElementById(`fieldlabel_${key}`);
    if (label) {
        label.style.borderColor = checked ? '#93c5fd' : '#e5e7eb';
        label.style.background  = checked ? '#eff6ff' : 'white';
    }
};

window.saveExportTemplate = function() {
    if (typeof saveUserTemplate !== 'function') {
        showToast('Templates module not loaded', '❌'); return;
    }
    const name = document.getElementById('saveTemplateName')?.value.trim();
    if (!name) { showToast('Enter a template name', '⚠️'); return; }

    const selected = [...document.querySelectorAll('#exportModal input[type=checkbox]:checked')].map(cb => cb.value);
    const tpl = saveUserTemplate(name, selected);
    if (!tpl) return;

    document.getElementById('saveTemplateName').value = '';
    showToast(`Template "${name}" saved`, '✅');

    // Refresh template list
    const section = document.getElementById('exportTemplateSelectorSection');
    if (section && typeof renderTemplateSelectorHtml === 'function') {
        section.innerHTML = renderTemplateSelectorHtml(new Set(selected));
    }
};

window.runExport = function() {
    const checkboxes = document.querySelectorAll('#exportModal input[type=checkbox]');
    const selected   = [...checkboxes].filter(cb => cb.checked).map(cb => cb.value);
    if (selected.length === 0) { showToast('Select at least one field', '⚠️'); return; }

    // Save multiplier
    const multEl = document.getElementById('priceMult');
    if (multEl) localStorage.setItem(PRICE_MULT_KEY, multEl.value);
    localStorage.setItem('exportFields', JSON.stringify(selected));

    const scope  = document.getElementById('exportScope')?.value  || 'all';
    const filter = document.getElementById('exportFilter')?.value || 'all';
    const cols   = getCollections();

    let cards = scope === 'current'
        ? (cols.find(c => c.id === getCurrentCollectionId())?.cards || [])
        : cols.flatMap(c => c.cards);

    // Apply filter
    if (filter === 'rtl')      cards = cards.filter(c => c.readyToList);
    if (filter === 'unlisted') cards = cards.filter(c => !c.listingStatus);
    if (filter === 'listed')   cards = cards.filter(c => c.listingStatus === 'listed');
    if (filter === 'sold')     cards = cards.filter(c => c.listingStatus === 'sold');

    if (cards.length === 0) { showToast('No cards match the selected filter', '⚠️'); return; }

    const fields = EXPORT_FIELDS.filter(f => selected.includes(f.key));
    const csv    = generateCSV(cards, fields);
    const today  = new Date().toISOString().split('T')[0];
    const label  = scope === 'current'
        ? sanitizeFilename(cols.find(c => c.id === getCurrentCollectionId())?.name || 'collection')
        : 'All_Collections';
    const suffix = filter !== 'all' ? `_${filter}` : '';

    downloadFile(csv, `BOBA_${label}${suffix}_${today}.csv`, 'text/csv');
    document.getElementById('exportModal')?.remove();
    showToast(`Exported ${cards.length} card${cards.length !== 1 ? 's' : ''}`, '✅');
};

function generateCSV(cards, fields) {
    const ec = val => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const mult = getPriceMultiplier();

    const headers = fields.map(f => ec(f.label));
    const rows = cards.map(card => fields.map(f => {
        let val = card[f.key];
        if (f.key === 'tags')         val = Array.isArray(val) ? val.join(' | ') : '';
        if (f.key === 'readyToList')  val = val ? 'Yes' : 'No';
        if (f.key === 'ebaySearchUrl' && typeof buildEbaySearchUrl === 'function') {
            val = buildEbaySearchUrl(card) || '';
        }
        if (f.key === 'ebayAvgPrice' || f.key === 'ebayLowPrice' || f.key === 'ebayHighPrice') {
            val = val != null ? Number(val).toFixed(2) : '';
        }
        if (f.key === 'suggestedPrice') {
            // Placeholder — will be populated once Radish integration is live
            val = card.radishAvgPrice ? (card.radishAvgPrice * mult).toFixed(2) : '';
        }
        return ec(val ?? '');
    }));

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

function sanitizeFilename(name) {
    return (name || 'collection').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').substring(0, 100);
}

function escapeHtmlAttr(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Deck Export — BoBA Deck CSV format ────────────────────────────────────
// Slots 1–30 = Play parallel cards (in whatever order they were scanned)
// Slots B1–B15 = Bonus Play parallel cards (0–15)
// Columns: Slot, Card #, Name, Cost, Ability, DBS
window.runDeckExport = function() {
    const tag = document.getElementById('deckExportTag')?.value;
    if (!tag) { showToast('Select a deck first', '⚠️'); return; }

    const cards = (typeof window.getDeckCards === 'function') ? window.getDeckCards(tag) : [];
    if (!cards.length) { showToast(`No cards found for deck "${tag}"`, '⚠️'); return; }

    // Split by parallel type
    const plays  = cards.filter(c => {
        const p = (c.pose || '').toLowerCase();
        return p.includes('play') && !p.includes('bonus');
    });
    const bonuses = cards.filter(c => {
        const p = (c.pose || '').toLowerCase();
        return p.includes('bonus');
    });

    // Warn if under 30 plays — still export, just leave slots empty
    if (plays.length < 30) {
        showToast(`Note: only ${plays.length}/30 play slots filled`, '⚠️');
    }

    const ec = val => `"${String(val ?? '').replace(/"/g, '""')}"`;

    const rows = [];
    // Header
    rows.push(['Slot','Card #','Name','Cost','Ability','DBS'].map(ec).join(','));

    // Play slots 1–30
    for (let i = 1; i <= 30; i++) {
        const card = plays[i - 1] || null;
        rows.push([
            ec(i),
            ec(card?.cardNumber ?? ''),
            ec(card?.hero       ?? ''),
            ec(card?.dbsCost    ?? ''),
            ec(card?.ability    ?? ''),
            ec(card?.dbs        ?? ''),
        ].join(','));
    }

    // Bonus slots B1–B15 (stop early if no more bonus plays)
    for (let i = 1; i <= Math.min(15, bonuses.length); i++) {
        const card = bonuses[i - 1];
        rows.push([
            ec(`B${i}`),
            ec(card?.cardNumber ?? ''),
            ec(card?.hero       ?? ''),
            ec(card?.dbsCost    ?? ''),
            ec(card?.ability    ?? ''),
            ec(card?.dbs        ?? ''),
        ].join(','));
    }

    const csv   = rows.join('\n');
    const today = new Date().toISOString().split('T')[0];
    const name  = sanitizeFilename(tag);
    downloadFile(csv, `BoBA_Deck_${name}_${today}.csv`, 'text/csv');
    document.getElementById('exportModal')?.remove();
    showToast(`Exported deck "${tag}" (${plays.length} plays, ${bonuses.length} bonus)`, '✅');
};

function downloadFile(content, filename, type) {
    const blob = new Blob(['\ufeff' + content], { type: type + ';charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    // Delay cleanup — iOS Safari needs a tick to initiate the download before
    // the blob URL is revoked, otherwise the download silently fails.
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

console.log('Export module loaded (v1.2 — deck export)');
