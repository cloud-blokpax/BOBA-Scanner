<script lang="ts">
	import { isPro, setShowGoProModal } from '$lib/stores/pro.svelte';

	let {
		priceData,
		priceLoading,
		priceError,
		priceErrorReason = null,
		historyData,
		historyLoading,
		showPriceHistory
	}: {
		priceData: { price_mid: number | null; price_low: number | null; price_high: number | null; listings_count: number | null; buy_now_low?: number | null; buy_now_mid?: number | null; buy_now_count?: number | null } | null;
		priceLoading: boolean;
		priceError: boolean;
		priceErrorReason?: string | null;
		historyData: Array<{ date: string; price_mid: number | null }>;
		historyLoading: boolean;
		showPriceHistory: boolean;
	} = $props();
</script>

<!-- Price section -->
<div class="price-section">
	{#if priceLoading}
		<div class="price-loading">
			<div class="price-shimmer"></div>
			<span class="price-loading-text">Checking prices...</span>
		</div>
	{:else if priceData?.buy_now_low}
		<div class="price-label">Buy Now Price</div>
		<div class="price-main">${priceData.buy_now_low.toFixed(2)}</div>
		{#if priceData.buy_now_count && priceData.buy_now_count > 1}
			<div class="price-source">
				Lowest of {priceData.buy_now_count} Buy Now listing{priceData.buy_now_count !== 1 ? 's' : ''} on eBay
			</div>
		{:else if priceData.buy_now_count === 1}
			<div class="price-source">1 Buy Now listing on eBay</div>
		{/if}
	{:else if priceData?.price_mid}
		<div class="price-label">eBay Price</div>
		<div class="price-main">${priceData.price_mid.toFixed(2)}</div>
		<div class="price-source">Based on {priceData.listings_count} listing{priceData.listings_count !== 1 ? 's' : ''} (incl. auctions)</div>
	{:else if priceError}
		<div class="price-unavailable">
			<span>Price unavailable</span>
			{#if priceErrorReason}
				<span class="price-unavailable-sub">{priceErrorReason}</span>
			{/if}
		</div>
	{:else}
		<div class="price-unavailable">
			<span>No pricing data available</span>
			<span class="price-unavailable-sub">This card may be too new or rare for market data</span>
		</div>
	{/if}
</div>

<!-- Price sparkline (premium) -->
{#if showPriceHistory && historyData.length > 1}
	{@const prices = historyData.map(d => d.price_mid).filter((p): p is number => p != null)}
	{@const min = Math.min(...prices)}
	{@const max = Math.max(...prices)}
	{@const range = max - min || 1}
	{@const w = 200}
	{@const h = 40}
	{@const points = prices.map((p, i) => `${(i / (prices.length - 1)) * w},${h - ((p - min) / range) * h}`).join(' ')}
	{@const trend = prices[prices.length - 1] - prices[0]}
	<div class="price-sparkline">
		<div class="sparkline-header">
			<span class="sparkline-label">30-Day Trend</span>
			<span class="sparkline-trend" class:trend-up={trend > 0} class:trend-down={trend < 0}>
				{trend > 0 ? '↑' : trend < 0 ? '↓' : '→'} ${Math.abs(trend).toFixed(2)}
			</span>
		</div>
		<svg viewBox="0 0 {w} {h}" class="sparkline-svg">
			<polyline points={points} fill="none" stroke={trend >= 0 ? '#10b981' : '#ef4444'} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	</div>
{:else if showPriceHistory && historyLoading}
	<div class="price-sparkline"><div class="price-shimmer" style="width: 100%; height: 40px;"></div></div>
{:else if !isPro()}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="pro-preview" onclick={() => setShowGoProModal(true)}>
		<div class="pro-preview-blur">
			<svg viewBox="0 0 200 40" class="sparkline-svg">
				<polyline points="0,30 20,25 40,28 60,20 80,22 100,15 120,18 140,12 160,14 180,10 200,8"
					fill="none" stroke="var(--gold)" stroke-width="2" opacity="0.3" />
			</svg>
		</div>
		<span class="pro-preview-label">Price trends — available with Pro</span>
	</div>
{/if}

<style>
	.price-section { padding: 0.5rem 0; }

	.price-label {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted, #475569);
		margin-bottom: 0.125rem;
	}

	.price-main {
		font-size: 1.75rem;
		font-weight: 800;
		color: var(--success, #10b981);
	}



	.price-source {
		font-size: 0.75rem;
		color: var(--text-muted, #475569);
		margin-top: 0.125rem;
	}

	.price-unavailable {
		text-align: center;
		padding: 0.25rem 0;
	}

	.price-unavailable span:first-child {
		display: block;
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--text-secondary, #94a3b8);
	}

	.price-unavailable-sub {
		display: block;
		font-size: 0.75rem;
		color: var(--text-muted, #475569);
		margin-top: 0.25rem;
	}

	.price-loading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.price-shimmer {
		width: 80px;
		height: 24px;
		border-radius: 4px;
		background: linear-gradient(
			90deg,
			var(--bg-elevated, #121d34) 25%,
			var(--bg-hover, #182540) 50%,
			var(--bg-elevated, #121d34) 75%
		);
		background-size: 200% 100%;
		animation: shimmer 1.8s linear infinite;
	}

	.price-loading-text {
		font-size: 0.8rem;
		color: var(--text-muted, #475569);
	}

	@keyframes shimmer {
		0% { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}

	.price-sparkline { padding: 0.5rem 0; }
	.sparkline-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
	.sparkline-label { font-size: 0.7rem; color: var(--text-muted, #475569); text-transform: uppercase; letter-spacing: 0.04em; }
	.sparkline-trend { font-size: 0.8rem; font-weight: 600; }
	.trend-up { color: var(--success, #10b981); }
	.trend-down { color: var(--danger, #ef4444); }
	.sparkline-svg { width: 100%; height: 40px; }

	.pro-preview {
		cursor: pointer;
		position: relative;
		padding: 0.5rem;
		border-radius: 8px;
		background: var(--bg-elevated);
		text-align: center;
		margin: 0.5rem 0;
	}
	.pro-preview-blur {
		filter: blur(2px);
		opacity: 0.5;
	}
	.pro-preview-label {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--gold);
	}
</style>
