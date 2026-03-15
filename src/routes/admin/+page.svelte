<script lang="ts">
	import { getSupabase } from '$lib/services/supabase';
	import { showToast } from '$lib/stores/toast';
	import { debounce } from '$lib/utils';
	import {
		getAllParallelConfig,
		updateParallelRarity,
		seedMissingParallels,
		reloadParallelConfig,
		type ParallelConfigEntry
	} from '$lib/services/parallel-config';
	import {
		getAllFeatureFlags,
		saveFeatureFlag,
		loadFeatureFlags,
		type FeatureFlag
	} from '$lib/stores/feature-flags';
	import type { CardRarity } from '$lib/types';

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
		call_type: string;
		error_message: string | null;
		success: boolean;
		created_at: string;
	}

	let activeTab = $state<'users' | 'logs' | 'stats' | 'parallels' | 'features'>('users');
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

	// ── Parallels tab state ──
	let parallelEntries = $state<ParallelConfigEntry[]>([]);
	let parallelsLoading = $state(false);
	let seeding = $state(false);
	let editingParallel = $state<string | null>(null);

	// ── Features tab state ──
	let featureList = $state<FeatureFlag[]>([]);
	let featuresLoading = $state(false);
	let savingFlag = $state<string | null>(null);
	let overrideUserId = $state('');
	let overrideFeatureKey = $state('');
	let overrideEnabled = $state(true);
	let overrideSaving = $state(false);
	let userOverridesList = $state<Array<{
		user_id: string;
		feature_key: string;
		enabled: boolean;
		user_email?: string;
	}>>([]);

	const RARITY_TIERS: { key: CardRarity; label: string; color: string }[] = [
		{ key: 'common', label: 'Common', color: '#9CA3AF' },
		{ key: 'uncommon', label: 'Uncommon', color: '#22C55E' },
		{ key: 'rare', label: 'Rare', color: '#3B82F6' },
		{ key: 'ultra_rare', label: 'Ultra Rare', color: '#A855F7' },
		{ key: 'legendary', label: 'Legendary', color: '#F59E0B' }
	];

	const parallelsByRarity = $derived.by(() => {
		const grouped: Record<CardRarity, ParallelConfigEntry[]> = {
			common: [], uncommon: [], rare: [], ultra_rare: [], legendary: []
		};
		for (const entry of parallelEntries) {
			const r = entry.rarity as CardRarity;
			if (grouped[r]) grouped[r].push(entry);
		}
		return grouped;
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
			const [usersRes, logsRes, statsRes] = await Promise.all([
				client.from('users').select('*').order('created_at', { ascending: false }).limit(100),
				client.from('api_call_logs').select('*').order('created_at', { ascending: false }).limit(50),
				client.from('system_settings').select('key, value').in('key', ['total_scans', 'total_cards'])
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

	async function loadParallels() {
		parallelsLoading = true;
		try {
			parallelEntries = await getAllParallelConfig();
		} catch {
			showToast('Failed to load parallel config', 'x');
		}
		parallelsLoading = false;
	}

	async function handleSeedParallels() {
		seeding = true;
		try {
			const count = await seedMissingParallels();
			if (count > 0) {
				showToast(`Discovered ${count} new parallel(s)`, 'check');
				await loadParallels();
			} else {
				showToast('No new parallels found', 'check');
			}
		} catch {
			showToast('Failed to seed parallels', 'x');
		}
		seeding = false;
	}

	async function handleRarityChange(parallelName: string, newRarity: CardRarity) {
		// Optimistic update
		parallelEntries = parallelEntries.map((e) =>
			e.parallel_name === parallelName ? { ...e, rarity: newRarity } : e
		);
		editingParallel = null;

		const success = await updateParallelRarity(parallelName, newRarity);
		if (!success) {
			showToast('Failed to update — reloading', 'x');
			await loadParallels();
		}
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

	$effect(() => {
		if (activeTab === 'parallels') {
			loadParallels();
		}
	});

	// ── Features tab ──
	async function loadFeaturesTab() {
		featuresLoading = true;
		try {
			await loadFeatureFlags();
			featureList = getAllFeatureFlags();
			const client = getSupabase();
			if (client) {
				const { data } = await client
					.from('user_feature_overrides')
					.select('user_id, feature_key, enabled')
					.order('created_at', { ascending: false })
					.limit(200);
				if (data) {
					const userIds = [...new Set(data.map((d: { user_id: string }) => d.user_id))];
					const { data: userRows } = await client
						.from('users')
						.select('id, email')
						.in('id', userIds);
					const emailMap = new Map((userRows || []).map((u: { id: string; email: string }) => [u.id, u.email]));
					userOverridesList = data.map((d: { user_id: string; feature_key: string; enabled: boolean }) => ({
						...d,
						user_email: emailMap.get(d.user_id) || d.user_id
					}));
				}
			}
		} catch {
			showToast('Failed to load features', 'x');
		}
		featuresLoading = false;
	}

	$effect(() => {
		if (activeTab === 'features') loadFeaturesTab();
	});

	async function toggleFlagRole(
		featureKey: string,
		role: 'enabled_globally' | 'enabled_for_guest' | 'enabled_for_authenticated' | 'enabled_for_member' | 'enabled_for_admin',
		currentValue: boolean
	) {
		savingFlag = featureKey;
		const success = await saveFeatureFlag(featureKey, { [role]: !currentValue });
		if (success) {
			featureList = getAllFeatureFlags();
			showToast('Flag updated', 'check');
		} else {
			showToast('Failed to update flag', 'x');
		}
		savingFlag = null;
	}

	async function addUserOverride() {
		if (!overrideUserId.trim() || !overrideFeatureKey) return;
		overrideSaving = true;
		const client = getSupabase();
		if (!client) { overrideSaving = false; return; }
		try {
			let userId = overrideUserId.trim();
			if (!userId.match(/^[0-9a-f-]{36}$/i)) {
				const { data: userRow } = await client.from('users').select('id').eq('email', userId).single();
				if (!userRow) { showToast('User not found', 'x'); overrideSaving = false; return; }
				userId = userRow.id;
			}
			const { error } = await client.from('user_feature_overrides').upsert(
				{ user_id: userId, feature_key: overrideFeatureKey, enabled: overrideEnabled, updated_at: new Date().toISOString() },
				{ onConflict: 'user_id,feature_key' }
			);
			if (error) throw error;
			showToast('Override saved', 'check');
			overrideUserId = '';
			await loadFeaturesTab();
		} catch { showToast('Failed to save override', 'x'); }
		overrideSaving = false;
	}

	async function removeOverride(userId: string, featureKey: string) {
		const client = getSupabase();
		if (!client) return;
		const { error } = await client.from('user_feature_overrides').delete().eq('user_id', userId).eq('feature_key', featureKey);
		if (error) showToast('Failed to remove override', 'x');
		else { showToast('Override removed', 'check'); await loadFeaturesTab(); }
	}

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
			<button class:active={activeTab === 'parallels'} onclick={() => (activeTab = 'parallels')}>Parallels</button>
			<button class:active={activeTab === 'logs'} onclick={() => (activeTab = 'logs')}>Logs</button>
			<button class:active={activeTab === 'stats'} onclick={() => (activeTab = 'stats')}>Stats</button>
			<button class:active={activeTab === 'features'} onclick={() => (activeTab = 'features')}>Features</button>
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
		{:else if activeTab === 'parallels'}
			<div class="tab-content">
				<div class="parallels-header">
					<p class="parallels-desc">Assign each card parallel to a rarity tier. Tap a parallel to change its rarity.</p>
					<button class="btn-discover" onclick={handleSeedParallels} disabled={seeding}>
						{seeding ? 'Discovering...' : 'Auto-Discover'}
					</button>
				</div>

				{#if parallelsLoading}
					<div class="loading">Loading parallels...</div>
				{:else if parallelEntries.length === 0}
					<div class="empty">
						<p>No parallels configured yet.</p>
						<p>Click "Auto-Discover" to pull parallel names from your card database.</p>
					</div>
				{:else}
					<div class="rarity-columns">
						{#each RARITY_TIERS as tier}
							{@const entries = parallelsByRarity[tier.key]}
							<div class="rarity-column">
								<div class="rarity-header" style:--rarity-color={tier.color}>
									<span class="rarity-dot" style:background={tier.color}></span>
									<span class="rarity-name">{tier.label}</span>
									<span class="rarity-count">{entries.length}</span>
								</div>
								<div class="rarity-list">
									{#each entries as entry}
										<div class="parallel-pill-wrapper">
											<button
												class="parallel-pill"
												style:--pill-color={tier.color}
												onclick={() => editingParallel = editingParallel === entry.parallel_name ? null : entry.parallel_name}
											>
												{entry.parallel_name}
											</button>
											{#if editingParallel === entry.parallel_name}
												<div class="rarity-selector">
													{#each RARITY_TIERS as target}
														<button
															class="rarity-option"
															class:current={target.key === entry.rarity}
															style:--option-color={target.color}
															onclick={() => handleRarityChange(entry.parallel_name, target.key)}
															disabled={target.key === entry.rarity}
														>
															<span class="option-dot" style:background={target.color}></span>
															{target.label}
														</button>
													{/each}
												</div>
											{/if}
										</div>
									{/each}
									{#if entries.length === 0}
										<span class="empty-tier">No parallels</span>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else if activeTab === 'logs'}
			<div class="tab-content">
				<div class="logs-list">
					{#each logs as log}
						<div class="log-entry">
							<div class="log-action">
								{log.call_type}
								{#if !log.success}<span class="badge" style="background: #ef444420; color: #ef4444; margin-left: 0.5rem;">Failed</span>{/if}
							</div>
							<div class="log-details">{log.error_message || ''}</div>
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
		{:else if activeTab === 'features'}
			<div class="tab-content">
				{#if featuresLoading}
					<div class="loading">Loading features...</div>
				{:else}
					<h2 class="section-title">Feature Flags</h2>
					<p class="section-desc">Toggle features for each role tier. Per-user overrides below take precedence.</p>
					<div class="feature-flags-list">
						{#each featureList as flag}
							<div class="feature-flag-row">
								<div class="flag-info">
									<span class="flag-icon">{flag.icon}</span>
									<div>
										<div class="flag-name">{flag.display_name}</div>
										<div class="flag-desc">{flag.description}</div>
										<div class="flag-key">{flag.feature_key}</div>
									</div>
								</div>
								<div class="flag-toggles">
									{#each [
										{ key: 'enabled_globally', label: 'Global' },
										{ key: 'enabled_for_guest', label: 'Guest' },
										{ key: 'enabled_for_authenticated', label: 'Auth' },
										{ key: 'enabled_for_member', label: 'Member' },
										{ key: 'enabled_for_admin', label: 'Admin' }
									] as tier}
										<label class="toggle-label">
											<span class="toggle-tier">{tier.label}</span>
											<button
												class="toggle-btn"
												class:toggle-on={flag[tier.key as keyof FeatureFlag]}
												onclick={() => toggleFlagRole(flag.feature_key, tier.key as 'enabled_globally' | 'enabled_for_guest' | 'enabled_for_authenticated' | 'enabled_for_member' | 'enabled_for_admin', !!flag[tier.key as keyof FeatureFlag])}
												disabled={savingFlag === flag.feature_key}
												aria-label="Toggle {tier.label} for {flag.feature_key}"
											></button>
										</label>
									{/each}
								</div>
							</div>
						{/each}
					</div>

					<h2 class="section-title" style="margin-top: 2rem;">Per-User Overrides</h2>
					<p class="section-desc">Grant or revoke specific features for individual users by email or UUID.</p>
					<div class="override-form">
						<input type="text" bind:value={overrideUserId} placeholder="User email or ID" class="search-input" style="flex: 2;" />
						<select bind:value={overrideFeatureKey} class="override-select">
							<option value="">Select feature...</option>
							{#each featureList as flag}
								<option value={flag.feature_key}>{flag.display_name}</option>
							{/each}
						</select>
						<select bind:value={overrideEnabled} class="override-select" style="flex: 0.5;">
							<option value={true}>Grant</option>
							<option value={false}>Revoke</option>
						</select>
						<button class="btn-discover" onclick={addUserOverride} disabled={overrideSaving || !overrideUserId.trim() || !overrideFeatureKey}>
							{overrideSaving ? 'Saving...' : 'Add'}
						</button>
					</div>
					{#if userOverridesList.length > 0}
						<div class="overrides-table">
							<table>
								<thead><tr><th>User</th><th>Feature</th><th>Status</th><th></th></tr></thead>
								<tbody>
									{#each userOverridesList as ov}
										<tr>
											<td class="email-cell">{ov.user_email}</td>
											<td>{ov.feature_key}</td>
											<td>
												{#if ov.enabled}<span class="badge member">Granted</span>
												{:else}<span class="badge" style="background: #ef444420; color: #ef4444;">Revoked</span>{/if}
											</td>
											<td><button class="remove-btn" onclick={() => removeOverride(ov.user_id, ov.feature_key)}>✕</button></td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{:else}
						<p class="empty">No per-user overrides set.</p>
					{/if}
				{/if}
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

	/* ── Parallels Tab ── */
	.parallels-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.parallels-desc {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin: 0;
	}
	.btn-discover {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--accent-primary);
		background: transparent;
		color: var(--accent-primary);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-discover:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.rarity-columns {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.rarity-column {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 0.75rem;
	}
	.rarity-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.625rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border-color);
	}
	.rarity-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.rarity-name {
		font-weight: 700;
		font-size: 0.9rem;
		color: var(--rarity-color);
	}
	.rarity-count {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-left: auto;
	}
	.rarity-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	.parallel-pill-wrapper {
		position: relative;
	}
	.parallel-pill {
		padding: 0.3rem 0.75rem;
		border-radius: 16px;
		border: 1px solid color-mix(in srgb, var(--pill-color) 30%, transparent);
		background: color-mix(in srgb, var(--pill-color) 10%, transparent);
		color: var(--pill-color);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}
	.parallel-pill:hover {
		background: color-mix(in srgb, var(--pill-color) 20%, transparent);
		border-color: color-mix(in srgb, var(--pill-color) 50%, transparent);
	}
	.rarity-selector {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 100;
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: 0.25rem;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 140px;
	}
	.rarity-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.625rem;
		border: none;
		background: transparent;
		border-radius: 6px;
		font-size: 0.8rem;
		color: var(--text-primary);
		cursor: pointer;
		text-align: left;
	}
	.rarity-option:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	.rarity-option.current {
		opacity: 0.4;
		cursor: default;
	}
	.option-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.empty-tier {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		font-style: italic;
	}

	/* ── Features Tab ── */
	.section-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.25rem; }
	.section-desc { font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 1rem; }
	.feature-flags-list { display: flex; flex-direction: column; gap: 0.75rem; }
	.feature-flag-row { background: var(--bg-elevated); border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
	.flag-info { display: flex; gap: 0.75rem; align-items: flex-start; }
	.flag-icon { font-size: 1.5rem; flex-shrink: 0; margin-top: 2px; }
	.flag-name { font-weight: 600; font-size: 0.95rem; }
	.flag-desc { font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px; }
	.flag-key { font-size: 0.7rem; color: var(--text-tertiary); font-family: var(--font-mono); margin-top: 4px; }
	.flag-toggles { display: flex; gap: 0.75rem; flex-wrap: wrap; }
	.toggle-label { display: flex; flex-direction: column; align-items: center; gap: 4px; }
	.toggle-tier { font-size: 0.65rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
	.toggle-btn { width: 36px; height: 20px; border-radius: 10px; border: none; background: var(--bg-hover); position: relative; cursor: pointer; transition: background 0.2s; }
	.toggle-btn::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--text-secondary); transition: transform 0.2s, background 0.2s; }
	.toggle-btn.toggle-on { background: var(--success, #10b981); }
	.toggle-btn.toggle-on::after { transform: translateX(16px); background: white; }
	.toggle-btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.override-form { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
	.override-select { padding: 0.5rem 0.75rem; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-base); color: var(--text-primary); font-size: 0.85rem; flex: 1; }
	.overrides-table { margin-top: 0.5rem; }
	.remove-btn { background: none; border: none; color: var(--text-tertiary); cursor: pointer; font-size: 0.9rem; padding: 2px 6px; border-radius: 4px; }
	.remove-btn:hover { background: var(--danger-light); color: var(--danger); }
</style>
