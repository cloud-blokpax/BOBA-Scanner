<script lang="ts">
	import { onMount } from 'svelte';
	import { VARIANT_CODES, VARIANT_ABBREV, VARIANT_FULL_NAME, VARIANT_COLOR, type VariantCode } from '$lib/data/variants';
	import { getPriceWithReason } from '$lib/stores/prices.svelte';
	import type { Card } from '$lib/types';

	let {
		card,
		currentVariant = 'paper',
		onVariantChange,
	}: {
		card: Card;
		currentVariant?: string;
		onVariantChange?: (variant: VariantCode) => void;
	} = $props();

	interface VariantPriceState {
		price: number | null;
		isColdStart: boolean;
		loading: boolean;
		errorReason: string | null;
	}

	const initialState: Record<VariantCode, VariantPriceState> = {
		paper: { price: null, isColdStart: false, loading: true, errorReason: null },
		cf: { price: null, isColdStart: false, loading: true, errorReason: null },
		ff: { price: null, isColdStart: false, loading: true, errorReason: null },
		ocm: { price: null, isColdStart: false, loading: true, errorReason: null },
		sf: { price: null, isColdStart: false, loading: true, errorReason: null },
	};
	let prices = $state<Record<VariantCode, VariantPriceState>>(initialState);

	let lastCardId = '';

	async function loadPrice(variant: VariantCode) {
		if (!card?.id) return;
		prices[variant] = { ...prices[variant], loading: true };
		try {
			const result = await getPriceWithReason(card.id, variant);
			const data = result.data as (typeof result.data & { confidence_cold_start?: boolean }) | null;
			prices[variant] = {
				price: data?.price_mid ?? null,
				isColdStart: (data?.confidence_cold_start === true) || false,
				loading: false,
				errorReason: result.errorReason,
			};
		} catch {
			prices[variant] = {
				price: null,
				isColdStart: false,
				loading: false,
				errorReason: 'Failed to load price',
			};
		}
	}

	onMount(() => {
		lastCardId = card?.id || '';
		// Parallel fetch for all variants
		for (const v of VARIANT_CODES) {
			loadPrice(v);
		}
	});

	// Refetch when card changes
	$effect(() => {
		if (card?.id && card.id !== lastCardId) {
			lastCardId = card.id;
			for (const v of VARIANT_CODES) {
				loadPrice(v);
			}
		}
	});

	function handleSelect(variant: VariantCode) {
		if (onVariantChange) onVariantChange(variant);
	}

	function formatPrice(price: number | null): string {
		if (price === null) return 'No data';
		return `$${price.toFixed(2)}`;
	}
</script>

<section class="wvpp">
	<div class="wvpp-header">
		<h3 class="wvpp-title">Prices by Variant</h3>
		{#if prices[currentVariant as VariantCode]?.isColdStart}
			<span class="wvpp-provisional-flag" title="Provisional — price will stabilize as more market data is harvested">
				* Provisional
			</span>
		{/if}
	</div>

	<div class="wvpp-list" role="radiogroup" aria-label="Select variant to view">
		{#each VARIANT_CODES as v}
			{@const state = prices[v]}
			<button
				type="button"
				class="wvpp-row"
				class:wvpp-row-active={currentVariant === v}
				data-variant={v}
				style={`--variant-color: ${VARIANT_COLOR[v]}`}
				onclick={() => handleSelect(v)}
				role="radio"
				aria-checked={currentVariant === v}
			>
				<span class="wvpp-abbrev">{VARIANT_ABBREV[v]}</span>
				<span class="wvpp-name">{VARIANT_FULL_NAME[v]}</span>
				<span class="wvpp-price" class:wvpp-price-missing={state?.price === null && !state?.loading}>
					{#if state?.loading}
						…
					{:else}
						{formatPrice(state.price)}{state.isColdStart ? '*' : ''}
					{/if}
				</span>
			</button>
		{/each}
	</div>

	{#if prices[currentVariant as VariantCode]?.isColdStart}
		<p class="wvpp-note">
			* Provisional price — the first few harvests of a new variant are
			marked provisional. Prices stabilize as more market data comes in.
		</p>
	{/if}
</section>

<style>
	.wvpp {
		margin-top: 0.75rem;
		padding: 0.75rem;
		border: 1px solid var(--border, rgba(148,163,184,0.2));
		border-radius: 10px;
		background: var(--bg-surface, #0d1524);
	}

	.wvpp-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}
	.wvpp-title {
		font-size: 0.85rem;
		font-weight: 700;
		margin: 0;
		color: var(--text-primary, #e2e8f0);
	}
	.wvpp-provisional-flag {
		font-size: 0.65rem;
		font-weight: 700;
		color: #f59e0b;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.wvpp-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.wvpp-row {
		display: grid;
		grid-template-columns: 40px 1fr auto;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: var(--text-primary, #e2e8f0);
		font-family: var(--font-sans);
		font-size: 0.8rem;
		text-align: left;
		cursor: pointer;
		transition: background 0.12s, border-color 0.12s;
	}
	.wvpp-row:hover {
		background: var(--bg-elevated, #121d34);
	}
	.wvpp-row-active {
		border-color: var(--variant-color);
		background: color-mix(in srgb, var(--variant-color) 10%, var(--bg-surface, #0d1524));
	}

	.wvpp-abbrev {
		text-align: center;
		font-weight: 800;
		color: var(--variant-color);
		font-size: 0.75rem;
	}
	.wvpp-name {
		color: var(--text-primary, #e2e8f0);
	}
	.wvpp-price {
		font-weight: 700;
		color: #10b981;
		text-align: right;
		white-space: nowrap;
	}
	.wvpp-price-missing {
		color: var(--text-muted, #475569);
		font-weight: 500;
		font-style: italic;
	}

	.wvpp-note {
		margin: 0.5rem 0 0;
		font-size: 0.7rem;
		color: var(--text-muted, #475569);
		line-height: 1.4;
	}
</style>
