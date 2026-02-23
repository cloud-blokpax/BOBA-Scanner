// js/export.js — CSV export with field selection

// All available export fields
const EXPORT_FIELDS = [
    { key: 'cardId',     label: 'Card ID',     default: true  },
    { key: 'hero',       label: 'Name',         default: true  },
    { key: 'year',       label: 'Year',         default: true  },
    { key: 'set',        label: 'Set',          default: true  },
    { key: 'cardNumber', label: 'Card Number',  default: true  },
    { key: 'pose',       label: 'Parallel',     default: true  },
    { key: 'weapon',     label: 'Weapon',       default: true  },
    { key: 'power',      label: 'Power',        default: true  },
    { key: 'scanMethod', label: 'Scan Method',  default: false },
    { key: 'scanType',   label: 'Scan Type',    default: false },
    { key: 'tags',       label: 'Tags',         default: true  },
    { key: 'timestamp',  label: 'Date Scanned', default: false },
    { key: 'fileName',   label: 'File Name',    default: false },
    { key: 'imageUrl',   label: 'Image URL',    default: false },
];

// Open the export modal
function openExportModal() {
    const allCards = getCollections().flatMap(c => c.cards);
    if (allCards.length === 0) {
        showToast('No cards to export', '⚠️');
        return;
    }

    const savedFields = (() => {
        try { return JSON.parse(localStorage.getItem('exportFields') || 'null'); }
        catch { return null; }
    })();

    const activeFields = new Set(
        savedFields || EXPORT_FIELDS.filter(f => f.default).map(f => f.key)
    );

    const html = `
    <div class="modal active" id="exportModal">
        <div class="modal-backdrop" onclick="document.getElementById('exportModal').remove()"></div>
        <div class="modal-content" style="max-width:440px;">
            <div class="modal-header">
                <h2>📄 Export CSV</h2>
                <button class="modal-close" onclick="document.getElementById('exportModal').remove()">×</button>
            </div>
            <div class="modal-body" style="padding:20px;">
                <p style="color:#666;font-size:13px;margin:0 0 16px;">
                    ${allCards.length} card${allCards.length !== 1 ? 's' : ''} across all collections.
                    Choose which fields to include:
                </p>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px;">
                    ${EXPORT_FIELDS.map(f => `
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                                      padding:8px 10px;border-radius:8px;border:1.5px solid ${activeFields.has(f.key) ? '#93c5fd' : '#e5e7eb'};
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

                <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
                    <span style="font-size:12px;color:#9ca3af;flex:1;">
                        Export scope:
                    </span>
                    <select id="exportScope" style="padding:6px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;background:white;">
                        <option value="all">All collections</option>
                        <option value="current">Current collection only</option>
                    </select>
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

window.toggleExportField = function(key, checked) {
    const label = document.getElementById(`fieldlabel_${key}`);
    if (label) {
        label.style.borderColor = checked ? '#93c5fd' : '#e5e7eb';
        label.style.background  = checked ? '#eff6ff' : 'white';
    }
};

window.runExport = function() {
    const checkboxes = document.querySelectorAll('#exportModal input[type=checkbox]');
    const selected   = [...checkboxes].filter(cb => cb.checked).map(cb => cb.value);

    if (selected.length === 0) {
        showToast('Select at least one field', '⚠️');
        return;
    }

    // Save preference
    localStorage.setItem('exportFields', JSON.stringify(selected));

    const scope     = document.getElementById('exportScope')?.value || 'all';
    const cols      = getCollections();
    const allCards  = scope === 'current'
        ? (cols.find(c => c.id === getCurrentCollectionId())?.cards || [])
        : cols.flatMap(c => c.cards);

    if (allCards.length === 0) {
        showToast('No cards to export', '⚠️');
        return;
    }

    const fields = EXPORT_FIELDS.filter(f => selected.includes(f.key));
    const csv    = generateCSV(allCards, fields);
    const today  = new Date().toISOString().split('T')[0];
    const label  = scope === 'current'
        ? sanitizeFilename(cols.find(c => c.id === getCurrentCollectionId())?.name || 'collection')
        : 'All_Collections';

    downloadFile(csv, `BOBA_${label}_${today}.csv`, 'text/csv');
    document.getElementById('exportModal')?.remove();
    showToast(`Exported ${allCards.length} cards`, '✅');
};

function generateCSV(cards, fields) {
    const escapeCell = (val) => {
        const str = String(val ?? '');
        return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = fields.map(f => escapeCell(f.label));
    const rows = cards.map(card => {
        return fields.map(f => {
            let val = card[f.key];
            // Tags: join with pipe separator so each card stays one row
            if (f.key === 'tags') val = Array.isArray(val) ? val.join(' | ') : '';
            return escapeCell(val ?? '');
        });
    });

    return [
        headers.join(','),
        ...rows.map(r => r.join(','))
    ].join('\n');
}

function sanitizeFilename(name) {
    return (name || 'collection')
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .substring(0, 100);
}

function downloadFile(content, filename, type) {
    const blob = new Blob(['\ufeff' + content], { type: type + ';charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

console.log('✅ Export module loaded');
