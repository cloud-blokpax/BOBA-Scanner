<script lang="ts">
	import { supabase } from '$lib/services/supabase';
	import { showToast } from '$lib/stores/toast';
	import { debounce } from '$lib/utils';

	interface UserRow {
		id: string;
		email: string;
		name: string | null;
		is_admin: boolean;
		is_member: boolean;
		scan_count: number;
		created_at: string;
	}

	interface LogRow {
		id: string;
		user_id: string | null;
		action: string;
		details: string | null;
		created_at: string;
	}

	let activeTab = $state<'users' | 'logs' | 'stats'>('users');
	let users = $state<UserRow[]>([]);
	let filteredUsers = $state<UserRow[]>([]);
	let logs = $state<LogRow[]>([]);
	let loading = $state(true);
	let searchQuery = $state('');

	let stats = $state({
		totalUsers: 0,
		totalScans: 0,
		activeToday: 0,
		totalCards: 0
	});

	async function loadDashboard() {
		loading = true;
		try {
			const [usersRes, logsRes, statsRes] = await Promise.all([
				supabase.from('users').select('*').order('created_at', { ascending: false }).limit(100),
				supabase.from('error_logs').select('*').order('created_at', { ascending: false }).limit(50),
				supabase.from('system_settings').select('key, value').in('key', ['total_scans', 'total_cards'])
			]);

			if (usersRes.data) {
				users = usersRes.data as UserRow[];
				filteredUsers = users;
				stats.totalUsers = users.length;
				stats.activeToday = users.filter((u) => {
					const d = new Date(u.created_at);
					const now = new Date();
					return d.toDateString() === now.toDateString();
				}).length;
			}

			if (logsRes.data) logs = logsRes.data as LogRow[];

			if (statsRes.data) {
				for (const row of statsRes.data) {
					if (row.key === 'total_scans') stats.totalScans = Number(row.value) || 0;
					if (row.key === 'total_cards') stats.totalCards = Number(row.value) || 0;
				}
			}
		} catch (err) {
			showToast('Failed to load dashboard', 'x');
		}
		loading = false;
	}

	const filterUsers = debounce((query: string) => {
		if (!query.trim()) {
			filteredUsers = users;
			return;
		}
		const q = query.toLowerCase();
		filteredUsers = users.filter(
			(u) =>
				u.email?.toLowerCase().includes(q) ||
				u.name?.toLowerCase().includes(q)
		);
	}, 300);

	$effect(() => {
		filterUsers(searchQuery);
	});

	$effect(() => {
		loadDashboard();
	});

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>Admin Dashboard - BOBA Scanner</title>
</svelte:head>

<div class="admin-page">
	<header class="page-header">
		<h1>Admin Dashboard</h1>
	</header>

	{#if loading}
		<div class="loading">Loading...</div>
	{:else}
		<div class="stats-row">
			<div class="stat-card">
				<div class="stat-value">{stats.totalUsers}</div>
				<div class="stat-label">Users</div>
			</div>
			<div class="stat-card">
				<div class="stat-value">{stats.totalScans}</div>
				<div class="stat-label">Total Scans</div>
			</div>
			<div class="stat-card">
				<div class="stat-value">{stats.activeToday}</div>
				<div class="stat-label">Active Today</div>
			</div>
			<div class="stat-card">
				<div class="stat-value">{stats.totalCards}</div>
				<div class="stat-label">Cards in DB</div>
			</div>
		</div>

		<div class="tabs">
			<button class:active={activeTab === 'users'} onclick={() => (activeTab = 'users')}>Users</button>
			<button class:active={activeTab === 'logs'} onclick={() => (activeTab = 'logs')}>Logs</button>
			<button class:active={activeTab === 'stats'} onclick={() => (activeTab = 'stats')}>Stats</button>
		</div>

		{#if activeTab === 'users'}
			<div class="tab-content">
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search users..."
					class="search-input"
				/>
				<div class="table-wrapper">
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Email</th>
								<th>Role</th>
								<th>Scans</th>
								<th>Joined</th>
							</tr>
						</thead>
						<tbody>
							{#each filteredUsers as user}
								<tr>
									<td>{user.name || '—'}</td>
									<td class="email-cell">{user.email}</td>
									<td>
										{#if user.is_admin}
											<span class="badge admin">Admin</span>
										{:else if user.is_member}
											<span class="badge member">Member</span>
										{:else}
											<span class="badge">User</span>
										{/if}
									</td>
									<td>{user.scan_count}</td>
									<td>{formatDate(user.created_at)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{:else if activeTab === 'logs'}
			<div class="tab-content">
				<div class="logs-list">
					{#each logs as log}
						<div class="log-entry">
							<div class="log-action">{log.action}</div>
							<div class="log-details">{log.details || ''}</div>
							<div class="log-time">{formatDate(log.created_at)}</div>
						</div>
					{/each}
					{#if logs.length === 0}
						<p class="empty">No recent logs.</p>
					{/if}
				</div>
			</div>
		{:else if activeTab === 'stats'}
			<div class="tab-content">
				<div class="stats-detail">
					<div class="detail-row">
						<span>Total Users</span>
						<strong>{stats.totalUsers}</strong>
					</div>
					<div class="detail-row">
						<span>Total Scans</span>
						<strong>{stats.totalScans}</strong>
					</div>
					<div class="detail-row">
						<span>Cards in Database</span>
						<strong>{stats.totalCards}</strong>
					</div>
					<div class="detail-row">
						<span>Active Today</span>
						<strong>{stats.activeToday}</strong>
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.admin-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 1rem;
	}
	.page-header {
		margin-bottom: 1.5rem;
	}
	h1 {
		font-size: 1.5rem;
		font-weight: 700;
	}
	.loading {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}
	.stats-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}
	.stat-card {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
		text-align: center;
	}
	.stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--accent-primary);
	}
	.stat-label {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 1rem;
		border-bottom: 1px solid var(--border-color);
	}
	.tabs button {
		background: none;
		border: none;
		padding: 0.625rem 1rem;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 0.9rem;
		border-bottom: 2px solid transparent;
	}
	.tabs button.active {
		color: var(--accent-primary);
		border-bottom-color: var(--accent-primary);
		font-weight: 600;
	}
	.search-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.9rem;
		margin-bottom: 0.75rem;
	}
	.table-wrapper {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	th {
		text-align: left;
		padding: 0.5rem;
		border-bottom: 1px solid var(--border-color);
		color: var(--text-secondary);
		font-weight: 600;
		white-space: nowrap;
	}
	td {
		padding: 0.5rem;
		border-bottom: 1px solid var(--border-color);
	}
	.email-cell {
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		background: var(--bg-hover);
		color: var(--text-secondary);
	}
	.badge.admin {
		background: #7c3aed20;
		color: #7c3aed;
	}
	.badge.member {
		background: #2563eb20;
		color: #2563eb;
	}
	.logs-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.log-entry {
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		background: var(--bg-elevated);
	}
	.log-action {
		font-weight: 600;
		font-size: 0.85rem;
	}
	.log-details {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-top: 2px;
	}
	.log-time {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		margin-top: 4px;
	}
	.empty {
		text-align: center;
		color: var(--text-tertiary);
		padding: 2rem;
	}
	.stats-detail {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.detail-row {
		display: flex;
		justify-content: space-between;
		padding: 0.75rem;
		border-radius: 8px;
		background: var(--bg-elevated);
	}
	.detail-row span {
		color: var(--text-secondary);
	}
</style>
