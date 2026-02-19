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

    const [usersData, logsData, statsData] = await Promise.all([
      fetchAllUsers(),
      fetchRecentLogs(),
      fetchSystemStats()
    ]);

    showLoading(false);
    renderAdminDashboard(usersData, logsData, statsData);

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
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await window.supabaseClient
    .from('system_stats')
    .select('*')
    .eq('date', today)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || await calculateTodayStats();
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
function renderAdminDashboard(users, logs, stats) {
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
        </div>
        <div class="admin-content">
          <div class="admin-tab-content active" id="tab-overview">${renderOverviewTab(stats, users, logs)}</div>
          <div class="admin-tab-content" id="tab-users">${renderUsersTab(users)}</div>
          <div class="admin-tab-content" id="tab-logs">${renderLogsTab(logs)}</div>
          <div class="admin-tab-content" id="tab-stats">${renderStatsTab(stats, logs)}</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper.firstElementChild);
  window.adminData = { users, logs, stats };

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
        <option value="limit">Near Limits</option>
      </select>
    </div>
    <div class="users-table-container">
      <table class="users-table" id="usersTable">
        <thead>
          <tr>
            <th>User</th><th>Email</th><th>Discord</th><th>Cards</th>
            <th>API Calls</th><th>Admin</th><th>Joined</th><th>Actions</th>
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
      <td><span class="status-badge ${user.is_admin ? 'admin' : 'regular'}">${user.is_admin ? 'Admin' : 'User'}</span></td>
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
  const cardLimit = parseInt(document.getElementById('editCardLimit').value);
  const apiLimit  = parseInt(document.getElementById('editApiLimit').value);
  const isAdminVal = document.getElementById('editIsAdmin').checked;

  try {
    const { error } = await window.supabaseClient
      .from('users')
      .update({ card_limit: cardLimit, api_calls_limit: apiLimit, is_admin: isAdminVal })
      .eq('id', userId);

    if (error) throw error;

    await logAdminAction('change_limit', userId, '', `cards:${cardLimit},api:${apiLimit},admin:${isAdminVal}`);
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
    if (filter === 'limit') {
      const nearCard = (user.cards_in_collection || 0) >= (user.card_limit || 1) * 0.9;
      const nearApi  = (user.api_calls_used || 0) >= (user.api_calls_limit || 1) * 0.9;
      if (!nearCard && !nearApi) show = false;
    }

    row.style.display = show ? '' : 'none';
  });
}

// Use event delegation for admin action buttons (edit/logs)
document.addEventListener('click', (e) => {
  const editBtn = e.target.closest('.admin-edit-btn');
  if (editBtn) { editUser(editBtn.dataset.uid); return; }

  const logsBtn = e.target.closest('.admin-logs-btn');
  if (logsBtn) { viewUserLogs(logsBtn.dataset.uid); return; }

  const exportBtn = e.target.closest('#exportLogsBtn');
  if (exportBtn) { exportLogs(); return; }
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
