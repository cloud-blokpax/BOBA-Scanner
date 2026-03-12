<script lang="ts">
	import { onMount } from 'svelte';
	import { getPrice } from '$lib/stores/prices';
	import type { PriceData } from '$lib/types';

	let { cardId }: { cardId: string } = $props();

	let priceData = $state<PriceData | null>(null);
	let loading = $state(true);

	onMount(async () => {
		priceData = await getPrice(cardId);
		loading = false;
	});

	function formatPrice(val: number | null): string {
		if (val === null || val === undefined) return '--';
		return `$${val.toFixed(2)}`;
	}
</script>

<div class="price-display">
	{#if loading}
		<span class="price-loading">Loading prices...</span>
	{:else if priceData && priceData.listings_count && priceData.listings_count > 0}
		<div class="price-row">
			<span class="price-label">Low</span>
			<span class="price-value">{formatPrice(priceData.price_low)}</span>
		</div>
		<div class="price-row primary">
			<span class="price-label">Mid</span>
			<span class="price-value">{formatPrice(priceData.price_mid)}</span>
		</div>
		<div class="price-row">
			<span class="price-label">High</span>
			<span class="price-value">{formatPrice(priceData.price_high)}</span>
		</div>
		<span class="price-count">{priceData.listings_count} active listings</span>
	{:else}
		<span class="price-empty">No listings found</span>
	{/if}
</div>

<style>
	.price-display {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
	}

	.price-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.25rem 0;
	}

	.price-row.primary .price-value {
		font-weight: 700;
		font-size: 1.1rem;
		color: var(--accent-gold, #f59e0b);
	}

	.price-label {
		color: var(--text-secondary, #94a3b8);
		font-size: 0.85rem;
	}

	.price-value {
		font-weight: 600;
	}

	.price-count {
		font-size: 0.8rem;
		color: var(--text-tertiary, #64748b);
		margin-top: 0.25rem;
	}

	.price-loading,
	.price-empty {
		color: var(--text-secondary, #94a3b8);
		font-size: 0.85rem;
	}
</style>
