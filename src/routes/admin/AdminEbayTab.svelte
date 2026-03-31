<script lang="ts">
	import { getSupabase } from '$lib/services/supabase';
	import { showToast } from '$lib/stores/toast.svelte';
	import Sparkline from './Sparkline.svelte';
	import HarvestResults from './HarvestResults.svelte';

	let loading = $state(true);
	let triggeringHarvest = $state(false);
	let ebayMetrics = $state({
		callsRemaining: null as number | null,
		callsLimit: null as number | null,
		resetAt: null as string | null,
		cacheHits: 0,
		totalPrices: 0,
		stalePrices: 0
	});

	$effect(() => {
		loadEbay();
	});

	async function loadEbay() {
		loading = true;
		const client = getSupabase();
		if (!client) { loading = false; return; }

		try {
			// ebay_api_log is not in generated Supabase types yet
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const [quotaRes, pricesRes, staleRes] = await Promise.all([
				(client as any).from('ebay_api_log')
					.select('calls_remaining, calls_limit, reset_at, status, chain_depth, cards_processed, cards_updated, recorded_at')
					.order('recorded_at', { ascending: false })
					.limit(1)
					.maybeSingle(),
				client.from('price_cache').select('id', { count: 'exact', head: true }),
				client.from('price_cache').select('id', { count: 'exact', head: true })
					.lt('fetched_at', new Date(Date.now() - 7 * 86400000).toISOString())
			]);

			if (quotaRes.data) {
				const q = quotaRes.data as Record<string, unknown>;
				ebayMetrics.callsRemaining = q.calls_remaining as number | null;
				ebayMetrics.callsLimit = q.calls_limit as number | null;
				ebayMetrics.resetAt = q.reset_at as string | null;
			}

			ebayMetrics.totalPrices = pricesRes.count || 0;
			ebayMetrics.stalePrices = staleRes.count || 0;
		} catch {
			showToast('Failed to load eBay data', 'x');
		}
		loading = false;
	}

	const usedPercent = $derived(
		ebayMetrics.callsLimit && ebayMetrics.callsRemaining != null
			? Math.round(((ebayMetrics.callsLimit - ebayMetrics.callsRemaining) / ebayMetrics.callsLimit) * 100)
			: null
	);

	const remainingPercent = $derived(
		ebayMetrics.callsLimit && ebayMetrics.callsRemaining != null
			? Math.round((ebayMetrics.callsRemaining / ebayMetrics.callsLimit) * 100)
			: null
	);

	function formatResetTime(): string {
		if (!ebayMetrics.resetAt) return 'Unknown';
		const reset = new Date(ebayMetrics.resetAt);
		const diff = reset.getTime() - Date.now();
		if (diff < 0) return 'Overdue';
		const hours = Math.floor(diff / 3600000);
		const mins = Math.floor((diff % 3600000) / 60000);
		return `${hours}h ${mins}m`;
	}

	async function triggerHarvest() {
		triggeringHarvest = true;
		try {
			const res = await fetch('/api/admin/trigger-harvest', { method: 'POST' });
			const data = await res.json();

			if (!res.ok) {
				showToast(data.error || `Trigger failed: ${res.status}`, 'x');
				return;
			}

			if (data.cronResponse?.skipped) {
				showToast(`Harvest skipped: ${data.cronResponse.reason}`, 'x');
			} else if (data.cronResponse?.stopped) {
				showToast(`Harvest stopped: ${data.cronResponse.reason}`, 'x');
			} else {
				const processed = data.cronResponse?.processed ?? 0;
				const updated = data.cronResponse?.updated ?? 0;
				showToast(`Harvest started! First batch: ${processed} processed, ${updated} updated`, 'check');
			}

			// Refresh the tab data after a short delay to let the first chain link finish
			setTimeout(() => loadEbay(), 2000);
		} catch {
			showToast('Failed to trigger harvest', 'x');
		} finally {
			triggeringHarvest = false;
		}
	}
</script>

<div class="ebay-tab">
	{#if loading}
		<div class="loading">Loading eBay data...</div>
	{:else}
		<!-- Status Cards -->
		<div class="metrics-row">
			<div class="mini-card">
				<div class="mc-value">{ebayMetrics.callsRemaining?.toLocaleString() ?? '—'}</div>
				<div class="mc-label">Calls Remaining</div>
			</div>
			<div class="mini-card">
				<div class="mc-value">{ebayMetrics.callsLimit?.toLocaleString() ?? '—'}</div>
				<div class="mc-label">Daily Limit</div>
			</div>
			<div class="mini-card">
				<div class="mc-value">{formatResetTime()}</div>
				<div class="mc-label">Until Reset</div>
			</div>
			<div class="mini-card">
				<div class="mc-value">{ebayMetrics.totalPrices.toLocaleString()}</div>
				<div class="mc-label">Cached Prices</div>
			</div>
		</div>

		<!-- Usage Gauge -->
		{#if usedPercent != null}
			<div class="gauge-section">
				<h3 class="section-title">API Quota Usage</h3>
				<div class="gauge-bar">
					<div
						class="gauge-fill"
						style:width="{usedPercent}%"
						class:low={remainingPercent != null && remainingPercent > 50}
						class:mid={remainingPercent != null && remainingPercent <= 50 && remainingPercent > 20}
						class:high={remainingPercent != null && remainingPercent <= 20}
					></div>
				</div>
				<div class="gauge-labels">
					<span>{usedPercent}% used</span>
					<span>{remainingPercent}% remaining</span>
				</div>
			</div>
		{/if}

		<!-- Price Freshness -->
		<div class="info-section">
			<h3 class="section-title">Price Freshness</h3>
			<div class="info-rows">
				<div class="info-row">
					<span>Total cached prices</span>
					<strong>{ebayMetrics.totalPrices}</strong>
				</div>
				<div class="info-row">
					<span>Stale prices (&gt;7 days)</span>
					<strong class="warn">{ebayMetrics.stalePrices}</strong>
				</div>
				{#if ebayMetrics.totalPrices > 0}
					<div class="info-row">
						<span>Fresh rate</span>
						<strong>{Math.round(((ebayMetrics.totalPrices - ebayMetrics.stalePrices) / ebayMetrics.totalPrices) * 100)}%</strong>
					</div>
				{/if}
			</div>
		</div>

		<!-- Actions -->
		<div class="actions-section">
			<h3 class="section-title">Actions</h3>
			<div class="actions-grid">
				<button class="action-btn primary" onclick={triggerHarvest} disabled={triggeringHarvest}>
					{triggeringHarvest ? 'Running...' : 'Trigger Price Harvest'}
				</button>
				<button class="action-btn" onclick={loadEbay}>Refresh Status</button>
			</div>
		</div>

		<!-- Harvest Results -->
		<HarvestResults />
	{/if}
</div>

<style>
	.ebay-tab {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.loading {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}

	.metrics-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
		gap: 0.5rem;
	}

	.mini-card {
		background: var(--bg-elevated);
		border-radius: 10px;
		padding: 0.75rem;
		text-align: center;
	}

	.mc-value {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--gold);
	}

	.mc-label {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		margin-top: 2px;
	}

	.section-title {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}

	.gauge-section {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
	}

	.gauge-bar {
		width: 100%;
		height: 12px;
		border-radius: 6px;
		background: var(--bg-hover);
		overflow: hidden;
	}

	.gauge-fill {
		height: 100%;
		border-radius: 6px;
		transition: width 0.3s;
	}

	.gauge-fill.low { background: var(--success); }
	.gauge-fill.mid { background: var(--warning); }
	.gauge-fill.high { background: var(--danger); }

	.gauge-labels {
		display: flex;
		justify-content: space-between;
		margin-top: 0.375rem;
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.info-section {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
	}

	.info-rows {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.info-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
	}

	.info-row span { color: var(--text-secondary); }
	.warn { color: var(--warning); }

	.actions-section {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
	}

	.actions-grid {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.action-btn {
		padding: 0.625rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-secondary);
		font-size: 0.85rem;
		cursor: pointer;
		font-weight: 500;
	}

	.action-btn:hover {
		border-color: var(--border-strong);
	}

	.action-btn.primary {
		border-color: var(--gold);
		color: var(--gold);
	}

	.action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
