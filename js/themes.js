// ============================================================
// js/themes.js — Theme Engine
// Controls visibility and order of UI sections.
// Admins create & publish themes. Members can customize.
// Regular users can only apply admin-published themes.
//
// Architecture: CSS-injection. applyTheme() writes one <style> tag.
// No display:none in JS, no DOM manipulation — everything via CSS.
// ============================================================

// ── Registry: everything that can be themed ───────────────────────────────────

const THEME_SECTIONS = [
  { id: 'statsContainer',  label: '📊 Stats Bar',       defaultOrder: 1, canMove: true, canHide: true },
  { id: 'uploadArea',      label: '📷 Scan Section',    defaultOrder: 2, canMove: true, canHide: false }, // can hide sub-items, not the whole section
  { id: 'exportSection',   label: '🛠️ Tools & Export', defaultOrder: 3, canMove: true, canHide: true },
];

// Individual elements within sections — each has a CSS selector and label
const THEME_ELEMENTS = [
  // Scan section buttons
  { id: 'btnPriceCheck',      label: 'Check eBay Prices button',   selector: '#btnPriceCheck',      group: 'Scan' },
  { id: 'btnBatchScan',       label: 'Batch Scan button',          selector: '#btnBatchScan',        group: 'Scan' },
  { id: 'btnOpenPriceCheck',  label: 'Price Check nav button',     selector: '#btnOpenPriceCheck',   group: 'Scan' },
  { id: 'btnOpenCollection',  label: 'My Collection nav button',   selector: '#btnOpenCollection',   group: 'Scan' },
  // Tools section buttons
  { id: 'btnExportCSV',       label: 'Export CSV button',          selector: '#btnExportCSV',        group: 'Tools' },
  { id: 'btnCollectionStats', label: 'Collection Stats button',    selector: '#btnCollectionStats',  group: 'Tools' },
  { id: 'btnScanHistory',     label: 'Scan History button',        selector: '#btnScanHistory',      group: 'Tools' },
  { id: 'btnReadyToList',     label: 'Ready to List button',       selector: '#btnReadyToList',      group: 'Tools' },
  // Stat cards
  { id: 'statCardScanned',    label: 'Cards Scanned stat',         selector: '#statCardScanned',     group: 'Stats' },
  { id: 'statCardAI',         label: 'AI Lookups stat',            selector: '#statCardAI',          group: 'Stats' },
  { id: 'statCardCost',       label: 'Total Cost stat',            selector: '#statCardCost',        group: 'Stats' },
  { id: 'statCardRate',       label: 'Free Rate stat',             selector: '#statCardRate',        group: 'Stats' },
];

// Default theme config — everything visible, natural order
function defaultThemeConfig() {
  const config = {
    sections: {},
    elements: {}
  };
  THEME_SECTIONS.forEach(s => {
    config.sections[s.id] = { visible: true, order: s.defaultOrder };
  });
  THEME_ELEMENTS.forEach(e => {
    config.elements[e.id] = true;
  });
  return config;
}

// ── CSS generator ─────────────────────────────────────────────────────────────

function buildThemeCSS(config) {
  if (!config) return '';
  const lines = [];

  // Section order and visibility
  (config.sections ? Object.entries(config.sections) : []).forEach(([id, s]) => {
    if (typeof s.order === 'number') {
      lines.push(`#${id} { order: ${s.order}; }`);
    }
    if (s.visible === false) {
      lines.push(`#${id} { display: none !important; }`);
    }
  });

  // Individual element visibility
  (config.elements ? Object.entries(config.elements) : []).forEach(([id, visible]) => {
    if (!visible) {
      const el = THEME_ELEMENTS.find(e => e.id === id);
      if (el) lines.push(`${el.selector} { display: none !important; }`);
    }
  });

  return lines.length ? `/* BOBA Theme */\n${lines.join('\n')}` : '';
}

// ── Apply / clear ─────────────────────────────────────────────────────────────

function applyTheme(config) {
  let style = document.getElementById('bobaThemeStyle');
  if (!style) {
    style = document.createElement('style');
    style.id = 'bobaThemeStyle';
    document.head.appendChild(style);
  }
  style.textContent = buildThemeCSS(config);
  window._activeThemeConfig = config;
}

function clearTheme() {
  const style = document.getElementById('bobaThemeStyle');
  if (style) style.textContent = '';
  window._activeThemeConfig = null;
}

// ── Load theme at sign-in ─────────────────────────────────────────────────────

window.loadUserTheme = async function() {
  if (!window.currentUser || !window.supabaseClient) return;

  try {
    const { data: user } = await window.supabaseClient
      .from('users')
      .select('active_theme_id, custom_theme, is_member')
      .eq('id', window.currentUser.id)
      .single();

    if (!user) return;

    // Members with a custom theme take priority
    if (user.is_member && user.custom_theme) {
      applyTheme(user.custom_theme);
      console.log('🎨 Applied member custom theme');
      return;
    }

    // Active theme from the themes table
    if (user.active_theme_id) {
      const { data: theme } = await window.supabaseClient
        .from('themes')
        .select('config, name')
        .eq('id', user.active_theme_id)
        .single();

      if (theme?.config) {
        applyTheme(theme.config);
        console.log(`🎨 Applied theme: ${theme.name}`);
      }
    }
  } catch (err) {
    console.warn('Theme load failed (non-fatal):', err.message);
  }
};

// ── Save helpers ──────────────────────────────────────────────────────────────

async function saveActiveThemeId(themeId) {
  if (!window.currentUser || !window.supabaseClient) return false;
  const { error } = await window.supabaseClient
    .from('users')
    .update({ active_theme_id: themeId, custom_theme: null })
    .eq('id', window.currentUser.id);
  return !error;
}

async function saveCustomTheme(config) {
  if (!window.currentUser || !window.supabaseClient) return false;
  const { error } = await window.supabaseClient
    .from('users')
    .update({ custom_theme: config, active_theme_id: null })
    .eq('id', window.currentUser.id);
  return !error;
}

// ── Fetch public themes list ──────────────────────────────────────────────────

async function fetchPublicThemes() {
  if (!window.supabaseClient) return [];
  const { data } = await window.supabaseClient
    .from('themes')
    .select('id, name, description')
    .eq('is_public', true)
    .order('name');
  return data || [];
}

// ── Settings modal theme section ──────────────────────────────────────────────
// Called from ui.js when settings modal opens

window.renderThemeSettingsSection = async function() {
  const container = document.getElementById('themeSettingsSection');
  if (!container) return;

  if (!window.currentUser) {
    container.innerHTML = `<p style="font-size:13px;color:#9ca3af;">Sign in to apply themes.</p>`;
    return;
  }

  container.innerHTML = `<p style="font-size:13px;color:#9ca3af;">Loading themes...</p>`;

  const themes = await fetchPublicThemes();
  const isMember = window.currentUser?.is_member;
  const hasCustom  = !!window._activeThemeConfig && !window.currentUser?.active_theme_id;

  const themeOptions = themes.map(t =>
    `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`
  ).join('');

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;gap:8px;align-items:center;">
        <select id="themePickerSelect" style="flex:1;padding:8px 10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:13px;">
          <option value="">— No theme (default) —</option>
          ${themeOptions}
        </select>
        <button id="themeApplyBtn" class="btn-tag-add" style="padding:8px 14px;font-size:13px;white-space:nowrap;">Apply</button>
      </div>
      ${isMember ? `
        <button id="themeCustomizeBtn" style="
          background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;
          padding:9px 14px;font-size:13px;font-weight:600;color:#2563eb;
          cursor:pointer;text-align:left;display:flex;align-items:center;gap:6px;">
          ✏️ Customize my theme ${hasCustom ? '<span style="background:#2563eb;color:white;border-radius:4px;padding:1px 6px;font-size:10px;">ACTIVE</span>' : ''}
        </button>` : `
        <p style="font-size:11px;color:#9ca3af;margin:0;">
          ⭐ Upgrade to Member to create your own custom theme
        </p>`}
      ${window._activeThemeConfig ? `
        <button id="themeClearBtn" style="
          background:none;border:1px solid #e5e7eb;border-radius:8px;
          padding:7px 12px;font-size:12px;color:#6b7280;cursor:pointer;">
          ✕ Clear theme (reset to default)
        </button>` : ''}
    </div>`;

  // Wire apply
  document.getElementById('themeApplyBtn')?.addEventListener('click', async () => {
    const select = document.getElementById('themePickerSelect');
    const themeId = select?.value;
    if (!themeId) {
      clearTheme();
      await saveActiveThemeId(null);
      showToast('Theme cleared', '🎨');
      return;
    }
    const { data: theme } = await window.supabaseClient
      .from('themes').select('config, name').eq('id', themeId).single();
    if (theme?.config) {
      applyTheme(theme.config);
      await saveActiveThemeId(themeId);
      showToast(`Theme applied: ${theme.name}`, '🎨');
      window.renderThemeSettingsSection();
    }
  });

  // Wire member customize
  document.getElementById('themeCustomizeBtn')?.addEventListener('click', () => {
    window.closeSettings?.();
    openThemeEditor(window._activeThemeConfig || defaultThemeConfig(), false, async (config) => {
      applyTheme(config);
      const ok = await saveCustomTheme(config);
      if (ok) showToast('Custom theme saved', '🎨');
      else showToast('Save failed', '❌');
    });
  });

  // Wire clear
  document.getElementById('themeClearBtn')?.addEventListener('click', async () => {
    clearTheme();
    await saveActiveThemeId(null);
    showToast('Theme cleared', '✕');
    window.renderThemeSettingsSection();
  });
};

// ── Theme Editor Modal (shared by admin + members) ────────────────────────────
// isAdmin: true = can publish to themes table
// onSave: callback(config) — caller decides where to persist

window.openThemeEditor = function(initialConfig, isAdmin = false, onSave) {
  document.getElementById('themeEditorModal')?.remove();

  // Deep clone so edits don't affect live theme until saved
  let editConfig = JSON.parse(JSON.stringify(initialConfig || defaultThemeConfig()));

  function buildEditorHTML() {
    // ── Sort sections by their CURRENT order in editConfig so the list always
    //    reflects the real order, and up/down arrows are disabled correctly.
    const sortedSections = [...THEME_SECTIONS].sort((a, b) => {
      const oa = editConfig.sections[a.id]?.order ?? a.defaultOrder;
      const ob = editConfig.sections[b.id]?.order ?? b.defaultOrder;
      return oa - ob;
    });

    // Section order/visibility rows — rendered in sorted order
    const sectionsHTML = sortedSections.map((s, sortedIdx) => {
      const sc       = editConfig.sections[s.id] || { visible: true, order: s.defaultOrder };
      const isFirst  = sortedIdx === 0;
      const isLast   = sortedIdx === sortedSections.length - 1;
      return `
        <div class="theme-section-row" data-section-id="${s.id}" style="
          display:flex;align-items:center;gap:10px;padding:10px 12px;
          background:#f9fafb;border-radius:8px;margin-bottom:6px;border:1px solid #e5e7eb;">
          <div style="flex:1;font-size:13px;font-weight:600;color:#111827;">${s.label}</div>
          ${s.canMove ? `
            <div style="display:flex;flex-direction:column;gap:2px;">
              <button class="theme-move-up" data-section-id="${s.id}"
                      title="Move up"
                      ${isFirst ? 'disabled' : ''}
                      style="background:none;border:1px solid #d1d5db;border-radius:4px;
                             padding:2px 6px;font-size:11px;line-height:1.4;
                             ${isFirst ? 'opacity:.3;cursor:not-allowed;' : 'cursor:pointer;'}">▲</button>
              <button class="theme-move-down" data-section-id="${s.id}"
                      title="Move down"
                      ${isLast ? 'disabled' : ''}
                      style="background:none;border:1px solid #d1d5db;border-radius:4px;
                             padding:2px 6px;font-size:11px;line-height:1.4;
                             ${isLast ? 'opacity:.3;cursor:not-allowed;' : 'cursor:pointer;'}">▼</button>
            </div>` : ''}
          ${s.canHide ? `
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:#374151;cursor:pointer;white-space:nowrap;">
              <input type="checkbox" class="theme-section-visible"
                     data-section-id="${s.id}" ${sc.visible ? 'checked' : ''}>
              Visible
            </label>` : `<span style="font-size:11px;color:#9ca3af;">Always shown</span>`}
        </div>`;
    }).join('');

    // Element toggles — grouped
    const groups = [...new Set(THEME_ELEMENTS.map(e => e.group))];
    const elementsHTML = groups.map(group => {
      const groupEls = THEME_ELEMENTS.filter(e => e.group === group);
      return `
        <div style="margin-bottom:14px;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;
                      letter-spacing:.06em;margin-bottom:6px;">${group}</div>
          ${groupEls.map(el => `
            <label style="display:flex;align-items:center;gap:8px;padding:6px 0;
                           font-size:13px;color:#374151;cursor:pointer;border-bottom:1px solid #f3f4f6;">
              <input type="checkbox" class="theme-element-toggle"
                     data-element-id="${el.id}"
                     ${editConfig.elements[el.id] !== false ? 'checked' : ''}>
              ${el.label}
            </label>`).join('')}
        </div>`;
    }).join('');

    return { sectionsHTML, elementsHTML };
  }

  function renderModal() {
    document.getElementById('themeEditorModal')?.remove();
    const { sectionsHTML, elementsHTML } = buildEditorHTML();

    const nameField = isAdmin ? `
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px;">Theme Name</label>
        <input type="text" id="themeEditorName" value="${escapeHtml(editConfig._name || '')}"
               placeholder="e.g. Deck Builder, Quick Scan..."
               style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;">
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px;">Description (optional)</label>
        <input type="text" id="themeEditorDesc" value="${escapeHtml(editConfig._description || '')}"
               placeholder="Short description for users..."
               style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;">
      </div>` : '';

    const publishRow = isAdmin ? `
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#374151;cursor:pointer;margin-bottom:12px;">
        <input type="checkbox" id="themeEditorPublish" ${editConfig._isPublic ? 'checked' : ''}>
        Publish (make visible to all users)
      </label>` : '';

    const html = `
      <div class="modal active" id="themeEditorModal">
        <div class="modal-backdrop" id="themeEditorBackdrop"></div>
        <div class="modal-content" style="max-width:520px;max-height:92vh;display:flex;flex-direction:column;">
          <div class="modal-header">
            <div>
              <h2>🎨 ${isAdmin ? 'Theme Editor' : 'Customize My Theme'}</h2>
              <div style="font-size:12px;color:#6b7280;margin-top:2px;">
                ${isAdmin ? 'Create or edit a theme for all users' : 'Your personal layout — visible only to you'}
              </div>
            </div>
            <button class="modal-close" id="themeEditorClose">×</button>
          </div>
          <div class="modal-body" style="flex:1;overflow-y:auto;padding:20px;">
            ${nameField}

            <div style="margin-bottom:16px;">
              <div style="font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;
                           letter-spacing:.06em;margin-bottom:8px;">Section Order & Visibility</div>
              <div id="themeSectionsList">
                ${sectionsHTML}
              </div>
            </div>

            <div>
              <div style="font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;
                           letter-spacing:.06em;margin-bottom:8px;">Individual Elements</div>
              ${elementsHTML}
            </div>
          </div>
          <div class="modal-footer" style="flex-direction:column;gap:10px;align-items:stretch;">
            ${publishRow}
            <div style="display:flex;gap:8px;">
              <button class="btn-secondary" id="themeEditorPreview" style="flex:1;">👁 Preview</button>
              <button class="btn-secondary" id="themeEditorCancel" style="flex:1;">Cancel</button>
              <button class="btn btn-primary" id="themeEditorSave" style="flex:1;">
                ${isAdmin ? '💾 Save Theme' : '💾 Save'}
              </button>
            </div>
          </div>
        </div>
      </div>`;

    document.body.insertAdjacentHTML('beforeend', html);
    wireEditorEvents();
  }

  function readCurrentEdits() {
    // Read section visibility checkboxes
    document.querySelectorAll('.theme-section-visible').forEach(cb => {
      const id = cb.dataset.sectionId;
      if (editConfig.sections[id]) editConfig.sections[id].visible = cb.checked;
    });
    // Read element checkboxes
    document.querySelectorAll('.theme-element-toggle').forEach(cb => {
      editConfig.elements[cb.dataset.elementId] = cb.checked;
    });
    if (isAdmin) {
      editConfig._name        = document.getElementById('themeEditorName')?.value || '';
      editConfig._description = document.getElementById('themeEditorDesc')?.value || '';
      editConfig._isPublic    = document.getElementById('themeEditorPublish')?.checked || false;
    }
  }

  function moveSection(sectionId, direction) {
    readCurrentEdits();
    // Sort by current order, swap the moved item with its neighbour
    const sorted = [...THEME_SECTIONS].sort((a, b) =>
      (editConfig.sections[a.id]?.order || a.defaultOrder) -
      (editConfig.sections[b.id]?.order || b.defaultOrder)
    );
    const idx = sorted.findIndex(s => s.id === sectionId);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const orderA = editConfig.sections[sorted[idx].id]?.order    || sorted[idx].defaultOrder;
    const orderB = editConfig.sections[sorted[swapIdx].id]?.order || sorted[swapIdx].defaultOrder;
    editConfig.sections[sorted[idx].id].order    = orderB;
    editConfig.sections[sorted[swapIdx].id].order = orderA;

    // Re-render the whole modal to reflect new order
    renderModal();
  }

  function wireEditorEvents() {
    document.getElementById('themeEditorClose')?.addEventListener('click', () => {
      clearTheme(); // remove preview
      document.getElementById('themeEditorModal')?.remove();
    });
    document.getElementById('themeEditorBackdrop')?.addEventListener('click', () => {
      clearTheme();
      document.getElementById('themeEditorModal')?.remove();
    });
    document.getElementById('themeEditorCancel')?.addEventListener('click', () => {
      clearTheme();
      document.getElementById('themeEditorModal')?.remove();
    });

    // Move buttons
    document.querySelectorAll('.theme-move-up').forEach(btn => {
      btn.addEventListener('click', () => moveSection(btn.dataset.sectionId, -1));
    });
    document.querySelectorAll('.theme-move-down').forEach(btn => {
      btn.addEventListener('click', () => moveSection(btn.dataset.sectionId, 1));
    });

    // Live preview
    document.getElementById('themeEditorPreview')?.addEventListener('click', () => {
      readCurrentEdits();
      applyTheme(editConfig);
      showToast('Previewing theme — save to keep', '👁');
    });

    // Save
    document.getElementById('themeEditorSave')?.addEventListener('click', async () => {
      readCurrentEdits();
      if (isAdmin && !editConfig._name?.trim()) {
        showToast('Please enter a theme name', '⚠️');
        return;
      }
      document.getElementById('themeEditorModal')?.remove();
      if (typeof onSave === 'function') await onSave(editConfig);
    });
  }

  renderModal();
};

// ── Admin: save new/updated theme to Supabase ─────────────────────────────────

window.adminSaveTheme = async function(config, existingId = null) {
  if (!window.supabaseClient) return null;
  const row = {
    name:        config._name || 'Untitled Theme',
    description: config._description || '',
    is_public:   config._isPublic || false,
    created_by:  window.currentUser?.id,
    config:      { sections: config.sections, elements: config.elements }
  };

  let result;
  if (existingId) {
    result = await window.supabaseClient.from('themes').update(row).eq('id', existingId).select().single();
  } else {
    result = await window.supabaseClient.from('themes').insert(row).select().single();
  }

  if (result.error) {
    console.error('Save theme error:', result.error);
    showToast('Failed to save theme', '❌');
    return null;
  }
  showToast(`Theme "${row.name}" saved`, '🎨');
  return result.data;
};

window.adminDeleteTheme = async function(themeId) {
  if (!window.supabaseClient) return;
  const { error } = await window.supabaseClient.from('themes').delete().eq('id', themeId);
  if (error) { showToast('Failed to delete theme', '❌'); return false; }
  showToast('Theme deleted', '✅');
  return true;
};

console.log('✅ Themes module loaded');
