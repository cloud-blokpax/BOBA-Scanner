<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import Sparkline from './Sparkline.svelte';
	import HarvestResults from './HarvestResults.svelte';
	import AdminCardPrices from './AdminCardPrices.svelte';

	let loading = $state(true);
	interface PriceStatusGroup {
		card_type: string;
		has_price: number;
		searched_no_price: number;
		not_searched: number;
		total: number;
	}

	let ebayMetrics = $state({
		callsRemaining: null as number | null,
		callsLimit: null as number | null,
		resetAt: null as string | null,
		cacheHits: 0,
		totalPrices: 0,
		stalePrices: 0,
		priceStatus: [] as PriceStatusGroup[]
	});

	// ── Harvest runner state ─────────────────────────────
	let harvestRunning = $state(false);
	let harvestStopping = $state(false);
	let harvestMode = $state<'single' | 'continuous'>('continuous');
	let harvestProgress = $state({
		batches: 0,
		processed: 0,
		updated: 0,
		errors: 0,
		callsUsed: 0,
		startedAt: null as number | null,
		lastStatus: ''
	});
	let stopRequested = false;

	// ── Confidence threshold ─────────────────────────────
	let confidenceThreshold = $state(0);
	let savingThreshold = $state(false);

	// ── Card price browser ──────────────────────────────
	let showCardPrices = $state(false);

	$effect(() => {
		loadEbay();
	});

	async function loadEbay() {
		loading = true;
		try {
			// Load confidence threshold (non-critical)
			try {
				const configRes = await fetch('/api/admin/harvest-config');
				if (configRes.ok) {
					const configData = await configRes.json();
					confidenceThreshold = configData.confidenceThreshold;
				}
			} catch { /* non-critical */ }

			const res = await fetch('/api/admin/ebay-metrics');
			if (!res.ok) throw new Error('Failed to load eBay metrics');
			const data = await res.json();

			ebayMetrics.callsRemaining = data.callsRemaining;
			ebayMetrics.callsLimit = data.callsLimit;
			ebayMetrics.resetAt = data.resetAt;
			ebayMetrics.totalPrices = data.totalPrices;
			ebayMetrics.stalePrices = data.stalePrices;
			ebayMetrics.priceStatus = data.priceStatus ?? [];
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

	function formatElapsed(): string {
		if (!harvestProgress.startedAt) return '0s';
		const elapsed = Math.round((Date.now() - harvestProgress.startedAt) / 1000);
		if (elapsed < 60) return `${elapsed}s`;
		const mins = Math.floor(elapsed / 60);
		const secs = elapsed % 60;
		return `${mins}m ${secs}s`;
	}

	// ── Harvest runner ───────────────────────────────────

	async function startHarvest() {
		harvestRunning = true;
		harvestStopping = false;
		stopRequested = false;
		harvestProgress = {
			batches: 0,
			processed: 0,
			updated: 0,
			errors: 0,
			callsUsed: 0,
			startedAt: Date.now(),
			lastStatus: 'Starting...'
		};

		const maxBatches = harvestMode === 'single' ? 1 : 10000;

		for (let batch = 0; batch < maxBatches; batch++) {
			if (stopRequested) {
				harvestProgress.lastStatus = 'Stopped by user';
				break;
			}

			try {
				const res = await fetch('/api/admin/trigger-harvest', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ chainDepth: batch })
				});

				if (!res.ok) {
					// Parse error body for diagnostic info
					let errorDetail = `HTTP ${res.status}`;
					try {
						const errData = await res.json();
						errorDetail = errData.error || errData.detail || errorDetail;
					} catch { /* use default */ }

					// Retry on transient 502/503/504 (up to 2 retries with backoff)
					if (res.status >= 502 && res.status <= 504 && (harvestProgress.errors % 3) < 2) {
						harvestProgress.lastStatus = `${errorDetail} — retrying...`;
						harvestProgress.errors++;
						await new Promise(r => setTimeout(r, 3000 * ((harvestProgress.errors % 3) + 1)));
						continue;
					}

					harvestProgress.lastStatus = errorDetail;
					harvestProgress.errors++;
					break;
				}

				const data = await res.json();
				const cron = data.cronResponse;

				if (!cron) {
					harvestProgress.lastStatus = 'No response from cron';
					break;
				}

				// Cron returned a skip/stop
				if (cron.skipped) {
					harvestProgress.lastStatus = `Skipped: ${cron.reason}`;
					break;
				}
				if (cron.stopped) {
					harvestProgress.lastStatus = `Done: ${cron.reason}`;
					break;
				}

				// Successful batch
				harvestProgress.batches++;
				harvestProgress.processed += cron.processed || 0;
				harvestProgress.updated += cron.updated || 0;
				harvestProgress.errors += cron.errors || 0;
				harvestProgress.callsUsed = 5000 - (cron.remainingBefore || 5000) + (cron.processed || 0);
				harvestProgress.lastStatus = `Batch ${batch + 1}: ${cron.processed} cards`;

			} catch (err) {
				harvestProgress.lastStatus = 'Network error';
				harvestProgress.errors++;
				// Retry after a short delay
				await new Promise(r => setTimeout(r, 2000));
				continue;
			}

			// Small delay between batches to avoid overwhelming the API
			if (harvestMode === 'continuous') {
				await new Promise(r => setTimeout(r, 500));
			}
		}

		harvestRunning = false;
		harvestStopping = false;
		showToast(`Harvest complete: ${harvestProgress.processed} cards processed`, 'check');
		loadEbay();
	}

	function stopHarvest() {
		stopRequested = true;
		harvestStopping = true;
		harvestProgress.lastStatus = 'Stopping after current batch...';
	}

	async function saveThreshold() {
		savingThreshold = true;
		try {
			const res = await fetch('/api/admin/harvest-config', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ confidenceThreshold })
			});
			if (!res.ok) {
				showToast('Failed to save threshold', 'x');
				return;
			}
			showToast(`Threshold set to ${confidenceThreshold}%`, 'check');
		} catch {
			showToast('Failed to save threshold', 'x');
		} finally {
			savingThreshold = false;
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

		<!-- Price Status Summary -->
		<div class="info-section">
			<h3 class="section-title">Price Status Summary</h3>
			{#if ebayMetrics.priceStatus.length > 0}
				{#each ebayMetrics.priceStatus as group}
					{@const label = group.card_type === 'heroes' ? 'Heroes' : group.card_type === 'plays' ? 'Plays' : 'Hot Dogs'}
					{@const pricedPct = group.total > 0 ? Math.round((group.has_price / group.total) * 100) : 0}
					{@const searchedPct = group.total > 0 ? Math.round(((group.has_price + group.searched_no_price) / group.total) * 100) : 0}
					<div class="status-group">
						<div class="status-group-header">
							<span class="status-group-title">{label}</span>
							<span class="status-group-total">{group.total.toLocaleString()} cards</span>
						</div>
						<div class="info-rows">
							<div class="info-row">
								<span>Has a price</span>
								<strong class="success">{group.has_price.toLocaleString()}</strong>
							</div>
							<div class="info-row">
								<span>Searched, none found</span>
								<strong class="warn">{group.searched_no_price.toLocaleString()}</strong>
							</div>
							<div class="info-row">
								<span>Not yet searched</span>
								<strong>{group.not_searched.toLocaleString()}</strong>
							</div>
						</div>
						{#if group.total > 0}
							<div class="status-gauge">
								<div class="gauge-bar">
									<div class="gauge-fill low" style:width="{pricedPct}%"></div>
								</div>
								<div class="gauge-labels">
									<span>{pricedPct}% priced</span>
									<span>{searchedPct}% searched</span>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			{:else}
				<p class="empty-status">Loading price status...</p>
			{/if}
		</div>

		<!-- Confidence Threshold -->
		<div class="info-section">
			<h3 class="section-title">Confidence Threshold</h3>
			<p class="threshold-desc">Prices below this confidence score will be logged but not cached. Currently: <strong>{confidenceThreshold}%</strong></p>
			<div class="threshold-control">
				<input
					type="range"
					min="0"
					max="100"
					step="5"
					bind:value={confidenceThreshold}
					class="threshold-slider"
				/>
				<span class="threshold-value">{confidenceThreshold}%</span>
				<button class="action-btn" onclick={saveThreshold} disabled={savingThreshold}>
					{savingThreshold ? 'Saving...' : 'Save'}
				</button>
			</div>
		</div>

		<!-- Harvest Runner -->
		<div class="actions-section">
			<h3 class="section-title">Price Harvest</h3>

			{#if !harvestRunning}
				<div class="mode-selector">
					<button
						class="mode-btn"
						class:active={harvestMode === 'single'}
						onclick={() => harvestMode = 'single'}
					>Single Batch (9 cards)</button>
					<button
						class="mode-btn"
						class:active={harvestMode === 'continuous'}
						onclick={() => harvestMode = 'continuous'}
					>Run Until Done</button>
				</div>

				<div class="actions-grid">
					<button class="action-btn primary" onclick={startHarvest}>
						{harvestMode === 'single' ? 'Run Single Batch' : 'Start Harvest'}
					</button>
					<button class="action-btn" onclick={loadEbay}>Refresh Status</button>
				</div>
			{:else}
				<!-- Live Progress -->
				<div class="harvest-live">
					<div class="live-header">
						<span class="live-dot"></span>
						<span class="live-label">Harvesting...</span>
						<span class="live-elapsed">{formatElapsed()}</span>
					</div>

					<div class="live-stats">
						<div class="live-stat">
							<span class="ls-value">{harvestProgress.batches}</span>
							<span class="ls-label">Batches</span>
						</div>
						<div class="live-stat">
							<span class="ls-value">{harvestProgress.processed}</span>
							<span class="ls-label">Cards</span>
						</div>
						<div class="live-stat">
							<span class="ls-value">{harvestProgress.updated}</span>
							<span class="ls-label">Priced</span>
						</div>
						<div class="live-stat">
							<span class="ls-value" class:warn={harvestProgress.errors > 0}>{harvestProgress.errors}</span>
							<span class="ls-label">Errors</span>
						</div>
					</div>

					<div class="live-status">{harvestProgress.lastStatus}</div>

					<button
						class="action-btn stop-btn"
						onclick={stopHarvest}
						disabled={harvestStopping}
					>
						{harvestStopping ? 'Stopping...' : 'Stop Harvest'}
					</button>
				</div>
			{/if}
		</div>

		<!-- Harvest Results -->
		<HarvestResults />

		<!-- Card Price Browser -->
		<div class="actions-section">
			<div class="section-header-row">
				<h3 class="section-title">Card Price Browser</h3>
				<button class="action-btn" onclick={() => showCardPrices = !showCardPrices}>
					{showCardPrices ? 'Hide' : 'Show All Cards'}
				</button>
			</div>
			{#if showCardPrices}
				<AdminCardPrices />
			{/if}
		</div>
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
	.success { color: var(--success); }

	.status-group {
		margin-bottom: 1rem;
	}

	.status-group:last-child {
		margin-bottom: 0;
	}

	.status-group-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 0.375rem;
	}

	.status-group-title {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.status-group-total {
		font-size: 0.7rem;
		color: var(--text-tertiary);
	}

	.status-gauge {
		margin-top: 0.375rem;
	}

	.empty-status {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		text-align: center;
		padding: 0.5rem 0;
	}

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

	.threshold-desc {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		margin-bottom: 0.75rem;
	}

	.threshold-control {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.threshold-slider {
		flex: 1;
		accent-color: var(--gold);
		height: 6px;
	}

	.threshold-value {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--gold);
		min-width: 3rem;
		text-align: center;
	}

	.mode-selector {
		display: flex;
		gap: 0.35rem;
		margin-bottom: 0.75rem;
	}

	.mode-btn {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-tertiary);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.mode-btn:hover {
		border-color: var(--border-strong);
		color: var(--text-secondary);
	}

	.mode-btn.active {
		border-color: var(--gold);
		color: var(--gold);
		background: var(--bg-elevated);
	}

	.harvest-live {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.live-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.live-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--success);
		animation: pulse 1.5s infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.3; }
	}

	.live-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.live-elapsed {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}

	.live-stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.35rem;
	}

	.live-stat {
		text-align: center;
		background: var(--bg-hover);
		border-radius: 8px;
		padding: 0.5rem 0.25rem;
	}

	.ls-value {
		display: block;
		font-size: 1rem;
		font-weight: 700;
		color: var(--gold);
		font-variant-numeric: tabular-nums;
	}

	.ls-value.warn { color: var(--warning); }

	.ls-label {
		display: block;
		font-size: 0.65rem;
		color: var(--text-tertiary);
		margin-top: 1px;
	}

	.live-status {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	.stop-btn {
		border-color: var(--danger) !important;
		color: var(--danger) !important;
		width: 100%;
	}

	.section-header-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.section-header-row .section-title {
		margin-bottom: 0;
	}
</style>
