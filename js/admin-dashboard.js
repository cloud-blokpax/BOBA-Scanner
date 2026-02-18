// Admin Dashboard & User Management

// ==================== ADMIN DASHBOARD ====================

async function openAdminDashboard() {
    if (!isAdmin()) {
        showToast('Access denied', '❌');
        return;
    }
    
    try {
        showLoading(true, 'Loading admin dashboard...');
        
        // Fetch all data
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
    return data;
}

async function fetchRecentLogs(limit = 100) {
    const { data, error } = await window.supabaseClient
        .from('api_call_logs')
        .select(`
            *,
            users(email, name)
        `)
        .order('created_at', { ascending: false })
        .limit(limit);
    
    if (error) throw error;
    return data;
}

async function fetchSystemStats() {
    // Get today's stats
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await window.supabaseClient
        .from('system_stats')
        .select('*')
        .eq('date', today)
        .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    // If no stats for today, calculate them
    if (!data) {
        return await calculateTodayStats();
    }
    
    return data;
}

async function calculateTodayStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Count total users
    const { count: totalUsers } = await window.supabaseClient
        .from('users')
        .select('*', { count: 'exact', head: true });
    
    // Count active users (API calls today)
    const { data: activeCalls } = await window.supabaseClient
        .from('api_call_logs')
        .select('user_id')
        .gte('created_at', today.toISOString());
    
    const activeUsers = new Set(activeCalls?.map(c => c.user_id) || []).size;
    
    // Count total API calls today
    const { count: totalApiCalls } = await window.supabaseClient
        .from('api_call_logs')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today.toISOString());
    
    // Calculate total cost today
    const { data: costData } = await window.supabaseClient
        .from('api_call_logs')
        .select('cost')
        .gte('created_at', today.toISOString());
    
    const totalCost = costData?.reduce((sum, c) => sum + parseFloat(c.cost || 0), 0) || 0;
    
    return {
        total_users: totalUsers,
        active_users: activeUsers,
        total_api_calls: totalApiCalls,
        total_cost: totalCost
    };
}

function renderAdminDashboard(users, logs, stats) {
    const modal = `
        <div class="modal active" id="adminDashboard">
            <div class="modal-content admin-dashboard-content">
                <div class="modal-header">
                    <div class="modal-title">👑 Admin Dashboard</div>
                    <div class="modal-close" onclick="closeAdminDashboard()">×</div>
                </div>
                
                <div class="admin-tabs">
                    <button class="admin-tab active" onclick="showAdminTab('overview')">
                        Overview
                    </button>
                    <button class="admin-tab" onclick="showAdminTab('users')">
                        Users (${users.length})
                    </button>
                    <button class="admin-tab" onclick="showAdminTab('logs')">
                        API Logs
                    </button>
                    <button class="admin-tab" onclick="showAdminTab('stats')">
                        Statistics
                    </button>
                </div>
                
                <div class="admin-content">
                    <!-- Overview Tab -->
                    <div class="admin-tab-content active" id="tab-overview">
                        ${renderOverviewTab(stats, users, logs)}
                    </div>
                    
                    <!-- Users Tab -->
                    <div class="admin-tab-content" id="tab-users">
                        ${renderUsersTab(users)}
                    </div>
                    
                    <!-- Logs Tab -->
                    <div class="admin-tab-content" id="tab-logs">
                        ${renderLogsTab(logs)}
                    </div>
                    
                    <!-- Stats Tab -->
                    <div class="admin-tab-content" id="tab-stats">
                        ${renderStatsTab(stats, logs)}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modal);
    
    // Store data globally for tab switching
    window.adminData = { users, logs, stats };
}

function renderOverviewTab(stats, users, logs) {
    const recentUsers = users.slice(0, 5);
    const recentErrors = logs.filter(l => !l.success).slice(0, 5);
    
    return `
        <div class="overview-grid">
            <div class="overview-stat">
                <div class="stat-icon">👥</div>
                <div class="stat-value">${stats.total_users}</div>
                <div class="stat-label">Total Users</div>
            </div>
            
            <div class="overview-stat">
                <div class="stat-icon">✅</div>
                <div class="stat-value">${stats.active_users}</div>
                <div class="stat-label">Active Today</div>
            </div>
            
            <div class="overview-stat">
                <div class="stat-icon">🤖</div>
                <div class="stat-value">${stats.total_api_calls}</div>
                <div class="stat-label">API Calls Today</div>
            </div>
            
            <div class="overview-stat">
                <div class="stat-icon">💰</div>
                <div class="stat-value">$${stats.total_cost.toFixed(2)}</div>
                <div class="stat-label">Cost Today</div>
            </div>
        </div>
        
        <div class="overview-section">
            <h4>Recent Users</h4>
            <div class="recent-users-list">
                ${recentUsers.map(u => `
                    <div class="recent-user-item">
                        <img src="${u.picture}" alt="${u.name}">
                        <div class="user-info">
                            <strong>${u.name}</strong>
                            <small>${u.email}</small>
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
                            <div class="error-user">${e.users?.email || 'Unknown'}</div>
                            <div class="error-message">${e.error_message || 'No message'}</div>
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
            <input type="text" id="userSearch" placeholder="Search users..." 
                   onkeyup="filterUsers(this.value)">
            <select id="userFilter" onchange="filterUsers()">
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
                        <th>User</th>
                        <th>Email</th>
                        <th>Discord</th>
                        <th>Cards</th>
                        <th>API Calls</th>
                        <th>Admin</th>
                        <th>Joined</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map(u => renderUserRow(u)).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderUserRow(user) {
    const cardsPercent = (user.cards_in_collection / user.card_limit) * 100;
    const apiPercent = (user.api_calls_used / user.api_calls_limit) * 100;
    
    return `
        <tr class="user-row ${user.is_admin ? 'admin-user' : ''}" data-user-id="${user.id}">
            <td>
                <div class="user-cell">
                    <img src="${user.picture}" alt="${user.name}" class="user-avatar-small">
                    <span>${user.name}</span>
                </div>
            </td>
            <td>${user.email}</td>
            <td>${user.discord_id || '-'}</td>
            <td>
                <div class="limit-cell">
                    ${user.cards_in_collection} / ${user.card_limit}
                    <div class="mini-bar">
                        <div class="mini-fill" style="width: ${cardsPercent}%"></div>
                    </div>
                </div>
            </td>
            <td>
                <div class="limit-cell">
                    ${user.api_calls_used} / ${user.api_calls_limit}
                    <div class="mini-bar">
                        <div class="mini-fill" style="width: ${apiPercent}%"></div>
                    </div>
                </div>
            </td>
            <td>
                <span class="status-badge ${user.is_admin ? 'admin' : 'regular'}">
                    ${user.is_admin ? 'Admin' : 'User'}
                </span>
            </td>
            <td>${new Date(user.created_at).toLocaleDateString()}</td>
            <td>
                <button class="btn-icon" onclick="editUser('${user.id}')" title="Edit">
                    ✏️
                </button>
                <button class="btn-icon" onclick="viewUserLogs('${user.id}')" title="Logs">
                    📊
                </button>
            </td>
        </tr>
    `;
}

function renderLogsTab(logs) {
    return `
        <div class="logs-controls">
            <select id="logFilter" onchange="filterLogs()">
                <option value="all">All Logs</option>
                <option value="success">Successful Only</option>
                <option value="failed">Failed Only</option>
                <option value="today">Today</option>
            </select>
            <button class="btn btn-secondary btn-sm" onclick="exportLogs()">
                📥 Export Logs
            </button>
        </div>
        
        <div class="logs-table-container">
            <table class="logs-table">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>User</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Cards</th>
                        <th>Cost</th>
                        <th>Error</th>
                    </tr>
                </thead>
                <tbody id="logsTableBody">
                    ${logs.map(log => renderLogRow(log)).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderLogRow(log) {
    return `
        <tr class="${log.success ? 'log-success' : 'log-failed'}">
            <td>${new Date(log.created_at).toLocaleString()}</td>
            <td>${log.users?.email || 'Unknown'}</td>
            <td>${log.call_type}</td>
            <td>
                <span class="status-badge ${log.success ? 'success' : 'failed'}">
                    ${log.success ? '✅' : '❌'}
                </span>
            </td>
            <td>${log.cards_processed}</td>
            <td>$${parseFloat(log.cost || 0).toFixed(4)}</td>
            <td>${log.error_message || '-'}</td>
        </tr>
    `;
}

function renderStatsTab(stats, logs) {
    // Calculate stats
    const successRate = logs.length > 0 
        ? ((logs.filter(l => l.success).length / logs.length) * 100).toFixed(1)
        : 0;
    
    const avgCost = logs.length > 0
        ? (logs.reduce((sum, l) => sum + parseFloat(l.cost || 0), 0) / logs.length).toFixed(4)
        : 0;
    
    // Group logs by date
    const logsByDate = {};
    logs.forEach(log => {
        const date = new Date(log.created_at).toLocaleDateString();
        logsByDate[date] = (logsByDate[date] || 0) + 1;
    });
    
    return `
        <div class="stats-grid">
            <div class="stat-card">
                <h4>Success Rate</h4>
                <div class="stat-big">${successRate}%</div>
                <div class="stat-detail">
                    ${logs.filter(l => l.success).length} / ${logs.length} calls
                </div>
            </div>
            
            <div class="stat-card">
                <h4>Average Cost</h4>
                <div class="stat-big">$${avgCost}</div>
                <div class="stat-detail">Per API call</div>
            </div>
            
            <div class="stat-card">
                <h4>Total Cost (30d)</h4>
                <div class="stat-big">$${logs.reduce((sum, l) => sum + parseFloat(l.cost || 0), 0).toFixed(2)}</div>
                <div class="stat-detail">Last 30 days</div>
            </div>
            
            <div class="stat-card">
                <h4>Active Users</h4>
                <div class="stat-big">${new Set(logs.map(l => l.user_id)).size}</div>
                <div class="stat-detail">Made API calls</div>
            </div>
        </div>
        
        <div class="chart-section">
            <h4>API Calls by Date</h4>
            <div class="simple-chart">
                ${Object.entries(logsByDate).slice(-7).map(([date, count]) => `
                    <div class="chart-bar">
                        <div class="bar-fill" style="height: ${(count / Math.max(...Object.values(logsByDate))) * 100}%"></div>
                        <div class="bar-label">${date.split('/')[1]}/${date.split('/')[0]}</div>
                        <div class="bar-value">${count}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// ==================== ADMIN ACTIONS ====================

async function editUser(userId) {
    const user = window.adminData.users.find(u => u.id === userId);
    if (!user) return;
    
    const modal = `
        <div class="modal active" id="editUserModal">
            <div class="modal-content">
                <div class="modal-header">
                    <div class="modal-title">✏️ Edit User: ${user.name}</div>
                    <div class="modal-close" onclick="closeEditUserModal()">×</div>
                </div>
                
                <div class="edit-user-content">
                    <div class="form-group">
                        <label>Card Limit</label>
                        <input type="number" id="editCardLimit" value="${user.card_limit}" min="0">
                    </div>
                    
                    <div class="form-group">
                        <label>API Calls Limit (per month)</label>
                        <input type="number" id="editApiLimit" value="${user.api_calls_limit}" min="0">
                    </div>
                    
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="editIsAdmin" ${user.is_admin ? 'checked' : ''}>
                            Grant Admin Access
                        </label>
                    </div>
                    
                    <div class="form-group">
                        <label>Reset API Calls for This Month</label>
                        <button class="btn btn-secondary" onclick="resetUserApiCalls('${userId}')">
                            Reset to 0
                        </button>
                    </div>
                </div>
                
                <div class="modal-buttons">
                    <button class="btn btn-secondary" onclick="closeEditUserModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="saveUserChanges('${userId}')">
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modal);
}

async function saveUserChanges(userId) {
    const cardLimit = parseInt(document.getElementById('editCardLimit').value);
    const apiLimit = parseInt(document.getElementById('editApiLimit').value);
    const isAdmin = document.getElementById('editIsAdmin').checked;
    
    try {
        const { error } = await window.supabaseClient
            .from('users')
            .update({
                card_limit: cardLimit,
                api_calls_limit: apiLimit,
                is_admin: isAdmin
            })
            .eq('id', userId);
        
        if (error) throw error;
        
        // Log admin action
        await logAdminAction('change_limit', userId, '', `cards:${cardLimit},api:${apiLimit},admin:${isAdmin}`);
        
        showToast('User updated successfully', '✅');
        closeEditUserModal();
        
        // Refresh dashboard
        setTimeout(() => {
            closeAdminDashboard();
            openAdminDashboard();
        }, 500);
        
    } catch (err) {
        console.error('Save user error:', err);
        showToast('Failed to update user', '❌');
    }
}

async function resetUserApiCalls(userId) {
    if (!confirm('Reset this user\'s API calls to 0 for this month?')) {
        return;
    }
    
    try {
        const { error } = await window.supabaseClient
            .from('users')
            .update({ api_calls_used: 0 })
            .eq('id', userId);
        
        if (error) throw error;
        
        await logAdminAction('reset_user', userId, '', 'api_calls_reset');
        
        showToast('API calls reset', '✅');
        
    } catch (err) {
        console.error('Reset error:', err);
        showToast('Failed to reset', '❌');
    }
}

async function viewUserLogs(userId) {
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
        
        const user = window.adminData.users.find(u => u.id === userId);
        
        const modal = `
            <div class="modal active" id="userLogsModal">
                <div class="modal-content">
                    <div class="modal-header">
                        <div class="modal-title">📊 Logs: ${user?.name || 'User'}</div>
                        <div class="modal-close" onclick="closeUserLogsModal()">×</div>
                    </div>
                    
                    <div class="user-logs-content">
                        <table class="logs-table">
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>Type</th>
                                    <th>Status</th>
                                    <th>Cards</th>
                                    <th>Cost</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${logs.map(log => `
                                    <tr class="${log.success ? 'log-success' : 'log-failed'}">
                                        <td>${new Date(log.created_at).toLocaleString()}</td>
                                        <td>${log.call_type}</td>
                                        <td>${log.success ? '✅' : '❌'}</td>
                                        <td>${log.cards_processed}</td>
                                        <td>$${parseFloat(log.cost || 0).toFixed(4)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    
                    <div class="modal-buttons">
                        <button class="btn btn-secondary" onclick="closeUserLogsModal()">Close</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modal);
        
    } catch (err) {
        showLoading(false);
        console.error('View logs error:', err);
        showToast('Failed to load logs', '❌');
    }
}

async function logAdminAction(actionType, targetUserId, oldValue, newValue) {
    try {
        await window.supabaseClient
            .from('admin_actions')
            .insert({
                admin_id: currentUser.id,
                action_type: actionType,
                target_user_id: targetUserId,
                old_value: oldValue,
                new_value: newValue
            });
    } catch (err) {
        console.error('Log admin action error:', err);
    }
}

// ==================== HELPER FUNCTIONS ====================

function showAdminTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.admin-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.admin-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`tab-${tabName}`).classList.add('active');
}

function filterUsers(searchTerm = '') {
    const filter = document.getElementById('userFilter')?.value || 'all';
    const search = searchTerm.toLowerCase();
    
    document.querySelectorAll('.user-row').forEach(row => {
        const userId = row.dataset.userId;
        const user = window.adminData.users.find(u => u.id === userId);
        
        if (!user) return;
        
        // Filter logic
        let show = true;
        
        // Search filter
        if (search) {
            const searchable = `${user.name} ${user.email} ${user.discord_id || ''}`.toLowerCase();
            if (!searchable.includes(search)) {
                show = false;
            }
        }
        
        // Category filter
        if (filter === 'admin' && !user.is_admin) show = false;
        if (filter === 'regular' && user.is_admin) show = false;
        if (filter === 'limit') {
            const nearCardLimit = user.cards_in_collection >= user.card_limit * 0.9;
            const nearApiLimit = user.api_calls_used >= user.api_calls_limit * 0.9;
            if (!nearCardLimit && !nearApiLimit) show = false;
        }
        
        row.style.display = show ? '' : 'none';
    });
}

function closeAdminDashboard() {
    const modal = document.getElementById('adminDashboard');
    if (modal) modal.remove();
}

function closeEditUserModal() {
    const modal = document.getElementById('editUserModal');
    if (modal) modal.remove();
}

function closeUserLogsModal() {
    const modal = document.getElementById('userLogsModal');
    if (modal) modal.remove();
}

async function exportLogs() {
    const logs = window.adminData.logs;
    
    const csv = [
        ['Time', 'User', 'Type', 'Success', 'Cards', 'Cost', 'Error'],
        ...logs.map(log => [
            new Date(log.created_at).toISOString(),
            log.users?.email || '',
            log.call_type,
            log.success ? 'Yes' : 'No',
            log.cards_processed,
            parseFloat(log.cost || 0).toFixed(4),
            log.error_message || ''
        ])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api_logs_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('Logs exported', '✅');
}
