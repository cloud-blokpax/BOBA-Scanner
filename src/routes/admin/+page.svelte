<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';

	import AdminSidebar from './AdminSidebar.svelte';
	import AdminPulseTab from './AdminPulseTab.svelte';
	import AdminUsersTab from './AdminUsersTab.svelte';
	import AdminCardsTab from './AdminCardsTab.svelte';
	import AdminScansTab from './AdminScansTab.svelte';
	import AdminFeaturesTab from './AdminFeaturesTab.svelte';
	import AdminEbayTab from './AdminEbayTab.svelte';
	import AdminWtpTab from './AdminWtpTab.svelte';
	import AdminChangelogTab from './AdminChangelogTab.svelte';
	import AdminSystemTab from './AdminSystemTab.svelte';
	import AdminParallelsTab from './AdminParallelsTab.svelte';
	import AdminPacksTab from './AdminPacksTab.svelte';
	import AdminPhase2Tab from './AdminPhase2Tab.svelte';
	import AdminTriageTab from './AdminTriageTab.svelte';

	type TabId = 'pulse' | 'users' | 'cards' | 'scans' | 'phase2' | 'triage' | 'features' | 'ebay' | 'wtp' | 'changelog' | 'system' | 'parallels' | 'packs';

	// Consolidated from 13 tabs to 9:
	// - Stats removed (redundant with Pulse metrics)
	// - Config folded into System tab
	// - Logs folded into Scans tab (was a simpler view of the same data)
	// - Parallels moved to legacy (reference data, rarely changed)
	const TABS: { id: TabId; label: string; group: 'main' | 'legacy' }[] = [
		{ id: 'pulse', label: 'Pulse', group: 'main' },
		{ id: 'users', label: 'Users', group: 'main' },
		{ id: 'cards', label: 'Cards', group: 'main' },
		{ id: 'scans', label: 'Scans', group: 'main' },
		{ id: 'phase2', label: 'Phase 2', group: 'main' },
		{ id: 'triage', label: 'Triage', group: 'main' },
		{ id: 'features', label: 'Features', group: 'main' },
		{ id: 'ebay', label: 'eBay', group: 'main' },
		{ id: 'wtp', label: 'WTP', group: 'main' },
		{ id: 'packs', label: 'Packs', group: 'main' },
		{ id: 'changelog', label: 'Changelog', group: 'main' },
		{ id: 'system', label: 'System', group: 'main' },
		{ id: 'parallels', label: 'Parallels', group: 'legacy' },
	];

	let activeTab = $state<TabId>('pulse');
	let loading = $state(true);
	let isMobile = $state(true);
	let showMoreTabs = $state(false);
	let dismissedAlerts = $state<Set<string>>(new Set());
	let autoRefresh = $state(false);
	let autoRefreshTimer = $state<ReturnType<typeof setInterval> | null>(null);

	// Dashboard data from API
	let dashData = $state<{
		metrics: {
			totalUsers: number;
			usersToday: number;
			activeUsers: number;
			scansToday: number;
			totalScans: number;
			totalCards: number;
			apiCallsToday: number;
			errorsToday: number;
			aiCostToday: number;
			aiCostMTD: number;
			scanFlagsPending: number;
			ebayRemaining: number | null;
			ebayLimit: number | null;
			ebayResetAt: string | null;
		};
		trends: { scans: number[]; signups: number[]; errors: number[] };
		alerts: Array<{ id: string; severity: 'info' | 'warning' | 'error'; title: string; description: string; action?: string }>;
		recentSignups: Array<{ email: string; name: string | null; created_at: string }>;
		recentErrors: Array<{ call_type: string; error_message: string | null; created_at: string }>;
		featureFlags: Array<{ key: string; enabled: boolean }>;
		health: Record<string, { status: string; message?: string }>;
		timestamp: string;
	} | null>(null);

	const defaultMetrics = {
		totalUsers: 0, usersToday: 0, activeUsers: 0, scansToday: 0, totalScans: 0,
		totalCards: 0, apiCallsToday: 0, errorsToday: 0, aiCostToday: 0, aiCostMTD: 0,
		scanFlagsPending: 0, ebayRemaining: null, ebayLimit: null, ebayResetAt: null
	};

	const defaultTrends = { scans: [], signups: [], errors: [] };

	const metrics = $derived(dashData?.metrics ?? defaultMetrics);
	const trends = $derived(dashData?.trends ?? defaultTrends);
	const health = $derived(dashData?.health ?? {});
	const filteredAlerts = $derived(
		(dashData?.alerts ?? []).filter((a) => !dismissedAlerts.has(a.id))
	);

	function checkMobile() {
		isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
	}

	$effect(() => {
		checkMobile();
		if (typeof window !== 'undefined') {
			window.addEventListener('resize', checkMobile);
			return () => window.removeEventListener('resize', checkMobile);
		}
	});

	$effect(() => {
		loadDashboard();
	});

	// Auto-refresh: reload dashboard every 60s when enabled
	$effect(() => {
		if (autoRefresh) {
			autoRefreshTimer = setInterval(() => {
				loadDashboard();
			}, 60_000);
		} else if (autoRefreshTimer) {
			clearInterval(autoRefreshTimer);
			autoRefreshTimer = null;
		}

		return () => {
			if (autoRefreshTimer) clearInterval(autoRefreshTimer);
		};
	});

	async function loadDashboard() {
		loading = true;
		try {
			const res = await fetch('/api/admin/stats');
			if (!res.ok) throw new Error('Failed to load dashboard');
			dashData = await res.json();
		} catch {
			showToast('Failed to load dashboard data', 'x');
		}
		loading = false;
	}

	function navigateTab(tab: string) {
		activeTab = tab as TabId;
		showMoreTabs = false;
	}

	function dismissAlert(id: string) {
		dismissedAlerts = new Set([...dismissedAlerts, id]);
	}

	const lastUpdated = $derived.by(() => {
		if (!dashData?.timestamp) return '';
		const diff = Date.now() - new Date(dashData.timestamp).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'Just now';
		return `${mins}m ago`;
	});

	const mainTabs = $derived(TABS.filter((t) => t.group === 'main'));
	const legacyTabs = $derived(TABS.filter((t) => t.group === 'legacy'));
</script>

<svelte:head>
	<title>Admin Dashboard - Card Scanner</title>
</svelte:head>

<div class="admin-page" class:mobile={isMobile}>
	{#if loading && !dashData}
		<div class="loading-screen">
			<div class="loading-spinner"></div>
			<p>Loading admin dashboard...</p>
		</div>
	{:else}
		<!-- MOBILE LAYOUT: Single scrollable pulse page -->
		{#if isMobile}
			<div class="mobile-layout">
				<div class="mobile-header">
					<h1 class="mobile-title">Admin</h1>
					<div class="header-right">
						<button
							class="auto-refresh-toggle"
							class:active={autoRefresh}
							onclick={() => autoRefresh = !autoRefresh}
							title={autoRefresh ? 'Auto-refresh ON (60s)' : 'Auto-refresh OFF'}
						>
							{autoRefresh ? '⟳ Live' : '⟳'}
						</button>
						{#if lastUpdated}
							<span class="last-updated">Updated {lastUpdated}</span>
						{/if}
					</div>
				</div>

				{#if activeTab === 'pulse'}
					<AdminPulseTab
						{metrics}
						{trends}
						alerts={filteredAlerts}
						recentSignups={dashData?.recentSignups ?? []}
						{health}
						onNavigate={navigateTab}
						onDismissAlert={dismissAlert}
						onRefresh={loadDashboard}
					/>
				{:else}
					<button class="back-btn" onclick={() => activeTab = 'pulse'}>
						&larr; Back to Pulse
					</button>

					{#if activeTab === 'users'}
						<AdminUsersTab />
					{:else if activeTab === 'cards'}
						<AdminCardsTab />
					{:else if activeTab === 'scans'}
						<AdminScansTab />
					{:else if activeTab === 'phase2'}
						<AdminPhase2Tab />
					{:else if activeTab === 'triage'}
						<AdminTriageTab />
					{:else if activeTab === 'features'}
						<AdminFeaturesTab />
					{:else if activeTab === 'ebay'}
						<AdminEbayTab />
					{:else if activeTab === 'wtp'}
						<AdminWtpTab />
					{:else if activeTab === 'changelog'}
						<AdminChangelogTab />
					{:else if activeTab === 'system'}
						<AdminSystemTab {health} />
					{:else if activeTab === 'parallels'}
						<AdminParallelsTab />
					{:else if activeTab === 'packs'}
						<AdminPacksTab />
					{/if}
				{/if}

				<!-- Mobile Bottom Quick-Nav (only on pulse) -->
				{#if activeTab === 'pulse'}
					<div class="mobile-nav-section">
						<h3 class="mobile-nav-label">Jump To</h3>
						<div class="mobile-nav-grid">
							{#each TABS.filter((t) => t.id !== 'pulse' && t.group === 'main') as tab}
								<button class="mobile-nav-btn" onclick={() => navigateTab(tab.id)}>
									{tab.label}
									{#if tab.id === 'cards' && metrics.scanFlagsPending > 0}
										<span class="mobile-nav-badge">{metrics.scanFlagsPending}</span>
									{/if}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>

		<!-- DESKTOP LAYOUT: Sidebar + Tabs -->
		{:else}
			<div class="desktop-layout">
				<!-- Sidebar -->
				<AdminSidebar
					{metrics}
					{health}
					alertCount={filteredAlerts.length}
				/>

				<!-- Main Content -->
				<div class="main-content">
					<div class="desktop-header">
						<h1 class="desktop-title">Admin Dashboard</h1>
						<div class="header-right">
							<button
								class="auto-refresh-toggle"
								class:active={autoRefresh}
								onclick={() => autoRefresh = !autoRefresh}
								title={autoRefresh ? 'Auto-refresh ON (60s)' : 'Auto-refresh OFF'}
							>
								{autoRefresh ? '⟳ Live' : '⟳'}
							</button>
							{#if lastUpdated}
								<span class="last-updated">Updated {lastUpdated}</span>
							{/if}
						</div>
					</div>

					<!-- Tab Bar -->
					<div class="tab-bar">
						<div class="tab-group">
							{#each mainTabs as tab}
								<button
									class="tab-btn"
									class:active={activeTab === tab.id}
									onclick={() => activeTab = tab.id}
								>
									{tab.label}
									{#if tab.id === 'cards' && metrics.scanFlagsPending > 0}
										<span class="tab-badge">{metrics.scanFlagsPending}</span>
									{/if}
								</button>
							{/each}
						</div>

						<div class="tab-divider"></div>

						<button class="more-btn" onclick={() => showMoreTabs = !showMoreTabs}>
							More {showMoreTabs ? '−' : '+'}
						</button>

						{#if showMoreTabs}
							<div class="more-tabs">
								{#each legacyTabs as tab}
									<button
										class="tab-btn"
										class:active={activeTab === tab.id}
										onclick={() => { activeTab = tab.id; showMoreTabs = false; }}
									>
										{tab.label}
									</button>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Tab Content -->
					<div class="tab-content">
						{#if activeTab === 'pulse'}
							<AdminPulseTab
								{metrics}
								{trends}
								alerts={filteredAlerts}
								recentSignups={dashData?.recentSignups ?? []}
								{health}
								onNavigate={navigateTab}
								onDismissAlert={dismissAlert}
								onRefresh={loadDashboard}
							/>
						{:else if activeTab === 'users'}
							<AdminUsersTab />
						{:else if activeTab === 'cards'}
							<AdminCardsTab />
						{:else if activeTab === 'scans'}
							<AdminScansTab />
						{:else if activeTab === 'phase2'}
							<AdminPhase2Tab />
						{:else if activeTab === 'triage'}
							<AdminTriageTab />
						{:else if activeTab === 'features'}
							<AdminFeaturesTab />
						{:else if activeTab === 'ebay'}
							<AdminEbayTab />
						{:else if activeTab === 'wtp'}
							<AdminWtpTab />
						{:else if activeTab === 'changelog'}
							<AdminChangelogTab />
						{:else if activeTab === 'system'}
							<AdminSystemTab {health} />
						{:else if activeTab === 'parallels'}
							<AdminParallelsTab />
						{:else if activeTab === 'packs'}
							<AdminPacksTab />
						{/if}
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.admin-page {
		min-height: 100vh;
	}

	/* Loading */
	.loading-screen {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 1rem;
		gap: 1rem;
		color: var(--text-tertiary);
	}

	.loading-spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--border);
		border-top-color: var(--gold);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* MOBILE LAYOUT */
	.mobile-layout {
		padding: 1rem;
		max-width: 600px;
		margin: 0 auto;
	}

	.mobile-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.mobile-title {
		font-size: 1.25rem;
		font-weight: 700;
	}

	.last-updated {
		font-size: 0.7rem;
		color: var(--text-tertiary);
	}

	.back-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		color: var(--text-secondary);
		font-size: 0.8rem;
		cursor: pointer;
		margin-bottom: 1rem;
	}

	.mobile-nav-section {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	.mobile-nav-label {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}

	.mobile-nav-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
	}

	.mobile-nav-btn {
		padding: 0.625rem 0.5rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		color: var(--text-secondary);
		font-size: 0.8rem;
		cursor: pointer;
		text-align: center;
		transition: border-color 0.15s, color 0.15s;
	}

	.mobile-nav-btn:hover {
		border-color: var(--gold);
		color: var(--gold);
	}

	.mobile-nav-badge {
		display: inline-block;
		padding: 0 5px;
		border-radius: 8px;
		background: var(--warning);
		color: #000;
		font-size: 0.6rem;
		font-weight: 700;
		min-width: 14px;
		text-align: center;
		line-height: 14px;
		margin-left: 4px;
	}

	/* DESKTOP LAYOUT */
	.desktop-layout {
		display: flex;
		gap: 1.5rem;
		max-width: 1400px;
		margin: 0 auto;
		padding: 1.5rem;
	}

	.main-content {
		flex: 1;
		min-width: 0;
	}

	.desktop-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.desktop-title {
		font-size: 1.35rem;
		font-weight: 700;
	}

	/* Tab Bar */
	.tab-bar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
		position: relative;
	}

	.tab-group {
		display: flex;
		gap: 0.125rem;
		flex-wrap: wrap;
	}

	.tab-btn {
		background: none;
		border: none;
		padding: 0.625rem 0.875rem;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 0.85rem;
		border-bottom: 2px solid transparent;
		white-space: nowrap;
		transition: color 0.15s;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.tab-btn:hover {
		color: var(--text-primary);
	}

	.tab-btn.active {
		color: var(--gold);
		border-bottom-color: var(--gold);
		font-weight: 600;
	}

	.tab-badge {
		display: inline-block;
		padding: 0 5px;
		border-radius: 8px;
		background: var(--warning);
		color: #000;
		font-size: 0.6rem;
		font-weight: 700;
		min-width: 16px;
		text-align: center;
		line-height: 16px;
	}

	.tab-divider {
		width: 1px;
		height: 20px;
		background: var(--border);
		margin: 0 0.375rem;
	}

	.more-btn {
		background: none;
		border: none;
		padding: 0.5rem 0.75rem;
		color: var(--text-tertiary);
		cursor: pointer;
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.more-btn:hover { color: var(--text-secondary); }

	.more-tabs {
		display: flex;
		gap: 0.125rem;
	}

	.tab-content {
		min-height: 400px;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.auto-refresh-toggle {
		padding: 0.3rem 0.6rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		color: var(--text-tertiary);
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.auto-refresh-toggle:hover {
		border-color: var(--text-secondary);
		color: var(--text-secondary);
	}

	.auto-refresh-toggle.active {
		border-color: var(--success);
		color: var(--success);
		background: rgba(16, 185, 129, 0.08);
		animation: pulse-glow 2s ease-in-out infinite;
	}

	@keyframes pulse-glow {
		0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
		50% { box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15); }
	}
</style>
