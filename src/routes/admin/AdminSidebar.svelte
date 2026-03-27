<script lang="ts">
	import Sparkline from './Sparkline.svelte';

	interface AdminMetrics {
		totalUsers: number;
		activeUsers: number;
		scansToday: number;
		aiCostToday: number;
		aiCostMTD: number;
		totalCards: number;
		ebayRemaining: number | null;
		ebayLimit: number | null;
		errorsToday: number;
		scanFlagsPending: number;
	}

	let { metrics, health, alertCount = 0 }: {
		metrics: AdminMetrics;
		health: Record<string, { status: string; message?: string }>;
		alertCount?: number;
	} = $props();

	const overallStatus = $derived.by(() => {
		if (!health) return 'unknown';
		const statuses = Object.values(health).map((h) => h.status);
		if (statuses.some((s) => s === 'down')) return 'down';
		if (statuses.some((s) => s === 'degraded')) return 'degraded';
		return 'ok';
	});

	const statusLabel = $derived(
		overallStatus === 'ok' ? 'System OK' : overallStatus === 'degraded' ? 'Degraded' : 'Issues'
	);

	const statusColor = $derived(
		overallStatus === 'ok' ? 'var(--success)' : overallStatus === 'degraded' ? 'var(--warning)' : 'var(--danger)'
	);

	const ebayPercent = $derived(
		metrics.ebayLimit && metrics.ebayRemaining != null
			? Math.round((metrics.ebayRemaining / metrics.ebayLimit) * 100)
			: null
	);
</script>

<aside class="sidebar">
	<div class="status-badge" style:--status-color={statusColor}>
		<span class="status-dot"></span>
		<span class="status-text">{statusLabel}</span>
	</div>

	<div class="sidebar-metrics">
		<div class="sb-metric">
			<span class="sb-label">Scans Today</span>
			<span class="sb-value">{metrics.scansToday.toLocaleString()}</span>
		</div>

		<div class="sb-metric">
			<span class="sb-label">Active Users</span>
			<span class="sb-value">{metrics.activeUsers}</span>
		</div>

		<div class="sb-metric">
			<span class="sb-label">AI Cost MTD</span>
			<span class="sb-value">${metrics.aiCostMTD.toFixed(2)}</span>
		</div>

		<div class="sb-metric">
			<span class="sb-label">eBay API</span>
			{#if ebayPercent != null}
				<div class="progress-bar">
					<div
						class="progress-fill"
						style:width="{ebayPercent}%"
						class:low={ebayPercent < 20}
						class:mid={ebayPercent >= 20 && ebayPercent < 50}
					></div>
				</div>
				<span class="sb-sub">{ebayPercent}%</span>
			{:else}
				<span class="sb-sub">N/A</span>
			{/if}
		</div>

		<div class="sb-metric">
			<span class="sb-label">Cards in DB</span>
			<span class="sb-value">{metrics.totalCards.toLocaleString()}</span>
		</div>

		{#if alertCount > 0}
			<div class="sb-metric alert-metric">
				<span class="sb-label">Alerts</span>
				<span class="sb-value alert-value">{alertCount}</span>
			</div>
		{/if}
	</div>

	<div class="sidebar-health">
		<span class="sb-label">Services</span>
		<div class="health-list">
			{#each Object.entries(health || {}) as [name, check]}
				<div class="health-row">
					<span
						class="health-dot"
						class:ok={check.status === 'ok'}
						class:degraded={check.status === 'degraded'}
						class:down={check.status === 'down'}
					></span>
					<span class="health-name">{name}</span>
				</div>
			{/each}
		</div>
	</div>
</aside>

<style>
	.sidebar {
		width: 200px;
		flex-shrink: 0;
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		height: fit-content;
		position: sticky;
		top: 5rem;
	}

	.status-badge {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		background: color-mix(in srgb, var(--status-color) 12%, transparent);
	}

	.status-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--status-color);
		flex-shrink: 0;
	}

	.status-text {
		font-weight: 700;
		font-size: 0.85rem;
		color: var(--status-color);
	}

	.sidebar-metrics {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.sb-metric {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.sb-label {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.sb-value {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.sb-sub {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.progress-bar {
		width: 100%;
		height: 6px;
		border-radius: 3px;
		background: var(--bg-hover);
		overflow: hidden;
		margin-top: 4px;
	}

	.progress-fill {
		height: 100%;
		border-radius: 3px;
		background: var(--success);
		transition: width 0.3s ease;
	}

	.progress-fill.low {
		background: var(--danger);
	}

	.progress-fill.mid {
		background: var(--warning);
	}

	.alert-metric .alert-value {
		color: var(--warning);
	}

	.sidebar-health {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
	}

	.health-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.health-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.health-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		background: var(--text-tertiary);
	}

	.health-dot.ok { background: var(--success); }
	.health-dot.degraded { background: var(--warning); }
	.health-dot.down { background: var(--danger); }

	.health-name {
		font-size: 0.75rem;
		color: var(--text-secondary);
		text-transform: capitalize;
	}
</style>
