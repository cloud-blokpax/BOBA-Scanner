<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import { debounce } from '$lib/utils';

	interface UserRow {
		id: string;
		auth_user_id: string;
		email: string;
		name: string | null;
		is_admin: boolean;
		is_pro: boolean;
		is_organizer: boolean;
		pro_until: string | null;
		api_calls_used: number;
		cards_in_collection: number;
		created_at: string;
	}

	// Pro date management
	let proDateUserId = $state<string | null>(null);
	let proDateInput = $state('');

	function openProDatePicker(user: UserRow) {
		proDateUserId = user.auth_user_id;
		// Default to 30 days from now if no existing date
		const defaultDate = user.pro_until
			? new Date(user.pro_until).toISOString().split('T')[0]
			: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
		proDateInput = defaultDate;
	}

	async function setProUntil(userId: string) {
		const until = proDateInput ? new Date(proDateInput + 'T23:59:59Z').toISOString() : null;
		await updateUser(userId, { is_pro: true, pro_until: until });
		proDateUserId = null;
		proDateInput = '';
	}

	async function clearProUntil(userId: string) {
		await updateUser(userId, { is_pro: false, pro_until: null });
		proDateUserId = null;
		proDateInput = '';
	}

	let users = $state<UserRow[]>([]);
	let filteredUsers = $state<UserRow[]>([]);
	let loading = $state(true);
	let searchQuery = $state('');
	let roleFilter = $state<'all' | 'admin' | 'pro' | 'organizer' | 'user'>('all');
	let sortBy = $state<'created_at' | 'api_calls_used' | 'name' | 'cards_in_collection'>('created_at');
	let sortDir = $state<'asc' | 'desc'>('desc');
	let togglingUser = $state<string | null>(null);
	let selectedUsers = $state<Set<string>>(new Set());
	let selectedUserDetail = $state<UserRow | null>(null);
	let bulkAction = $state('');
	let processingBulk = $state(false);

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short', day: 'numeric', year: 'numeric'
		});
	}

	function timeAgo(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime();
		const days = Math.floor(diff / 86400000);
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		if (days < 30) return `${days}d ago`;
		return `${Math.floor(days / 30)}mo ago`;
	}

	const doFilter = debounce(() => {
		let result = [...users];

		// Search
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter(
				(u) => u.email?.toLowerCase().includes(q) || u.name?.toLowerCase().includes(q)
			);
		}

		// Role filter
		if (roleFilter !== 'all') {
			result = result.filter((u) => {
				if (roleFilter === 'admin') return u.is_admin;
				if (roleFilter === 'pro') return u.is_pro;
				if (roleFilter === 'organizer') return u.is_organizer;
				return !u.is_admin && !u.is_pro;
			});
		}

		// Sort
		result.sort((a, b) => {
			let cmp = 0;
			if (sortBy === 'created_at') cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
			else if (sortBy === 'api_calls_used') cmp = (a.api_calls_used || 0) - (b.api_calls_used || 0);
			else if (sortBy === 'cards_in_collection') cmp = (a.cards_in_collection || 0) - (b.cards_in_collection || 0);
			else if (sortBy === 'name') cmp = (a.name || '').localeCompare(b.name || '');
			return sortDir === 'desc' ? -cmp : cmp;
		});

		filteredUsers = result;
	}, 200);

	$effect(() => {
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		searchQuery; roleFilter; sortBy; sortDir;
		doFilter();
	});

	$effect(() => {
		loadUsers();
	});

	async function loadUsers() {
		loading = true;
		try {
			const res = await fetch('/api/admin/users');
			if (!res.ok) throw new Error(`Failed to load users: ${res.status}`);
			const data = await res.json();
			users = data as UserRow[];
			filteredUsers = users;
		} catch {
			showToast('Failed to load users', 'x');
		}
		loading = false;
	}

	async function updateUser(userId: string, updates: Record<string, unknown>) {
		togglingUser = userId;
		try {
			const res = await fetch('/api/admin/users', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ user_id: userId, updates })
			});
			if (!res.ok) throw new Error('Failed to update');
			// Refresh locally
			const user = users.find((u) => u.auth_user_id === userId);
			if (user) Object.assign(user, updates);
			doFilter();
			showToast('User updated', 'check');
		} catch {
			showToast('Failed to update user', 'x');
		}
		togglingUser = null;
	}

	function toggleSelect(userId: string) {
		const next = new Set(selectedUsers);
		if (next.has(userId)) next.delete(userId);
		else next.add(userId);
		selectedUsers = next;
	}

	function toggleSelectAll() {
		if (selectedUsers.size === filteredUsers.length) {
			selectedUsers = new Set();
		} else {
			selectedUsers = new Set(filteredUsers.map((u) => u.auth_user_id));
		}
	}

	async function executeBulkAction() {
		if (!bulkAction || selectedUsers.size === 0) return;
		processingBulk = true;
		try {
			const userIds = [...selectedUsers];
			let updates: Record<string, boolean> = {};
			if (bulkAction === 'grant-pro') updates = { is_pro: true };
			else if (bulkAction === 'revoke-pro') updates = { is_pro: false };
			else if (bulkAction === 'grant-organizer') updates = { is_organizer: true };
			else if (bulkAction === 'revoke-organizer') updates = { is_organizer: false };

			const res = await fetch('/api/admin/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'update_role', user_ids: userIds, updates })
			});
			if (!res.ok) throw new Error('Bulk update failed');
			showToast(`Updated ${userIds.length} users`, 'check');
			selectedUsers = new Set();
			bulkAction = '';
			await loadUsers();
		} catch {
			showToast('Bulk action failed', 'x');
		}
		processingBulk = false;
	}

	function setSort(col: typeof sortBy) {
		if (sortBy === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else { sortBy = col; sortDir = 'desc'; }
	}
</script>

<div class="users-tab">
	{#if loading}
		<div class="loading">Loading users...</div>
	{:else}
		<!-- Search & Filters -->
		<div class="filters-row">
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search users..."
				class="search-input"
			/>
			<select bind:value={roleFilter} class="filter-select">
				<option value="all">All Roles</option>
				<option value="admin">Admins</option>
				<option value="pro">Pro</option>
				<option value="organizer">Organizers</option>
				<option value="user">Free Users</option>
			</select>
		</div>

		<!-- Bulk Actions -->
		{#if selectedUsers.size > 0}
			<div class="bulk-bar">
				<span class="bulk-count">{selectedUsers.size} selected</span>
				<select bind:value={bulkAction} class="bulk-select">
					<option value="">Bulk action...</option>
					<option value="grant-pro">Grant Pro</option>
					<option value="revoke-pro">Revoke Pro</option>
					<option value="grant-organizer">Grant Organizer</option>
					<option value="revoke-organizer">Revoke Organizer</option>
				</select>
				<button class="bulk-btn" onclick={executeBulkAction} disabled={!bulkAction || processingBulk}>
					{processingBulk ? 'Processing...' : 'Apply'}
				</button>
				<button class="bulk-clear" onclick={() => { selectedUsers = new Set(); }}>Clear</button>
			</div>
		{/if}

		<!-- User Table -->
		<div class="table-wrapper">
			<table>
				<thead>
					<tr>
						<th class="th-check">
							<input
								type="checkbox"
								checked={selectedUsers.size === filteredUsers.length && filteredUsers.length > 0}
								onchange={toggleSelectAll}
							/>
						</th>
						<th class="sortable" onclick={() => setSort('name')}>
							Name {sortBy === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
						</th>
						<th>Email</th>
						<th>Role</th>
						<th class="sortable" onclick={() => setSort('api_calls_used')}>
							API Calls {sortBy === 'api_calls_used' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
						</th>
						<th class="sortable" onclick={() => setSort('cards_in_collection')}>
							Cards {sortBy === 'cards_in_collection' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
						</th>
						<th class="sortable" onclick={() => setSort('created_at')}>
							Joined {sortBy === 'created_at' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
						</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredUsers as user}
						<tr
							class:selected={selectedUsers.has(user.auth_user_id)}
							class:detail-active={selectedUserDetail?.auth_user_id === user.auth_user_id}
						>
							<td>
								<input
									type="checkbox"
									checked={selectedUsers.has(user.auth_user_id)}
									onchange={() => toggleSelect(user.auth_user_id)}
								/>
							</td>
							<td>
								<button class="name-btn" onclick={() => selectedUserDetail = selectedUserDetail?.auth_user_id === user.auth_user_id ? null : user}>
									{user.name || '—'}
								</button>
							</td>
							<td class="email-cell">{user.email}</td>
							<td>
								{#if user.is_admin}
									<span class="badge admin">Admin</span>
								{:else if user.is_pro}
									<span class="badge pro">Pro</span>
								{:else}
									<span class="badge">User</span>
								{/if}
								{#if user.is_organizer}
									<span class="badge organizer">Org</span>
								{/if}
							</td>
							<td>{user.api_calls_used || 0}</td>
							<td>{user.cards_in_collection || 0}</td>
							<td class="date-cell">{timeAgo(user.created_at)}</td>
							<td class="actions-cell">
								<button
									class="action-btn"
									class:active={user.is_pro}
									onclick={() => {
										if (user.is_pro) {
											clearProUntil(user.auth_user_id);
										} else {
											openProDatePicker(user);
										}
									}}
									disabled={togglingUser === user.auth_user_id}
									title={user.is_pro ? 'Revoke Pro' : 'Grant Pro'}
								>
									{user.is_pro ? 'Pro' : '+Pro'}
								</button>
								{#if proDateUserId === user.auth_user_id}
									<div class="pro-date-picker">
										<input type="date" bind:value={proDateInput} class="date-input" />
										<button class="date-confirm" onclick={() => setProUntil(user.auth_user_id)}>Set</button>
										<button class="date-cancel" onclick={() => { proDateUserId = null; }}>×</button>
									</div>
								{/if}
								<button
									class="action-btn"
									class:active={user.is_organizer}
									onclick={() => updateUser(user.auth_user_id, { is_organizer: !user.is_organizer })}
									disabled={togglingUser === user.auth_user_id}
									title={user.is_organizer ? 'Remove Organizer' : 'Make Organizer'}
								>
									{user.is_organizer ? 'Org' : '+Org'}
								</button>
							</td>
						</tr>

						<!-- User Detail Panel -->
						{#if selectedUserDetail?.auth_user_id === user.auth_user_id}
							<tr class="detail-row">
								<td colspan="8">
									<div class="detail-panel">
										<div class="detail-grid">
											<div class="detail-item">
												<span class="detail-label">Email</span>
												<span class="detail-value">{user.email}</span>
											</div>
											<div class="detail-item">
												<span class="detail-label">Name</span>
												<span class="detail-value">{user.name || '—'}</span>
											</div>
											<div class="detail-item">
												<span class="detail-label">User ID</span>
												<span class="detail-value mono">{user.auth_user_id}</span>
											</div>
											<div class="detail-item">
												<span class="detail-label">API Calls Used</span>
												<span class="detail-value">{user.api_calls_used || 0}</span>
											</div>
											<div class="detail-item">
												<span class="detail-label">Collection Size</span>
												<span class="detail-value">{user.cards_in_collection || 0} cards</span>
											</div>
											<div class="detail-item">
												<span class="detail-label">Joined</span>
												<span class="detail-value">{formatDate(user.created_at)}</span>
											</div>
											<div class="detail-item">
												<span class="detail-label">Admin</span>
												<span class="detail-value">{user.is_admin ? 'Yes' : 'No'}</span>
											</div>
											<div class="detail-item">
												<span class="detail-label">Pro</span>
												<span class="detail-value">
													{#if user.is_pro && user.pro_until}
														Until {new Date(user.pro_until).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
													{:else if user.is_pro}
														Yes (no expiry)
													{:else}
														No
													{/if}
												</span>
											</div>
										</div>
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>

		<div class="table-footer">
			Showing {filteredUsers.length} of {users.length} users
		</div>
	{/if}
</div>

<style>
	.users-tab {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.loading {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}

	/* Filters */
	.filters-row {
		display: flex;
		gap: 0.5rem;
	}

	.search-input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.85rem;
	}

	.filter-select {
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.85rem;
	}

	/* Bulk Actions */
	.bulk-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.3);
	}

	.bulk-count {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--gold);
	}

	.bulk-select {
		padding: 0.375rem 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.8rem;
	}

	.bulk-btn {
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--gold);
		background: transparent;
		color: var(--gold);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}

	.bulk-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.bulk-clear {
		padding: 0.375rem 0.5rem;
		border-radius: 6px;
		border: none;
		background: none;
		color: var(--text-tertiary);
		font-size: 0.8rem;
		cursor: pointer;
	}

	/* Table */
	.table-wrapper { overflow-x: auto; }

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}

	th {
		text-align: left;
		padding: 0.5rem;
		border-bottom: 1px solid var(--border);
		color: var(--text-tertiary);
		font-weight: 600;
		white-space: nowrap;
		font-size: 0.75rem;
	}

	th.sortable {
		cursor: pointer;
		user-select: none;
	}

	th.sortable:hover { color: var(--gold); }

	.th-check { width: 32px; }

	td {
		padding: 0.5rem;
		border-bottom: 1px solid var(--border);
	}

	tr.selected {
		background: rgba(245, 158, 11, 0.05);
	}

	tr.detail-active {
		background: rgba(245, 158, 11, 0.08);
	}

	.name-btn {
		background: none;
		border: none;
		color: var(--text-primary);
		cursor: pointer;
		font-weight: 500;
		padding: 0;
		text-align: left;
	}

	.name-btn:hover { color: var(--gold); }

	.email-cell {
		max-width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-secondary);
	}

	.date-cell {
		white-space: nowrap;
		color: var(--text-tertiary);
		font-size: 0.75rem;
	}

	.badge {
		display: inline-block;
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 0.65rem;
		font-weight: 600;
		background: var(--bg-hover);
		color: var(--text-secondary);
	}

	.badge.admin { background: #7c3aed20; color: #7c3aed; }
	.badge.pro { background: #2563eb20; color: #2563eb; }
	.badge.organizer { background: #16a34a20; color: #16a34a; }

	.actions-cell {
		display: flex;
		gap: 0.25rem;
	}

	.action-btn {
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 0.65rem;
		font-weight: 600;
		border: 1px solid var(--border);
		background: var(--bg-base);
		color: var(--text-tertiary);
		cursor: pointer;
		white-space: nowrap;
	}

	.action-btn.active {
		background: rgba(16, 185, 129, 0.1);
		border-color: rgba(16, 185, 129, 0.3);
		color: var(--success);
	}

	.action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	/* Detail Panel */
	.detail-row td {
		padding: 0;
		border-bottom: 1px solid var(--border);
	}

	.detail-panel {
		padding: 0.75rem;
		background: var(--bg-elevated);
	}

	.detail-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 0.5rem;
	}

	.detail-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.detail-label {
		font-size: 0.65rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.detail-value {
		font-size: 0.8rem;
		color: var(--text-primary);
	}

	.detail-value.mono {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		word-break: break-all;
	}

	.table-footer {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		text-align: center;
		padding: 0.5rem;
	}

	.pro-date-picker {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-top: 0.25rem;
	}
	.date-input {
		padding: 2px 4px;
		border-radius: 4px;
		border: 1px solid var(--border);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.7rem;
		width: 120px;
	}
	.date-confirm {
		padding: 2px 8px;
		border-radius: 4px;
		border: 1px solid var(--gold);
		background: transparent;
		color: var(--gold);
		font-size: 0.65rem;
		font-weight: 600;
		cursor: pointer;
	}
	.date-cancel {
		padding: 2px 6px;
		border-radius: 4px;
		border: none;
		background: none;
		color: var(--text-tertiary);
		font-size: 0.8rem;
		cursor: pointer;
	}
</style>
