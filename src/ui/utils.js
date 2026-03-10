// ── src/ui/utils.js ──────────────────────────────────────────────────────────
// Shared utility functions: HTML escaping

// Sanitize user-controlled strings before inserting into HTML
export function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
// Expose globally so lazy-loaded modules (admin-dashboard, etc.) can use it
window.escapeHtml = escapeHtml;
