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
          <button class="admin-tab" data-tab="activity">Activity</button>
        </div>
        <div class="admin-content">
          <div class="admin-tab-content active" id="tab-overview">${renderOverviewTab(stats, users, logs)}</div>
          <div class="admin-tab-content" id="tab-users">${renderUsersTab(users)}</div>
          <div class="admin-tab-content" id="tab-logs">${renderLogsTab(logs)}</div>
          <div class="admin-tab-content" id="tab-stats">${renderStatsTab(stats, logs)}</div>
          <div class="admin-tab-content" id="tab-tournaments">${typeof renderTournamentsTab === 'function' ? renderTournamentsTab(tournaments) : ''}</div>
          <div class="admin-tab-content" id="tab-themes">${renderThemesTab()}</div>
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

const MEMBER_CARD_LIMIT = 250;
const MEMBER_API_LIMIT  = 250;

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
        card_limit:      MEMBER_CARD_LIMIT,
        api_calls_limit: MEMBER_API_LIMIT
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
        card_limit:      MEMBER_CARD_LIMIT,
        api_calls_limit: MEMBER_API_LIMIT
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
};
