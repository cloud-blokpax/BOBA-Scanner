// ============================================================
// js/admin-dashboard.js — FIXED
// Changes:
//   - escapeHtml() applied to ALL user-controlled data in HTML templates
//     (was vulnerable to XSS — a user with name <script>... would execute code)
//   - openAdminDashboard() has duplicate-insertion guard
//   - editUser() and viewUserLogs() have duplicate-insertion guards
//   - showAdminTab() no longer uses implicit global `event` — receives `btn` param
//   - filterUsers() debounced via the debounce() helper from ui-enhancements.js
//   - calculateTodayStats() queries run in parallel (Promise.all)
// ============================================================

// Resolve escapeHtml from window (defined in ui.js core bundle)
const escapeHtml = (...args) => window.escapeHtml(...args);

async function openAdminDashboard() {
  if (!isAdmin()) {
    showToast('Access denied', '❌');
    return;
  }

  // FIXED: Guard against opening twice
  if (document.getElementById('adminDashboard')) return;

  try {
    showLoading(true, 'Loading admin dashboard...');

    const [usersData, logsData, statsData, tournamentsData] = await Promise.all([
      fetchAllUsers(),
      fetchRecentLogs(),
      fetchSystemStats(),
      (typeof fetchAllTournaments === 'function') ? fetchAllTournaments() : Promise.resolve([])
    ]);

    showLoading(false);
    renderAdminDashboard(usersData, logsData, statsData, tournamentsData);

  } catch (err) {
    showLoading(false);
    console.error('Admin dashboard error:', err);
    showToast('Failed to load admin dashboard', '❌');
  }
}

async function fetchAllUsers() {
  const { data, error } = await window.supabaseClient
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function fetchRecentLogs(limit = 100) {
  const { data, error } = await window.supabaseClient
    .from('api_call_logs')
    .select('*, users(email, name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function fetchSystemStats() {
  try {
    const today = new Date().toISOString().split('T')[0];
    // NOTE: No .single() — that returns HTTP 406 on zero rows, logged as a network
    // error in the browser console even when JS catches it. Array fetch is always 200.
    const { data, error } = await window.supabaseClient
      .from('system_stats')
      .select('*')
      .eq('date', today)
      .limit(1);
    if (error) throw error;
    return (data && data.length > 0) ? data[0] : await calculateTodayStats();
  } catch (_err) {
    // system_stats table may not exist — silently fall back to live calculation
    return await calculateTodayStats();
  }
}

// FIXED: All 4 queries run in parallel (was sequential — 4× slower)
async function calculateTodayStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const [
    { count: totalUsers },
    { data: activeCalls },
    { count: totalApiCalls },
    { data: costData }
  ] = await Promise.all([
    window.supabaseClient.from('users').select('*', { count: 'exact', head: true }),
    window.supabaseClient.from('api_call_logs').select('user_id').gte('created_at', todayISO),
    window.supabaseClient.from('api_call_logs').select('*', { count: 'exact', head: true }).gte('created_at', todayISO),
    window.supabaseClient.from('api_call_logs').select('cost').gte('created_at', todayISO)
  ]);

  const activeUsers = new Set((activeCalls || []).map(c => c.user_id)).size;
  const totalCost   = (costData || []).reduce((sum, c) => sum + parseFloat(c.cost || 0), 0);

  return { total_users: totalUsers, active_users: activeUsers, total_api_calls: totalApiCalls, total_cost: totalCost };
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderAdminDashboard(users, logs, stats, tournaments) {
  tournaments = tournaments || [];
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal active" id="adminDashboard">
      <div class="modal-content admin-dashboard-content">
        <div class="modal-header">
          <div class="modal-title">👑 Admin Dashboard</div>
          <div class="modal-close" id="adminDashboardClose">×</div>
        </div>
        <div class="admin-tabs" id="adminTabs">
          <button class="admin-tab active" data-tab="overview">Overview</button>
          <button class="admin-tab" data-tab="users">Users (${users.length})</button>
          <button class="admin-tab" data-tab="logs">API Logs</button>
          <button class="admin-tab" data-tab="stats">Statistics</button>
          <button class="admin-tab" data-tab="tournaments">🏆 Tournaments (${tournaments.length})</button>
          <button class="admin-tab" data-tab="themes">🎨 Themes</button>
          <button class="admin-tab" data-tab="settings">⚙️ Settings</button>
          <button class="admin-tab" data-tab="features">✨ Features</button>
          <button class="admin-tab" data-tab="activity">Activity</button>
        </div>
        <div class="admin-content">
          <div class="admin-tab-content active" id="tab-overview">${renderOverviewTab(stats, users, logs)}</div>
          <div class="admin-tab-content" id="tab-users">${renderUsersTab(users)}</div>
          <div class="admin-tab-content" id="tab-logs">${renderLogsTab(logs)}</div>
          <div class="admin-tab-content" id="tab-stats">${renderStatsTab(stats, logs)}</div>
          <div class="admin-tab-content" id="tab-tournaments">${typeof renderTournamentsTab === 'function' ? renderTournamentsTab(tournaments) : ''}</div>
          <div class="admin-tab-content" id="tab-themes">${renderThemesTab()}</div>
          <div class="admin-tab-content" id="tab-settings">${renderSettingsTab()}</div>
          <div class="admin-tab-content" id="tab-features">${renderFeaturesTab()}</div>
          <div class="admin-tab-content" id="tab-activity">${renderActivityTab(users)}</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper.firstElementChild);
  window.adminData = { users, logs, stats, tournaments };

  // FIXED: Wire tab clicks without inline handlers — no more implicit event global
  document.getElementById('adminDashboardClose')?.addEventListener('click', closeAdminDashboard);
  document.getElementById('adminTabs')?.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', (e) => showAdminTab(btn.dataset.tab, btn));
  });

  // FIXED: Debounce the search input
  const searchInput = document.getElementById('userSearch');
  if (searchInput && typeof debounce === 'function') {
    searchInput.addEventListener('input', debounce(() => filterUsers(searchInput.value), 200));
  } else if (searchInput) {
    searchInput.addEventListener('input', () => filterUsers(searchInput.value));
  }

  const filterSelect = document.getElementById('userFilter');
  filterSelect?.addEventListener('change', () => filterUsers(searchInput?.value || ''));
}

// FIXED: All user-controlled strings are escaped before injection into HTML
function renderOverviewTab(stats, users, logs) {
  const recentUsers  = users.slice(0, 5);
  const recentErrors = logs.filter(l => !l.success).slice(0, 5);

  return `
    <div class="overview-grid">
      <div class="overview-stat"><div class="stat-icon">👥</div><div class="stat-value">${stats.total_users || 0}</div><div class="stat-label">Total Users</div></div>
      <div class="overview-stat"><div class="stat-icon">✅</div><div class="stat-value">${stats.active_users || 0}</div><div class="stat-label">Active Today</div></div>
      <div class="overview-stat"><div class="stat-icon">🤖</div><div class="stat-value">${stats.total_api_calls || 0}</div><div class="stat-label">API Calls Today</div></div>
      <div class="overview-stat"><div class="stat-icon">💰</div><div class="stat-value">$${(stats.total_cost || 0).toFixed(2)}</div><div class="stat-label">Cost Today</div></div>
    </div>
    <div class="overview-section">
      <h4>Recent Users</h4>
      <div class="recent-users-list">
        ${recentUsers.map(u => `
          <div class="recent-user-item">
            <img src="${escapeHtml(u.picture || '')}" alt="${escapeHtml(u.name || '')}">
            <div class="user-info">
              <strong>${escapeHtml(u.name || 'Unknown')}</strong>
              <small>${escapeHtml(u.email || '')}</small>
            </div>
            <small>${new Date(u.created_at).toLocaleDateString()}</small>
          </div>
        `).join('')}
      </div>
    </div>
    ${recentErrors.length > 0 ? `
      <div class="overview-section">
        <h4>Recent Errors</h4>
        <div class="error-list">
          ${recentErrors.map(e => `
            <div class="error-item">
              <div class="error-time">${new Date(e.created_at).toLocaleTimeString()}</div>
              <div class="error-user">${escapeHtml(e.users?.email || 'Unknown')}</div>
              <div class="error-message">${escapeHtml(e.error_message || 'No message')}</div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

function renderUsersTab(users) {
  return `
    <div class="users-controls">
      <input type="text" id="userSearch" placeholder="Search users...">
      <select id="userFilter">
        <option value="all">All Users</option>
        <option value="admin">Admins Only</option>
        <option value="regular">Regular Users</option>
        <option value="member">Members Only</option>
        <option value="limit">Near Limits</option>
      </select>
    </div>
    <div class="users-table-container">
      <table class="users-table" id="usersTable">
        <thead>
          <tr>
            <th>User</th><th>Email</th><th>Discord</th><th>Cards</th>
            <th>API Calls</th><th>Admin</th><th>Member</th><th>Joined</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>${users.map(u => renderUserRow(u)).join('')}</tbody>
      </table>
    </div>
  `;
}

// FIXED: All user data escaped before HTML injection
function renderUserRow(user) {
  const cardsPercent = Math.min(100, ((user.cards_in_collection || 0) / (user.card_limit || 1)) * 100);
  const apiPercent   = Math.min(100, ((user.api_calls_used || 0) / (user.api_calls_limit || 1)) * 100);

  // Membership display
  let memberCell = '';
  if (user.is_member && user.member_until) {
    const expiry    = new Date(user.member_until);
    const now       = new Date();
    const daysLeft  = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    const expired   = daysLeft <= 0;
    const expLabel  = expired
      ? `<span style="color:#ef4444;font-size:10px;">Expired</span>`
      : `<span style="color:#6b7280;font-size:10px;">${daysLeft}d left</span>`;
    memberCell = `
      <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
        <span class="status-badge ${expired ? 'failed' : 'success'}" style="font-size:11px;">
          ${expired ? '⚠️ Expired' : '⭐ Member'}
        </span>
        ${expLabel}
        <div style="display:flex;gap:4px;margin-top:2px;">
          <button class="btn-icon member-extend-btn" data-uid="${escapeHtml(user.id)}" title="+30 days" style="font-size:10px;padding:2px 6px;">+30d</button>
          <button class="btn-icon member-revoke-btn" data-uid="${escapeHtml(user.id)}" title="Revoke membership" style="font-size:10px;padding:2px 6px;">✖</button>
        </div>
      </div>`;
  } else {
    memberCell = `
      <button class="btn-icon member-grant-btn" data-uid="${escapeHtml(user.id)}" title="Grant membership" style="font-size:11px;padding:3px 8px;">
        ⭐ Grant
      </button>`;
  }

  return `
    <tr class="user-row ${user.is_admin ? 'admin-user' : ''}" data-user-id="${escapeHtml(user.id)}">
      <td><div class="user-cell">
        <img src="${escapeHtml(user.picture || '')}" alt="" class="user-avatar-small">
        <span>${escapeHtml(user.name || 'Unknown')}</span>
      </div></td>
      <td>${escapeHtml(user.email || '')}</td>
      <td>${escapeHtml(user.discord_id || '-')}</td>
      <td><div class="limit-cell">${user.cards_in_collection || 0} / ${user.card_limit || 0}
        <div class="mini-bar"><div class="mini-fill" style="width:${cardsPercent}%"></div></div>
      </div></td>
      <td><div class="limit-cell">${user.api_calls_used || 0} / ${user.api_calls_limit || 0}
        <div class="mini-bar"><div class="mini-fill" style="width:${apiPercent}%"></div></div>
      </div></td>
      <td><span class="status-badge ${user.is_admin ? 'admin' : 'regular'}">${user.is_admin ? 'Admin' : 'User'}</span>${user.can_invite ? '<span style="display:block;font-size:10px;color:#7c3aed;margin-top:2px;">🏆 Invite</span>' : ''}</td>
      <td>${memberCell}</td>
      <td>${new Date(user.created_at).toLocaleDateString()}</td>
      <td>
        <button class="btn-icon admin-edit-btn" data-uid="${escapeHtml(user.id)}" title="Edit">✏️</button>
        <button class="btn-icon admin-logs-btn" data-uid="${escapeHtml(user.id)}" title="Logs">📊</button>
      </td>
    </tr>
  `;
}

function renderLogsTab(logs) {
  return `
    <div class="logs-controls">
      <select id="logFilter">
        <option value="all">All Logs</option>
        <option value="success">Successful Only</option>
        <option value="failed">Failed Only</option>
        <option value="today">Today</option>
      </select>
      <button class="btn btn-secondary btn-sm" id="exportLogsBtn">📥 Export Logs</button>
    </div>
    <div class="logs-table-container">
      <table class="logs-table">
        <thead>
          <tr><th>Time</th><th>User</th><th>Type</th><th>Status</th><th>Cards</th><th>Cost</th><th>Error</th></tr>
        </thead>
        <tbody id="logsTableBody">${logs.map(log => renderLogRow(log)).join('')}</tbody>
      </table>
    </div>
  `;
}

// FIXED: error_message escaped
function renderLogRow(log) {
  return `
    <tr class="${log.success ? 'log-success' : 'log-failed'}">
      <td>${new Date(log.created_at).toLocaleString()}</td>
      <td>${escapeHtml(log.users?.email || 'Unknown')}</td>
      <td>${escapeHtml(log.call_type || '')}</td>
      <td><span class="status-badge ${log.success ? 'success' : 'failed'}">${log.success ? '✅' : '❌'}</span></td>
      <td>${log.cards_processed || 0}</td>
      <td>$${parseFloat(log.cost || 0).toFixed(4)}</td>
      <td>${escapeHtml(log.error_message || '-')}</td>
    </tr>
  `;
}

function renderStatsTab(stats, logs) {
  const successRate = logs.length > 0
    ? ((logs.filter(l => l.success).length / logs.length) * 100).toFixed(1) : 0;
  const avgCost = logs.length > 0
    ? (logs.reduce((s, l) => s + parseFloat(l.cost || 0), 0) / logs.length).toFixed(4) : 0;
  const totalCost = logs.reduce((s, l) => s + parseFloat(l.cost || 0), 0).toFixed(2);

  const logsByDate = {};
  logs.forEach(log => {
    const d = new Date(log.created_at).toLocaleDateString();
    logsByDate[d] = (logsByDate[d] || 0) + 1;
  });
  const maxCount = Math.max(...Object.values(logsByDate), 1);

  return `
    <div class="stats-grid">
      <div class="stat-card"><h4>Success Rate</h4><div class="stat-big">${successRate}%</div>
        <div class="stat-detail">${logs.filter(l => l.success).length} / ${logs.length} calls</div></div>
      <div class="stat-card"><h4>Average Cost</h4><div class="stat-big">$${avgCost}</div><div class="stat-detail">Per API call</div></div>
      <div class="stat-card"><h4>Total Cost (30d)</h4><div class="stat-big">$${totalCost}</div><div class="stat-detail">Last 30 days</div></div>
      <div class="stat-card"><h4>Active Users</h4><div class="stat-big">${new Set(logs.map(l => l.user_id)).size}</div><div class="stat-detail">Made API calls</div></div>
    </div>
    <div class="chart-section">
      <h4>API Calls by Date</h4>
      <div class="simple-chart">
        ${Object.entries(logsByDate).slice(-7).map(([date, count]) => `
          <div class="chart-bar">
            <div class="bar-fill" style="height:${(count / maxCount) * 100}%"></div>
            <div class="bar-label">${date.split('/')[1]}/${date.split('/')[0]}</div>
            <div class="bar-value">${count}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ── Admin actions ─────────────────────────────────────────────────────────────
async function editUser(userId) {
  // FIXED: Guard against duplicate modal
  if (document.getElementById('editUserModal')) return;

  const user = window.adminData?.users.find(u => u.id === userId);
  if (!user) return;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal active" id="editUserModal">
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-title">✏️ Edit User: ${escapeHtml(user.name || '')}</div>
          <div class="modal-close" id="editUserClose">×</div>
        </div>
        <div class="edit-user-content">
          <div class="form-group">
            <label>Card Limit</label>
            <input type="number" id="editCardLimit" value="${parseInt(user.card_limit) || 25}" min="0">
          </div>
          <div class="form-group">
            <label>API Calls Limit (per month)</label>
            <input type="number" id="editApiLimit" value="${parseInt(user.api_calls_limit) || 50}" min="0">
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" id="editIsAdmin" ${user.is_admin ? 'checked' : ''}>
              Grant Admin Access
            </label>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" id="editCanInvite" ${user.can_invite ? 'checked' : ''}>
              🏆 Can Create Tournaments (invite role)
            </label>
          </div>
          <div class="form-group">
            <label>Reset API Calls for This Month</label>
            <button class="btn btn-secondary" id="resetApiCallsBtn">Reset to 0</button>
          </div>
        </div>
        <div class="modal-buttons">
          <button class="btn btn-secondary" id="editUserCancelBtn">Cancel</button>
          <button class="btn btn-primary" id="editUserSaveBtn">Save Changes</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper.firstElementChild);

  document.getElementById('editUserClose')?.addEventListener('click', closeEditUserModal);
  document.getElementById('editUserCancelBtn')?.addEventListener('click', closeEditUserModal);
  document.getElementById('editUserSaveBtn')?.addEventListener('click', () => saveUserChanges(userId));
  document.getElementById('resetApiCallsBtn')?.addEventListener('click', () => resetUserApiCalls(userId));
}

async function saveUserChanges(userId) {
  const cardLimit  = parseInt(document.getElementById('editCardLimit').value);
  const apiLimit   = parseInt(document.getElementById('editApiLimit').value);
  const isAdminVal = document.getElementById('editIsAdmin').checked;
  const canInvite  = document.getElementById('editCanInvite').checked;

  try {
    const { error } = await window.supabaseClient
      .from('users')
      .update({ card_limit: cardLimit, api_calls_limit: apiLimit, is_admin: isAdminVal, can_invite: canInvite })
      .eq('id', userId);

    if (error) throw error;

    await logAdminAction('change_limit', userId, '', `cards:${cardLimit},api:${apiLimit},admin:${isAdminVal},invite:${canInvite}`);
    showToast('User updated', '✅');
    closeEditUserModal();

    // Refresh dashboard
    setTimeout(() => { closeAdminDashboard(); openAdminDashboard(); }, 500);

  } catch (err) {
    console.error('Save user error:', err);
    showToast('Failed to update user', '❌');
  }
}

async function resetUserApiCalls(userId) {
  if (!confirm('Reset this user\'s API calls to 0?')) return;
  try {
    const { error } = await window.supabaseClient
      .from('users')
      .update({ api_calls_used: 0 })
      .eq('id', userId);
    if (error) throw error;
    await logAdminAction('reset_user', userId, '', 'api_calls_reset');
    showToast('API calls reset', '✅');
  } catch (err) {
    showToast('Failed to reset', '❌');
  }
}

async function viewUserLogs(userId) {
  // FIXED: Guard against duplicate modal
  if (document.getElementById('userLogsModal')) return;

  try {
    showLoading(true, 'Loading user logs...');

    const { data: logs, error } = await window.supabaseClient
      .from('api_call_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    showLoading(false);
    if (error) throw error;

    const user = window.adminData?.users.find(u => u.id === userId);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="modal active" id="userLogsModal">
        <div class="modal-content">
          <div class="modal-header">
            <div class="modal-title">📊 Logs: ${escapeHtml(user?.name || 'User')}</div>
            <div class="modal-close" id="userLogsClose">×</div>
          </div>
          <div class="user-logs-content">
            <table class="logs-table">
              <thead><tr><th>Time</th><th>Type</th><th>Status</th><th>Cards</th><th>Cost</th></tr></thead>
              <tbody>
                ${(logs || []).map(log => `
                  <tr class="${log.success ? 'log-success' : 'log-failed'}">
                    <td>${new Date(log.created_at).toLocaleString()}</td>
                    <td>${escapeHtml(log.call_type || '')}</td>
                    <td>${log.success ? '✅' : '❌'}</td>
                    <td>${log.cards_processed || 0}</td>
                    <td>$${parseFloat(log.cost || 0).toFixed(4)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div class="modal-buttons">
            <button class="btn btn-secondary" id="userLogsCloseBtn">Close</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(wrapper.firstElementChild);
    document.getElementById('userLogsClose')?.addEventListener('click', closeUserLogsModal);
    document.getElementById('userLogsCloseBtn')?.addEventListener('click', closeUserLogsModal);

  } catch (err) {
    showLoading(false);
    showToast('Failed to load logs', '❌');
  }
}

async function logAdminAction(actionType, targetUserId, oldValue, newValue) {
  try {
    await window.supabaseClient.from('admin_actions').insert({
      admin_id: currentUser.id, action_type: actionType,
      target_user_id: targetUserId, old_value: oldValue, new_value: newValue
    });
  } catch (err) {
    console.error('Log admin action error:', err);
  }
}

// ── Tab switching — FIXED: no implicit global `event` ────────────────────────
function showAdminTab(tabName, clickedBtn) {
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
  clickedBtn?.classList.add('active');

  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`tab-${tabName}`)?.classList.add('active');
}

// FIXED: Debounced by the caller (renderAdminDashboard wires up debounce)
function filterUsers(searchTerm = '') {
  const filter = document.getElementById('userFilter')?.value || 'all';
  const search = searchTerm.toLowerCase();

  document.querySelectorAll('.user-row').forEach(row => {
    const userId = row.dataset.userId;
    const user   = window.adminData?.users.find(u => u.id === userId);
    if (!user) return;

    let show = true;

    if (search) {
      const searchable = `${user.name} ${user.email} ${user.discord_id || ''}`.toLowerCase();
      if (!searchable.includes(search)) show = false;
    }

    if (filter === 'admin'   && !user.is_admin)  show = false;
    if (filter === 'regular' &&  user.is_admin)  show = false;
    if (filter === 'member'  && !user.is_member) show = false;
    if (filter === 'limit') {
      const nearCard = (user.cards_in_collection || 0) >= (user.card_limit || 1) * 0.9;
      const nearApi  = (user.api_calls_used || 0) >= (user.api_calls_limit || 1) * 0.9;
      if (!nearCard && !nearApi) show = false;
    }

    row.style.display = show ? '' : 'none';
  });
}

// ── Membership actions ────────────────────────────────────────────────────────

// Dynamic getters — resolve at call time so admin-configured values from
// system_settings are picked up even if loaded after this file parses.
function getMemberCardLimit() { return DEFAULT_LIMITS.member?.maxCards || 250; }
function getMemberApiLimit()  { return DEFAULT_LIMITS.member?.maxApiCalls || 250; }

async function grantMembership(userId) {
  const user      = window.adminData?.users.find(u => u.id === userId);
  const userName  = user?.name || user?.email || 'this user';
  const until     = new Date();
  until.setDate(until.getDate() + 30);

  try {
    const { error } = await window.supabaseClient
      .from('users')
      .update({
        is_member:       true,
        member_until:    until.toISOString(),
        card_limit:      getMemberCardLimit(),
        api_calls_limit: getMemberApiLimit()
      })
      .eq('id', userId);

    if (error) throw error;

    await logAdminAction('grant_membership', userId, 'none', `until:${until.toISOString().split('T')[0]}`);
    showToast(`⭐ ${userName} is now a member (30 days)`, '✅');
    setTimeout(() => { closeAdminDashboard(); openAdminDashboard(); }, 600);

  } catch (err) {
    console.error('Grant membership error:', err);
    showToast('Failed to grant membership', '❌');
  }
}

async function extendMembership(userId) {
  const user = window.adminData?.users.find(u => u.id === userId);
  if (!user) return;

  // If still active, add 30 days to current expiry; if expired, start fresh from today
  const base  = (user.member_until && new Date(user.member_until) > new Date())
    ? new Date(user.member_until)
    : new Date();
  const until = new Date(base);
  until.setDate(until.getDate() + 30);

  try {
    const { error } = await window.supabaseClient
      .from('users')
      .update({
        is_member:       true,
        member_until:    until.toISOString(),
        card_limit:      getMemberCardLimit(),
        api_calls_limit: getMemberApiLimit()
      })
      .eq('id', userId);

    if (error) throw error;

    await logAdminAction('extend_membership', userId, user.member_until || '', until.toISOString().split('T')[0]);
    showToast(`+30 days — now until ${until.toLocaleDateString()}`, '📅');
    setTimeout(() => { closeAdminDashboard(); openAdminDashboard(); }, 600);

  } catch (err) {
    console.error('Extend membership error:', err);
    showToast('Failed to extend membership', '❌');
  }
}

async function revokeMembership(userId) {
  const user = window.adminData?.users.find(u => u.id === userId);
  if (!user) return;

  try {
    const { error } = await window.supabaseClient
      .from('users')
      .update({
        is_member:       false,
        member_until:    null,
        card_limit:      DEFAULT_LIMITS.authenticated.maxCards,
        api_calls_limit: DEFAULT_LIMITS.authenticated.maxApiCalls
      })
      .eq('id', userId);

    if (error) throw error;

    await logAdminAction('revoke_membership', userId, 'member', 'none');
    showToast(`Membership revoked`, '✅');
    setTimeout(() => { closeAdminDashboard(); openAdminDashboard(); }, 600);

  } catch (err) {
    console.error('Revoke membership error:', err);
    showToast('Failed to revoke membership', '❌');
  }
}

// Use event delegation for admin action buttons (edit/logs)
document.addEventListener('click', (e) => {
  const editBtn = e.target.closest('.admin-edit-btn');
  if (editBtn) { editUser(editBtn.dataset.uid); return; }

  const logsBtn = e.target.closest('.admin-logs-btn');
  if (logsBtn) { viewUserLogs(logsBtn.dataset.uid); return; }

  const exportBtn = e.target.closest('#exportLogsBtn');
  if (exportBtn) { exportLogs(); return; }

  const grantBtn = e.target.closest('.member-grant-btn');
  if (grantBtn) { grantMembership(grantBtn.dataset.uid); return; }

  const extendBtn = e.target.closest('.member-extend-btn');
  if (extendBtn) { extendMembership(extendBtn.dataset.uid); return; }

  const revokeBtn = e.target.closest('.member-revoke-btn');
  if (revokeBtn) { revokeMembership(revokeBtn.dataset.uid); return; }

  // Tournament toggle in admin dashboard
  const tournamentToggle = e.target.closest('.admin-tournament-toggle');
  if (tournamentToggle && typeof toggleTournamentActive === 'function') {
    const tid = tournamentToggle.dataset.tid;
    const isActive = tournamentToggle.dataset.active === 'true';
    toggleTournamentActive(tid, !isActive).then(() => {
      setTimeout(() => { closeAdminDashboard(); openAdminDashboard(); }, 600);
    });
    return;
  }
});

function closeAdminDashboard() { document.getElementById('adminDashboard')?.remove(); }
function closeEditUserModal()   { document.getElementById('editUserModal')?.remove(); }
function closeUserLogsModal()   { document.getElementById('userLogsModal')?.remove(); }

async function exportLogs() {
  const logs = window.adminData?.logs || [];
  const csv  = [
    ['Time','User','Type','Success','Cards','Cost','Error'],
    ...logs.map(log => [
      new Date(log.created_at).toISOString(),
      log.users?.email || '',
      log.call_type,
      log.success ? 'Yes' : 'No',
      log.cards_processed,
      parseFloat(log.cost || 0).toFixed(4),
      log.error_message || ''
    ])
  ].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `api_logs_${new Date().toISOString().split('T')[0]}.csv`
  });
  a.click();
  URL.revokeObjectURL(url);
  showToast('Logs exported', '✅');
}

console.log('✅ Admin dashboard module loaded');


// ── Settings Tab ──────────────────────────────────────────────────────────────

// Read saved eBay settings with defaults (mirrors export.js getEbayExportSettings)
function getAdminEbaySettings() {
  try {
    return Object.assign({
      titleTemplate:       '{hero} {athlete} Bo Jackson Battle Arena',
      categoryId:          '183454',
      paymentProfile:      '',
      returnProfile:       '',
      shippingProfile:     '',
      descriptionTemplate: '<p><strong>{hero}</strong> ({cardNumber})</p><p>Set: {set} {year} | Parallel: {pose}</p>{weaponLine}<p>Game: Bo Jackson Battle Arena</p>{notesLine}',
      priceSource:         'ebayAvgPrice',
      bestOffer:           'false',
      duration:            'GTC',
      postalCode:          '',
      storeCategory:       '',
      gameSpecific:        'Bo Jackson Battle Arena',
      manufacturer:        '',
      language:            'English',
      sport:               'Trading Cards',
    }, JSON.parse(localStorage.getItem('ebayExportSettings') || '{}'));
  } catch { return {}; }
}

function renderEbaySettingsFields() {
  const s = getAdminEbaySettings();
  const inp = (id, val, placeholder, note) => `
    <div style="margin-bottom:12px;">
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">${note}</label>
      <input type="text" id="${id}" value="${escapeHtml(String(val || ''))}" placeholder="${escapeHtml(placeholder || '')}"
             style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;box-sizing:border-box;">
    </div>`;
  const sel = (id, val, opts, note) => `
    <div style="margin-bottom:12px;">
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">${note}</label>
      <select id="${id}" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;">
        ${opts.map(([v,l]) => `<option value="${v}" ${val===v?'selected':''}>${l}</option>`).join('')}
      </select>
    </div>`;

  // Template variable hint
  const hint = `<div style="font-size:11px;color:#9ca3af;margin-bottom:12px;">
    Available variables: <code>{hero}</code> <code>{athlete}</code> <code>{cardNumber}</code>
    <code>{year}</code> <code>{set}</code> <code>{pose}</code> <code>{weapon}</code>
    <code>{power}</code> <code>{condition}</code> <code>{notes}</code> <code>{game}</code>
  </div>`;

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <!-- Left column -->
      <div>
        <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Listing Content</div>
        ${hint}
        <div style="margin-bottom:12px;">
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Title Template (max 80 chars)</label>
          <input type="text" id="ebayTitleTemplate" value="${escapeHtml(s.titleTemplate)}" maxlength="120"
                 style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;box-sizing:border-box;"
                 placeholder="{hero} {athlete} Bo Jackson Battle Arena">
        </div>
        <div style="margin-bottom:12px;">
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Description Template (HTML ok)</label>
          <textarea id="ebayDescriptionTemplate" rows="4"
                    style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;box-sizing:border-box;font-family:monospace;resize:vertical;"
                    placeholder="<p><strong>{hero}</strong> ({cardNumber})</p>...">${escapeHtml(s.descriptionTemplate)}</textarea>
        </div>
        ${sel('ebayPriceSource', s.priceSource, [
          ['ebayAvgPrice','eBay Avg Price (auto-fetched)'],
          ['ebayLowPrice','eBay Low Price (auto-fetched)'],
          ['listingPrice','Manual Listing Price'],
        ], 'Price Source')}
        ${sel('ebayBestOffer', s.bestOffer, [['false','No'],['true','Yes']], 'Enable Best Offer')}
        ${sel('ebayDuration', s.duration, [['GTC','GTC (Good Till Cancelled)'],['Days_30','30 days'],['Days_7','7 days']], 'Listing Duration')}
      </div>

      <!-- Right column -->
      <div>
        <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">eBay Account Settings</div>
        ${inp('ebayCategoryId',      s.categoryId,      '183454', '* eBay Category ID (required)')}
        ${inp('ebayPaymentProfile',  s.paymentProfile,  'My Payment Policy', '* Payment Profile Name (required)')}
        ${inp('ebayReturnProfile',   s.returnProfile,   'My Return Policy',  '* Return Profile Name (required)')}
        ${inp('ebayShippingProfile', s.shippingProfile, 'My Shipping Policy','* Shipping Profile Name (required)')}
        ${inp('ebayPostalCode',      s.postalCode,      '90210',             '* Item Location Postal Code')}
        ${inp('ebayStoreCategory',   s.storeCategory,   '',                  'Store Category ID (optional)')}

        <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin:14px 0 10px;">Item Specifics (C: columns)</div>
        ${inp('ebayGame',         s.gameSpecific, 'Bo Jackson Battle Arena', 'C:Game')}
        ${inp('ebayManufacturer', s.manufacturer, 'Bo Jackson\'s Wild Card',  'C:Manufacturer')}
        ${inp('ebayLanguage',     s.language,     'English',                  'C:Language')}
        ${inp('ebaySport',        s.sport,        'Trading Cards',            'C:Sport')}
      </div>
    </div>`;
}

function renderSettingsTab() {
  const g = DEFAULT_LIMITS.guest;
  const a = DEFAULT_LIMITS.authenticated;
  const m = DEFAULT_LIMITS.member;

  return `
    <div id="settingsTabContent" style="padding:16px;">
      <div style="margin-bottom:16px;">
        <div style="font-weight:700;font-size:15px;color:#111827;">System Settings</div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px;">
          Configure default limits for each user tier. Changes apply to new users and membership grants.
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px;">
        <!-- Guest -->
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;">
          <div style="font-weight:700;font-size:13px;color:#6b7280;margin-bottom:12px;">👤 Guest</div>
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Card Limit</label>
          <input type="number" id="settGuestCards" value="${g.maxCards}" min="0" max="9999"
                 style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;margin-bottom:10px;">
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">AI Lookup Limit</label>
          <input type="number" id="settGuestApi" value="${g.maxApiCalls}" min="0" max="9999"
                 style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
        </div>
        <!-- Authenticated -->
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;">
          <div style="font-weight:700;font-size:13px;color:#3b82f6;margin-bottom:12px;">🔐 Logged-in</div>
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Card Limit</label>
          <input type="number" id="settAuthCards" value="${a.maxCards}" min="0" max="9999"
                 style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;margin-bottom:10px;">
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">AI Lookup Limit</label>
          <input type="number" id="settAuthApi" value="${a.maxApiCalls}" min="0" max="9999"
                 style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
        </div>
        <!-- Member -->
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;">
          <div style="font-weight:700;font-size:13px;color:#f59e0b;margin-bottom:12px;">⭐ Member</div>
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Card Limit</label>
          <input type="number" id="settMemberCards" value="${m.maxCards}" min="0" max="9999"
                 style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;margin-bottom:10px;">
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">AI Lookup Limit</label>
          <input type="number" id="settMemberApi" value="${m.maxApiCalls}" min="0" max="9999"
                 style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:12px;">
        <button id="saveSystemSettings" class="btn btn-primary" style="padding:10px 24px;">Save Settings</button>
        <span id="settingsSaveStatus" style="font-size:13px;color:#6b7280;"></span>
      </div>

      <!-- ── eBay Export Settings ── -->
      <div style="margin-top:28px;border-top:1px solid #e5e7eb;padding-top:20px;">
        <div style="margin-bottom:14px;">
          <div style="font-weight:700;font-size:15px;color:#111827;">🏪 eBay Export Settings</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">
            Configure defaults for the eBay Seller Hub bulk upload CSV.
            Fields marked <strong>*</strong> cannot be derived from card metadata and must be set here.
          </div>
        </div>

        ${renderEbaySettingsFields()}

        <div style="display:flex;align-items:center;gap:12px;margin-top:16px;">
          <button id="saveEbaySettings" class="btn btn-primary" style="padding:10px 24px;">Save eBay Settings</button>
          <span id="ebaySettingsSaveStatus" style="font-size:13px;color:#6b7280;"></span>
        </div>
      </div>
    </div>`;
}

async function saveSystemSettings() {
  const pairs = [
    { key: 'guest_max_cards',  value: document.getElementById('settGuestCards')?.value  },
    { key: 'guest_max_api',    value: document.getElementById('settGuestApi')?.value    },
    { key: 'auth_max_cards',   value: document.getElementById('settAuthCards')?.value   },
    { key: 'auth_max_api',     value: document.getElementById('settAuthApi')?.value     },
    { key: 'member_max_cards', value: document.getElementById('settMemberCards')?.value },
    { key: 'member_max_api',   value: document.getElementById('settMemberApi')?.value  }
  ];

  const statusEl = document.getElementById('settingsSaveStatus');
  if (statusEl) statusEl.textContent = 'Saving...';

  try {
    // Upsert each setting (key is the unique column)
    for (const { key, value } of pairs) {
      const { error } = await window.supabaseClient
        .from('system_settings')
        .upsert({ key, value: String(parseInt(value) || 0) }, { onConflict: 'key' });
      if (error) throw error;
    }

    // Reload into memory so changes take effect immediately
    await loadSystemSettings();

    await logAdminAction('update_settings', null, '', pairs.map(p => `${p.key}:${p.value}`).join(','));
    if (statusEl) statusEl.textContent = 'Saved!';
    showToast('System settings saved', '✅');
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
  } catch (err) {
    console.error('Save settings error:', err);
    // Detect missing table and show helpful SQL instructions
    const isMissing = err?.message?.includes('system_settings') || err?.code === '42P01';
    if (isMissing) {
      if (statusEl) statusEl.innerHTML = '';
      showSystemSettingsSetupModal();
    } else {
      if (statusEl) statusEl.textContent = 'Failed to save — check console';
      showToast('Failed to save settings', '❌');
    }
  }
}

// Show modal with SQL instructions to create the system_settings table
function showSystemSettingsSetupModal() {
  document.getElementById('sysSettSetupModal')?.remove();
  const sql = `CREATE TABLE system_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Admins can read/write, everyone else can read
CREATE POLICY "Anyone can read settings"
  ON system_settings FOR SELECT USING (true);

CREATE POLICY "Admins can write settings"
  ON system_settings FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );`;

  const html = `
    <div class="modal active" id="sysSettSetupModal" style="z-index:10003;">
      <div class="modal-backdrop" id="sysSettSetupBackdrop"></div>
      <div class="modal-content" style="max-width:560px;">
        <div class="modal-header">
          <h2>⚙️ Table Setup Required</h2>
          <button class="modal-close" id="sysSettSetupClose">×</button>
        </div>
        <div class="modal-body" style="padding:20px;">
          <p style="margin:0 0 12px;color:#374151;">
            The <strong>system_settings</strong> table doesn't exist in Supabase yet.
            Run this SQL in your Supabase dashboard → SQL Editor:
          </p>
          <pre id="sysSettSQL" style="background:#1e293b;color:#e2e8f0;padding:14px;border-radius:8px;font-size:12px;overflow-x:auto;white-space:pre;cursor:pointer;"
               title="Click to copy">${sql.replace(/</g,'&lt;')}</pre>
          <button id="copySysSettSQL" style="margin-top:8px;padding:6px 14px;font-size:12px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;background:#fff;">
            📋 Copy SQL
          </button>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" id="sysSettSetupDone">Done</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const close = () => document.getElementById('sysSettSetupModal')?.remove();
  document.getElementById('sysSettSetupClose')?.addEventListener('click', close);
  document.getElementById('sysSettSetupBackdrop')?.addEventListener('click', close);
  document.getElementById('sysSettSetupDone')?.addEventListener('click', close);
  document.getElementById('copySysSettSQL')?.addEventListener('click', () => {
    navigator.clipboard.writeText(sql).then(() => showToast('SQL copied to clipboard', '📋'));
  });
  document.getElementById('sysSettSQL')?.addEventListener('click', () => {
    navigator.clipboard.writeText(sql).then(() => showToast('SQL copied to clipboard', '📋'));
  });
}

// Wire save buttons via event delegation
document.addEventListener('click', (e) => {
  if (e.target.closest('#saveSystemSettings')) {
    saveSystemSettings();
  }
  if (e.target.closest('#saveEbaySettings')) {
    if (typeof window.saveEbayExportSettings === 'function') window.saveEbayExportSettings();
  }
});

// ── Themes Tab ────────────────────────────────────────────────────────────────

function renderThemesTab() {
  return `
    <div id="adminThemesTab" style="padding:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div>
          <div style="font-weight:700;font-size:15px;color:#111827;">Themes</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">
            Create layouts users can apply. Members can also make personal themes.
          </div>
        </div>
        <button id="adminCreateThemeBtn" class="btn-tag-add" style="padding:8px 16px;font-size:13px;white-space:nowrap;">
          + New Theme
        </button>
      </div>
      <div id="adminThemesList">
        <p style="text-align:center;color:#9ca3af;padding:24px;">Loading themes...</p>
      </div>
    </div>`;
}

async function loadAdminThemesList() {
  const el = document.getElementById('adminThemesList');
  if (!el) return;

  try {
    const { data: themes, error } = await window.supabaseClient
      .from('themes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!themes || themes.length === 0) {
      el.innerHTML = `<p style="text-align:center;color:#9ca3af;padding:32px;">No themes yet. Create your first one!</p>`;
      return;
    }

    el.innerHTML = themes.map(theme => `
      <div class="admin-theme-row" data-theme-id="${escapeHtml(theme.id)}" style="
        display:flex;align-items:flex-start;gap:12px;padding:12px 14px;
        background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin-bottom:8px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-weight:700;font-size:14px;color:#111827;">${escapeHtml(theme.name)}</span>
            <span class="status-badge ${theme.is_public ? 'success' : 'regular'}" style="font-size:11px;">
              ${theme.is_public ? '🌐 Published' : '🔒 Draft'}
            </span>
          </div>
          ${theme.description ? `<div style="font-size:12px;color:#6b7280;margin-top:3px;">${escapeHtml(theme.description)}</div>` : ''}
          <div style="font-size:11px;color:#9ca3af;margin-top:4px;">
            Created ${new Date(theme.created_at).toLocaleDateString()}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">
          <button class="btn-icon admin-theme-edit-btn" data-theme-id="${escapeHtml(theme.id)}" title="Edit theme">✏️</button>
          <button class="btn-icon admin-theme-toggle-btn" data-theme-id="${escapeHtml(theme.id)}"
                  data-is-public="${theme.is_public}" title="${theme.is_public ? 'Unpublish' : 'Publish'}">
            ${theme.is_public ? '🔒 Unpublish' : '🌐 Publish'}
          </button>
          <button class="btn-icon admin-theme-delete-btn" data-theme-id="${escapeHtml(theme.id)}" title="Delete theme"
                  style="color:#ef4444;">🗑️</button>
        </div>
      </div>`).join('');

  } catch (err) {
    el.innerHTML = `<p style="text-align:center;color:#ef4444;padding:24px;">Failed to load themes: ${escapeHtml(err.message)}</p>`;
  }
}

// Event delegation for theme buttons
document.addEventListener('click', async (e) => {
  // Create new theme
  if (e.target.closest('#adminCreateThemeBtn')) {
    const defaultCfg = typeof defaultThemeConfig === 'function' ? defaultThemeConfig() : {};
    defaultCfg._name = '';
    defaultCfg._description = '';
    defaultCfg._isPublic = false;
    if (typeof window.openThemeEditor === 'function') {
      window.openThemeEditor(defaultCfg, true, async (config) => {
        await window.adminSaveTheme(config);
        loadAdminThemesList();
      });
    }
    return;
  }

  // Edit existing theme
  const editBtn = e.target.closest('.admin-theme-edit-btn');
  if (editBtn) {
    const themeId = editBtn.dataset.themeId;
    const { data: theme } = await window.supabaseClient.from('themes').select('*').eq('id', themeId).single();
    if (theme) {
      const editCfg = { ...theme.config, _name: theme.name, _description: theme.description, _isPublic: theme.is_public };
      if (typeof window.openThemeEditor === 'function') {
        window.openThemeEditor(editCfg, true, async (config) => {
          await window.adminSaveTheme(config, themeId);
          loadAdminThemesList();
        });
      }
    }
    return;
  }

  // Toggle publish/unpublish
  const toggleBtn = e.target.closest('.admin-theme-toggle-btn');
  if (toggleBtn) {
    const themeId   = toggleBtn.dataset.themeId;
    const isPublic  = toggleBtn.dataset.isPublic === 'true';
    const { error } = await window.supabaseClient
      .from('themes').update({ is_public: !isPublic }).eq('id', themeId);
    if (!error) {
      showToast(isPublic ? 'Theme unpublished' : 'Theme published', '🌐');
      loadAdminThemesList();
    }
    return;
  }

  // Delete theme
  const deleteBtn = e.target.closest('.admin-theme-delete-btn');
  if (deleteBtn) {
    const themeId = deleteBtn.dataset.themeId;
    if (typeof window.adminDeleteTheme === 'function') {
      const ok = await window.adminDeleteTheme(themeId);
      if (ok) loadAdminThemesList();
    }
    return;
  }
});

// Auto-load themes list when tab is clicked
// ── Activity Log Tab ──────────────────────────────────────────────────────────
// Shows admin_actions from Supabase in a readable timeline format

function renderActivityTab(users) {
  return `
    <div id="activityTabContent" style="padding:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="font-size:13px;color:#6b7280;">Recent admin actions and user activity</div>
        <button onclick="loadActivityLog()" class="btn-tag-add" style="font-size:12px;padding:6px 12px;">
          🔄 Refresh
        </button>
      </div>
      <div id="activityLogList">
        <p style="text-align:center;color:#9ca3af;padding:32px 0;">Loading activity log...</p>
      </div>
    </div>`;
}

window.loadActivityLog = async function() {
  const el = document.getElementById('activityLogList');
  if (!el) return;
  el.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:24px;">Loading...</p>';

  try {
    const { data: actions, error: actErr } = await window.supabaseClient
      .from('admin_actions')
      .select('*, admin:admin_id(name,email), target:target_user_id(name,email)')
      .order('created_at', { ascending: false })
      .limit(100);

    const { data: apiLogs, error: logErr } = await window.supabaseClient
      .from('api_call_logs')
      .select('*, user:user_id(name,email)')
      .order('created_at', { ascending: false })
      .limit(50);

    // Merge and sort by timestamp
    const allEvents = [
      ...(actions || []).map(a => ({
        type:      'admin',
        icon:      '👑',
        label:     formatAdminAction(a),
        actor:     a.admin?.name || a.admin?.email || 'Admin',
        timestamp: a.created_at
      })),
      ...(apiLogs || []).map(l => ({
        type:      'api',
        icon:      l.success ? '✅' : '❌',
        label:     `${l.call_type || 'API call'} — ${l.cards_processed || 0} card(s)${l.cost ? ` ($${Number(l.cost).toFixed(4)})` : ''}`,
        actor:     l.user?.name || l.user?.email || 'Unknown user',
        timestamp: l.created_at
      }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 100);

    if (allEvents.length === 0) {
      el.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:32px;">No activity yet</p>';
      return;
    }

    el.innerHTML = allEvents.map(ev => {
      const date = new Date(ev.timestamp);
      const dateStr = date.toLocaleDateString('en-US', { month:'short', day:'numeric' });
      const timeStr = date.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
      return `
        <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #f3f4f6;align-items:flex-start;">
          <span style="font-size:18px;line-height:1.4;">${ev.icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:500;color:#111827;">${escapeHtml(ev.label)}</div>
            <div style="font-size:12px;color:#9ca3af;margin-top:2px;">${escapeHtml(ev.actor)}</div>
          </div>
          <div style="font-size:11px;color:#9ca3af;white-space:nowrap;text-align:right;">
            <div>${dateStr}</div>
            <div>${timeStr}</div>
          </div>
        </div>`;
    }).join('');

  } catch (err) {
    el.innerHTML = `<p style="text-align:center;color:#ef4444;padding:24px;">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
};

function formatAdminAction(a) {
  const target = a.target?.name || a.target?.email || a.target_user_id || 'user';
  switch (a.action_type) {
    case 'update_card_limit':    return `Updated card limit for ${target}: ${a.old_value} → ${a.new_value}`;
    case 'update_api_limit':     return `Updated API limit for ${target}: ${a.old_value} → ${a.new_value}`;
    case 'reset_api_calls':      return `Reset API calls for ${target}`;
    case 'toggle_admin':         return `${a.new_value === 'true' ? 'Granted' : 'Revoked'} admin for ${target}`;
    case 'assign_template':      return `Assigned template to ${target}`;
    case 'unassign_template':    return `Removed template from ${target}`;
    default:                     return `${a.action_type || 'Action'} on ${target}`;
  }
}

// Auto-load activity log and themes when their tabs are clicked
const _origShowAdminTab = window.showAdminTab;
window.showAdminTab = function(tab, btn) {
  if (typeof _origShowAdminTab === 'function') _origShowAdminTab(tab, btn);
  if (tab === 'activity') {
    setTimeout(loadActivityLog, 50);
  }
  if (tab === 'themes') {
    setTimeout(loadAdminThemesList, 50);
  }
  if (tab === 'settings') {
    // Re-render with freshest values (in case another admin updated)
    loadSystemSettings().then(() => {
      const el = document.getElementById('tab-settings');
      if (el) el.innerHTML = renderSettingsTab();
    });
  }
  if (tab === 'features') {
    setTimeout(loadAdminFeaturesTab, 50);
  }
};

// ── Features Tab ──────────────────────────────────────────────────────────────
// Admin can toggle magical features on/off per role or per individual user.

function renderFeaturesTab() {
  return `
    <div id="featuresTabContent" style="padding:16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;font-size:15px;color:#111827;">✨ Feature Flags</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">
            Control which magical features are available to each user tier.
            Per-user overrides take priority over role defaults.
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="font-size:11px;color:#9ca3af;">Roles:</span>
          <span style="font-size:11px;background:#f3f4f6;padding:2px 7px;border-radius:4px;">👤 Guest</span>
          <span style="font-size:11px;background:#dbeafe;padding:2px 7px;border-radius:4px;color:#1d4ed8;">🔐 Auth</span>
          <span style="font-size:11px;background:#fef3c7;padding:2px 7px;border-radius:4px;color:#92400e;">⭐ Member</span>
          <span style="font-size:11px;background:#ede9fe;padding:2px 7px;border-radius:4px;color:#5b21b6;">👑 Admin</span>
        </div>
      </div>
      <div id="adminFlagsList">
        <p style="text-align:center;color:#9ca3af;padding:32px 0;">Loading feature flags...</p>
      </div>

      <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px;">
        <div style="font-weight:700;font-size:14px;color:#111827;margin-bottom:8px;">Per-User Overrides</div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:12px;">
          Grant or revoke specific features for individual users, overriding their role defaults.
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
          <select id="overrideUserSelect" style="flex:1;min-width:180px;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;">
            <option value="">Select a user...</option>
            ${(window.adminData?.users || []).map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name || u.email || u.id)}</option>`).join('')}
          </select>
          <select id="overrideFeatureSelect" style="flex:1;min-width:180px;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;">
            <option value="">Select a feature...</option>
            ${(typeof getAllFeatureFlags === 'function' ? getAllFeatureFlags() : []).map(f => `<option value="${escapeHtml(f.feature_key)}">${escapeHtml(f.display_name || f.feature_key)}</option>`).join('')}
          </select>
          <button id="overrideGrantBtn"  class="btn btn-primary"   style="padding:8px 16px;font-size:13px;white-space:nowrap;">✅ Grant</button>
          <button id="overrideRevokeBtn" class="btn btn-secondary" style="padding:8px 16px;font-size:13px;white-space:nowrap;">🚫 Revoke</button>
          <button id="overrideClearBtn"  class="btn btn-secondary" style="padding:8px 16px;font-size:13px;white-space:nowrap;">↩ Reset</button>
        </div>
        <div id="overridesList" style="font-size:13px;color:#6b7280;">
          <p style="padding:8px 0;color:#9ca3af;">Select a user above to see their overrides.</p>
        </div>
      </div>

      <div style="margin-top:16px;">
        <div style="font-size:11px;color:#9ca3af;background:#f9fafb;border-radius:8px;padding:12px;">
          <strong>Database tables required:</strong> <code>feature_flags</code> and <code>user_feature_overrides</code><br>
          See feature-flags.js for SQL schema. Without these tables, hardcoded defaults are used.
        </div>
      </div>
    </div>`;
}

async function loadAdminFeaturesTab() {
  const el = document.getElementById('adminFlagsList');
  if (!el) return;

  // Load current flags (refreshes cache from DB)
  if (typeof loadFeatureFlags === 'function') {
    await loadFeatureFlags();
  }

  const flags = (typeof getAllFeatureFlags === 'function') ? getAllFeatureFlags() : [];

  if (flags.length === 0) {
    el.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:24px;">No feature flags defined.</p>';
    return;
  }

  el.innerHTML = flags.map(flag => renderFlagRow(flag)).join('');

  // Wire override buttons
  document.getElementById('overrideGrantBtn')?.addEventListener('click',  () => applyUserOverride(true));
  document.getElementById('overrideRevokeBtn')?.addEventListener('click', () => applyUserOverride(false));
  document.getElementById('overrideClearBtn')?.addEventListener('click',  () => applyUserOverride(null));
  document.getElementById('overrideUserSelect')?.addEventListener('change', loadUserOverrides);
}

function renderFlagRow(flag) {
  const roleToggle = (id, label, checked, roleKey) => `
    <div style="display:flex;align-items:center;gap:6px;">
      <label class="feature-toggle" title="${label}">
        <input type="checkbox" class="feature-role-toggle"
               data-key="${escapeHtml(flag.feature_key)}"
               data-role="${roleKey}"
               ${checked ? 'checked' : ''}
               style="width:14px;height:14px;cursor:pointer;">
        <span style="font-size:12px;">${label}</span>
      </label>
    </div>`;

  return `
    <div class="feature-flag-row" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin-bottom:10px;">
      <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div style="font-size:24px;line-height:1;">${escapeHtml(flag.icon || '✨')}</div>
        <div style="flex:1;min-width:200px;">
          <div style="font-weight:700;font-size:14px;color:#111827;">${escapeHtml(flag.display_name || flag.feature_key)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(flag.description || '')}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;min-width:220px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <label class="feature-toggle" title="Enable for everyone (overrides all role settings)">
              <input type="checkbox" class="feature-global-toggle"
                     data-key="${escapeHtml(flag.feature_key)}"
                     ${flag.enabled_globally ? 'checked' : ''}
                     style="width:14px;height:14px;cursor:pointer;">
              <span style="font-size:12px;font-weight:600;color:#374151;">🌐 Enable globally</span>
            </label>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;opacity:${flag.enabled_globally ? '0.4' : '1'};" id="role-toggles-${escapeHtml(flag.feature_key)}">
            ${roleToggle('', '👤 Guest',   flag.enabled_for_guest,         'enabled_for_guest')}
            ${roleToggle('', '🔐 Auth',    flag.enabled_for_authenticated,  'enabled_for_authenticated')}
            ${roleToggle('', '⭐ Member',  flag.enabled_for_member,         'enabled_for_member')}
            ${roleToggle('', '👑 Admin',   flag.enabled_for_admin,          'enabled_for_admin')}
          </div>
        </div>
      </div>
    </div>`;
}

// Save flag change when a toggle is clicked
document.addEventListener('change', async (e) => {
  const globalToggle = e.target.closest('.feature-global-toggle');
  const roleToggle   = e.target.closest('.feature-role-toggle');

  if (!globalToggle && !roleToggle) return;

  const featureKey = (globalToggle || roleToggle).dataset.key;
  if (!featureKey || typeof saveFeatureFlag !== 'function') return;

  if (globalToggle) {
    const enabled = globalToggle.checked;
    const ok = await saveFeatureFlag(featureKey, { enabled_globally: enabled });
    if (ok) {
      showToast(enabled ? 'Feature enabled globally' : 'Global enable off', '✅');
      // Dim/undim role toggles
      const roleSection = document.getElementById(`role-toggles-${featureKey}`);
      if (roleSection) roleSection.style.opacity = enabled ? '0.4' : '1';
    } else {
      showToast('Failed to save — check DB table exists', '❌');
      globalToggle.checked = !enabled; // revert
    }
    return;
  }

  if (roleToggle) {
    const roleKey = roleToggle.dataset.role;
    const enabled = roleToggle.checked;
    const ok = await saveFeatureFlag(featureKey, { [roleKey]: enabled });
    if (ok) {
      showToast(`${featureKey}: ${roleKey} ${enabled ? 'enabled' : 'disabled'}`, '✅');
    } else {
      showToast('Failed to save — check DB table exists', '❌');
      roleToggle.checked = !enabled;
    }
  }
});

async function applyUserOverride(enabled) {
  const userId     = document.getElementById('overrideUserSelect')?.value;
  const featureKey = document.getElementById('overrideFeatureSelect')?.value;
  if (!userId || !featureKey) {
    showToast('Select a user and a feature first', '⚠️');
    return;
  }
  if (typeof setUserFeatureOverride !== 'function') {
    showToast('Feature flags module not loaded', '❌');
    return;
  }
  const ok = await setUserFeatureOverride(userId, featureKey, enabled);
  if (ok) {
    const label = enabled === null ? 'Reset to default' : enabled ? 'Feature granted' : 'Feature revoked';
    showToast(label, '✅');
    await logAdminAction('feature_override', userId, '', `${featureKey}:${enabled}`);
    await loadUserOverrides();
  } else {
    showToast('Failed to apply override', '❌');
  }
}

async function loadUserOverrides() {
  const el     = document.getElementById('overridesList');
  const userId = document.getElementById('overrideUserSelect')?.value;
  if (!el || !userId || !window.supabaseClient) return;

  try {
    const { data, error } = await window.supabaseClient
      .from('user_feature_overrides')
      .select('feature_key, enabled')
      .eq('user_id', userId);

    if (error) throw error;

    if (!data || data.length === 0) {
      el.innerHTML = '<p style="color:#9ca3af;padding:6px 0;font-size:12px;">No overrides — using role defaults.</p>';
      return;
    }

    el.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${data.map(o => `
          <span style="font-size:12px;padding:4px 10px;border-radius:20px;
            background:${o.enabled ? '#d1fae5' : '#fee2e2'};
            color:${o.enabled ? '#065f46' : '#991b1b'};">
            ${o.enabled ? '✅' : '🚫'} ${escapeHtml(o.feature_key)}
          </span>`).join('')}
      </div>`;
  } catch (err) {
    el.innerHTML = `<p style="color:#ef4444;font-size:12px;">Failed to load overrides: ${escapeHtml(err.message)}</p>`;
  }
}

// ── Expose to window for lazy-loading ────────────────────────────────────────
window.openAdminDashboard = openAdminDashboard;
window.showAdminTab = showAdminTab;
window.closeAdminDashboard = closeAdminDashboard;
