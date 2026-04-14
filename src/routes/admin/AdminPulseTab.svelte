<script lang="ts">
	import Sparkline from './Sparkline.svelte';

	interface Alert {
		id: string;
		severity: 'info' | 'warning' | 'error';
		title: string;
		description: string;
		action?: string;
	}

	interface RecentSignup {
		email: string;
		name: string | null;
		created_at: string;
	}

	let {
		metrics,
		trends,
		alerts,
		recentSignups,
		health,
		onNavigate,
		onDismissAlert,
		onRefresh
	}: {
		metrics: {
			scansToday: number;
			activeUsers: number;
			aiCostToday: number;
			aiCostMTD: number;
			ebayRemaining: number | null;
			ebayLimit: number | null;
			errorsToday: number;
			usersToday: number;
			totalScans: number;
			scanFlagsPending: number;
		};
		trends: { scans: number[]; signups: number[]; errors: number[] };
		alerts: Alert[];
		recentSignups: RecentSignup[];
		health: Record<string, { status: string; message?: string }>;
		onNavigate: (tab: string) => void;
		onDismissAlert: (id: string) => void;
		onRefresh: () => void;
	} = $props();

	function timeAgo(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}hr ago`;
		return `${Math.floor(hrs / 24)}d ago`;
	}

	const overallStatus = $derived.by(() => {
		if (!health) return 'ok';
		const statuses = Object.values(health).map((h) => h.status);
		if (statuses.some((s) => s === 'down')) return 'down';
		if (statuses.some((s) => s === 'degraded')) return 'degraded';
		return 'ok';
	});

	const statusDot = $derived(
		overallStatus === 'ok' ? 'dot-ok' : overallStatus === 'degraded' ? 'dot-warn' : 'dot-error'
	);

	const ebayPercent = $derived(
		metrics.ebayLimit && metrics.ebayRemaining != null
			? Math.round((metrics.ebayRemaining / metrics.ebayLimit) * 100)
			: null
	);

	// ── Quick Action state ────────────────────────────────
	let harvestTriggering = $state(false);
	let harvestResult = $state<{ ok: boolean; message: string } | null>(null);

	async function triggerHarvestBatch() {
		harvestTriggering = true;
		harvestResult = null;
		try {
			const res = await fetch('/api/admin/trigger-harvest', { method: 'POST' });
			const data = await res.json();
			if (data.triggered && data.cronResponse) {
				const cr = data.cronResponse;
				harvestResult = {
					ok: true,
					message: `Harvested ${cr.processed ?? 0} cards (${cr.updated ?? 0} updated, ${cr.errors ?? 0} errors)`
				};
			} else {
				harvestResult = { ok: false, message: data.error || 'Harvest failed' };
			}
		} catch {
			harvestResult = { ok: false, message: 'Network error — could not reach harvest endpoint' };
		}
		harvestTriggering = false;
		// Auto-clear result after 10s
		setTimeout(() => { harvestResult = null; }, 10000);
	}

	function onRefreshFresh() {
		// Bypass Redis cache by appending ?fresh=true
		// The parent onRefresh will be modified to accept this param
		onRefresh();
	}

	const scanTrend = $derived.by(() => {
		if (trends.scans.length < 2) return null;
		const recent = trends.scans.slice(-7);
		const prev = trends.scans.slice(-14, -7);
		const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
		const prevAvg = prev.length > 0 ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;
		if (prevAvg === 0) return null;
		return Math.round(((recentAvg - prevAvg) / prevAvg) * 100);
	});
</script>

<div class="pulse-tab">
	<!-- Status Header -->
	<div class="pulse-header">
		<div class="pulse-status">
			<span class="status-dot {statusDot}"></span>
			<span class="status-label">BOBA Scanner Admin</span>
		</div>
		<button class="refresh-btn" onclick={onRefresh}>Refresh</button>
	</div>

	<!-- Metric Cards -->
	<div class="metric-grid">
		<button class="metric-card" onclick={() => onNavigate('scans')}>
			<div class="metric-value">{metrics.scansToday.toLocaleString()}</div>
			<div class="metric-label">Scans Today</div>
			{#if scanTrend != null}
				<div class="metric-trend" class:positive={scanTrend > 0} class:negative={scanTrend < 0}>
					{scanTrend > 0 ? '+' : ''}{scanTrend}%
				</div>
			{/if}
		</button>

		<button class="metric-card" onclick={() => onNavigate('users')}>
			<div class="metric-value">{metrics.activeUsers}</div>
			<div class="metric-label">Active Users</div>
			{#if metrics.usersToday > 0}
				<div class="metric-trend positive">+{metrics.usersToday} new</div>
			{/if}
		</button>

		<button class="metric-card" onclick={() => onNavigate('scans')}>
			<div class="metric-value">${metrics.aiCostToday.toFixed(2)}</div>
			<div class="metric-label">AI Cost Today</div>
			<div class="metric-sub" class:status-ok={metrics.aiCostToday < 5} class:status-warn={metrics.aiCostToday >= 5}>
				{metrics.aiCostToday < 5 ? 'ok' : 'high'}
			</div>
		</button>

		<button class="metric-card" onclick={() => onNavigate('ebay')}>
			<div class="metric-value">{metrics.ebayRemaining?.toLocaleString() ?? '—'}</div>
			<div class="metric-label">eBay API Left</div>
			{#if ebayPercent != null}
				<div class="metric-sub" class:status-ok={ebayPercent > 20} class:status-warn={ebayPercent <= 20}>
					{ebayPercent}%
				</div>
			{/if}
		</button>

		<button class="metric-card" onclick={() => onNavigate('scans')}>
			<div class="metric-value">{metrics.totalScans.toLocaleString()}</div>
			<div class="metric-label">Total Scans</div>
		</button>

		<button class="metric-card" onclick={() => onNavigate('users')}>
			<div class="metric-value">{metrics.usersToday}</div>
			<div class="metric-label">New Signups</div>
		</button>
	</div>

	<!-- Alerts -->
	{#if alerts.length > 0}
		<div class="alerts-section">
			<h3 class="section-label">Alerts ({alerts.length})</h3>
			{#each alerts as alert}
				<div class="alert-card" class:alert-error={alert.severity === 'error'} class:alert-warning={alert.severity === 'warning'} class:alert-info={alert.severity === 'info'}>
					<div class="alert-content">
						<div class="alert-title">{alert.title}</div>
						<div class="alert-desc">{alert.description}</div>
					</div>
					<div class="alert-actions">
						{#if alert.action === 'review'}
							<button class="alert-btn" onclick={() => onNavigate('cards')}>Review</button>
						{:else if alert.action === 'view-logs'}
							<button class="alert-btn" onclick={() => onNavigate('scans')}>View</button>
						{:else if alert.action === 'view-scans'}
							<button class="alert-btn" onclick={() => onNavigate('scans')}>View</button>
						{/if}
						<button class="alert-dismiss" onclick={() => onDismissAlert(alert.id)}>Dismiss</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- 14-Day Trends -->
	<div class="trends-section">
		<h3 class="section-label">14-Day Trends</h3>
		<div class="trends-grid">
			<div class="trend-row">
				<span class="trend-label">Scans</span>
				<Sparkline data={trends.scans} color="var(--gold)" width={180} height={28} />
			</div>
			<div class="trend-row">
				<span class="trend-label">Users</span>
				<Sparkline data={trends.signups} color="var(--info)" width={180} height={28} />
			</div>
			<div class="trend-row">
				<span class="trend-label">Errors</span>
				<Sparkline data={trends.errors} color="var(--danger)" width={180} height={28} />
			</div>
		</div>
	</div>

	<!-- Quick Actions — real API calls, not just navigation -->
	<div class="quick-actions">
		<h3 class="section-label">Quick Actions</h3>
		<div class="actions-grid">
			<button
				class="action-btn"
				class:action-loading={harvestTriggering}
				onclick={triggerHarvestBatch}
				disabled={harvestTriggering}
			>
				{harvestTriggering ? 'Harvesting...' : 'Trigger Harvest'}
			</button>
			<button class="action-btn" onclick={() => onRefreshFresh()}>
				Force Refresh
			</button>
			<button class="action-btn" onclick={() => onNavigate('features')}>Feature Flags</button>
			<button class="action-btn" onclick={() => onNavigate('scans')}>Error Logs</button>
		</div>
		{#if harvestResult}
			<div class="harvest-result" class:harvest-ok={harvestResult.ok} class:harvest-fail={!harvestResult.ok}>
				{harvestResult.message}
			</div>
		{/if}
	</div>

	<!-- Recent Signups -->
	{#if recentSignups.length > 0}
		<div class="recent-signups">
			<h3 class="section-label">Recent Signups</h3>
			{#each recentSignups.slice(0, 5) as signup}
				<div class="signup-row">
					<span class="signup-email">{signup.name || signup.email}</span>
					<span class="signup-time">{timeAgo(signup.created_at)}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.pulse-tab {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.pulse-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.pulse-status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.status-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.dot-ok { background: var(--success); }
	.dot-warn { background: var(--warning); }
	.dot-error { background: var(--danger); }

	.status-label {
		font-weight: 700;
		font-size: 1rem;
	}

	.refresh-btn {
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		color: var(--text-secondary);
		font-size: 0.8rem;
		cursor: pointer;
	}

	.refresh-btn:hover {
		background: var(--bg-hover);
	}

	/* Metric Cards */
	.metric-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}

	@media (min-width: 768px) {
		.metric-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	@media (min-width: 1024px) {
		.metric-grid {
			grid-template-columns: repeat(6, 1fr);
		}
	}

	.metric-card {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 0.875rem;
		text-align: center;
		border: 1px solid transparent;
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.metric-card:hover {
		border-color: var(--border-strong);
	}

	.metric-value {
		font-size: 1.35rem;
		font-weight: 700;
		color: var(--gold);
	}

	.metric-label {
		font-size: 0.7rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.metric-trend {
		font-size: 0.7rem;
		font-weight: 600;
		margin-top: 0.25rem;
	}

	.metric-trend.positive { color: var(--success); }
	.metric-trend.negative { color: var(--danger); }

	.metric-sub {
		font-size: 0.7rem;
		font-weight: 600;
		margin-top: 0.25rem;
	}

	.status-ok { color: var(--success); }
	.status-warn { color: var(--warning); }

	/* Alerts */
	.section-label {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}

	.alerts-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.alert-card {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		border-radius: 10px;
		border-left: 3px solid;
	}

	.alert-error {
		background: rgba(239, 68, 68, 0.08);
		border-left-color: var(--danger);
	}

	.alert-warning {
		background: rgba(245, 158, 11, 0.08);
		border-left-color: var(--warning);
	}

	.alert-info {
		background: rgba(59, 130, 246, 0.08);
		border-left-color: var(--info);
	}

	.alert-title {
		font-size: 0.85rem;
		font-weight: 600;
	}

	.alert-desc {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin-top: 2px;
	}

	.alert-actions {
		display: flex;
		gap: 0.375rem;
		flex-shrink: 0;
	}

	.alert-btn {
		padding: 0.3rem 0.625rem;
		border-radius: 6px;
		border: 1px solid var(--gold);
		background: transparent;
		color: var(--gold);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}

	.alert-dismiss {
		padding: 0.3rem 0.625rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-tertiary);
		font-size: 0.75rem;
		cursor: pointer;
	}

	/* Trends */
	.trends-section {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
	}

	.trends-grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.trend-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.trend-label {
		font-size: 0.8rem;
		color: var(--text-secondary);
		min-width: 60px;
	}

	/* Quick Actions */
	.actions-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;
	}

	@media (min-width: 768px) {
		.actions-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.action-btn {
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		color: var(--text-secondary);
		font-size: 0.8rem;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s;
	}

	.action-btn:hover {
		border-color: var(--gold);
		color: var(--gold);
	}

	.action-loading {
		opacity: 0.6;
		cursor: wait !important;
	}

	.harvest-result {
		margin-top: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		font-size: 0.8rem;
		font-weight: 500;
	}

	.harvest-ok {
		background: rgba(16, 185, 129, 0.1);
		color: var(--success);
	}

	.harvest-fail {
		background: rgba(239, 68, 68, 0.1);
		color: var(--danger);
	}

	/* Recent Signups */
	.recent-signups {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
	}

	.signup-row {
		display: flex;
		justify-content: space-between;
		padding: 0.375rem 0;
		border-bottom: 1px solid var(--border);
	}

	.signup-row:last-child {
		border-bottom: none;
	}

	.signup-email {
		font-size: 0.8rem;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 200px;
	}

	.signup-time {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		flex-shrink: 0;
	}
</style>
