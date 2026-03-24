<script lang="ts">
	import { getSupabase } from '$lib/services/supabase';
	import { showToast } from '$lib/stores/toast.svelte';

	import AdminUsersTab from './AdminUsersTab.svelte';
	import AdminParallelsTab from './AdminParallelsTab.svelte';
	import AdminLogsTab from './AdminLogsTab.svelte';
	import AdminStatsTab from './AdminStatsTab.svelte';
	import AdminFeaturesTab from './AdminFeaturesTab.svelte';
	import AdminConfigTab from './AdminConfigTab.svelte';

	let activeTab = $state<'users' | 'logs' | 'stats' | 'parallels' | 'features' | 'config'>('users');
	let loading = $state(true);

	let stats = $state({
		totalUsers: 0,
		totalScans: 0,
		activeToday: 0,
		totalCards: 0
	});

	async function loadDashboard() {
		loading = true;
		const client = getSupabase();
		if (!client) {
			showToast('Supabase not configured', 'x');
			loading = false;
			return;
		}
		try {
			const [usersRes, statsRes] = await Promise.all([
				client.from('users').select('created_at').order('created_at', { ascending: false }).limit(100),
				client.from('system_settings').select('key, value').in('key', ['total_scans', 'total_cards'])
			]);

			if (usersRes.data) {
				stats.totalUsers = usersRes.data.length;
				stats.activeToday = usersRes.data.filter((u) => {
					const d = new Date(u.created_at);
					const now = new Date();
					return d.toDateString() === now.toDateString();
				}).length;
			}

			if (statsRes.data) {
				for (const row of statsRes.data) {
					if (row.key === 'total_scans') stats.totalScans = Number(row.value) || 0;
					if (row.key === 'total_cards') stats.totalCards = Number(row.value) || 0;
				}
			}
		} catch {
			showToast('Failed to load dashboard', 'x');
		}
		loading = false;
	}

	$effect(() => {
		loadDashboard();
	});
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
			<button class:active={activeTab === 'parallels'} onclick={() => (activeTab = 'parallels')}>Parallels</button>
			<button class:active={activeTab === 'logs'} onclick={() => (activeTab = 'logs')}>Logs</button>
			<button class:active={activeTab === 'stats'} onclick={() => (activeTab = 'stats')}>Stats</button>
			<button class:active={activeTab === 'features'} onclick={() => (activeTab = 'features')}>Features</button>
			<button class:active={activeTab === 'config'} onclick={() => (activeTab = 'config')}>Config</button>
		</div>

		{#if activeTab === 'users'}
			<AdminUsersTab />
		{:else if activeTab === 'parallels'}
			<AdminParallelsTab />
		{:else if activeTab === 'logs'}
			<AdminLogsTab />
		{:else if activeTab === 'stats'}
			<AdminStatsTab {stats} />
		{:else if activeTab === 'features'}
			<AdminFeaturesTab />
		{:else if activeTab === 'config'}
			<AdminConfigTab />
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
		overflow-x: auto;
	}
	.tabs button {
		background: none;
		border: none;
		padding: 0.625rem 1rem;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 0.9rem;
		border-bottom: 2px solid transparent;
		white-space: nowrap;
	}
	.tabs button.active {
		color: var(--accent-primary);
		border-bottom-color: var(--accent-primary);
		font-weight: 600;
	}
</style>
