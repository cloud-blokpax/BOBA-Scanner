// ============================================================
// js/tournaments.js — Tournament Code System v1.0
//
// Allows members with "can_invite" role to create tournament codes.
// Non-members can use a tournament code to access the deck builder
// with predefined parameters (name, heroes, plays, bonus counts).
//
// Supabase table: tournaments
//   id            UUID   primary key
//   creator_id    UUID   references users(id)
//   code          TEXT   unique, the shareable tournament code
//   name          TEXT   tournament name (becomes deck tag)
//   max_heroes    INT    required hero count
//   max_plays     INT    required play count
//   max_bonus     INT    max bonus plays (0 to this number)
//   usage_count   INT    how many times the code has been redeemed
//   is_active     BOOL   whether the code can still be used
//   created_at    TIMESTAMPTZ
//
// Users table addition: can_invite BOOLEAN default false
// ============================================================

// ── Check if current user can create tournaments ────────────────────────────
function canCreateTournament() {
  return window.currentUser?.can_invite === true ||
         window.currentUser?.is_admin === true;
}
window.canCreateTournament = canCreateTournament;

// ── Check if current user has deck builder access ───────────────────────────
// Members and admins get full access. Others need a tournament code.
function hasDeckBuilderAccess() {
  return window.currentUser?.is_member === true ||
         window.currentUser?.is_admin === true;
}
window.hasDeckBuilderAccess = hasDeckBuilderAccess;

// ── Validate a tournament code against Supabase ────────────────────────────
async function validateTournamentCode(code) {
  if (!code || !window.supabaseClient) return null;

  const normalizedCode = code.trim().toUpperCase();

  const { data, error } = await window.supabaseClient
    .from('tournaments')
    .select('*')
    .eq('code', normalizedCode)
    .eq('is_active', true)
    .single();

  if (error || !data) return null;
  return data;
}
window.validateTournamentCode = validateTournamentCode;

// ── Increment usage count for a tournament code ────────────────────────────
async function incrementTournamentUsage(tournamentId) {
  if (!window.supabaseClient || !tournamentId) return;

  try {
    // Read current count, then increment
    const { data } = await window.supabaseClient
      .from('tournaments')
      .select('usage_count')
      .eq('id', tournamentId)
      .single();

    const newCount = (data?.usage_count || 0) + 1;

    await window.supabaseClient
      .from('tournaments')
      .update({ usage_count: newCount })
      .eq('id', tournamentId);
  } catch (err) {
    console.error('Failed to increment tournament usage:', err);
  }
}
window.incrementTournamentUsage = incrementTournamentUsage;

// ── Create a new tournament ─────────────────────────────────────────────────
async function createTournament(params) {
  if (!canCreateTournament()) {
    showToast('You do not have permission to create tournaments', '❌');
    return null;
  }

  const { name, code, maxHeroes, maxPlays, maxBonus } = params;

  if (!name || !code) {
    showToast('Tournament name and code are required', '⚠️');
    return null;
  }

  const normalizedCode = code.trim().toUpperCase();

  try {
    // Check if code already exists
    const { data: existing } = await window.supabaseClient
      .from('tournaments')
      .select('id')
      .eq('code', normalizedCode)
      .single();

    if (existing) {
      showToast('This tournament code is already in use', '⚠️');
      return null;
    }

    const { data, error } = await window.supabaseClient
      .from('tournaments')
      .insert({
        creator_id: window.currentUser.id,
        code: normalizedCode,
        name: name.trim(),
        max_heroes: Math.max(0, parseInt(maxHeroes) || 0),
        max_plays: Math.max(0, parseInt(maxPlays) || 0),
        max_bonus: Math.max(0, parseInt(maxBonus) || 0),
        usage_count: 0,
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    showToast(`Tournament "${name}" created with code: ${normalizedCode}`, '🏆');
    return data;

  } catch (err) {
    console.error('Create tournament error:', err);
    showToast('Failed to create tournament', '❌');
    return null;
  }
}
window.createTournament = createTournament;

// ── Fetch all tournaments (for admin dashboard) ────────────────────────────
async function fetchAllTournaments() {
  if (!window.supabaseClient) return [];

  try {
    const { data, error } = await window.supabaseClient
      .from('tournaments')
      .select('*, users:creator_id(name, email)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Fetch tournaments error:', err);
    return [];
  }
}
window.fetchAllTournaments = fetchAllTournaments;

// ── Fetch tournaments created by current user ──────────────────────────────
async function fetchMyTournaments() {
  if (!window.supabaseClient || !window.currentUser) return [];

  try {
    const { data, error } = await window.supabaseClient
      .from('tournaments')
      .select('*')
      .eq('creator_id', window.currentUser.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Fetch my tournaments error:', err);
    return [];
  }
}
window.fetchMyTournaments = fetchMyTournaments;

// ── Toggle tournament active status ────────────────────────────────────────
async function toggleTournamentActive(tournamentId, isActive) {
  if (!window.supabaseClient) return;

  try {
    const { error } = await window.supabaseClient
      .from('tournaments')
      .update({ is_active: isActive })
      .eq('id', tournamentId);

    if (error) throw error;
    showToast(isActive ? 'Tournament activated' : 'Tournament deactivated', '✅');
  } catch (err) {
    console.error('Toggle tournament error:', err);
    showToast('Failed to update tournament', '❌');
  }
}
window.toggleTournamentActive = toggleTournamentActive;

// ── Show "Create Tournament" modal ──────────────────────────────────────────
function showCreateTournamentModal() {
  if (!canCreateTournament()) {
    showToast('You do not have permission to create tournaments', '❌');
    return;
  }

  document.getElementById('createTournamentModal')?.remove();

  const html = `
  <div class="modal active" id="createTournamentModal">
    <div class="modal-backdrop" id="createTournamentBackdrop"></div>
    <div class="modal-content" style="max-width:440px;">
      <div class="modal-header">
        <h2>🏆 Create Tournament</h2>
        <button class="modal-close" id="createTournamentClose">×</button>
      </div>
      <div class="modal-body" style="padding:20px;">
        <p style="font-size:13px;color:#6b7280;margin:0 0 16px;">
          Create a tournament code that others can use to build a deck
          with your predefined parameters.
        </p>

        <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Tournament Name</label>
        <input type="text" id="tournamentName"
               placeholder="e.g. Spring Championship 2026"
               autocomplete="off" autocorrect="off" spellcheck="false"
               style="width:100%;box-sizing:border-box;padding:11px 14px;border:1.5px solid #d1d5db;
                      border-radius:10px;font-size:15px;font-family:inherit;margin-bottom:12px;">

        <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Tournament Code</label>
        <div style="display:flex;gap:8px;margin-bottom:4px;">
          <input type="text" id="tournamentCode"
                 placeholder="e.g. SPRING2026"
                 autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false"
                 style="flex:1;box-sizing:border-box;padding:11px 14px;border:1.5px solid #d1d5db;
                        border-radius:10px;font-size:15px;font-family:monospace;text-transform:uppercase;">
          <button id="tournamentCodeGenerate" class="btn-secondary"
                  style="padding:10px 14px;border-radius:10px;font-size:13px;white-space:nowrap;">
            🎲 Generate
          </button>
        </div>
        <div style="font-size:11px;color:#9ca3af;margin-bottom:16px;">
          This code will be shared with participants to access the deck builder.
        </div>

        <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">Deck Requirements</div>
        <div style="display:flex;gap:10px;margin-bottom:6px;">
          <div style="flex:1;text-align:center;">
            <label style="font-size:12px;color:#6b7280;display:block;margin-bottom:3px;">🦸 Heroes</label>
            <input type="number" id="tournamentHeroes" min="0" value="0"
                   style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #d1d5db;
                          border-radius:8px;font-size:16px;text-align:center;font-family:inherit;">
          </div>
          <div style="flex:1;text-align:center;">
            <label style="font-size:12px;color:#6b7280;display:block;margin-bottom:3px;">▶ Plays</label>
            <input type="number" id="tournamentPlays" min="0" value="30"
                   style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #d1d5db;
                          border-radius:8px;font-size:16px;text-align:center;font-family:inherit;">
          </div>
          <div style="flex:1;text-align:center;">
            <label style="font-size:12px;color:#6b7280;display:block;margin-bottom:3px;">⭐ Bonus</label>
            <input type="number" id="tournamentBonus" min="0" value="15"
                   style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #d1d5db;
                          border-radius:8px;font-size:16px;text-align:center;font-family:inherit;">
          </div>
        </div>
        <div style="font-size:11px;color:#9ca3af;text-align:center;margin-top:4px;margin-bottom:16px;">
          Heroes and Plays are exact requirements. Bonus plays are optional (0 up to the number above).
        </div>

        <div id="createTournamentError" style="color:#ef4444;font-size:13px;display:none;margin-bottom:8px;"></div>
      </div>
      <div class="modal-footer" style="gap:8px;">
        <button class="btn-secondary" id="createTournamentCancel" style="flex:1;">Cancel</button>
        <button class="btn-tag-add" id="createTournamentSubmit" style="flex:2;padding:12px;font-size:14px;">
          🏆 Create Tournament
        </button>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  // Close handlers
  const closeModal = () => document.getElementById('createTournamentModal')?.remove();
  document.getElementById('createTournamentClose')?.addEventListener('click', closeModal);
  document.getElementById('createTournamentBackdrop')?.addEventListener('click', closeModal);
  document.getElementById('createTournamentCancel')?.addEventListener('click', closeModal);

  // Generate random code
  document.getElementById('tournamentCodeGenerate')?.addEventListener('click', () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const input = document.getElementById('tournamentCode');
    if (input) input.value = code;
  });

  // Submit
  document.getElementById('createTournamentSubmit')?.addEventListener('click', async () => {
    const errEl = document.getElementById('createTournamentError');
    const name = document.getElementById('tournamentName')?.value?.trim();
    const code = document.getElementById('tournamentCode')?.value?.trim();
    const maxHeroes = parseInt(document.getElementById('tournamentHeroes')?.value) || 0;
    const maxPlays = parseInt(document.getElementById('tournamentPlays')?.value) || 0;
    const maxBonus = parseInt(document.getElementById('tournamentBonus')?.value) || 0;

    if (!name) {
      if (errEl) { errEl.textContent = 'Please enter a tournament name.'; errEl.style.display = 'block'; }
      return;
    }
    if (!code || code.length < 4) {
      if (errEl) { errEl.textContent = 'Please enter a code (at least 4 characters).'; errEl.style.display = 'block'; }
      return;
    }
    if (maxHeroes === 0 && maxPlays === 0 && maxBonus === 0) {
      if (errEl) { errEl.textContent = 'At least one card category must be greater than 0.'; errEl.style.display = 'block'; }
      return;
    }

    const submitBtn = document.getElementById('createTournamentSubmit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating...'; }

    const result = await createTournament({ name, code, maxHeroes, maxPlays, maxBonus });

    if (result) {
      closeModal();
      // Show success with the code for copying
      showTournamentCreatedModal(result);
    } else {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '🏆 Create Tournament'; }
    }
  });

  setTimeout(() => document.getElementById('tournamentName')?.focus(), 80);
}
window.showCreateTournamentModal = showCreateTournamentModal;

// ── Show success modal with copy-able code ──────────────────────────────────
function showTournamentCreatedModal(tournament) {
  document.getElementById('tournamentCreatedModal')?.remove();

  const html = `
  <div class="modal active" id="tournamentCreatedModal">
    <div class="modal-backdrop" id="tournamentCreatedBackdrop"></div>
    <div class="modal-content" style="max-width:400px;">
      <div class="modal-header">
        <h2>🏆 Tournament Created!</h2>
        <button class="modal-close" id="tournamentCreatedClose">×</button>
      </div>
      <div class="modal-body" style="padding:20px;text-align:center;">
        <div style="font-size:15px;font-weight:600;color:#374151;margin-bottom:12px;">
          ${escapeHtml(tournament.name)}
        </div>
        <div style="background:#f0f9ff;border:2px solid #3b82f6;border-radius:12px;padding:16px;margin-bottom:12px;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">
            Tournament Code
          </div>
          <div style="font-size:28px;font-weight:800;color:#1d4ed8;letter-spacing:4px;font-family:monospace;">
            ${escapeHtml(tournament.code)}
          </div>
        </div>
        <button id="tournamentCopyCode" class="btn-secondary"
                style="padding:8px 20px;font-size:13px;margin-bottom:12px;">
          📋 Copy Code
        </button>
        <div style="font-size:12px;color:#6b7280;line-height:1.5;">
          <div>🦸 ${tournament.max_heroes} Heroes · ▶ ${tournament.max_plays} Plays · ⭐ ${tournament.max_bonus} Bonus</div>
          <div style="margin-top:4px;">Share this code with participants to let them build their deck.</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-tag-add" id="tournamentCreatedDone" style="flex:1;padding:12px;">Done</button>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  const closeModal = () => document.getElementById('tournamentCreatedModal')?.remove();
  document.getElementById('tournamentCreatedClose')?.addEventListener('click', closeModal);
  document.getElementById('tournamentCreatedBackdrop')?.addEventListener('click', closeModal);
  document.getElementById('tournamentCreatedDone')?.addEventListener('click', closeModal);

  document.getElementById('tournamentCopyCode')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(tournament.code).then(() => {
      showToast('Code copied to clipboard!', '📋');
    }).catch(() => {
      // Fallback for iOS Safari
      const temp = document.createElement('input');
      temp.value = tournament.code;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
      showToast('Code copied!', '📋');
    });
  });
}

// ── Show deck builder access gate (non-members) ────────────────────────────
function showDeckBuilderGate() {
  document.getElementById('deckBuilderGateModal')?.remove();

  const html = `
  <div class="modal active" id="deckBuilderGateModal">
    <div class="modal-backdrop" id="deckBuilderGateBackdrop"></div>
    <div class="modal-content" style="max-width:420px;">
      <div class="modal-header">
        <h2>🃏 Deck Builder</h2>
        <button class="modal-close" id="deckBuilderGateClose">×</button>
      </div>
      <div class="modal-body" style="padding:24px;text-align:center;">
        <div style="font-size:48px;margin-bottom:12px;">🔒</div>
        <div style="font-size:16px;font-weight:700;color:#374151;margin-bottom:8px;">
          This is a paid member tool
        </div>
        <p style="font-size:13px;color:#6b7280;margin:0 0 20px;">
          The Deck Builder is available exclusively to BOBA Scanner members.
          Upgrade your account for full access to all premium features.
        </p>

        <div style="border-top:1px solid #e5e7eb;padding-top:20px;">
          <div style="font-size:14px;font-weight:600;color:#374151;margin-bottom:8px;">
            Tournament Code
          </div>
          <p style="font-size:12px;color:#9ca3af;margin:0 0 10px;">
            Have a tournament code? Enter it below to build your deck.
          </p>
          <div style="display:flex;gap:8px;">
            <input type="text" id="tournamentCodeInput"
                   placeholder="Enter code..."
                   autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false"
                   style="flex:1;padding:11px 14px;border:1.5px solid #d1d5db;border-radius:10px;
                          font-size:15px;font-family:monospace;text-transform:uppercase;text-align:center;
                          letter-spacing:2px;">
            <button id="tournamentCodeSubmit" class="btn-tag-add"
                    style="padding:10px 18px;font-size:14px;white-space:nowrap;">
              Enter
            </button>
          </div>
          <div id="tournamentCodeError" style="color:#ef4444;font-size:12px;margin-top:6px;display:none;"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="deckBuilderGateCancel" style="flex:1;">Close</button>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  const closeModal = () => document.getElementById('deckBuilderGateModal')?.remove();
  document.getElementById('deckBuilderGateClose')?.addEventListener('click', closeModal);
  document.getElementById('deckBuilderGateBackdrop')?.addEventListener('click', closeModal);
  document.getElementById('deckBuilderGateCancel')?.addEventListener('click', closeModal);

  // Submit tournament code
  const submitCode = async () => {
    const input = document.getElementById('tournamentCodeInput');
    const errEl = document.getElementById('tournamentCodeError');
    const code = (input?.value || '').trim();

    if (!code) {
      if (errEl) { errEl.textContent = 'Please enter a tournament code.'; errEl.style.display = 'block'; }
      return;
    }

    const submitBtn = document.getElementById('tournamentCodeSubmit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Validating...'; }

    const tournament = await validateTournamentCode(code);

    if (!tournament) {
      if (errEl) { errEl.textContent = 'Invalid or expired tournament code.'; errEl.style.display = 'block'; }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Enter'; }
      return;
    }

    // Valid code — close gate and open deck builder with tournament params
    closeModal();
    openDeckBuilderWithTournament(tournament);
  };

  document.getElementById('tournamentCodeSubmit')?.addEventListener('click', submitCode);
  document.getElementById('tournamentCodeInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitCode();
  });

  setTimeout(() => document.getElementById('tournamentCodeInput')?.focus(), 80);
}
window.showDeckBuilderGate = showDeckBuilderGate;

// ── Open deck builder with tournament parameters (locked) ──────────────────
function openDeckBuilderWithTournament(tournament) {
  window._deckBuilderActive = true;
  window._deckBuilderQueue = [];
  window._activeTournament = tournament;

  // Pre-fill config from tournament — user cannot change these
  window._deckBuilderConfig = {
    name: tournament.name,
    tag: tournament.name.replace(/[|,]/g, '-').trim(),
    maxHeroes: tournament.max_heroes,
    maxPlays: tournament.max_plays,
    maxBonus: tournament.max_bonus,
    totalTarget: tournament.max_heroes + tournament.max_plays + tournament.max_bonus,
    tournamentId: tournament.id,
    tournamentCode: tournament.code,
    isTournament: true
  };

  // Skip the setup modal — go directly to the building modal
  if (typeof renderDeckBuilderModal === 'function') {
    renderDeckBuilderModal();
  }
}
window.openDeckBuilderWithTournament = openDeckBuilderWithTournament;

// ── "My Tournaments" modal — for users with invite role ─────────────────────
async function showMyTournamentsModal() {
  if (!canCreateTournament()) return;

  document.getElementById('myTournamentsModal')?.remove();

  const tournaments = await fetchMyTournaments();

  const rows = tournaments.length === 0
    ? '<div style="text-align:center;padding:20px;color:#9ca3af;font-size:13px;">No tournaments created yet.</div>'
    : tournaments.map(t => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px;background:${t.is_active ? '#f0f9ff' : '#f9fafb'};
                    border:1px solid ${t.is_active ? '#bfdbfe' : '#e5e7eb'};border-radius:10px;margin-bottom:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${escapeHtml(t.name)}
            </div>
            <div style="font-size:12px;color:#6b7280;margin-top:2px;">
              Code: <strong style="font-family:monospace;letter-spacing:1px;">${escapeHtml(t.code)}</strong>
              · 🦸${t.max_heroes} ▶${t.max_plays} ⭐${t.max_bonus}
            </div>
          </div>
          <div style="text-align:center;flex-shrink:0;">
            <div style="font-size:18px;font-weight:800;color:#1d4ed8;">${t.usage_count || 0}</div>
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;">uses</div>
          </div>
          <button data-toggle-tournament="${escapeHtml(t.id)}" data-active="${t.is_active}"
                  style="padding:6px 12px;border-radius:8px;border:1px solid ${t.is_active ? '#ef4444' : '#10b981'};
                         background:none;color:${t.is_active ? '#ef4444' : '#10b981'};font-size:12px;
                         font-weight:600;cursor:pointer;white-space:nowrap;">
            ${t.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      `).join('');

  const html = `
  <div class="modal active" id="myTournamentsModal">
    <div class="modal-backdrop" id="myTournamentsBackdrop"></div>
    <div class="modal-content" style="max-width:480px;max-height:85vh;display:flex;flex-direction:column;">
      <div class="modal-header">
        <h2>🏆 My Tournaments</h2>
        <button class="modal-close" id="myTournamentsClose">×</button>
      </div>
      <div class="modal-body" style="flex:1;overflow-y:auto;padding:16px 20px;">
        ${rows}
      </div>
      <div class="modal-footer" style="gap:8px;">
        <button class="btn-secondary" id="myTournamentsCloseBtn" style="flex:1;">Close</button>
        <button class="btn-tag-add" id="myTournamentsCreate" style="flex:1;padding:12px;">
          + Create New
        </button>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  const closeModal = () => document.getElementById('myTournamentsModal')?.remove();
  document.getElementById('myTournamentsClose')?.addEventListener('click', closeModal);
  document.getElementById('myTournamentsBackdrop')?.addEventListener('click', closeModal);
  document.getElementById('myTournamentsCloseBtn')?.addEventListener('click', closeModal);

  document.getElementById('myTournamentsCreate')?.addEventListener('click', () => {
    closeModal();
    showCreateTournamentModal();
  });

  // Toggle active/inactive
  document.getElementById('myTournamentsModal')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-toggle-tournament]');
    if (!btn) return;
    const id = btn.dataset.toggleTournament;
    const isActive = btn.dataset.active === 'true';
    await toggleTournamentActive(id, !isActive);
    closeModal();
    showMyTournamentsModal(); // refresh
  });
}
window.showMyTournamentsModal = showMyTournamentsModal;

// ── Render tournaments tab for admin dashboard ──────────────────────────────
function renderTournamentsTab(tournaments) {
  if (!tournaments || tournaments.length === 0) {
    return `<div style="text-align:center;padding:40px;color:#9ca3af;">
      <div style="font-size:32px;margin-bottom:8px;">🏆</div>
      <p>No tournaments created yet.</p>
    </div>`;
  }

  return `
    <div style="margin-bottom:16px;">
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;">
        <div style="background:#f0f9ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 18px;flex:1;min-width:120px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:#1d4ed8;">${tournaments.length}</div>
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Total Tournaments</div>
        </div>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 18px;flex:1;min-width:120px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:#166534;">${tournaments.filter(t => t.is_active).length}</div>
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Active</div>
        </div>
        <div style="background:#faf5ff;border:1px solid #ddd6fe;border-radius:10px;padding:12px 18px;flex:1;min-width:120px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:#7c3aed;">${tournaments.reduce((s, t) => s + (t.usage_count || 0), 0)}</div>
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Total Uses</div>
        </div>
      </div>
    </div>
    <div class="users-table-container">
      <table class="users-table">
        <thead>
          <tr>
            <th>Tournament</th><th>Code</th><th>Heroes</th><th>Plays</th><th>Bonus</th>
            <th>Uses</th><th>Creator</th><th>Status</th><th>Created</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${tournaments.map(t => `
            <tr>
              <td><strong>${escapeHtml(t.name)}</strong></td>
              <td><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px;letter-spacing:1px;">${escapeHtml(t.code)}</code></td>
              <td>${t.max_heroes}</td>
              <td>${t.max_plays}</td>
              <td>${t.max_bonus}</td>
              <td><strong style="color:#1d4ed8;">${t.usage_count || 0}</strong></td>
              <td>${escapeHtml(t.users?.name || t.users?.email || 'Unknown')}</td>
              <td><span class="status-badge ${t.is_active ? 'success' : 'failed'}">${t.is_active ? 'Active' : 'Inactive'}</span></td>
              <td>${new Date(t.created_at).toLocaleDateString()}</td>
              <td>
                <button class="btn-icon admin-tournament-toggle" data-tid="${escapeHtml(t.id)}" data-active="${t.is_active}"
                        title="${t.is_active ? 'Deactivate' : 'Activate'}" style="font-size:11px;padding:3px 8px;">
                  ${t.is_active ? '⏸️' : '▶️'}
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}
window.renderTournamentsTab = renderTournamentsTab;

console.log('🏆 Tournaments module loaded');
