<script lang="ts">
	import { onMount } from 'svelte';
	import { PARALLEL_CODES, PARALLEL_ABBREV, PARALLEL_FULL_NAME, PARALLEL_COLOR, type ParallelCode } from '$lib/data/parallels';
	import { getPriceWithReason } from '$lib/stores/prices.svelte';
	import type { Card } from '$lib/types';

	let {
		card,
		currentParallel = 'paper',
		onParallelChange,
	}: {
		card: Card;
		currentParallel?: string;
		onParallelChange?: (parallel: ParallelCode) => void;
	} = $props();

	interface ParallelPriceState {
		price: number | null;
		isColdStart: boolean;
		loading: boolean;
		errorReason: string | null;
	}

	const initialState: Record<ParallelCode, ParallelPriceState> = {
		paper: { price: null, isColdStart: false, loading: true, errorReason: null },
		cf: { price: null, isColdStart: false, loading: true, errorReason: null },
		ff: { price: null, isColdStart: false, loading: true, errorReason: null },
		ocm: { price: null, isColdStart: false, loading: true, errorReason: null },
		sf: { price: null, isColdStart: false, loading: true, errorReason: null },
	};
	let prices = $state<Record<ParallelCode, ParallelPriceState>>(initialState);

	let lastCardId = '';

	async function loadPrice(parallel: ParallelCode) {
		if (!card?.id) return;
		prices[parallel] = { ...prices[parallel], loading: true };
		try {
			// Pass the human-readable DB name to match the price_cache row.
			const result = await getPriceWithReason(card.id, PARALLEL_FULL_NAME[parallel]);
			const data = result.data as (typeof result.data & { confidence_cold_start?: boolean }) | null;
			prices[parallel] = {
				price: data?.price_mid ?? null,
				isColdStart: (data?.confidence_cold_start === true) || false,
				loading: false,
				errorReason: result.errorReason,
			};
		} catch {
			prices[parallel] = {
				price: null,
				isColdStart: false,
				loading: false,
				errorReason: 'Failed to load price',
			};
		}
	}

	onMount(() => {
		lastCardId = card?.id || '';
		// Parallel fetch for all parallels
		for (const p of PARALLEL_CODES) {
			loadPrice(p);
		}
	});

	// Refetch when card changes
	$effect(() => {
		if (card?.id && card.id !== lastCardId) {
			lastCardId = card.id;
			for (const p of PARALLEL_CODES) {
				loadPrice(p);
			}
		}
	});

	function handleSelect(parallel: ParallelCode) {
		if (onParallelChange) onParallelChange(parallel);
	}

	function formatPrice(price: number | null): string {
		if (price === null) return 'No data';
		return `$${price.toFixed(2)}`;
	}
</script>

<section class="wppp">
	<div class="wppp-header">
		<h3 class="wppp-title">Prices by Parallel</h3>
		{#if prices[currentParallel as ParallelCode]?.isColdStart}
			<span class="wppp-provisional-flag" title="Provisional — price will stabilize as more market data is harvested">
				* Provisional
			</span>
		{/if}
	</div>

	<div class="wppp-list" role="radiogroup" aria-label="Select parallel to view">
		{#each PARALLEL_CODES as p}
			{@const state = prices[p]}
			<button
				type="button"
				class="wppp-row"
				class:wppp-row-active={currentParallel === p}
				data-parallel={p}
				style={`--parallel-color: ${PARALLEL_COLOR[p]}`}
				onclick={() => handleSelect(p)}
				role="radio"
				aria-checked={currentParallel === p}
			>
				<span class="wppp-abbrev">{PARALLEL_ABBREV[p]}</span>
				<span class="wppp-name">{PARALLEL_FULL_NAME[p]}</span>
				<span class="wppp-price" class:wppp-price-missing={state?.price === null && !state?.loading}>
					{#if state?.loading}
						…
					{:else}
						{formatPrice(state.price)}{state.isColdStart ? '*' : ''}
					{/if}
				</span>
			</button>
		{/each}
	</div>

	{#if prices[currentParallel as ParallelCode]?.isColdStart}
		<p class="wppp-note">
			* Provisional price — the first few harvests of a new parallel are
			marked provisional. Prices stabilize as more market data comes in.
		</p>
	{/if}
</section>

<style>
	.wppp {
		margin-top: 0.75rem;
		padding: 0.75rem;
		border: 1px solid var(--border, rgba(148,163,184,0.2));
		border-radius: 10px;
		background: var(--bg-surface, #0d1524);
	}

	.wppp-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}
	.wppp-title {
		font-size: 0.85rem;
		font-weight: 700;
		margin: 0;
		color: var(--text-primary, #e2e8f0);
	}
	.wppp-provisional-flag {
		font-size: 0.65rem;
		font-weight: 700;
		color: #f59e0b;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.wppp-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.wppp-row {
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
	.wppp-row:hover {
		background: var(--bg-elevated, #121d34);
	}
	.wppp-row-active {
		border-color: var(--parallel-color);
		background: color-mix(in srgb, var(--parallel-color) 10%, var(--bg-surface, #0d1524));
	}

	.wppp-abbrev {
		text-align: center;
		font-weight: 800;
		color: var(--parallel-color);
		font-size: 0.75rem;
	}
	.wppp-name {
		color: var(--text-primary, #e2e8f0);
	}
	.wppp-price {
		font-weight: 700;
		color: #10b981;
		text-align: right;
		white-space: nowrap;
	}
	.wppp-price-missing {
		color: var(--text-muted, #475569);
		font-weight: 500;
		font-style: italic;
	}

	.wppp-note {
		margin: 0.5rem 0 0;
		font-size: 0.7rem;
		color: var(--text-muted, #475569);
		line-height: 1.4;
	}
</style>
