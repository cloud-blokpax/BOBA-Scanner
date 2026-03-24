<script lang="ts">
	import { getPrice } from '$lib/stores/prices.svelte';
	import { buildEbaySearchUrl } from '$lib/services/ebay';
	import AffiliateNotice from '$lib/components/AffiliateNotice.svelte';
	import type { PriceData, Card } from '$lib/types';

	let {
		cardId,
		card = null
	}: {
		cardId: string;
		card?: Card | null;
	} = $props();

	// Build eBay search URL if we have card metadata
	const ebayUrl = $derived(
		card ? buildEbaySearchUrl({
			card_number: card.card_number,
			hero_name: card.hero_name,
			set_code: card.set_code
		}) : null
	);

	let priceData = $state<PriceData | null>(null);
	let loading = $state(true);

	$effect(() => {
		// Re-fetch when cardId changes
		const id = cardId;
		let cancelled = false;
		loading = true;
		priceData = null;
		getPrice(id).then((data) => {
			if (!cancelled) {
				priceData = data;
				loading = false;
			}
		}).catch(() => {
			if (!cancelled) {
				priceData = null;
				loading = false;
			}
		});
		return () => { cancelled = true; };
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
		{#if ebayUrl}
			<a href={ebayUrl} target="_blank" rel="noopener noreferrer" class="ebay-link">
				View on eBay →
			</a>
			<AffiliateNotice compact />
		{/if}
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

	.ebay-link {
		display: inline-block;
		margin-top: 0.5rem;
		padding: 0.35rem 0.75rem;
		border-radius: 6px;
		background: rgba(0, 100, 210, 0.1);
		color: var(--accent-primary, #3b82f6);
		font-size: 0.8rem;
		font-weight: 600;
		text-decoration: none;
		text-align: center;
	}
	.ebay-link:hover {
		background: rgba(0, 100, 210, 0.2);
	}

	.price-loading,
	.price-empty {
		color: var(--text-secondary, #94a3b8);
		font-size: 0.85rem;
	}
</style>
