/**
 * bottom-nav.js — Bottom navigation bar + More sheet for BOBA Scanner
 * Provides tab-based navigation: Scan | Collection | Deck | More
 */
(function () {
    'use strict';

    let currentTab = 'scan';

    // ── Tab switching ────────────────────────────────────────────────────────

    function setActiveTab(tab) {
        document.querySelectorAll('.bottom-nav-item').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
    }

    function switchTab(tab) {
        if (tab === 'more') {
            openMoreSheet();
            return;
        }

        if (tab === 'deck') {
            // Deck opens a modal; keep underlying tab as-is
            if (typeof window.openDeckBuilder === 'function') {
                window.openDeckBuilder();
            } else {
                if (typeof window.showToast === 'function') {
                    window.showToast('Deck Builder not ready', '⚠️');
                }
            }
            setActiveTab('deck');
            return;
        }

        setActiveTab(tab);
        currentTab = tab;

        if (tab === 'collection') {
            document.body.classList.remove('tab-scan');
            document.body.classList.add('tab-collection');
            // Trigger card render if the function is available
            if (typeof window.renderCards === 'function') {
                window.renderCards();
            }
        } else {
            // scan
            document.body.classList.remove('tab-collection');
            document.body.classList.add('tab-scan');
        }
    }

    // ── More sheet ───────────────────────────────────────────────────────────

    function openMoreSheet() {
        var sheet = document.getElementById('moreSheet');
        var backdrop = document.getElementById('moreSheetBackdrop');
        if (sheet) sheet.classList.add('active');
        if (backdrop) backdrop.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeMoreSheet() {
        var sheet = document.getElementById('moreSheet');
        var backdrop = document.getElementById('moreSheetBackdrop');
        if (sheet) sheet.classList.remove('active');
        if (backdrop) backdrop.classList.remove('active');
        document.body.style.overflow = '';
    }

    // ── Wiring ───────────────────────────────────────────────────────────────

    function wireMoreItem(id, fn) {
        var el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', function () {
                closeMoreSheet();
                fn();
            });
        }
    }

    function initBottomNav() {
        // Set initial tab state
        document.body.classList.add('tab-scan');

        // Wire bottom nav tab buttons
        document.querySelectorAll('.bottom-nav-item[data-tab]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                switchTab(btn.dataset.tab);
            });
        });

        // Close more sheet on backdrop click
        var backdrop = document.getElementById('moreSheetBackdrop');
        if (backdrop) {
            backdrop.addEventListener('click', closeMoreSheet);
        }

        // Swipe-down to close more sheet
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

        // Wire More sheet items to existing global functions
        wireMoreItem('moreSettings', function () {
            if (typeof window.openSettings === 'function') window.openSettings();
        });
        wireMoreItem('moreExportCSV', function () {
            if (typeof window.openExportModal === 'function') window.openExportModal();
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

    document.addEventListener('DOMContentLoaded', initBottomNav);
})();
