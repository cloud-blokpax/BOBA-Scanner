// ── src/ui/cards-grid.js ─────────────────────────────────────────────────────
// ES Module — Card grid rendering: renderCards(), pagination, bulk select helpers,
// renderField(), and openPriceCheckModal window assignment.

import { getCollections, getCurrentCollectionId, setCurrentCollectionId, saveCollections } from '../core/collection/collections.js';
import { escapeHtml } from './utils.js';
import { showToast } from './toast.js';
import { on } from '../core/event-bus.js';
import { fetchEbayAvgPrice } from '../features/ebay/ebay.js';

function renderCards() {
    console.log('🎨 Rendering cards...');

    // Update nav counts whenever cards are re-rendered
    if (typeof window.updateCollectionNavCounts === 'function') {
        try { window.updateCollectionNavCounts(); } catch(e) {}
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
              <span class="cl-badge ${card.scanType==='ocr'?'badge-free':'badge-paid'}">${escapeHtml(card.scanMethod||card.scanType||'')}</span>
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
                <span class="cs-badge ${card.scanType==='ocr'?'badge-free':'badge-paid'}">${escapeHtml(card.scanMethod||card.scanType||'')}</span>
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
            : (card.confidence && card.scanType === 'ocr'
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
                <span class="card-badge ${card.scanType === 'ocr' ? 'badge-free' : 'badge-paid'}">
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
            window.openCardDetail(cardIdx);
        }, { passive: false });

        grid.addEventListener('click', function(e) {
            if (e.detail === 0) return; // keyboard-triggered, skip
            const target = e.target.closest('[data-open-card]');
            if (!target) return;
            const now = Date.now();
            if (grid._lastTouchEnd && now - grid._lastTouchEnd < 600) return;
            const cardIdx = parseInt(target.dataset.openCard, 10);
            if (window._bulkSelect?.active) { window.toggleBulkCardSelect(cardIdx); return; }
            window.openCardDetail(cardIdx);
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
        if (typeof window.recordDeletedCard === 'function') window.recordDeletedCard(card);
        if (typeof window.deleteCardImage   === 'function') window.deleteCardImage(card.imageUrl);
        if (card.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(card.imageUrl);
        collection.cards.splice(idx, 1);
        collection.stats.scanned = Math.max(0, (collection.stats.scanned || 0) - 1);
        if (card.scanType === 'ocr') collection.stats.free = Math.max(0, (collection.stats.free || 0) - 1);
    }
    saveCollections(collections);
    if (typeof window.updateStats === 'function') window.updateStats();
    window._bulkSelect.active = false;
    window._bulkSelect.selected.clear();
    renderCards();
    showToast(`${count} card${count!==1?'s':''} removed`, '🗑️');
};

window.bulkRefreshEbayPrices = function() {
    const sel = window._bulkSelect?.selected;
    if (!sel?.size) return;
    if (!fetchEbayAvgPrice) { showToast('eBay refresh not available', '⚠️'); return; }
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

// ── Event bus subscriptions ─────────────────────────────────────────────────
on('cards:changed', () => renderCards());

export { renderCards, renderField };
