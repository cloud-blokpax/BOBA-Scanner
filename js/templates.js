// ============================================================
// js/templates.js — Export template management
// Handles user-created and admin-assigned export templates.
// User templates: stored in localStorage + synced to Supabase.
// Admin templates: read from Supabase admin_templates table.
// ============================================================

const TEMPLATES_LS_KEY = 'exportTemplates';

// ── User Templates ────────────────────────────────────────────────────────────

function getUserTemplates() {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_LS_KEY) || '[]'); }
  catch { return []; }
}

function saveUserTemplate(name, fields) {
  if (!name?.trim()) return null;
  const templates = getUserTemplates();
  const existingIdx = templates.findIndex(t => t.name === name.trim());
  const tpl = {
    id:        existingIdx >= 0 ? templates[existingIdx].id : `tpl_${Date.now()}`,
    name:      name.trim(),
    fields,
    updatedAt: new Date().toISOString(),
    isUser:    true
  };
  if (existingIdx >= 0) {
    templates[existingIdx] = tpl;
  } else {
    templates.push(tpl);
  }
  try { localStorage.setItem(TEMPLATES_LS_KEY, JSON.stringify(templates)); } catch {}
  pushTemplatesToCloud();
  return tpl;
}

function deleteUserTemplate(id) {
  const templates = getUserTemplates().filter(t => t.id !== id);
  try { localStorage.setItem(TEMPLATES_LS_KEY, JSON.stringify(templates)); } catch {}
  pushTemplatesToCloud();
}

async function pushTemplatesToCloud() {
  if (!window.supabaseClient || !currentUser) return;
  try {
    // Store templates in the user_data column on the collections row
    // (avoids needing a dedicated table while still persisting to cloud)
    await window.supabaseClient
      .from('collections')
      .upsert({
        user_id:          currentUser.id,
        export_templates: getUserTemplates(),
        updated_at:       new Date().toISOString()
      }, { onConflict: 'user_id' });
  } catch {}
}

async function pullTemplatesFromCloud() {
  if (!window.supabaseClient || !currentUser) return;
  try {
    const { data, error } = await window.supabaseClient
      .from('collections')
      .select('export_templates')
      .eq('user_id', currentUser.id)
      .single();
    if (!error && data?.export_templates?.length) {
      // Merge: local wins on conflicts (same id)
      const local   = getUserTemplates();
      const remote  = data.export_templates;
      const merged  = [...local];
      for (const rt of remote) {
        if (!merged.find(lt => lt.id === rt.id)) merged.push(rt);
      }
      try { localStorage.setItem(TEMPLATES_LS_KEY, JSON.stringify(merged)); } catch {}
    }
  } catch {}
}

// ── Admin Templates ───────────────────────────────────────────────────────────

let _adminTemplates = [];

async function loadAdminTemplates() {
  if (!window.supabaseClient || !currentUser) return;
  try {
    // Fetch assigned admin templates via junction table
    const { data, error } = await window.supabaseClient
      .from('user_admin_template_assignments')
      .select('admin_templates(*)')
      .eq('user_id', currentUser.id);
    if (!error && data) {
      _adminTemplates = data
        .map(row => row.admin_templates)
        .filter(Boolean)
        .map(t => ({ ...t, isAdmin: true }));
    }
  } catch {}
}

function getAdminTemplates() { return _adminTemplates; }

// ── All Templates (merged list for export modal) ──────────────────────────────

function getAllTemplates() {
  return [
    ...getUserTemplates(),
    ..._adminTemplates
  ];
}

// ── Template Selector UI ──────────────────────────────────────────────────────

// Returns HTML for the template section inside the export modal.
// Called by export.js when building the export modal.
function renderTemplateSelectorHtml(activeFields) {
  const templates = getAllTemplates();
  if (templates.length === 0) return '';

  const opts = templates.map(t => {
    const badge = t.isAdmin
      ? '<span style="background:#7c3aed;color:white;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:4px;">ADMIN</span>'
      : '';
    return `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}${t.isAdmin ? ' [Admin]' : ''}</option>`;
  });

  return `
    <div style="border-top:1px solid #e5e7eb;margin-top:16px;padding-top:16px;">
      <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
        Saved Templates
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${templates.map(t => {
          const badge = t.isAdmin
            ? '<span style="background:#7c3aed;color:white;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px;">ADMIN</span>'
            : '';
          return `
            <div style="display:flex;align-items:center;gap:4px;padding:5px 10px;border:1.5px solid #e5e7eb;
                        border-radius:8px;font-size:13px;background:white;cursor:pointer;"
                 onclick="loadTemplate('${escapeHtml(t.id)}')" title="Load ${escapeHtml(t.name)}">
              📋 ${escapeHtml(t.name)} ${badge}
              ${!t.isAdmin ? `<button onclick="event.stopPropagation();deleteTemplateConfirm('${escapeHtml(t.id)}')"
                              style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:12px;padding:0 0 0 4px;"
                              title="Delete">✕</button>` : ''}
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

window.loadTemplate = function(id) {
  const tpl = getAllTemplates().find(t => t.id === id);
  if (!tpl) return;

  // Uncheck all, then check template fields
  document.querySelectorAll('#exportModal input[type=checkbox]').forEach(cb => {
    const isInTemplate = tpl.fields.includes(cb.value);
    cb.checked = isInTemplate;
    const label = document.getElementById(`fieldlabel_${cb.value}`);
    if (label) {
      label.style.borderColor = isInTemplate ? '#93c5fd' : '#e5e7eb';
      label.style.background  = isInTemplate ? '#eff6ff'  : 'white';
    }
  });

  showToast(`Loaded: ${tpl.name}`, '📋');
};

window.deleteTemplateConfirm = function(id) {
  const tpl = getUserTemplates().find(t => t.id === id);
  if (!tpl) return;
  if (!confirm(`Delete template "${tpl.name}"?`)) return;
  deleteUserTemplate(id);
  // Refresh template section in open modal
  const section = document.getElementById('exportTemplateSelectorSection');
  if (section) {
    const activeFields = [...document.querySelectorAll('#exportModal input[type=checkbox]:checked')].map(cb => cb.value);
    section.innerHTML = renderTemplateSelectorHtml(new Set(activeFields));
  }
  showToast('Template deleted', '🗑️');
};

// ── Admin: Manage template assignments ────────────────────────────────────────

async function fetchAllAdminTemplates() {
  if (!window.supabaseClient) return [];
  const { data, error } = await window.supabaseClient
    .from('admin_templates')
    .select('*')
    .order('created_at', { ascending: false });
  return error ? [] : (data || []);
}

async function fetchAllAssignments() {
  if (!window.supabaseClient) return [];
  const { data, error } = await window.supabaseClient
    .from('user_admin_template_assignments')
    .select('user_id, admin_template_id');
  return error ? [] : (data || []);
}

async function assignAdminTemplate(userId, templateId) {
  if (!window.supabaseClient) return;
  await window.supabaseClient
    .from('user_admin_template_assignments')
    .upsert({ user_id: userId, admin_template_id: templateId, assigned_by: currentUser.id },
             { onConflict: 'user_id,admin_template_id' });
}

async function unassignAdminTemplate(userId, templateId) {
  if (!window.supabaseClient) return;
  await window.supabaseClient
    .from('user_admin_template_assignments')
    .delete()
    .eq('user_id', userId)
    .eq('admin_template_id', templateId);
}

async function createAdminTemplate(name, fields, description = '') {
  if (!window.supabaseClient || !isAdmin()) return null;
  const { data, error } = await window.supabaseClient
    .from('admin_templates')
    .insert({ name, fields, description, created_by: currentUser.id })
    .select()
    .single();
  if (error) { showToast('Failed to create template', '❌'); return null; }
  showToast(`Template "${name}" created`, '✅');
  return data;
}

// ── Auto-load on sign-in ──────────────────────────────────────────────────────
// Called from user-management.js after successful login
window._loadUserTemplates = async function() {
  await pullTemplatesFromCloud();
  await loadAdminTemplates();
};

console.log('✅ Templates module loaded');
