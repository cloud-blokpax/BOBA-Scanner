/**
 * bottom-nav.js — ES Module — Bottom navigation bar + More sheet for BOBA Scanner
 * Provides tab-based navigation: Scan | Collection | Deck | More
 *
 * Mobile-first: uses pointerdown for instant tab switching so taps feel
 * immediate on iOS/Android. `click` is preserved as a desktop fallback.
 */

import { showToast } from './toast.js';
import { renderCards } from './cards-grid.js';

let currentTab = 'scan';
// Track last pointerdown-triggered switch to suppress the synthetic click
// that fires ~300ms later on touch devices (ghost-click prevention).
let lastPointerSwitch = 0;

// ── Tab switching ────────────────────────────────────────────────────────

function setActiveTab(tab) {
    // If the tab has no corresponding nav button (e.g. collection/deck moved to More),
    // keep the More button visually active so the user has a clear "home" tap target.
    var hasNavButton = !!document.querySelector('.bottom-nav-item[data-tab="' + tab + '"]');
    var effectiveTab = hasNavButton ? tab : 'more';
    document.querySelectorAll('.bottom-nav-item').forEach(function (btn) {
        var isActive = btn.dataset.tab === effectiveTab;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
}

function switchTab(tab) {
    // Always close the More sheet when switching away from it
    closeMoreSheet();

    if (tab === 'more') {
        openMoreSheet();
        return;
    }

    if (tab === 'deck') {
        setActiveTab('deck');
        currentTab = 'deck';
        document.body.classList.remove('tab-scan');
        document.body.classList.add('tab-collection');
        if (typeof window.sliderSwitch === 'function') {
            window.sliderSwitch('deck_building');
        } else {
            showToast('Deck Builder not ready', '⚠️');
        }
        return;
    }

    setActiveTab(tab);

    if (tab === 'collection') {
        currentTab = 'collection';
        document.body.classList.remove('tab-scan');
        document.body.classList.add('tab-collection');
        if (typeof window.sliderSwitch === 'function') {
            window.sliderSwitch('my_collection');
        }
        if (typeof window.renderCards === 'function') {
            window.renderCards();
        }
    } else {
        // scan
        document.body.classList.remove('tab-collection');
        document.body.classList.add('tab-scan');
        // If already on scan tab, open the scan options panel or trigger file picker
        if (currentTab === 'scan') {
            var panel = document.getElementById('scanOptionsPanel');
            if (panel) {
                panel.style.display = panel.style.display === 'none' ? '' : 'none';
            } else {
                var fi = document.getElementById('fileInput');
                if (fi) { fi.removeAttribute('capture'); fi.click(); }
            }
        }
        currentTab = 'scan';
    }
}

// ── More sheet ───────────────────────────────────────────────────────────

function openMoreSheet() {
    var sheet = document.getElementById('moreSheet');
    var backdrop = document.getElementById('moreSheetBackdrop');
    if (sheet) sheet.classList.add('active');
    if (backdrop) backdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
    // Mark the More button as active
    document.querySelectorAll('.bottom-nav-item[data-tab="more"]').forEach(function (btn) {
        btn.classList.add('active');
    });
}

function closeMoreSheet() {
    var sheet = document.getElementById('moreSheet');
    var backdrop = document.getElementById('moreSheetBackdrop');
    if (sheet) sheet.classList.remove('active');
    if (backdrop) backdrop.classList.remove('active');
    document.body.style.overflow = '';
    // Restore the correct active tab indicator
    document.querySelectorAll('.bottom-nav-item[data-tab="more"]').forEach(function (btn) {
        btn.classList.remove('active');
    });
}

// ── Wiring ───────────────────────────────────────────────────────────────

function wireMoreItem(id, fn) {
    var el = document.getElementById(id);
    if (!el) return;

    // Pointer feedback
    el.addEventListener('pointerdown', function () { el.classList.add('tapped'); });
    el.addEventListener('pointerup', function () {
        setTimeout(function () { el.classList.remove('tapped'); }, 150);
    });
    el.addEventListener('pointercancel', function () { el.classList.remove('tapped'); });

    // Action on click — `touch-action: manipulation` removes the 300ms delay,
    // so click fires quickly on touch. No suppression needed here.
    el.addEventListener('click', function () {
        closeMoreSheet();
        fn();
    });
}

function initBottomNav() {
    // Set initial tab state
    document.body.classList.add('tab-scan');

    // Wire bottom nav tab buttons
    // Strategy: use pointerdown to switch immediately (bypasses 300ms iOS click delay
    // and any invisible overlay that might intercept a deferred click event).
    document.querySelectorAll('.bottom-nav-item[data-tab]').forEach(function (btn) {
        btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');

        btn.addEventListener('pointerdown', function (e) {
            btn.classList.add('tapped');
            lastPointerSwitch = Date.now();
            switchTab(btn.dataset.tab);
        });

        btn.addEventListener('pointerup', function () {
            setTimeout(function () { btn.classList.remove('tapped'); }, 120);
        });

        btn.addEventListener('pointercancel', function () {
            btn.classList.remove('tapped');
        });

        btn.addEventListener('pointerleave', function () {
            btn.classList.remove('tapped');
        });

        // Desktop click fallback — skipped if we just handled via pointerdown
        btn.addEventListener('click', function () {
            if (Date.now() - lastPointerSwitch < 600) return;
            switchTab(btn.dataset.tab);
        });
    });

    // Close more sheet on backdrop click/tap
    var backdrop = document.getElementById('moreSheetBackdrop');
    if (backdrop) {
        backdrop.addEventListener('pointerdown', closeMoreSheet);
    }

    // Swipe-down gesture to close more sheet
    var sheet = document.getElementById('moreSheet');
    var touchStartY = 0;
    if (sheet) {
        sheet.addEventListener('touchstart', function (e) {
            touchStartY = e.touches[0].clientY;
        }, { passive: true });
        sheet.addEventListener('touchend', function (e) {
            var delta = e.changedTouches[0].clientY - touchStartY;
            if (delta > 60) closeMoreSheet();
        }, { passive: true });
    }

    // ── More sheet item wiring ──────────────────────────────────────────
    wireMoreItem('moreCollection', function () {
        switchTab('collection');
        if (typeof window.sliderSwitch === 'function') window.sliderSwitch('my_collection');
    });
    wireMoreItem('moreDeck', function () {
        switchTab('deck');
    });
    wireMoreItem('moreSettings', function () {
        if (typeof window.openSettings === 'function') window.openSettings();
    });
    wireMoreItem('moreExportCSV', function () {
        if (typeof window.openExportModal === 'function') window.openExportModal();
    });
    wireMoreItem('moreEbayExport', function () {
        if (typeof window.openEbayExportModal === 'function') window.openEbayExportModal();
    });
    wireMoreItem('moreCollectionStats', function () {
        if (typeof window.openStatsModal === 'function') window.openStatsModal();
        else if (typeof window.showStatsModal === 'function') window.showStatsModal();
    });
    wireMoreItem('moreScanHistory', function () {
        if (typeof window.openScanHistoryModal === 'function') window.openScanHistoryModal();
    });
    wireMoreItem('moreReadyToList', function () {
        if (typeof window.openReadyToListView === 'function') window.openReadyToListView();
    });
    wireMoreItem('moreSetCompletion', function () {
        if (typeof window.analyzeSetCompletion === 'function') window.analyzeSetCompletion();
    });
    wireMoreItem('moreGradeCard', function () {
        if (typeof window.triggerGradeCardWithPicker === 'function') window.triggerGradeCardWithPicker();
    });
    wireMoreItem('moreEbayLister', function () {
        if (typeof window.triggerEbayListerWithPicker === 'function') window.triggerEbayListerWithPicker();
    });
    wireMoreItem('moreCreateTournament', function () {
        if (typeof window.showCreateTournamentModal === 'function') window.showCreateTournamentModal();
    });
    wireMoreItem('moreMyTournaments', function () {
        if (typeof window.showMyTournamentsModal === 'function') window.showMyTournamentsModal();
    });
    wireMoreItem('moreSignOut', function () {
        if (typeof window.signOut === 'function') window.signOut();
    });
}

// Expose globals for other modules
window.bottomNavSwitchTab = switchTab;
window.closeMoreSheet = closeMoreSheet;
window.openMoreSheet = openMoreSheet;

// Run on DOMContentLoaded — or immediately if DOM is already ready
// (Vite module bundles sometimes run after the event has fired)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBottomNav);
} else {
    initBottomNav();
}

export { switchTab as bottomNavSwitchTab, openMoreSheet, closeMoreSheet };
