// ES Module — CSV export v1.1
// New: condition, notes, readyToList, listingStatus, suggestedPrice fields
//      Ready-to-List filter option, template save/load, price multiplier

import { getCollections, getCurrentCollectionId } from '../../core/collection/collections.js';
import { escapeHtml } from '../../ui/utils.js';
import { showToast } from '../../ui/toast.js';
import { buildEbaySearchUrl } from '../marketplace/ebay.js';

export const EXPORT_FIELDS = [
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
export function openExportModal() {
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
        if (f.key === 'ebaySearchUrl') {
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

// ── eBay Bulk Upload Export ───────────────────────────────────────────────────
// Generates a Seller Hub-compatible CSV for eBay bulk listing upload.
// Admin configures listing-specific fields (category, profiles, title template, etc.)
// in the admin dashboard Settings tab. Card metadata fills everything else.

const EBAY_SETTINGS_KEY = 'ebayExportSettings';

const EBAY_CONDITION_MAP = {
    // Raw / ungraded
    'Raw':    '3000',
    // PSA grades
    'PSA 10': '2750', 'PSA 9': '3000', 'PSA 8': '3000',
    'PSA 7':  '3000', 'PSA 6': '3000', 'PSA 5': '5000',
    'PSA 4':  '5000', 'PSA 3': '6000', 'PSA 2': '6000', 'PSA 1': '6000',
    // BGS grades
    'BGS 10': '2750', 'BGS 9.5': '2750', 'BGS 9': '3000', 'BGS 8.5': '3000',
    'BGS 8':  '3000', 'BGS 7.5': '3000', 'BGS 7': '3000',
    // SGC grades
    'SGC 10': '2750', 'SGC 9': '3000', 'SGC 8': '3000', 'SGC 7': '3000',
};

function getEbayExportSettings() {
    try {
        return Object.assign({
            titleTemplate:    '{hero} {athlete} Bo Jackson Battle Arena',
            categoryId:       '183454',
            paymentProfile:   '',
            returnProfile:    '',
            shippingProfile:  '',
            descriptionTemplate: '<p><strong>{hero}</strong> ({cardNumber})</p><p>Set: {set} {year} | Parallel: {pose}</p>{weaponLine}<p>Game: Bo Jackson Battle Arena</p>{notesLine}',
            priceSource:      'ebayAvgPrice',
            bestOffer:        'false',
            duration:         'GTC',
            postalCode:       '',
            storeCategory:    '',
            gameSpecific:     'Bo Jackson Battle Arena',
            manufacturer:     '',
            language:         'English',
            sport:            'Trading Cards',
        }, JSON.parse(localStorage.getItem(EBAY_SETTINGS_KEY) || '{}'));
    } catch { return {}; }
}

window.saveEbayExportSettings = function() {
    const get = id => document.getElementById(id)?.value ?? '';
    const settings = {
        titleTemplate:    get('ebayTitleTemplate'),
        categoryId:       get('ebayCategoryId'),
        paymentProfile:   get('ebayPaymentProfile'),
        returnProfile:    get('ebayReturnProfile'),
        shippingProfile:  get('ebayShippingProfile'),
        descriptionTemplate: get('ebayDescriptionTemplate'),
        priceSource:      get('ebayPriceSource'),
        bestOffer:        get('ebayBestOffer'),
        duration:         get('ebayDuration'),
        postalCode:       get('ebayPostalCode'),
        storeCategory:    get('ebayStoreCategory'),
        gameSpecific:     get('ebayGame'),
        manufacturer:     get('ebayManufacturer'),
        language:         get('ebayLanguage'),
        sport:            get('ebaySport'),
    };
    localStorage.setItem(EBAY_SETTINGS_KEY, JSON.stringify(settings));
    const status = document.getElementById('ebaySettingsSaveStatus');
    if (status) { status.textContent = 'Saved ✓'; setTimeout(() => { status.textContent = ''; }, 2500); }
    showToast('eBay export settings saved', '✅');
};

function renderEbayTemplate(template, card, settings) {
    if (!template) return '';
    const s = settings || {};
    return template
        .replace(/\{hero\}/gi,        card.hero        || '')
        .replace(/\{athlete\}/gi,     card.athlete      || '')
        .replace(/\{cardNumber\}/gi,  card.cardNumber   || '')
        .replace(/\{year\}/gi,        String(card.year  || ''))
        .replace(/\{set\}/gi,         card.set          || '')
        .replace(/\{pose\}/gi,        card.pose         || '')
        .replace(/\{weapon\}/gi,      card.weapon       || '')
        .replace(/\{power\}/gi,       String(card.power || ''))
        .replace(/\{condition\}/gi,   card.condition    || '')
        .replace(/\{notes\}/gi,       card.notes        || '')
        .replace(/\{game\}/gi,        s.gameSpecific    || 'Bo Jackson Battle Arena')
        .replace(/\{weaponLine\}/gi,  card.weapon ? `<p>Weapon: ${card.weapon}${card.power ? ' | Power: ' + card.power : ''}</p>` : '')
        .replace(/\{notesLine\}/gi,   card.notes  ? `<p>Notes: ${card.notes}</p>` : '');
}

function getEbayConditionId(card) {
    if (card.condition && EBAY_CONDITION_MAP[card.condition]) {
        return EBAY_CONDITION_MAP[card.condition];
    }
    return '3000'; // Used — default
}

function getEbayPrice(card, priceSource) {
    const sources = {
        ebayAvgPrice:  card.ebayAvgPrice,
        ebayLowPrice:  card.ebayLowPrice,
        ebayHighPrice: card.ebayHighPrice,
        listingPrice:  card.listingPrice,
    };
    const val = sources[priceSource] ?? card.listingPrice ?? card.ebayAvgPrice;
    return val != null ? Number(val).toFixed(2) : '';
}

function generateEbayCSV(cards, settings) {
    const s    = settings || getEbayExportSettings();
    const ec   = val => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const mult = getPriceMultiplier();

    // eBay Seller Hub Live Listing CSV header
    // The Action column header encodes locale metadata — this exact format is required by eBay
    const ACTION_HEADER = 'Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)';

    const headers = [
        ACTION_HEADER,
        'Category',
        'Title',
        'Subtitle',
        'ConditionID',
        'ConditionDescription',
        'BuyItNowPrice',
        'Quantity',
        'Duration',
        'Description',
        'PaymentProfileName',
        'ReturnProfileName',
        'ShippingProfileName',
        'Custom Label (SKU)',
        'PicURL',
        'BestOfferEnabled',
        'PostalCode',
        'StoreCategory',
        'C:Year',
        'C:Character',
        'C:Athlete',
        'C:Card Number',
        'C:Parallel',
        'C:Weapon',
        'C:Power',
        'C:Set',
        'C:Game',
        'C:Manufacturer',
        'C:Language',
        'C:Sport',
    ];

    const rows = cards.map(card => {
        const title = renderEbayTemplate(s.titleTemplate, card, s).substring(0, 80);
        const desc  = renderEbayTemplate(s.descriptionTemplate, card, s);
        const price = getEbayPrice(card, s.priceSource);

        return [
            ec('Add'),
            ec(s.categoryId),
            ec(title),
            ec(''),                          // Subtitle — leave blank
            ec(getEbayConditionId(card)),
            ec(card.notes || ''),            // ConditionDescription
            ec(price),
            ec('1'),
            ec(s.duration || 'GTC'),
            ec(desc),
            ec(s.paymentProfile  || ''),
            ec(s.returnProfile   || ''),
            ec(s.shippingProfile || ''),
            ec(card.cardNumber   || ''),     // Custom Label / SKU
            ec(card.imageUrl && !card.imageUrl.startsWith('blob:') ? card.imageUrl : ''),
            ec(s.bestOffer === 'true' ? '1' : '0'),
            ec(s.postalCode     || ''),
            ec(s.storeCategory  || ''),
            ec(String(card.year   || '')),
            ec(card.hero        || ''),
            ec(card.athlete     || ''),
            ec(card.cardNumber  || ''),
            ec(card.pose        || ''),
            ec(card.weapon      || ''),
            ec(String(card.power || '')),
            ec(card.set         || ''),
            ec(s.gameSpecific   || 'Bo Jackson Battle Arena'),
            ec(s.manufacturer   || ''),
            ec(s.language       || 'English'),
            ec(s.sport          || 'Trading Cards'),
        ].join(',');
    });

    return [headers.map(ec).join(','), ...rows].join('\n');
}

window.openEbayExportModal = function() {
    const allCards = getCollections().flatMap(c => c.cards);
    if (!allCards.length) { showToast('No cards to export', '⚠️'); return; }

    document.getElementById('ebayExportModal')?.remove();

    const rtlCount = allCards.filter(c => c.readyToList).length;
    const cols = getCollections();

    const html = `
    <div class="modal active" id="ebayExportModal">
      <div class="modal-backdrop" onclick="document.getElementById('ebayExportModal').remove()"></div>
      <div class="modal-content" style="max-width:440px;max-height:90vh;display:flex;flex-direction:column;">
        <div class="modal-header">
          <h2>🏪 eBay Bulk Export</h2>
          <button class="modal-close" onclick="document.getElementById('ebayExportModal').remove()">×</button>
        </div>
        <div class="modal-body" style="flex:1;overflow-y:auto;padding:20px;">
          <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">
            Exports a CSV compatible with eBay Seller Hub bulk upload (Reports tab).
            Configure listing details in the Admin Dashboard → Settings → eBay Export Settings.
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
            <div style="flex:1;min-width:140px;">
              <label style="font-size:12px;color:#9ca3af;display:block;margin-bottom:4px;">Scope</label>
              <select id="ebayExportScope" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;">
                <option value="all">All collections</option>
                <option value="current">Current collection</option>
              </select>
            </div>
            <div style="flex:1;min-width:140px;">
              <label style="font-size:12px;color:#9ca3af;display:block;margin-bottom:4px;">Filter</label>
              <select id="ebayExportFilter" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;">
                <option value="all">All cards</option>
                <option value="rtl">Ready to List only (${rtlCount})</option>
                <option value="unlisted">Not yet listed</option>
              </select>
            </div>
          </div>
          <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;font-size:12px;color:#92400e;">
            <strong>Tip:</strong> Fields marked with * in the admin settings must be configured before uploading to eBay (category, shipping profiles, etc.).
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="document.getElementById('ebayExportModal').remove()" style="flex:1;">Cancel</button>
          <button class="btn-tag-add" onclick="runEbayExport()" style="flex:1;">⬇ Download eBay CSV</button>
        </div>
      </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', html);
};

window.runEbayExport = function() {
    const scope  = document.getElementById('ebayExportScope')?.value  || 'all';
    const filter = document.getElementById('ebayExportFilter')?.value || 'all';
    const cols   = getCollections();

    let cards = scope === 'current'
        ? (cols.find(c => c.id === getCurrentCollectionId())?.cards || [])
        : cols.flatMap(c => c.cards);

    if (filter === 'rtl')      cards = cards.filter(c => c.readyToList);
    if (filter === 'unlisted') cards = cards.filter(c => !c.listingStatus);

    if (!cards.length) { showToast('No cards match the selected filter', '⚠️'); return; }

    const settings = getEbayExportSettings();
    const csv      = generateEbayCSV(cards, settings);
    const today    = new Date().toISOString().split('T')[0];

    downloadFile(csv, `BOBA_eBay_Bulk_${today}.csv`, 'text/csv');
    document.getElementById('ebayExportModal')?.remove();
    showToast(`eBay export: ${cards.length} card${cards.length !== 1 ? 's' : ''}`, '✅');
};

window.openExportModal = openExportModal;

console.log('Export module loaded (v1.2 — deck export)');
