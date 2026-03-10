// Source Protection — Anti-scraping & anti-copying measures (ES Module)
// Adds friction for casual code theft. Not bulletproof (nothing client-side is),
// but makes it significantly harder for drive-by scrapers and copycats.

'use strict';

// ── 1. Disable right-click context menu ──────────────────────────────────
document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    return false;
});

// ── 2. Block common keyboard shortcuts for viewing source / DevTools ─────
document.addEventListener('keydown', function (e) {
    // Ctrl+U (View Source)
    if (e.ctrlKey && e.key === 'u') { e.preventDefault(); return false; }
    // Ctrl+Shift+I (DevTools)
    if (e.ctrlKey && e.shiftKey && e.key === 'I') { e.preventDefault(); return false; }
    // Ctrl+Shift+J (Console)
    if (e.ctrlKey && e.shiftKey && e.key === 'J') { e.preventDefault(); return false; }
    // Ctrl+Shift+C (Element Inspector)
    if (e.ctrlKey && e.shiftKey && e.key === 'C') { e.preventDefault(); return false; }
    // F12 (DevTools)
    if (e.key === 'F12') { e.preventDefault(); return false; }
    // Ctrl+S (Save Page)
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); return false; }
});

// ── 3. Disable text selection on non-input elements ──────────────────────
document.addEventListener('selectstart', function (e) {
    // Allow selection in inputs and textareas
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
});

// ── 4. Disable drag-and-drop of images and links ─────────────────────────
document.addEventListener('dragstart', function (e) {
    e.preventDefault();
});

// ── 5. Console warning message ───────────────────────────────────────────
const warningStyle = 'color: red; font-size: 24px; font-weight: bold;';
const infoStyle = 'color: #666; font-size: 14px;';
console.log('%cSTOP!', warningStyle);
console.log('%cThis is a protected application. Unauthorized access, scraping, or copying of source code is prohibited.', infoStyle);
