<!--
	War Room Hero Table

	Renders the hero data table with price-per-power, liquidity badges, and eBay links.
-->
<script lang="ts">
	import { buildEbaySearchUrl } from '$lib/services/ebay';
	import WIcon from './WIcon.svelte';
	import type { HeroCard } from './war-room-constants';

	let {
		heroes,
		sortBy,
		pFilter,
		wFilter,
		onSortChange,
		onClearFilters,
	}: {
		heroes: HeroCard[];
		sortBy: 'ppp' | 'price' | 'power' | 'listings';
		pFilter: string | null;
		wFilter: string | null;
		onSortChange: (sort: 'ppp' | 'price' | 'power' | 'listings') => void;
		onClearFilters: () => void;
	} = $props();

	function liq(ls: number): { label: string; color: string } {
		if (ls >= 10) return { label: 'Available', color: '#22c55e' };
		if (ls >= 3) return { label: 'Limited', color: '#f59e0b' };
		if (ls >= 1) return { label: 'Scarce', color: '#ef4444' };
		return { label: 'None', color: '#4a6178' };
	}

	function fmtPrice(v: number): string {
		return v < 10 ? v.toFixed(2) : v.toFixed(0);
	}

	const SORT_OPTIONS: { id: typeof sortBy; l: string }[] = [
		{ id: 'ppp', l: 'Best $/pwr' },
		{ id: 'price', l: 'Cheapest' },
		{ id: 'power', l: 'Strongest' },
		{ id: 'listings', l: 'Most listed' },
	];
</script>

<div class="results-header">
	<div class="section-label">
		Heroes{pFilter ? ` \u00b7 ${pFilter}` : ''}{wFilter ? ` \u00b7 ${wFilter}` : ''}
	</div>
	{#if pFilter || wFilter}
		<button class="clear-btn" onclick={onClearFilters}>Clear</button>
	{/if}
</div>
<div class="sort-row">
	{#each SORT_OPTIONS as o}
		<button class="sort-btn" class:active={sortBy === o.id} onclick={() => onSortChange(o.id)}>
			{o.l}
		</button>
	{/each}
</div>
<div class="card-list">
	{#each heroes.slice(0, 20) as h, i}
		{@const l = liq(h.ls)}
		<a
			class="card-row"
			class:even={i % 2 === 0}
			href={buildEbaySearchUrl({ hero_name: h.hero, card_number: h.num, parallel: h.p, weapon_type: h.w, athlete_name: h.ath })}
			target="_blank"
			rel="noopener noreferrer"
		>
			<div class="card-icon-col">
				<WIcon type={h.w} size={16} color="#6b7d8e" />
				<span class="card-pwr">{h.pwr}</span>
			</div>
			<div class="card-info">
				<div class="card-hero">{h.hero}</div>
				<div class="card-meta">
					<span class="card-parallel">{h.p}</span>
					<span class="liq-badge" style="color: {l.color}; background: {l.color}12">{l.label}</span>
					<span>{h.ls} listed</span>
				</div>
			</div>
			<div class="card-price-col">
				<div class="card-price">${fmtPrice(h.mid)}</div>
				<div class="card-ppp">${h.ppp}/pwr</div>
			</div>
			<span class="card-ebay-arrow">↗</span>
		</a>
	{/each}
</div>

<style>
	.results-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}
	.section-label {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: #6b7d8e;
		text-transform: uppercase;
	}
	.clear-btn {
		font-size: 9px;
		color: #ef4444;
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: 6px;
		padding: 2px 8px;
		cursor: pointer;
		font-family: inherit;
		font-weight: 600;
	}
	.sort-row {
		display: flex;
		gap: 4px;
		margin-bottom: 8px;
	}
	.sort-btn {
		padding: 4px 8px;
		border-radius: 8px;
		font-size: 9px;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid rgba(255, 255, 255, 0.05);
		background: transparent;
		color: #4a6178;
		font-family: inherit;
		transition: all 0.15s;
	}
	.sort-btn.active {
		border-color: rgba(245, 158, 11, 0.25);
		background: rgba(245, 158, 11, 0.06);
		color: #f59e0b;
	}
	.card-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.card-row {
		display: flex;
		align-items: center;
		padding: 8px 10px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.03);
		gap: 8px;
		transition: background 0.15s;
		text-decoration: none;
		color: inherit;
	}
	.card-row.even {
		background: rgba(255, 255, 255, 0.015);
	}
	.card-row:hover {
		background: rgba(255, 255, 255, 0.03);
	}
	.card-ebay-arrow {
		color: var(--accent-primary, #3b82f6);
		font-size: 0.8rem;
		flex-shrink: 0;
		opacity: 0.5;
	}
	.card-row:hover .card-ebay-arrow {
		opacity: 1;
	}
	.card-icon-col {
		width: 28px;
		display: flex;
		flex-direction: column;
		align-items: center;
		flex-shrink: 0;
	}
	.card-pwr {
		font-size: 8px;
		color: #4a6178;
		margin-top: 1px;
	}
	.card-info {
		flex: 1;
		min-width: 0;
	}
	.card-hero {
		font-size: 12px;
		font-weight: 700;
		color: #fff;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.card-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 9px;
		color: #4a6178;
		margin-top: 1px;
	}
	.card-parallel {
		color: #6b7d8e;
		font-weight: 500;
	}
	.liq-badge {
		font-weight: 700;
		font-size: 8px;
		padding: 0 4px;
		border-radius: 3px;
	}
	.card-price-col {
		text-align: right;
		flex-shrink: 0;
	}
	.card-price {
		font-size: 15px;
		font-weight: 800;
		font-family: 'JetBrains Mono', monospace;
		color: #fff;
	}
	.card-ppp {
		font-size: 9px;
		font-weight: 700;
		font-family: 'JetBrains Mono', monospace;
		color: #22c55e;
	}
</style>
