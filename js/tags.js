// js/tags.js — Tag management, filtering, and bulk operations
// Tags are stored in localStorage under 'userTags' and synced to Supabase.

// ── Storage ───────────────────────────────────────────────────────────────────

function getAllTags() {
    try { return JSON.parse(localStorage.getItem('userTags') || '[]'); }
    catch { return []; }
}

function saveAllTags(tags) {
    localStorage.setItem('userTags', JSON.stringify([...new Set(tags)]));
    if (typeof schedulePush === 'function') schedulePush();
}

function addTag(name) {
    const clean = name.trim();
    if (!clean) return;
    const tags = getAllTags();
    if (!tags.includes(clean)) {
        tags.push(clean);
        saveAllTags(tags);
    }
}

function deleteTagGlobally(name) {
    // Remove from tag list
    saveAllTags(getAllTags().filter(t => t !== name));
    // Remove from all cards
    const cols = getCollections();
    for (const col of cols) {
        for (const card of col.cards) {
            if (card.tags) card.tags = card.tags.filter(t => t !== name);
        }
    }
    saveCollections(cols);
    rerenderIfOpen();
}

// ── Pending tags for next scan ────────────────────────────────────────────────
let _pendingTags = [];

function getPendingTags()      { return _pendingTags; }
function setPendingTags(tags)  { _pendingTags = [...tags]; }
function clearPendingTags()    { _pendingTags = []; }

// ── Pre-upload tag prompt ─────────────────────────────────────────────────────
// Called by scanner.js before processing. Returns a Promise that resolves
// when the user dismisses the modal (with or without tags).

function promptForTags() {
    return new Promise((resolve) => {
        const existing = getAllTags();

        // Build modal HTML
        const modalHtml = `
        <div class="modal active" id="tagPromptModal">
            <div class="modal-backdrop"></div>
            <div class="modal-content" style="max-width:420px;">
                <div class="modal-header">
                    <h2>🏷️ Add Tags?</h2>
                    <button class="modal-close" id="tagPromptSkip">×</button>
                </div>
                <div class="modal-body" style="padding:20px;">
                    <p style="color:#666;margin:0 0 16px;">Optionally tag this card for easier filtering later.</p>

                    <!-- Selected tags for this upload -->
                    <div id="tagPromptSelected" style="display:flex;flex-wrap:wrap;gap:6px;min-height:32px;margin-bottom:12px;"></div>

                    <!-- Existing tags -->
                    <div style="font-size:12px;font-weight:600;color:#888;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;">
                        Your Tags
                    </div>
                    <div id="tagPromptList" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
                        ${existing.length === 0
                            ? '<span style="color:#aaa;font-size:13px;">No tags yet</span>'
                            : existing.map(t => `
                                <button class="tag-chip tag-chip-selectable" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>
                              `).join('')
                        }
                    </div>

                    <!-- Add new tag -->
                    <div style="display:flex;gap:8px;">
                        <input id="tagPromptInput" type="text" placeholder="New tag name..."
                               style="flex:1;padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;">
                        <button id="tagPromptAdd" class="btn-tag-add">Add</button>
                    </div>
                </div>
                <div class="modal-footer" style="gap:8px;">
                    <button id="tagPromptSkipBtn" class="btn-secondary" style="flex:1;">Skip</button>
                    <button id="tagPromptConfirm" class="btn-primary" style="flex:1;">Upload Card</button>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal     = document.getElementById('tagPromptModal');
        const input     = document.getElementById('tagPromptInput');
        const addBtn    = document.getElementById('tagPromptAdd');
        const skipBtn   = document.getElementById('tagPromptSkipBtn');
        const confirmBtn = document.getElementById('tagPromptConfirm');
        const selected  = new Set(_pendingTags); // pre-load any already set

        function renderSelected() {
            const el = document.getElementById('tagPromptSelected');
            if (selected.size === 0) {
                el.innerHTML = '<span style="color:#aaa;font-size:12px;">No tags selected</span>';
            } else {
                el.innerHTML = [...selected].map(t => `
                    <span class="tag-chip tag-chip-active">
                        ${escapeHtml(t)}
                        <button onclick="this.parentNode.remove();window._tagRemove('${escapeHtml(t)}')" style="background:none;border:none;cursor:pointer;margin-left:2px;font-size:11px;">✕</button>
                    </span>`).join('');
            }
        }

        window._tagRemove = (t) => { selected.delete(t); renderSelected(); updateChips(); };

        function updateChips() {
            document.querySelectorAll('#tagPromptList .tag-chip-selectable').forEach(btn => {
                const t = btn.dataset.tag;
                btn.classList.toggle('tag-chip-on', selected.has(t));
            });
        }

        function addNewTag() {
            const val = input.value.trim();
            if (!val) return;
            addTag(val);
            selected.add(val);
            input.value = '';
            // Re-render chip list
            const list = document.getElementById('tagPromptList');
            list.innerHTML = getAllTags().map(t => `
                <button class="tag-chip tag-chip-selectable${selected.has(t) ? ' tag-chip-on' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>
            `).join('');
            bindChips();
            renderSelected();
        }

        function bindChips() {
            document.querySelectorAll('#tagPromptList .tag-chip-selectable').forEach(btn => {
                btn.onclick = () => {
                    const t = btn.dataset.tag;
                    if (selected.has(t)) { selected.delete(t); } else { selected.add(t); }
                    updateChips();
                    renderSelected();
                };
            });
        }

        addBtn.onclick = addNewTag;
        input.onkeydown = (e) => { if (e.key === 'Enter') addNewTag(); };

        function finish(useTags) {
            _pendingTags = useTags ? [...selected] : [];
            modal.remove();
            delete window._tagRemove;
            resolve();
        }

        skipBtn.onclick              = () => finish(false);
        confirmBtn.onclick           = () => finish(true);
        document.getElementById('tagPromptSkip').onclick = () => finish(false);

        bindChips();
        renderSelected();
        updateChips();
    });
}

// ── Collection modal: filtering & selection ───────────────────────────────────
let _activeFilters    = new Set();   // tags currently filtered on
let _selectedCards    = new Set();   // Set of "colId:cardIndex" keys
let _selectionMode    = false;

function rerenderIfOpen() {
    if (document.getElementById('collectionModal')?.classList.contains('active')) {
        renderCollectionModal();
    }
}

function toggleSelectionMode(on) {
    _selectionMode = on;
    _selectedCards.clear();
    rerenderIfOpen();
}

function toggleCardSelection(key) {
    if (_selectedCards.has(key)) { _selectedCards.delete(key); }
    else { _selectedCards.add(key); }
    // Update visual without full re-render
    const el = document.querySelector(`.collection-card[data-key="${CSS.escape(key)}"]`);
    if (el) el.classList.toggle('selected', _selectedCards.has(key));
    updateBulkBar();
}

function updateBulkBar() {
    const bar = document.getElementById('bulkActionBar');
    if (!bar) return;
    const n = _selectedCards.size;
    bar.style.display = (_selectionMode && n > 0) ? 'flex' : 'none';
    const label = bar.querySelector('#bulkCount');
    if (label) label.textContent = `${n} card${n !== 1 ? 's' : ''} selected`;
}

function openBulkTagModal(action) {
    // action: 'add' or 'remove'
    const existing = getAllTags();
    const html = `
    <div class="modal active" id="bulkTagModal">
        <div class="modal-backdrop" onclick="document.getElementById('bulkTagModal').remove()"></div>
        <div class="modal-content" style="max-width:380px;">
            <div class="modal-header">
                <h2>${action === 'add' ? '🏷️ Add Tags' : '🗑️ Remove Tags'}</h2>
                <button class="modal-close" onclick="document.getElementById('bulkTagModal').remove()">×</button>
            </div>
            <div class="modal-body" style="padding:20px;">
                <p style="color:#666;margin:0 0 14px;font-size:13px;">
                    ${action === 'add' ? 'Add to' : 'Remove from'} ${_selectedCards.size} selected card${_selectedCards.size !== 1 ? 's' : ''}.
                </p>
                <div id="bulkTagList" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
                    ${existing.length === 0
                        ? '<span style="color:#aaa;font-size:13px;">No tags — add one below</span>'
                        : existing.map(t => `<button class="tag-chip tag-chip-selectable" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')
                    }
                </div>
                ${action === 'add' ? `
                <div style="display:flex;gap:8px;">
                    <input id="bulkTagInput" type="text" placeholder="New tag..."
                           style="flex:1;padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;">
                    <button onclick="bulkAddNewTag()" class="btn-tag-add">Add</button>
                </div>` : ''}
            </div>
            <div class="modal-footer">
                <button onclick="applyBulkTags('${action}')" class="btn-primary" style="flex:1;">Apply</button>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', html);

    const selected = new Set();
    document.querySelectorAll('#bulkTagList .tag-chip-selectable').forEach(btn => {
        btn.onclick = () => {
            const t = btn.dataset.tag;
            if (selected.has(t)) { selected.delete(t); btn.classList.remove('tag-chip-on'); }
            else                 { selected.add(t);    btn.classList.add('tag-chip-on'); }
        };
    });

    window._bulkSelected = selected;

    if (action === 'add') {
        const inp = document.getElementById('bulkTagInput');
        if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') bulkAddNewTag(); };
    }
}

window.bulkAddNewTag = function() {
    const inp = document.getElementById('bulkTagInput');
    if (!inp) return;
    const val = inp.value.trim();
    if (!val) return;
    addTag(val);
    inp.value = '';
    const list = document.getElementById('bulkTagList');
    const btn = document.createElement('button');
    btn.className = 'tag-chip tag-chip-selectable tag-chip-on';
    btn.dataset.tag = val;
    btn.textContent = val;
    btn.onclick = () => {
        if (window._bulkSelected.has(val)) { window._bulkSelected.delete(val); btn.classList.remove('tag-chip-on'); }
        else                               { window._bulkSelected.add(val);    btn.classList.add('tag-chip-on'); }
    };
    list.appendChild(btn);
    window._bulkSelected.add(val);
};

window.applyBulkTags = function(action) {
    const tagsToApply = [...(window._bulkSelected || [])];
    if (tagsToApply.length === 0) {
        document.getElementById('bulkTagModal')?.remove();
        return;
    }

    const cols = getCollections();
    for (const key of _selectedCards) {
        const [colId, idxStr] = key.split(':');
        const col  = cols.find(c => c.id === colId);
        if (!col) continue;
        const card = col.cards[parseInt(idxStr)];
        if (!card) continue;

        if (!Array.isArray(card.tags)) card.tags = [];

        if (action === 'add') {
            for (const t of tagsToApply) {
                if (!card.tags.includes(t)) card.tags.push(t);
            }
        } else {
            card.tags = card.tags.filter(t => !tagsToApply.includes(t));
        }
    }

    saveCollections(cols);
    document.getElementById('bulkTagModal')?.remove();
    _selectedCards.clear();
    _selectionMode = false;
    renderCollectionModal();
    showToast(`Tags ${action === 'add' ? 'added' : 'removed'}`, '✅');
};

// ── Render collection modal (replaces version in sync.js) ─────────────────────
function renderCollectionModal() {
    const body  = document.getElementById('collectionModalBody');
    const count = document.getElementById('collectionCount');
    if (!body) return;

    // Gather all cards with their collection ID + index
    const allCards = [];
    for (const col of getCollections()) {
        col.cards.forEach((card, idx) => {
            allCards.push({ ...card, _colId: col.id, _idx: idx, _key: `${col.id}:${idx}` });
        });
    }
    allCards.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Build tag filter bar
    const allTagsUsed = [...new Set(allCards.flatMap(c => c.tags || []))].sort();

    // Filter cards
    const filtered = _activeFilters.size === 0
        ? allCards
        : allCards.filter(c => [..._activeFilters].every(f => (c.tags || []).includes(f)));

    if (count) count.textContent = `(${filtered.length}${filtered.length !== allCards.length ? `/${allCards.length}` : ''} card${allCards.length !== 1 ? 's' : ''})`;

    const filterBar = allTagsUsed.length > 0 ? `
        <div class="tag-filter-bar">
            <span class="tag-filter-label">Filter:</span>
            ${allTagsUsed.map(t => `
                <button class="tag-chip tag-filter-chip${_activeFilters.has(t) ? ' tag-chip-on' : ''}"
                        onclick="toggleCollectionFilter('${escapeHtml(t)}')">${escapeHtml(t)}</button>
            `).join('')}
            ${_activeFilters.size > 0 ? `<button class="tag-clear-btn" onclick="clearCollectionFilters()">Clear</button>` : ''}
        </div>` : '';

    const bulkBar = `
        <div id="bulkActionBar" style="display:none;align-items:center;gap:8px;padding:8px 0;flex-wrap:wrap;">
            <span id="bulkCount" style="font-size:13px;font-weight:600;color:#555;flex:1;"></span>
            <button class="btn-tag-add" onclick="openBulkTagModal('add')">+ Add Tags</button>
            <button class="btn-tag-remove" onclick="openBulkTagModal('remove')">− Remove Tags</button>
            <button class="btn-secondary" style="padding:6px 12px;font-size:12px;" onclick="toggleSelectionMode(false)">Cancel</button>
        </div>`;

    const selectToggle = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
            <button class="btn-secondary" style="font-size:12px;padding:5px 12px;"
                    onclick="toggleSelectionMode(${!_selectionMode})">
                ${_selectionMode ? '✓ Done Selecting' : '☑ Select Cards'}
            </button>
        </div>`;

    if (filtered.length === 0) {
        body.innerHTML = filterBar + bulkBar + selectToggle + `
            <div class="collection-empty">
                <div class="collection-empty-icon">${_activeFilters.size > 0 ? '🔍' : '📭'}</div>
                <h3>${_activeFilters.size > 0 ? 'No cards match this filter' : 'No cards yet'}</h3>
                <p>${_activeFilters.size > 0 ? 'Try a different tag filter.' : 'Scan your first Bo Jackson card!'}</p>
            </div>`;
        return;
    }

    const cardsHtml = filtered.map(card => {
        const hasImage   = card.imageUrl && !card.imageUrl.startsWith('blob:') && card.imageUrl.length > 10;
        const isSelected = _selectedCards.has(card._key);
        const cardTags   = (card.tags || []).filter(Boolean);
        const ebayUrl    = (typeof buildEbaySearchUrl === 'function') ? buildEbaySearchUrl(card) : null;

        const listingBadge = card.listingStatus === 'listed' && card.listingUrl
            ? `<a href="${escapeHtml(card.listingUrl)}" target="_blank" rel="noopener noreferrer"
                  class="collection-ebay-link listing-active" title="View your eBay listing">🟢 Listed</a>`
            : card.listingStatus === 'sold'
            ? `<span class="collection-card-badge" style="background:#fee2e2;color:#991b1b;">🔴 Sold</span>`
            : '';

        return `
        <div class="collection-card${isSelected ? ' selected' : ''}" data-key="${escapeHtml(card._key)}">
            ${_selectionMode ? `
                <div class="card-select-btn${isSelected ? ' active' : ''}"
                     onclick="toggleCardSelection('${escapeHtml(card._key)}')">
                    ${isSelected ? '✓' : '+'}
                </div>` : ''}
            <div class="collection-card-img-wrap" onclick="openCollectionCardDetail('${escapeHtml(card._colId)}', ${card._idx})"
                 style="cursor:pointer;" title="View details">
                ${hasImage
                    ? `<img class="collection-card-image" src="${card.imageUrl}" alt="${escapeHtml(card.cardNumber)}"
                            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
                    : ''}
                <div class="collection-card-image no-image" style="${hasImage ? 'display:none' : ''}">🎴</div>
            </div>
            <div class="collection-card-info">
                <div class="collection-card-name" onclick="openCollectionCardDetail('${escapeHtml(card._colId)}', ${card._idx})"
                     style="cursor:pointer;" title="View details">
                    ${escapeHtml(card.hero || 'Unknown')}
                </div>
                ${(card.ebayAvgPrice || card.ebayLowPrice) ? `
                <div class="coll-price-row">
                    ${card.ebayAvgPrice ? `<span class="coll-price-avg" title="eBay avg price">⌀ $${Number(card.ebayAvgPrice).toFixed(2)}</span>` : ''}
                    ${card.ebayLowPrice ? `<span class="coll-price-low" title="eBay lowest price">↓ $${Number(card.ebayLowPrice).toFixed(2)}</span>` : ''}
                </div>` : ''}
                ${listingBadge
                    ? `<div style="margin-bottom:4px;">${listingBadge}</div>`
                    : ebayUrl ? `<div style="margin-bottom:4px;"><a href="${escapeHtml(ebayUrl)}" target="_blank" rel="noopener noreferrer"
                          class="collection-ebay-link" title="Search eBay">🛒 eBay</a></div>` : ''}
                <div class="collection-card-meta">${escapeHtml(card.cardNumber || '')} · ${escapeHtml(card.set || '')}</div>
                ${card.condition ? `<div style="font-size:10px;color:#6b7280;margin-top:1px;">${escapeHtml(card.condition)}</div>` : ''}
                ${cardTags.length > 0
                    ? `<div class="card-tags-row">${cardTags.map(t => `<span class="tag-chip tag-chip-sm">${escapeHtml(t)}</span>`).join('')}</div>`
                    : ''}
                <div class="collection-card-footer">
                    <span class="collection-card-badge ${card.scanType === 'free' ? 'free' : 'ai'}">
                        ${card.scanType === 'free' ? 'Free OCR' : 'AI'}
                    </span>
                </div>
            </div>
        </div>`;
    }).join('');

    body.innerHTML = filterBar + bulkBar + selectToggle + `<div class="collection-grid">${cardsHtml}</div>`;

    updateBulkBar();
}

window.toggleCollectionFilter = function(tag) {
    if (_activeFilters.has(tag)) { _activeFilters.delete(tag); }
    else                         { _activeFilters.add(tag); }
    renderCollectionModal();
};

window.clearCollectionFilters = function() {
    _activeFilters.clear();
    renderCollectionModal();
};

// Expose to window for onclick handlers
window.toggleSelectionMode   = toggleSelectionMode;
window.toggleCardSelection   = toggleCardSelection;
window.openBulkTagModal      = openBulkTagModal;
window.renderCollectionModal = renderCollectionModal;
window.openCollectionModal   = function() {
    const modal = document.getElementById('collectionModal');
    if (!modal) return;
    _selectionMode = false;
    _selectedCards.clear();
    _activeFilters.clear();
    // Reset title to default (openPriceCheckModal may have changed it)
    const titleEl = document.getElementById('collectionModalTitle');
    if (titleEl) titleEl.textContent = '🎴 My Collection';
    modal.classList.add('active');
    renderCollectionModal();
};

console.log('✅ Tags module loaded');
