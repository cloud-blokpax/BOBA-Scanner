<script lang="ts">
	// NOTE: This component is not currently mounted anywhere in the app.
	// It provides price alerts and a more detailed sparkline than the inline
	// version in ScanConfirmation.svelte. Intended for future use in CardDetail
	// or a dedicated price dashboard. See Fix 7 for a bug fix applied here.
	import { browser } from '$app/environment';

	const HISTORY_KEY = 'priceHistory';
	const ALERTS_KEY = 'priceAlerts';

	interface PricePoint {
		avg: number;
		low: number;
		high: number;
		sold: number;
		count: number;
		ts: number;
	}

	interface PriceAlert {
		cardNumber: string;
		heroName: string;
		targetPrice: number;
		direction: 'below' | 'above';
		created: string;
		triggered: boolean;
	}

	let {
		cardNumber,
		heroName = '',
		currentPrice = null
	}: {
		cardNumber: string;
		heroName?: string;
		currentPrice?: number | null;
	} = $props();

	let showAlertModal = $state(false);
	let alertDirection = $state<'below' | 'above'>('below');
	let alertTarget = $state(0);

	// Update alert target when currentPrice changes
	$effect(() => {
		if (currentPrice != null) alertTarget = currentPrice;
	});
	let alerts = $state<PriceAlert[]>(loadAlerts());
	let history = $state<PricePoint[]>(loadHistory());

	function loadHistory(): PricePoint[] {
		if (!browser) return [];
		try {
			const raw = localStorage.getItem(HISTORY_KEY);
			if (!raw) return [];
			const all: Record<string, PricePoint[]> = JSON.parse(raw);
			return all[cardNumber] || [];
		} catch (err) {
			console.debug('[PriceTrends] Price history load failed:', err);
			return [];
		}
	}

	function loadAlerts(): PriceAlert[] {
		if (!browser) return [];
		try {
			const raw = localStorage.getItem(ALERTS_KEY);
			return raw ? JSON.parse(raw) : [];
		} catch (err) {
			console.debug('[PriceTrends] Alerts load failed:', err);
			return [];
		}
	}

	function saveAlerts(a: PriceAlert[]): void {
		if (!browser) return;
		localStorage.setItem(ALERTS_KEY, JSON.stringify(a));
	}

	function addAlert(): void {
		const alert: PriceAlert = {
			cardNumber,
			heroName,
			targetPrice: alertTarget,
			direction: alertDirection,
			created: new Date().toISOString(),
			triggered: false
		};
		alerts = [...alerts, alert];
		saveAlerts(alerts);
		showAlertModal = false;
	}

	function removeAlert(alert: PriceAlert): void {
		alerts = alerts.filter(
			(a) =>
				!(a.cardNumber === alert.cardNumber &&
				  a.direction === alert.direction &&
				  a.targetPrice === alert.targetPrice &&
				  a.created === alert.created)
		);
		saveAlerts(alerts);
	}

	let cardAlerts = $derived(alerts.filter((a) => a.cardNumber === cardNumber));

	// SVG sparkline
	const WIDTH = 200;
	const HEIGHT = 60;
	const PADDING = 4;

	let svgPoints = $derived.by(() => {
		if (history.length < 2) return '';
		const prices = history.map((p) => p.avg);
		const min = Math.min(...prices);
		const max = Math.max(...prices);
		const range = max - min || 1;
		return history
			.map((p, i) => {
				const x = PADDING + (i / (history.length - 1)) * (WIDTH - PADDING * 2);
				const y = HEIGHT - PADDING - ((p.avg - min) / range) * (HEIGHT - PADDING * 2);
				return `${x},${y}`;
			})
			.join(' ');
	});

	let trend = $derived.by(() => {
		if (history.length < 2) return null;
		const first = history[0].avg;
		const last = history[history.length - 1].avg;
		if (first === 0) return null;
		return ((last - first) / first) * 100;
	});
</script>

<div class="price-trends">
	{#if history.length >= 2}
		<div class="chart-container">
			<svg viewBox="0 0 {WIDTH} {HEIGHT}" class="sparkline">
				<defs>
					<linearGradient id="grad-{cardNumber}" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stop-color="var(--accent-primary)" stop-opacity="0.3" />
						<stop offset="100%" stop-color="var(--accent-primary)" stop-opacity="0" />
					</linearGradient>
				</defs>
				<polyline
					fill="none"
					stroke="var(--accent-primary)"
					stroke-width="2"
					points={svgPoints}
				/>
				<polygon
					fill="url(#grad-{cardNumber})"
					points="{PADDING},{HEIGHT - PADDING} {svgPoints} {WIDTH - PADDING},{HEIGHT - PADDING}"
				/>
			</svg>
			{#if trend !== null}
				<span class="trend" class:positive={trend > 0} class:negative={trend < 0}>
					{trend > 0 ? '+' : ''}{trend.toFixed(1)}%
				</span>
			{/if}
		</div>
	{:else}
		<p class="no-data">Not enough price history to show a trend.</p>
	{/if}

	<div class="alerts-section">
		<div class="alerts-header">
			<span class="alerts-title">Price Alerts</span>
			<button class="btn-small" onclick={() => (showAlertModal = true)}>+ Alert</button>
		</div>

		{#if cardAlerts.length > 0}
			<div class="alerts-list">
				{#each cardAlerts as alert, i}
					<div class="alert-item">
						<span>{alert.direction === 'below' ? 'Below' : 'Above'} ${alert.targetPrice.toFixed(2)}</span>
						<button class="alert-remove" onclick={() => removeAlert(alert)}>x</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	{#if showAlertModal}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="alert-modal-backdrop" role="presentation" onclick={() => (showAlertModal = false)}>
			<div class="alert-modal" role="dialog" tabindex="-1" aria-label="Set Price Alert" onclick={(e) => e.stopPropagation()}>
				<h4>Set Price Alert</h4>
				<p class="alert-card-name">{heroName || cardNumber}</p>

				<div class="alert-form">
					<select bind:value={alertDirection}>
						<option value="below">Falls below</option>
						<option value="above">Rises above</option>
					</select>
					<input type="number" bind:value={alertTarget} min="0" step="0.01" />
				</div>

				<div class="alert-actions">
					<button class="btn-secondary" onclick={() => (showAlertModal = false)}>Cancel</button>
					<button class="btn-primary" onclick={addAlert}>Set Alert</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.price-trends {
		padding: 0.75rem 0;
	}
	.chart-container {
		position: relative;
		margin-bottom: 0.75rem;
	}
	.sparkline {
		width: 100%;
		height: 60px;
	}
	.trend {
		position: absolute;
		top: 4px;
		right: 4px;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: 4px;
		background: var(--bg-elevated);
	}
	.trend.positive { color: #22c55e; }
	.trend.negative { color: #ef4444; }
	.no-data {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		text-align: center;
		padding: 1rem 0;
	}
	.alerts-section { margin-top: 0.5rem; }
	.alerts-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.alerts-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-secondary);
	}
	.btn-small {
		font-size: 0.75rem;
		padding: 2px 8px;
		border-radius: 4px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-primary);
		cursor: pointer;
	}
	.btn-small:hover { background: var(--bg-hover); }
	.alerts-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.alert-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.375rem 0.5rem;
		border-radius: 6px;
		background: var(--bg-elevated);
		font-size: 0.8rem;
	}
	.alert-remove {
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		font-size: 0.9rem;
	}
	.alert-modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 200;
	}
	.alert-modal {
		background: var(--bg-base);
		border-radius: 12px;
		padding: 1.25rem;
		width: min(90vw, 320px);
	}
	h4 { font-size: 1rem; margin-bottom: 0.25rem; }
	.alert-card-name {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}
	.alert-form {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.alert-form select,
	.alert-form input {
		flex: 1;
		padding: 0.5rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.85rem;
	}
	.alert-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}
</style>
