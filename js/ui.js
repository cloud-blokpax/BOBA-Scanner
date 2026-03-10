// UI Helper Functions - COMPLETE PRODUCTION VERSION

// Sanitize user-controlled strings before inserting into HTML
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


function setStatus(type, state) {
    const el = document.getElementById(`status${type.charAt(0).toUpperCase() + type.slice(1)}`);
    if (el) el.className = `status-dot ${state}`;
}

function showToast(message, icon = '✓') {
    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toastIcon');
    const toastMessage = document.getElementById('toastMessage');
    
    if (!toast || !toastIcon || !toastMessage) {
        console.log('Toast elements not found, showing alert:', message);
        return;
    }
    
    toastIcon.textContent = icon;
    toastMessage.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function showLoading(show, text = 'Processing...') {
    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    
    if (!overlay || !loadingText) return;
    
    loadingText.textContent = text;
    overlay.classList.toggle('active', show);
}

function setProgress(percent) {
    const progressFill = document.getElementById('progressFill');
    if (progressFill) {
        progressFill.style.width = `${percent}%`;
    }
}

function updateStats() {
    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const collection  = collections.find(c => c.id === currentId);
    if (!collection) return;

    const stats  = collection.stats;
    const aiUsed = stats.aiCalls || 0;
    const rate   = stats.scanned > 0 ? Math.round((stats.free / stats.scanned) * 100) : 0;

    // Use actual user limits from userLimits (set after sign-in) or guest defaults
    const isGuest    = typeof userLimits === 'undefined' || !userLimits;
    const cardLimit  = isGuest ? 5  : (userLimits.maxCards    || 5);
    const aiLimit    = isGuest ? 1  : (userLimits.maxApiCalls || 1);
    const sublabel   = isGuest ? 'Guest limit' : 'Your limit';

    const statCards      = document.getElementById('statCards');
    const statAI         = document.getElementById('statAI');
    const statCost       = document.getElementById('statCost');
    const statRate       = document.getElementById('statRate');
    const statCardsLabel = document.getElementById('statCardsLabel');
    const statAILabel    = document.getElementById('statAILabel');

    if (statCards)      statCards.textContent      = `${stats.scanned} / ${cardLimit}`;
    if (statAI)         statAI.textContent          = `${aiUsed} / ${aiLimit}`;
    if (statCost)       statCost.textContent        = `$${(stats.cost || 0).toFixed(2)}`;
    if (statRate)       statRate.textContent        = `${rate}%`;
    if (statCardsLabel) statCardsLabel.textContent  = sublabel;
    if (statAILabel)    statAILabel.textContent     = `${aiLimit - aiUsed} remaining`;

    // Update stats strip summary line — total across ALL collections
    const allCollections = typeof getCollections === 'function' ? getCollections() : [];
    const totalCards = allCollections.reduce((sum, c) => sum + (c.cards?.length || 0), 0);
    const summary = document.getElementById('statsStripSummary');
    if (summary) summary.textContent = `${totalCards} card${totalCards !== 1 ? 's' : ''}`;
}

function renderCards() {
    console.log('🎨 Rendering cards...');

    // Update nav counts whenever cards are re-rendered
    if (typeof updateCollectionNavCounts === 'function') {
        try { updateCollectionNavCounts(); } catch(e) {}
    }
    
    // FIXED: Get collections properly instead of using reference
    const collections = getCollections();
    let currentId = getCurrentCollectionId();
    let collection = collections.find(c => c.id === currentId);

    // Fallback: if the active collection ID doesn't exist (e.g. it was removed
    // or sync wrote a different dataset), reset to 'default' only when the
    // default collection has cards — otherwise we silently show an empty grid
    // when this is really just a sync timing glitch (collection is in-flight).
    if (!collection && currentId !== 'default') {
        const defaultCol = collections.find(c => c.id === 'default');
        if (defaultCol && defaultCol.cards.length > 0) {
            console.warn(`⚠️ Collection "${currentId}" not found — falling back to default`);
            setCurrentCollectionId('default');
            currentId = 'default';
            collection = defaultCol;
        } else {
            // Default is also empty — don't switch; collection may be mid-sync.
            // Render the current collection as empty rather than clobbering the ID.
            console.warn(`⚠️ Collection "${currentId}" not found — waiting for sync`);
            collection = { id: currentId, cards: [], stats: { scanned: 0, free: 0, cost: 0, aiCalls: 0 } };
        }
    }

    if (!collection) {
        console.error('❌ No collection found');
        return;
    }
    
    const allCards = collection.cards || [];

    // ── View/sort/tag-filter preferences ──────────────────────────────────
    if (!window._cardViewPrefs) {
        const _storedView = localStorage.getItem('cardViewMode');
        window._cardViewPrefs = {
            sort: localStorage.getItem('cardSortMode') || 'newest',
            view: (['large', 'small', 'list'].includes(_storedView) ? _storedView : 'large'),
            tags: new Set()
        };
    }
    const prefs = window._cardViewPrefs;

    // ── Search/filter ─────────────────────────────────────────────────────
    const searchInput = document.getElementById('cardSearchInput');
    const searchBar   = document.getElementById('cardSearchBar');
    const searchClear = document.getElementById('cardSearchClear');
    const searchCount = document.getElementById('cardSearchCount');
    const searchQuery = (searchInput?.value || '').trim().toUpperCase();

    if (searchBar) searchBar.style.display = allCards.length > 0 ? 'block' : 'none';

    if (searchInput && !searchInput._wired) {
        searchInput._wired = true;
        // Debounce to avoid re-rendering on every keystroke (noticeable on 100+ cards)
        let _searchDebounceTimer = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(_searchDebounceTimer);
            _searchDebounceTimer = setTimeout(() => renderCards(), 150);
        });
        if (searchClear) {
            searchClear.addEventListener('click', () => {
                searchInput.value = '';
                searchClear.style.display = 'none';
                clearTimeout(_searchDebounceTimer);
                renderCards();
                searchInput.focus();
            });
        }
    }
    if (searchClear) searchClear.style.display = searchQuery ? 'block' : 'none';

    // Build filtered array while preserving original indices (needed for card operations)
    let filteredWithIdx = allCards.reduce((acc, card, idx) => {
        const q = searchQuery;
        if (!q ||
            String(card.hero       || '').toUpperCase().includes(q) ||
            String(card.cardNumber || '').toUpperCase().includes(q) ||
            String(card.athlete    || '').toUpperCase().includes(q) ||
            String(card.set        || '').toUpperCase().includes(q) ||
            String(card.pose       || '').toUpperCase().includes(q) ||
            String(card.weapon     || '').toUpperCase().includes(q) ||
            (Array.isArray(card.tags) && card.tags.some(t => t.toUpperCase().includes(q)))
        ) {
            acc.push({ card, idx });
        }
        return acc;
    }, []);

    // ── Tag filter ────────────────────────────────────────────────────────
    let filteredWithIdx2 = filteredWithIdx;
    if (prefs.tags.size > 0) {
        filteredWithIdx2 = filteredWithIdx.filter(({ card }) =>
            [...prefs.tags].every(tag => (card.tags || []).includes(tag))
        );
    }

    // ── Sort ──────────────────────────────────────────────────────────────
    switch (prefs.sort) {
        case 'oldest':    filteredWithIdx2.sort((a,b) => new Date(a.card.timestamp) - new Date(b.card.timestamp)); break;
        case 'hero':      filteredWithIdx2.sort((a,b) => String(a.card.hero||'').localeCompare(String(b.card.hero||''))); break;
        case 'cardnum':   filteredWithIdx2.sort((a,b) => String(a.card.cardNumber||'').localeCompare(String(b.card.cardNumber||''))); break;
        case 'ebay_high': filteredWithIdx2.sort((a,b) => (b.card.ebayAvgPrice||0) - (a.card.ebayAvgPrice||0)); break;
        case 'ebay_low':  filteredWithIdx2.sort((a,b) => (a.card.ebayAvgPrice||0) - (b.card.ebayAvgPrice||0)); break;
        default: /* newest — already newest-first from original push order */ break;
    }
    filteredWithIdx = filteredWithIdx2;

    // ── Pagination ────────────────────────────────────────────────────────
    const PAGE_SIZE = 50;
    if (!renderCards._page) renderCards._page = {};
    const tagKey  = [...prefs.tags].sort().join(',');
    const pageKey = `${currentId}|${searchQuery}|${prefs.sort}|${tagKey}`;
    if (renderCards._lastKey !== pageKey) {
        renderCards._page[pageKey] = 0;
        renderCards._lastKey = pageKey;
    }
    const page       = renderCards._page[pageKey] || 0;
    const totalCards = filteredWithIdx.length;
    const totalPages = Math.ceil(totalCards / PAGE_SIZE) || 1;
    const pagedItems = filteredWithIdx.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    if (searchCount) {
        const showing = pagedItems.length + page * PAGE_SIZE;
        searchCount.textContent = searchQuery && totalCards !== allCards.length
            ? `Showing ${Math.min(showing, totalCards)} of ${totalCards} (filtered from ${allCards.length})`
            : totalPages > 1
            ? `${totalCards} cards — page ${page + 1} of ${totalPages}`
            : `${allCards.length} card${allCards.length !== 1 ? 's' : ''}`;
    }

    console.log(`📊 Rendering ${pagedItems.length} card(s) (page ${page + 1}/${totalPages})`);

    const grid = document.getElementById('cardsGrid');
    const empty = document.getElementById('emptyState');
    const actionBar = document.getElementById('actionBar');

    if (!grid) {
        console.error('❌ Grid element not found');
        return;
    }

    if (allCards.length === 0) {
        if (empty) empty.style.display = '';
        if (actionBar) actionBar.style.display = 'none';
        const cb = document.getElementById('cardControlsBar');
        if (cb) cb.style.display = 'none';
        grid.innerHTML = '';
        grid.style.display = 'none';
        return;
    }

    if (totalCards === 0 && searchQuery) {
        if (empty) empty.style.display = 'none';
        if (actionBar) actionBar.style.display = '';
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:#9ca3af;">
            <div style="font-size:32px;margin-bottom:8px;">🔍</div>
            <p style="margin:0;font-size:15px;">No cards match "${escapeHtml(searchInput.value)}"</p>
        </div>`;
        grid.style.display = 'grid';
        return;
    }

    if (empty) empty.style.display = 'none';
    if (actionBar) actionBar.style.display = '';

    // ── Controls bar (sort / tag-filter / view-mode) ──────────────────────
    const controlsBar = document.getElementById('cardControlsBar');
    if (controlsBar) {
        controlsBar.style.display = 'block';
        const allTagsUsed = [...new Set(allCards.flatMap(c => c.tags || []))].sort();
        if (!window._bulkSelect) window._bulkSelect = { active: false, selected: new Set() };
        const _bs = window._bulkSelect;
        controlsBar.innerHTML = `
            <div class="card-controls-bar">
              <div class="card-controls-row">
                <select id="cardSortSelect" class="card-sort-select" aria-label="Sort cards">
                  <option value="newest"    ${prefs.sort==='newest'   ?'selected':''}>Newest Added</option>
                  <option value="oldest"    ${prefs.sort==='oldest'   ?'selected':''}>Oldest Added</option>
                  <option value="hero"      ${prefs.sort==='hero'     ?'selected':''}>Hero Name A–Z</option>
                  <option value="cardnum"   ${prefs.sort==='cardnum'  ?'selected':''}>Card Number</option>
                  <option value="ebay_high" ${prefs.sort==='ebay_high'?'selected':''}>eBay Price ↓</option>
                  <option value="ebay_low"  ${prefs.sort==='ebay_low' ?'selected':''}>eBay Price ↑</option>
                </select>
                <div style="display:flex;gap:4px;align-items:center;">
                  <div class="card-view-modes" role="group" aria-label="View mode">
                    <button class="card-view-btn${prefs.view==='large'?'  active':''}" data-view="large"  title="Small thumbnails">⊞</button>
                    <button class="card-view-btn${prefs.view==='small'?'  active':''}" data-view="small"  title="Large thumbnails">⊟</button>
                    <button class="card-view-btn${prefs.view==='list' ?'  active':''}" data-view="list"   title="List view">≡</button>
                  </div>
                  <button class="card-view-btn${_bs.active?' active':''}" id="bulkSelectToggleBtn" title="Select multiple cards">☑</button>
                </div>
              </div>
              ${allTagsUsed.length > 0 ? `
              <div class="card-tag-filter-row">
                <span class="card-filter-label">Filter:</span>
                ${allTagsUsed.map(t => `<button class="tag-filter-chip${prefs.tags.has(t)?' active':''}" data-filter-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
                ${prefs.tags.size > 0 ? `<button class="tag-filter-clear" id="cardTagFilterClear">✕ Clear</button>` : ''}
              </div>` : ''}
              ${_bs.active ? `
              <div id="bulkActionBar" style="margin-top:8px;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span id="bulkSelectedCount" style="flex:1;color:#94a3b8;font-size:13px;">${_bs.selected.size > 0 ? `${_bs.selected.size} card${_bs.selected.size!==1?'s':''} selected` : 'Tap cards to select'}</span>
                <button onclick="window.bulkSelectAll()" style="padding:5px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;cursor:pointer;font-size:12px;">☑ Select All</button>
                ${_bs.selected.size > 0 ? `
                <button onclick="window.bulkRefreshEbayPrices()" style="padding:5px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;cursor:pointer;font-size:12px;">🔄 Refresh eBay</button>
                <button onclick="window.bulkDeleteCards()" style="padding:5px 10px;border-radius:6px;border:1px solid #ef4444;background:#1e293b;color:#ef4444;cursor:pointer;font-size:12px;">🗑️ Delete</button>
                ` : ''}
                <button onclick="window.clearBulkSelect()" style="padding:5px 10px;border-radius:6px;border:1px solid #475569;background:#1e293b;color:#94a3b8;cursor:pointer;font-size:12px;">✕ Cancel</button>
              </div>` : ''}
            </div>`;

        // Wire controls (re-wired each render since innerHTML replaces DOM)
        const sortSel = document.getElementById('cardSortSelect');
        if (sortSel) sortSel.addEventListener('change', () => {
            prefs.sort = sortSel.value;
            localStorage.setItem('cardSortMode', prefs.sort);
            renderCards();
        });
        controlsBar.querySelectorAll('.card-view-btn[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                prefs.view = btn.dataset.view;
                localStorage.setItem('cardViewMode', prefs.view);
                renderCards();
            });
        });
        controlsBar.querySelectorAll('[data-filter-tag]').forEach(btn => {
            btn.addEventListener('click', () => {
                const tag = btn.dataset.filterTag;
                if (prefs.tags.has(tag)) prefs.tags.delete(tag); else prefs.tags.add(tag);
                renderCards();
            });
        });
        const clearTagBtn = document.getElementById('cardTagFilterClear');
        if (clearTagBtn) clearTagBtn.addEventListener('click', () => { prefs.tags.clear(); renderCards(); });

        document.getElementById('bulkSelectToggleBtn')?.addEventListener('click', () => {
            window._bulkSelect.active = !window._bulkSelect.active;
            if (!window._bulkSelect.active) window._bulkSelect.selected.clear();
            renderCards();
        });
    }

    // Set view-mode class on grid
    grid.className = `cards-grid cards-grid--${prefs.view}`;
    grid.style.display = prefs.view === 'list' ? 'flex' : 'grid';

    // ── Render paginated cards ─────────────────────────────────────────────
    if (prefs.view === 'list') {
        // List view: one row per card
        grid.innerHTML = pagedItems.map(({ card, idx }) => {
            const hasImg = card.imageUrl && !card.imageUrl.startsWith('blob:');
            const priceHtml = card.ebayAvgPrice
                ? `<span class="cl-price">⌀ $${Number(card.ebayAvgPrice).toFixed(2)}</span>` : '';
            return `
            <div class="card-list-row" id="card_item_${idx}" data-open-card="${idx}" style="cursor:pointer;">
              <div class="cl-img">
                ${hasImg ? `<img src="${card.imageUrl}" alt="${escapeHtml(card.cardNumber)}" onerror="this.style.display='none'">` : '<span>🎴</span>'}
              </div>
              <div class="cl-info">
                <div class="cl-name">${escapeHtml(card.hero||'Unknown')}</div>
                <div class="cl-meta">${escapeHtml(card.cardNumber||'')}${card.set?' · '+escapeHtml(card.set):''}</div>
              </div>
              ${priceHtml}
              ${card.condition ? `<span class="cl-cond">${escapeHtml(card.condition)}</span>` : ''}
              <span class="cl-badge ${card.scanType==='free'?'badge-free':'badge-paid'}">${escapeHtml(card.scanMethod||card.scanType||'')}</span>
            </div>`;
        }).join('');

    } else if (prefs.view === 'small') {
        // Small thumbnail view
        grid.innerHTML = pagedItems.map(({ card, idx }) => {
            const hasImg = card.imageUrl && !card.imageUrl.startsWith('blob:');
            const priceHtml = (card.ebayAvgPrice||card.ebayLowPrice)
                ? `<div class="cs-price">${card.ebayAvgPrice?`⌀$${Number(card.ebayAvgPrice).toFixed(0)}`:''} ${card.ebayLowPrice?`↓$${Number(card.ebayLowPrice).toFixed(0)}`:''}</div>` : '';
            return `
            <div class="card-small" id="card_item_${idx}" data-open-card="${idx}" style="cursor:pointer;" title="${escapeHtml(card.hero||'')}">
              <div class="cs-img">
                ${hasImg ? `<img src="${card.imageUrl}" alt="${escapeHtml(card.cardNumber)}" onerror="this.style.display='none'">` : '<span>🎴</span>'}
                <span class="cs-badge ${card.scanType==='free'?'badge-free':'badge-paid'}">${escapeHtml(card.scanMethod||card.scanType||'')}</span>
              </div>
              <div class="cs-body">
                <div class="cs-name">${escapeHtml(card.hero||'Unknown')}</div>
                <div class="cs-num">${escapeHtml(card.cardNumber||'')}</div>
                ${priceHtml}
              </div>
            </div>`;
        }).join('');

    } else {
        // Large view (default) — original rendering
        grid.innerHTML = pagedItems.map(({ card, idx }) => {
        const lowConfBadge = card.lowConfidence
            ? `<span class="conf-badge conf-low" title="Low confidence scan — please verify">⚠️ Verify</span>`
            : (card.confidence && card.scanType === 'free'
                ? `<span class="conf-badge conf-ok" title="OCR confidence: ${Math.round(card.confidence)}%">${Math.round(card.confidence)}%</span>`
                : '');

        const listingBadge = card.listingStatus === 'listed' && card.listingUrl
            ? `<a href="${escapeHtml(card.listingUrl)}" target="_blank" rel="noopener noreferrer"
                  class="listing-badge listed" title="View your eBay listing${card.listingPrice ? ': ' + card.listingPrice : ''}"
                  onclick="event.stopPropagation()">
                 🟢 Listed${card.listingPrice ? ' ' + escapeHtml(card.listingPrice) : ''}
               </a>`
            : card.listingStatus === 'listed'
            ? `<span class="listing-badge listed">🟢 Listed</span>`
            : card.listingStatus === 'sold'
            ? `<span class="listing-badge sold">🔴 Sold${card.soldAt ? ' ' + new Date(card.soldAt).toLocaleDateString() : ''}</span>`
            : '';

        const conditionOptions = [
            '', 'Raw', 'PSA 1', 'PSA 2', 'PSA 3', 'PSA 4', 'PSA 5',
            'PSA 6', 'PSA 7', 'PSA 8', 'PSA 9', 'PSA 10',
            'BGS 7', 'BGS 7.5', 'BGS 8', 'BGS 8.5', 'BGS 9', 'BGS 9.5', 'BGS 10',
            'SGC 7', 'SGC 8', 'SGC 9', 'SGC 10'
        ].map(opt => `<option value="${opt}" ${card.condition === opt ? 'selected' : ''}>${opt || 'Condition...'}</option>`).join('');

        return `
        <div class="card-item" id="card_item_${idx}" data-open-card="${idx}">
            <div class="card-image-container" data-open-card="${idx}" style="cursor:pointer;" title="Tap to view details">
                <img class="card-image"
                     src="${card.imageUrl && !card.imageUrl.startsWith('blob:') ? card.imageUrl : ''}"
                     alt="${escapeHtml(card.cardNumber)}"
                     onerror="this.style.display='none'"
                     style="${(!card.imageUrl || card.imageUrl.startsWith('blob:')) ? 'display:none' : ''}">
                <span class="card-badge ${card.scanType === 'free' ? 'badge-free' : 'badge-paid'}">
                    ${escapeHtml(card.scanMethod || '')}
                </span>
                ${lowConfBadge}
                ${listingBadge}
            </div>
            <div class="card-content" data-open-card="${idx}" style="cursor:pointer;">
                <div class="card-title-row">
                    <div class="card-title">${escapeHtml(card.hero || 'Unknown Card')}</div>
                    <span id="rtl_badge_${idx}" class="rtl-badge" style="${card.readyToList ? '' : 'display:none'}">🏷️ List</span>
                </div>
                ${card.athlete ? `<div class="card-athlete">${escapeHtml(card.athlete)}</div>` : ''}
                ${(card.ebayAvgPrice || card.ebayLowPrice) ? `
                <div class="card-price-row">
                    ${card.ebayAvgPrice ? `<span class="price-avg" title="eBay avg price">⌀ $${Number(card.ebayAvgPrice).toFixed(2)}</span>` : ''}
                    ${card.ebayLowPrice ? `<span class="price-low" title="eBay lowest price">↓ $${Number(card.ebayLowPrice).toFixed(2)}</span>` : ''}
                </div>` : ''}
                ${card.condition ? `<div class="card-condition-badge">${escapeHtml(card.condition)}</div>` : ''}
            </div>
            <div class="card-footer" onclick="event.stopPropagation()">
                <button class="btn-ebay card-footer-ebay" onclick="event.stopPropagation();openEbaySearch(${idx})" title="Search eBay">
                    <span class="btn-ebay-icon">🛒</span><span>Search eBay</span>
                </button>
                <button class="btn-wrong-card" onclick="event.stopPropagation();correctCard(${idx})" title="Wrong card? Search for the correct one">⚠️ Wrong Card</button>
                <button class="btn-detail card-footer-detail" data-open-card="${idx}" title="Edit / View full details">✏️ Edit</button>
                <button class="btn-card-more" data-card-more="${idx}" onclick="event.stopPropagation();toggleCardMoreMenu(${idx},this)" title="More options" style="display:none;">⋯</button>
            </div>
        </div>`;
        }).join('');
    } // end large-view else

    // ── Pagination controls ───────────────────────────────────────────────
    if (totalPages > 1) {
        const paginationHtml = `
        <div style="grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:12px;padding:16px 0;color:#94a3b8;font-size:14px;">
            <button onclick="renderCards._goToPage('${pageKey}', ${page - 1})"
                    style="padding:6px 16px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;cursor:pointer;${page === 0 ? 'opacity:0.4;pointer-events:none' : ''}"
                    ${page === 0 ? 'disabled' : ''}>← Prev</button>
            <span>Page ${page + 1} of ${totalPages}</span>
            <button onclick="renderCards._goToPage('${pageKey}', ${page + 1})"
                    style="padding:6px 16px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;cursor:pointer;${page >= totalPages - 1 ? 'opacity:0.4;pointer-events:none' : ''}"
                    ${page >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
        </div>`;
        grid.insertAdjacentHTML('beforeend', paginationHtml);
    }

    console.log('Cards rendered successfully');

    // ── Apply bulk-select-mode class and restore checked state ────────────
    if (window._bulkSelect) {
        grid.classList.toggle('bulk-select-mode', window._bulkSelect.active);
        if (window._bulkSelect.active) {
            window._bulkSelect.selected.forEach(idx => {
                const el = document.getElementById(`card_item_${idx}`);
                if (el) el.classList.add('is-selected');
            });
        }
    }

    // ── Delegated card-open handler ───────────────────────────────────────
    // The listeners are on the grid element itself and survive innerHTML replacements.
    // Guard against duplicate registration but reset when view mode changes.
    const viewModeKey = `view_${prefs.view}`;
    if (!grid._listenersAttached || grid._viewModeKey !== viewModeKey) {
        grid._listenersAttached = false; // force re-attach if view changed
        grid._viewModeKey = viewModeKey;
    }
    if (!grid._listenersAttached) {
        grid._listenersAttached = true;

        grid.addEventListener('touchend', function(e) {
            const target = e.target.closest('[data-open-card]');
            if (!target) return;
            e.preventDefault(); // kill the 300ms ghost click
            const cardIdx = parseInt(target.dataset.openCard, 10);
            if (window._bulkSelect?.active) { window.toggleBulkCardSelect(cardIdx); return; }
            openCardDetail(cardIdx);
        }, { passive: false });

        grid.addEventListener('click', function(e) {
            if (e.detail === 0) return; // keyboard-triggered, skip
            const target = e.target.closest('[data-open-card]');
            if (!target) return;
            const now = Date.now();
            if (grid._lastTouchEnd && now - grid._lastTouchEnd < 600) return;
            const cardIdx = parseInt(target.dataset.openCard, 10);
            if (window._bulkSelect?.active) { window.toggleBulkCardSelect(cardIdx); return; }
            openCardDetail(cardIdx);
        });

        grid.addEventListener('touchend', function() {
            grid._lastTouchEnd = Date.now();
        }, { passive: true, capture: true });
    }
}

// Pagination helper — used by inline onclick handlers in the pagination controls
renderCards._goToPage = function(pageKey, newPage) {
    if (!renderCards._page) renderCards._page = {};
    renderCards._page[pageKey] = newPage;
    renderCards._lastKey = pageKey;
    renderCards();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ── Bulk select helpers ───────────────────────────────────────────────────────
window.toggleBulkCardSelect = function(idx) {
    if (!window._bulkSelect?.active) return;
    const sel = window._bulkSelect.selected;
    const cardEl = document.getElementById(`card_item_${idx}`);
    if (sel.has(idx)) { sel.delete(idx); cardEl?.classList.remove('is-selected'); }
    else              { sel.add(idx);    cardEl?.classList.add('is-selected'); }
    const n = sel.size;
    const countEl = document.getElementById('bulkSelectedCount');
    if (countEl) countEl.textContent = n > 0 ? `${n} card${n!==1?'s':''} selected` : 'Tap cards to select';
    // Show/hide action buttons without full re-render
    const bar = document.getElementById('bulkActionBar');
    if (bar) {
        const hasBtns = bar.querySelectorAll('button[onclick*="bulkRefreshEbayPrices"], button[onclick*="bulkDeleteCards"]');
        if (n > 0 && hasBtns.length === 0) renderCards(); // add action buttons
        if (n === 0 && hasBtns.length > 0) renderCards(); // remove action buttons
    }
};

window.clearBulkSelect = function() {
    if (!window._bulkSelect) return;
    window._bulkSelect.active = false;
    window._bulkSelect.selected.clear();
    renderCards();
};

window.bulkSelectAll = function() {
    if (!window._bulkSelect?.active) return;
    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const collection  = collections.find(c => c.id === currentId);
    if (!collection) return;
    const sel = window._bulkSelect.selected;
    collection.cards.forEach((_, idx) => sel.add(idx));
    renderCards();
    const n = sel.size;
    const countEl = document.getElementById('bulkSelectedCount');
    if (countEl) countEl.textContent = `${n} card${n !== 1 ? 's' : ''} selected`;
};

window.bulkDeleteCards = function() {
    const sel = window._bulkSelect?.selected;
    if (!sel?.size) return;
    const count = sel.size;
    const indices = [...sel].sort((a, b) => b - a); // descending so splices don't shift
    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const collection  = collections.find(c => c.id === currentId);
    if (!collection) return;
    for (const idx of indices) {
        const card = collection.cards[idx];
        if (!card) continue;
        if (typeof recordDeletedCard === 'function') recordDeletedCard(card);
        if (typeof deleteCardImage   === 'function') deleteCardImage(card.imageUrl);
        if (card.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(card.imageUrl);
        collection.cards.splice(idx, 1);
        collection.stats.scanned = Math.max(0, (collection.stats.scanned || 0) - 1);
        if (card.scanType === 'free') collection.stats.free = Math.max(0, (collection.stats.free || 0) - 1);
    }
    saveCollections(collections);
    if (typeof updateStats === 'function') updateStats();
    window._bulkSelect.active = false;
    window._bulkSelect.selected.clear();
    renderCards();
    showToast(`${count} card${count!==1?'s':''} removed`, '🗑️');
};

window.bulkRefreshEbayPrices = function() {
    const sel = window._bulkSelect?.selected;
    if (!sel?.size) return;
    if (typeof fetchEbayAvgPrice !== 'function') { showToast('eBay refresh not available', '⚠️'); return; }
    const indices = [...sel];
    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const collection  = collections.find(c => c.id === currentId);
    if (!collection) return;
    showToast(`Refreshing eBay prices for ${indices.length} card${indices.length!==1?'s':''}...`, '🔄');
    let done = 0;
    indices.forEach(idx => {
        const card = collection.cards[idx];
        if (!card) { done++; return; }
        fetchEbayAvgPrice(card).then(result => {
            if (result && result.count > 0) {
                card.ebayAvgPrice     = result.avgPrice;
                card.ebayLowPrice     = result.lowPrice;
                card.ebayHighPrice    = result.highPrice;
                card.ebayListingCount = result.count;
            } else {
                card.ebayAvgPrice = null;
                card.ebayLowPrice = null;
            }
            card.ebayPriceFetched = new Date().toISOString();
        }).catch(() => {}).finally(() => {
            done++;
            if (done === indices.length) {
                saveCollections(collections);
                renderCards();
                showToast('eBay prices updated!', '✅');
            }
        });
    });
};

function renderField(label, field, index, value, autoFilled) {
    return `
        <div class="field">
            <div class="field-label">${label}</div>
            <input class="field-input ${autoFilled ? 'auto-filled' : ''}" 
                   type="text" 
                   value="${value || ''}" 
                   onchange="updateCard(${index}, '${field}', this.value)">
        </div>
    `;
}

function initUploadArea() {
    const uploadArea = document.getElementById('uploadArea');
    
    if (!uploadArea) {
        console.warn('Upload area element not found');
        return;
    }
    
    console.log('📤 Setting up upload area...');
    
    // Drag and drop handlers - attached directly, NO cloneNode
    // (cloneNode was stripping onclick attributes from the buttons inside,
    // making "Choose Image", "Take Photo" and "Settings" do nothing)
    uploadArea.addEventListener('dragover', function(e) {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', function(e) {
        if (!uploadArea.contains(e.relatedTarget)) {
            uploadArea.classList.remove('dragover');
        }
    });
    
    uploadArea.addEventListener('drop', function(e) {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        
        const files = Array.from(e.dataTransfer.files).filter(f => 
            f.type.startsWith('image/')
        );
        
        if (files.length > 0) {
            const input = document.getElementById('fileInput');
            if (input) {
                const dataTransfer = new DataTransfer();
                files.forEach(file => dataTransfer.items.add(file));
                input.files = dataTransfer.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });
    
    console.log('✅ Upload area ready');
}

// ========================================
// COMPATIBILITY FUNCTIONS FOR REDESIGNED UI
// ========================================

window.openSettings = function() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.classList.add('active');
        
        const toggleAutoDetect = document.getElementById('toggleAutoDetect');
        const togglePerspective = document.getElementById('togglePerspective');
        const toggleRegionOcr = document.getElementById('toggleRegionOcr');
        const selectQuality = document.getElementById('selectQuality');
        const rangeThreshold = document.getElementById('rangeThreshold');
        const thresholdValue = document.getElementById('thresholdValue');
        
        if (typeof config !== 'undefined') {
            if (toggleAutoDetect) toggleAutoDetect.checked = config.autoDetect;
            if (togglePerspective) togglePerspective.checked = config.perspective;
            if (toggleRegionOcr) toggleRegionOcr.checked = config.regionOcr;
            if (selectQuality) selectQuality.value = config.quality;
            if (rangeThreshold) rangeThreshold.value = config.threshold;
            if (thresholdValue) thresholdValue.textContent = config.threshold;
        }

        // Show theme section only for signed-in users, then populate it
        const themeGroup = document.getElementById('themeSettingGroup');
        if (themeGroup) {
            themeGroup.style.display = window.currentUser ? '' : 'none';
            if (window.currentUser && typeof window.renderThemeSettingsSection === 'function') {
                window.renderThemeSettingsSection();
            }
        }
    } else {
        showToast('Settings coming soon!', '⚙️');
    }
};

window.closeSettings = function() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.classList.remove('active');
    }
};

window.capturePhoto = function(e) {
    if (e) e.stopPropagation();
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.setAttribute('capture', 'environment');
        fileInput.setAttribute('accept', 'image/*');
        fileInput.click();
        
        setTimeout(() => {
            fileInput.removeAttribute('capture');
        }, 100);
    }
};

window.chooseFromGallery = function(e) {
    if (e) e.stopPropagation();
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.removeAttribute('capture');
        fileInput.setAttribute('accept', 'image/*');
        fileInput.click();
    }
};

window.showSignInPrompt = function() {
    // Show the sign-in modal which contains the rendered Google button.
    // google.accounts.id.prompt() does not work on iOS Safari (blocked by ITP).
    // The rendered button opens a proper popup/tab that iOS allows.
    const modal = document.getElementById('signInModal');
    if (modal) {
        modal.classList.add('active');
        // Render Google button inside modal if not already rendered
        const container = document.getElementById('googleSignInButton');
        if (container && typeof google !== 'undefined' && google.accounts) {
            container.innerHTML = '';
            google.accounts.id.renderButton(container, {
                theme: 'outline', size: 'large', width: 280,
                text: 'signin_with', shape: 'rectangular'
            });
        }
    } else if (typeof google !== 'undefined' && google.accounts) {
        // Fallback: try prompt (works on desktop)
        google.accounts.id.prompt();
    } else {
        showToast('Sign-in not available — try refreshing', '🔐');
    }
};

window.closeSignInModal = function() {
    const modal = document.getElementById('signInModal');
    if (modal) modal.classList.remove('active');
};

window.updateAuthUI = function(user) {
    const btnSignIn = document.getElementById('btnSignIn');
    const userAuthenticated = document.getElementById('userAuthenticated');
    const userName = document.getElementById('userName');
    const userEmail = document.getElementById('userEmail');
    const userAvatar = document.getElementById('userAvatar');
    
    if (user) {
        if (btnSignIn) btnSignIn.style.display = 'none';
        if (userAuthenticated) userAuthenticated.style.display = 'flex';
        
        if (userName) userName.textContent = user.name || 'User';
        if (userEmail) userEmail.textContent = user.email || '';
        if (userAvatar) {
            userAvatar.src = user.picture || user.profilePicture || '';
            userAvatar.alt = user.name || 'User';
        }
    } else {
        if (btnSignIn) btnSignIn.style.display = 'block';
        if (userAuthenticated) userAuthenticated.style.display = 'none';
    }
};

window.toggleUserMenu = function() {
    // Open the More sheet which contains Settings, Sign Out, and all tools
    if (typeof window.openMoreSheet === 'function') {
        window.openMoreSheet();
    }
};

window.signOut = function() {
    if (!confirm('Sign out?')) return;
    
    if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.disableAutoSelect();
    }
    
    // Only clear auth data — preserve collections and settings
    localStorage.removeItem('googleUser');
    localStorage.removeItem('currentCollectionId');
    sessionStorage.clear();
    
    if (typeof googleUser !== 'undefined') {
        window.googleUser = null;
    }
    if (typeof currentUser !== 'undefined') {
        window.currentUser = null;
    }
    
    updateAuthUI(null);
    showToast('Signed out successfully', '👋');
    
    setTimeout(() => {
        window.location.reload();
    }, 1000);
};

window.announceToScreenReader = function(message) {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.style.position = 'absolute';
    announcement.style.left = '-10000px';
    announcement.style.width = '1px';
    announcement.style.height = '1px';
    announcement.style.overflow = 'hidden';
    announcement.textContent = message;
    document.body.appendChild(announcement);
    
    setTimeout(() => {
        if (announcement.parentNode) {
            document.body.removeChild(announcement);
        }
    }, 1000);
};


// ========================================
// WIRE UP EVENTS — safety net for buttons
// Called on DOMContentLoaded as backup to 
// inline onclick handlers in index.html
// ========================================
function wireUpEvents() {
    const fi = () => document.getElementById('fileInput');

    // "Upload or Capture" — toggles the scan options panel
    const btnUploadCapture = document.getElementById('btnUploadCapture');
    const scanOptionsPanel = document.getElementById('scanOptionsPanel');
    if (btnUploadCapture && scanOptionsPanel) {
        btnUploadCapture.addEventListener('click', function(e) {
            e.stopPropagation();
            const isOpen = scanOptionsPanel.style.display !== 'none';
            scanOptionsPanel.style.display = isOpen ? 'none' : '';
        });
        // Close panel when clicking outside
        document.addEventListener('click', function(e) {
            if (scanOptionsPanel.style.display !== 'none'
                && !scanOptionsPanel.contains(e.target)
                && e.target !== btnUploadCapture
                && !btnUploadCapture.contains(e.target)) {
                scanOptionsPanel.style.display = 'none';
            }
        });
    }

    // "Upload to Collection" — sets mode to collection then triggers file picker
    const btnChooseImage = document.getElementById('btnChooseImage');
    if (btnChooseImage) btnChooseImage.addEventListener('click', function(e) {
        e.stopPropagation();
        window.scanMode = 'collection';
        if (scanOptionsPanel) scanOptionsPanel.style.display = 'none';
        const input = fi();
        if (input) { input.removeAttribute('capture'); input.click(); }
    });

    // "Check eBay Prices" — sets mode to pricecheck then triggers same file picker
    const btnPriceCheck = document.getElementById('btnPriceCheck');
    if (btnPriceCheck) btnPriceCheck.addEventListener('click', function(e) {
        e.stopPropagation();
        window.scanMode = 'pricecheck';
        if (typeof ensurePriceCheckCollection === 'function') ensurePriceCheckCollection();
        if (scanOptionsPanel) scanOptionsPanel.style.display = 'none';
        const input = fi();
        if (input) { input.removeAttribute('capture'); input.click(); }
    });

    // "View Collection" — switches to Collection tab
    const btnViewCollection = document.getElementById('btnViewCollection');
    if (btnViewCollection) btnViewCollection.addEventListener('click', function() {
        if (typeof window.bottomNavSwitchTab === 'function') {
            window.bottomNavSwitchTab('collection');
            if (typeof window.sliderSwitch === 'function') window.sliderSwitch('my_collection');
        }
    });

    // Settings — now wired from both header button and legacy btnSettings if present
    const btnHeaderSettings = document.getElementById('btnHeaderSettings');
    if (btnHeaderSettings) btnHeaderSettings.addEventListener('click', function(e) {
        e.stopPropagation();
        openSettings();
    });
    const btnSettingsLegacy = document.getElementById('btnSettings');
    if (btnSettingsLegacy) btnSettingsLegacy.addEventListener('click', function(e) {
        e.stopPropagation();
        openSettings();
    });

    // "My Collection" quick-access button — switches to the Collection tab
    const btnOpenCollection = document.getElementById('btnOpenCollection');
    if (btnOpenCollection) btnOpenCollection.addEventListener('click', function() {
        if (typeof window.bottomNavSwitchTab === 'function') {
            window.bottomNavSwitchTab('collection');
            if (typeof window.sliderSwitch === 'function') window.sliderSwitch('my_collection');
        } else if (typeof openCollectionModal === 'function') {
            openCollectionModal();
        }
    });

    // "Price Check" quick-access button — switches to Collection tab, selects Price Check slider
    const btnOpenPriceCheck = document.getElementById('btnOpenPriceCheck');
    if (btnOpenPriceCheck) btnOpenPriceCheck.addEventListener('click', function() {
        if (typeof window.bottomNavSwitchTab === 'function') {
            window.bottomNavSwitchTab('collection');
            if (typeof window.sliderSwitch === 'function') window.sliderSwitch('price_check');
        } else if (typeof openPriceCheckModal === 'function') {
            openPriceCheckModal();
        }
    });

    const btnExportCSV = document.getElementById('btnExportCSV');
    if (btnExportCSV) btnExportCSV.addEventListener('click', function() {
        if (typeof openExportModal === 'function') openExportModal();
    });

    const btnEbayExport = document.getElementById('btnEbayExport');
    if (btnEbayExport) btnEbayExport.addEventListener('click', function() {
        if (typeof openEbayExportModal === 'function') openEbayExportModal();
    });

    const btnExportExcel = document.getElementById('btnExportExcel');
    if (btnExportExcel) btnExportExcel.addEventListener('click', function() {
        if (typeof exportExcel === 'function') exportExcel();
    });

    const btnSignIn = document.getElementById('btnSignIn');
    if (btnSignIn) btnSignIn.addEventListener('click', showSignInPrompt);

    const btnSignOut = document.getElementById('btnSignOut');
    if (btnSignOut) btnSignOut.addEventListener('click', function() {
        if (typeof signOut === 'function') signOut();
    });

    const settingsModalClose = document.getElementById('settingsModalClose');
    if (settingsModalClose) settingsModalClose.addEventListener('click', closeSettings);

    const settingsCloseBtn = document.getElementById('settingsCloseBtn');
    if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', closeSettings);

    const settingsModalBackdrop = document.getElementById('settingsModalBackdrop');
    if (settingsModalBackdrop) settingsModalBackdrop.addEventListener('click', closeSettings);

    // Tool buttons — wired here (not inline onclick) to survive SES lockdown from browser extensions
    const btnBatchScan = document.getElementById('btnBatchScan');
    if (btnBatchScan) btnBatchScan.addEventListener('click', function() {
        if (scanOptionsPanel) scanOptionsPanel.style.display = 'none';
        if (typeof openBatchScanner === 'function') openBatchScanner();
        else if (typeof window.openBatchScanner === 'function') window.openBatchScanner();
    });

    const btnBinderScan = document.getElementById('btnBinderScan');
    if (btnBinderScan) btnBinderScan.addEventListener('click', function() {
        if (scanOptionsPanel) scanOptionsPanel.style.display = 'none';
        if (typeof openBinderScanner === 'function') openBinderScanner();
        else if (typeof window.openBinderScanner === 'function') window.openBinderScanner();
    });

    const btnDeckBuilder = document.getElementById('btnDeckBuilder');
    if (btnDeckBuilder) {
        btnDeckBuilder.addEventListener('click', function() {
            if (typeof window.openDeckBuilder === 'function') window.openDeckBuilder();
            else showToast('Deck Builder not loaded — please refresh', '⚠️');
        });
    }

    // Tournament buttons — only functional when tournaments.js is loaded
    const btnCreateTournament = document.getElementById('btnCreateTournament');
    if (btnCreateTournament) {
        btnCreateTournament.addEventListener('click', function() {
            if (typeof showCreateTournamentModal === 'function') showCreateTournamentModal();
        });
    }
    const btnMyTournaments = document.getElementById('btnMyTournaments');
    if (btnMyTournaments) {
        btnMyTournaments.addEventListener('click', function() {
            if (typeof showMyTournamentsModal === 'function') showMyTournamentsModal();
        });
    }

    // Deck Builder nav shortcut (home screen row → switches to Deck tab)
    const btnOpenDeckBuilderNav = document.getElementById('btnOpenDeckBuilderNav');
    if (btnOpenDeckBuilderNav) {
        btnOpenDeckBuilderNav.addEventListener('click', function() {
            if (typeof window.bottomNavSwitchTab === 'function') {
                window.bottomNavSwitchTab('deck');
            } else if (typeof window.sliderSwitch === 'function') {
                sliderSwitch('deck_building');
            }
        });
    }

    const btnReadyToList = document.getElementById('btnReadyToList');
    if (btnReadyToList) btnReadyToList.addEventListener('click', function() {
        if (typeof openReadyToListView === 'function') openReadyToListView();
        else if (typeof window.openReadyToListView === 'function') window.openReadyToListView();
    });

    const btnCollectionStats = document.getElementById('btnCollectionStats');
    if (btnCollectionStats) btnCollectionStats.addEventListener('click', function() {
        if (typeof openStatsModal === 'function') openStatsModal();
        else if (typeof showStatsModal === 'function') showStatsModal();
    });

    const btnScanHistory = document.getElementById('btnScanHistory');
    if (btnScanHistory) btnScanHistory.addEventListener('click', function() {
        if (typeof openScanHistoryModal === 'function') openScanHistoryModal();
    });

    // Force sync button
    const btnForceSync = document.getElementById('btnForceSync');
    if (btnForceSync) btnForceSync.addEventListener('click', function() {
        if (typeof forceSync === 'function') forceSync();
    });

    // Stats strip toggle removed — strip is now a simple static summary

    // User avatar menu toggle
    const userAvatar = document.getElementById('userAvatar');
    if (userAvatar) userAvatar.addEventListener('click', function() {
        if (typeof toggleUserMenu === 'function') toggleUserMenu();
    });

    // FAB sync button
    const fabSync = document.getElementById('fabSync');
    if (fabSync) fabSync.addEventListener('click', function() {
        if (typeof manualSync === 'function') manualSync();
    });

    // Collection slider tabs
    ['collection', 'price_check', 'deck_building'].forEach(id => {
        const btn = document.getElementById(
            id === 'collection' ? 'sliderBtnCollection' :
            id === 'price_check' ? 'sliderBtnPriceCheck' : 'sliderBtnDeckBuilder'
        );
        if (btn) btn.addEventListener('click', () => {
            if (typeof sliderSwitch === 'function') sliderSwitch(id);
        });
    });

    // Sign-in modal backdrop and close button
    const signInModalBackdrop = document.querySelector('#signInModal .modal-backdrop');
    if (signInModalBackdrop) signInModalBackdrop.addEventListener('click', function() {
        if (typeof closeSignInModal === 'function') closeSignInModal();
    });
    const signInModalClose = document.querySelector('#signInModal .modal-close');
    if (signInModalClose) signInModalClose.addEventListener('click', function() {
        if (typeof closeSignInModal === 'function') closeSignInModal();
    });

    // Collection modal backdrop and close button
    const collectionModalBackdrop = document.querySelector('#collectionModal .modal-backdrop');
    if (collectionModalBackdrop) collectionModalBackdrop.addEventListener('click', function() {
        if (typeof closeCollectionModal === 'function') closeCollectionModal();
    });
    const collectionModalClose = document.querySelector('#collectionModal .modal-close');
    if (collectionModalClose) collectionModalClose.addEventListener('click', function() {
        if (typeof closeCollectionModal === 'function') closeCollectionModal();
    });

    // Settings inputs
    const toggleAutoDetect = document.getElementById('toggleAutoDetect');
    if (toggleAutoDetect) toggleAutoDetect.addEventListener('change', function() {
        if (typeof updateSetting === 'function') updateSetting('autoDetect', this.checked);
    });
    const togglePerspective = document.getElementById('togglePerspective');
    if (togglePerspective) togglePerspective.addEventListener('change', function() {
        if (typeof updateSetting === 'function') updateSetting('perspective', this.checked);
    });
    const toggleRegionOcr = document.getElementById('toggleRegionOcr');
    if (toggleRegionOcr) toggleRegionOcr.addEventListener('change', function() {
        if (typeof updateSetting === 'function') updateSetting('regionOcr', this.checked);
    });
    const selectQuality = document.getElementById('selectQuality');
    if (selectQuality) selectQuality.addEventListener('change', function() {
        if (typeof updateSetting === 'function') updateSetting('quality', this.value);
    });
    const rangeThreshold = document.getElementById('rangeThreshold');
    if (rangeThreshold) {
        rangeThreshold.addEventListener('input', function() {
            const el = document.getElementById('thresholdValue');
            if (el) el.textContent = this.value;
        });
        rangeThreshold.addEventListener('change', function() {
            if (typeof updateSetting === 'function') updateSetting('threshold', this.value);
        });
    }

    console.log('✅ Button events wired');
}

// Update the card counts on the Collection / Price Check nav buttons
function updateCollectionNavCounts() {
    try {
        const collections = getCollections();
        const mainCol = collections.find(c => c.id === 'default') || collections.find(c => c.id !== 'price_check' && c.id !== 'deck_building');
        const pcCol   = collections.find(c => c.id === 'price_check');
        const dbCol   = collections.find(c => c.id === 'deck_building');

        const mainCount = mainCol?.cards?.length || 0;
        const pcCount   = pcCol?.cards?.length   || 0;
        const dbCount   = dbCol?.cards?.length   || 0;

        const mainEl = document.getElementById('collectionNavCount');
        const pcEl   = document.getElementById('priceCheckNavCount');
        const dbEl   = document.getElementById('deckBuilderNavCount');

        if (mainEl) mainEl.textContent = mainCount > 0 ? ` (${mainCount})` : '';
        if (pcEl)   pcEl.textContent   = pcCount   > 0 ? ` (${pcCount})`   : '';
        if (dbEl)   dbEl.textContent   = dbCount   > 0 ? ` (${dbCount})`   : '';

        // Update More sheet collection badge
        const moreCollBadge = document.getElementById('moreCollectionCount');
        if (moreCollBadge) moreCollBadge.textContent = mainCount > 0 ? String(mainCount) : '';

        // Also refresh the slider counts
        if (typeof updateCollectionSlider === 'function') updateCollectionSlider();
    } catch(e) {}
}
window.updateCollectionNavCounts = updateCollectionNavCounts;
window.showLoading = showLoading;
window.showToast = showToast;

// Open Price Check modal — delegates to the dedicated function in tags.js
window.openPriceCheckModal = function() {
    if (typeof openPriceCheckCollectionModal === 'function') {
        openPriceCheckCollectionModal();
    }
};

// ── Card Detail Modal ────────────────────────────────────────────────────────

window.openCardDetail = function(index) {
    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const collection  = collections.find(c => c.id === currentId);
    if (!collection?.cards[index]) return;

    const card = collection.cards[index];
    document.getElementById('cardDetailModal')?.remove();

    const ebayUrl  = (typeof buildEbaySearchUrl === 'function') ? buildEbaySearchUrl(card) : null;
    const ebaySoldUrl = (typeof buildEbaySoldUrl === 'function') ? buildEbaySoldUrl(card) : null;
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

        const sections = [
            {
                title: 'Card Info', icon: '🃏',
                rows: [
                    ['Hero / Character',    fmtStr(c.hero)],
                    ['Athlete',             fmtStr(c.athlete)],
                    ['Card Number',         fmtStr(c.cardNumber)],
                    ['Year',                fmtStr(c.year)],
                    ['Set',                 fmtStr(c.set)],
                    ['Parallel / Pose',     fmtStr(c.pose)],
                    ['Weapon',              fmtStr(c.weapon)],
                    ['Power',               fmtStr(c.power)],
                    ['Condition',           fmtStr(c.condition)],
                ]
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
            sections.push({
                title: 'AI Grade', icon: '🔬',
                rows: [
                    ['Grade',       g.grade != null ? `PSA ${g.grade}` : null],
                    ['Label',       fmtStr(g.grade_label)],
                    ['Confidence',  fmtPct(g.confidence)],
                    ['Centering',   fmtStr(g.centering)],
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
            'imageUrl','id','cardId','aiGrade'
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
                    return `<div style="background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border:1px solid #bbf7d0;border-radius:10px;padding:14px;margin-bottom:16px;">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                            <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">AI Grade</div>
                            <div style="font-size:28px;font-weight:900;color:${gc};line-height:1;">PSA ${g.grade} <span style="font-size:14px;font-weight:600;">${escapeHtml(g.grade_label || '')}</span></div>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;">
                            <div><span style="color:#6b7280;">Centering:</span> <strong style="color:#111827;">${escapeHtml(g.centering || 'N/A')}</strong></div>
                            <div><span style="color:#6b7280;">Confidence:</span> <strong style="color:#111827;">${g.confidence || 0}%</strong></div>
                            <div style="grid-column:1/-1;"><span style="color:#6b7280;">Corners:</span> <span style="color:#374151;">${escapeHtml(g.corners || 'N/A')}</span></div>
                            <div style="grid-column:1/-1;"><span style="color:#6b7280;">Edges:</span> <span style="color:#374151;">${escapeHtml(g.edges || 'N/A')}</span></div>
                            <div style="grid-column:1/-1;"><span style="color:#6b7280;">Surface:</span> <span style="color:#374151;">${escapeHtml(g.surface || 'N/A')}</span></div>
                        </div>
                        ${g.summary ? `<div style="margin-top:8px;font-size:12px;color:#374151;border-top:1px solid #d1fae5;padding-top:8px;">${escapeHtml(g.summary)}</div>` : ''}
                    </div>`;
                })() : ''}

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
                    ${card.athlete ? `
                    <div style="background:#eff6ff;border-radius:8px;padding:10px;grid-column:1/-1;">
                        <div style="font-size:11px;color:#3b82f6;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Athlete Inspiration</div>
                        <div style="font-size:15px;font-weight:700;color:#1e3a5f;margin-top:2px;">${escapeHtml(card.athlete)}</div>
                    </div>` : ''}
                    ${[
                        ['Card #', card.cardNumber], ['Year', card.year],
                        ['Set', card.set], ['Parallel', card.pose],
                        ['Weapon', card.weapon], ['Power', card.power]
                    ].map(([label, val]) => val ? `
                        <div style="background:#f9fafb;border-radius:8px;padding:10px;">
                            <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">${label}</div>
                            <div style="font-size:14px;font-weight:600;color:#111827;margin-top:2px;">${escapeHtml(String(val))}</div>
                        </div>` : '').join('')}
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
                ${(typeof isFeatureEnabled === 'function' && isFeatureEnabled('condition_grader'))
                    ? `<button class="btn-secondary" onclick="gradeCardFromDetail(${index})" title="AI estimates PSA grade" style="white-space:nowrap;">🔬 Grade</button>`
                    : ''}
                ${(typeof isFeatureEnabled === 'function' && isFeatureEnabled('ebay_lister'))
                    ? `<button class="btn-secondary" onclick="ebayListFromDetail(${index})" title="Generate eBay listing" style="white-space:nowrap;">🛒 List</button>`
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
                const url = await uploadWithRetry(base64, file.name, 5, 1000);
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
        if (typeof fetchEbayAvgPrice !== 'function') {
            if (el) { el.textContent = 'N/A'; el.style.color = '#9ca3af'; }
            return;
        }
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
    if (typeof openCardDetail === 'function') {
        openCardDetail(index);
    }

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
    if (typeof syncToCloud === 'function') syncToCloud();

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
        if (typeof syncToCloud === 'function') syncToCloud();
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
    if (typeof syncToCloud === 'function') syncToCloud();

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
(function() {
    wireUpEvents();
    initUploadArea();
    setTimeout(() => {
        const user = (typeof googleUser !== 'undefined' && googleUser) ||
                     (typeof currentUser !== 'undefined' && currentUser) || null;
        updateAuthUI(user);
    }, 500);
})();

// ── Wrong Card Correction ─────────────────────────────────────────────────────
// Opens a card search modal that replaces only the identification metadata of an
// existing card while preserving its image, condition, notes, tags, and listing data.

window.correctCard = function(idx) {
    document.getElementById('correctCardModal')?.remove();

    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const col         = collections.find(c => c.id === currentId);
    const card        = col?.cards?.[idx];
    if (!card) { showToast('Card not found', '❌'); return; }

    const html = `
    <div class="modal active" id="correctCardModal">
      <div class="modal-backdrop" id="correctCardBackdrop"></div>
      <div class="modal-content" style="max-width:480px;">
        <div class="modal-header">
          <h2>⚠️ Correct Card Identity</h2>
          <button class="modal-close" id="correctCardClose">×</button>
        </div>
        <div class="modal-body" style="padding:20px;">
          <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;
                      padding:10px 14px;margin-bottom:14px;font-size:13px;color:#92400e;">
            Currently identified as: <strong>${escapeHtml(card.hero || 'Unknown')}</strong>
            ${card.cardNumber ? ` (${escapeHtml(card.cardNumber)})` : ''}
            — your image will be kept.
          </div>
          <div style="display:flex;gap:8px;margin-bottom:12px;">
            <input type="text" id="correctCardInput"
                   placeholder="Search by card # or hero name…"
                   style="flex:1;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;"
                   autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
            <button type="button" id="correctCardBtn" class="btn-tag-add">Search</button>
          </div>
          <div id="correctCardResults" style="max-height:320px;overflow-y:auto;"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" id="correctCardCancel">Cancel</button>
        </div>
      </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', html);

    const input    = document.getElementById('correctCardInput');
    const resultsEl = document.getElementById('correctCardResults');
    const close    = () => document.getElementById('correctCardModal')?.remove();

    document.getElementById('correctCardClose')?.addEventListener('click', close);
    document.getElementById('correctCardCancel')?.addEventListener('click', close);
    document.getElementById('correctCardBackdrop')?.addEventListener('click', close);

    function runSearch() {
        const query = (input?.value || '').trim();
        if (!resultsEl) return;
        if (!query) {
            resultsEl.innerHTML = `<p style="text-align:center;color:#f59e0b;padding:16px 0;">⚠️ Type a card number or name</p>`;
            return;
        }
        if (typeof database === 'undefined' || !database.length) {
            resultsEl.innerHTML = `<p style="text-align:center;color:#6b7280;padding:16px 0;">⏳ Database still loading — try again in a moment</p>`;
            return;
        }
        const q = query.toUpperCase();
        const results = database.filter(c =>
            String(c['Card Number'] ?? '').toUpperCase().includes(q) ||
            String(c.Name           ?? '').toUpperCase().includes(q) ||
            String(c.Set            ?? '').toUpperCase().includes(q)
        ).slice(0, 20);

        if (!results.length) {
            resultsEl.innerHTML = `<p style="text-align:center;color:#9ca3af;padding:20px 0;">No cards found for "<strong>${escapeHtml(query)}</strong>"</p>`;
            return;
        }
        resultsEl.innerHTML = results.map(c => `
            <div class="manual-search-row" data-fix-card-id="${escapeHtml(String(c['Card ID']))}">
              <div class="manual-search-info">
                <div class="manual-search-name">${escapeHtml(c.Name || '')}</div>
                <div class="manual-search-meta">
                  ${escapeHtml(c['Card Number'] || '')} · ${escapeHtml(String(c.Year || ''))} · ${escapeHtml(c.Set || '')}
                  ${c.Parallel && c.Parallel !== 'Base' ? `· ${escapeHtml(c.Parallel)}` : ''}
                </div>
              </div>
              <span class="btn-tag-add" style="font-size:12px;padding:6px 12px;cursor:pointer;white-space:nowrap;">Select</span>
            </div>`).join('');

        function applyFix(cardId) {
            const match = database.find(c => String(c['Card ID']) === String(cardId));
            if (!match) { showToast('Card not found', '❌'); return; }

            // Refresh from storage in case something changed since the modal opened
            const cols2 = getCollections();
            const col2  = cols2.find(c => c.id === currentId);
            if (!col2 || !col2.cards[idx]) { showToast('Card no longer exists', '❌'); return; }

            const existing = col2.cards[idx];
            // Replace identification fields only — keep image, condition, notes, tags, listing data
            col2.cards[idx] = Object.assign({}, existing, {
                cardId:     String(match['Card ID'] || ''),
                hero:       match.Name               || '',
                athlete:    (typeof getAthleteForHero === 'function') ? (getAthleteForHero(match.Name) || '') : '',
                year:       match.Year               || '',
                set:        match.Set                || '',
                cardNumber: match['Card Number']     || '',
                pose:       match.Parallel           || '',
                weapon:     match.Weapon             || '',
                power:      match.Power              || '',
                scanMethod: 'Corrected',
                scanType:   existing.scanType,
            });

            saveCollections(cols2);
            renderCards();
            close();
            showToast(`Updated to: ${match.Name || 'Unknown'}`, '✅');
        }

        resultsEl.onclick = e => {
            const row = e.target.closest('[data-fix-card-id]');
            if (row) applyFix(row.dataset.fixCardId);
        };
        resultsEl.addEventListener('touchend', e => {
            const row = e.target.closest('[data-fix-card-id]');
            if (row) { e.preventDefault(); applyFix(row.dataset.fixCardId); }
        });
    }

    let _debounce = null;
    input?.addEventListener('input', () => { clearTimeout(_debounce); _debounce = setTimeout(runSearch, 180); });
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(_debounce); runSearch(); } });
    document.getElementById('correctCardBtn')?.addEventListener('pointerdown', e => { e.preventDefault(); clearTimeout(_debounce); runSearch(); });

    setTimeout(() => { try { input?.focus(); } catch(_) {} }, 120);
};

console.log('✅ UI helpers loaded');

// ── Cross-collection card copy from detail modal ────────────────────────────
window.moveCardToCollection = function(cardIndex, targetCollectionId) {
  const collections = getCollections();
  const currentId   = getCurrentCollectionId();
  const collection  = collections.find(c => c.id === currentId);
  if (!collection?.cards[cardIndex]) {
    showToast('Card not found', '❌');
    return;
  }

  const card = collection.cards[cardIndex];
  const copied = copyCardToCollection(card, targetCollectionId);

  if (copied) {
    const targetNames = { default: 'My Collection', price_check: 'Price Check', deck_building: 'Deck Builder' };
    const name = targetNames[targetCollectionId] || targetCollectionId;
    showToast(`Copied to ${name}`, '✅');
    if (typeof updateCollectionSlider === 'function') updateCollectionSlider();
    if (typeof updateCollectionNavCounts === 'function') updateCollectionNavCounts();
  } else {
    showToast('Already in that collection', '⚠️');
  }
};
