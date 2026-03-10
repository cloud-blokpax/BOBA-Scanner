// ── src/ui/events.js ─────────────────────────────────────────────────────────
// ES Module — wireUpEvents() — safety-net event listeners for buttons, called on load.

import { showToast } from './toast.js';
import { updateSetting } from '../core/config.js';

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
            else showToast('Deck Builder not loaded \u2014 please refresh', '\u26A0\uFE0F');
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
        updateSetting('autoDetect', this.checked);
    });
    const togglePerspective = document.getElementById('togglePerspective');
    if (togglePerspective) togglePerspective.addEventListener('change', function() {
        updateSetting('perspective', this.checked);
    });
    const toggleRegionOcr = document.getElementById('toggleRegionOcr');
    if (toggleRegionOcr) toggleRegionOcr.addEventListener('change', function() {
        updateSetting('regionOcr', this.checked);
    });
    const selectQuality = document.getElementById('selectQuality');
    if (selectQuality) selectQuality.addEventListener('change', function() {
        updateSetting('quality', this.value);
    });
    const rangeThreshold = document.getElementById('rangeThreshold');
    if (rangeThreshold) {
        rangeThreshold.addEventListener('input', function() {
            const el = document.getElementById('thresholdValue');
            if (el) el.textContent = this.value;
        });
        rangeThreshold.addEventListener('change', function() {
            updateSetting('threshold', this.value);
        });
    }

    console.log('✅ Button events wired');
}

export { wireUpEvents };
