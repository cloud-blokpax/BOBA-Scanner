// ── src/ui/card-corrections.js ───────────────────────────────────────────────
// ES Module — Wrong Card Correction: correctCard() modal that replaces identification
// metadata while preserving image, condition, notes, tags, and listing data.

import { getCollections, getCurrentCollectionId, saveCollections } from '../core/collection/collections.js';
import { database } from '../core/state.js';
import { escapeHtml } from './utils.js';
import { showToast } from './toast.js';
import { renderCards } from './cards-grid.js';
import { getAthleteForHero } from '../collections/boba/heroes.js';

// ── Wrong Card Correction ─────────────────────────────────────────────────────
// Opens a card search modal that replaces only the identification metadata of an
// existing card while preserving its image, condition, notes, tags, and listing data.

export function correctCard(idx) {
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
        if (!database.length) {
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
                athlete:    getAthleteForHero(match.Name) || '',
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
}

window.correctCard = correctCard;

console.log('✅ UI helpers loaded');

