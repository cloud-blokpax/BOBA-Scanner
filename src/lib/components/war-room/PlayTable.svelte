<!--
	War Room Play Table

	Renders the play card table with DBS, dollars-per-DBS, and eBay links.
-->
<script lang="ts">
	import { buildEbaySearchUrl } from '$lib/services/ebay';
	import { RARITY_COLORS } from './war-room-constants';
	import type { PlayCard } from './war-room-constants';

	let {
		plays,
		playSort,
		onSortChange,
	}: {
		plays: PlayCard[];
		playSort: 'dpd' | 'price' | 'dbs';
		onSortChange: (sort: 'dpd' | 'price' | 'dbs') => void;
	} = $props();

	function fmtPrice(v: number): string {
		return v < 10 ? v.toFixed(2) : v.toFixed(0);
	}

	const PLAY_SORT_OPTIONS: { id: typeof playSort; l: string }[] = [
		{ id: 'dpd', l: 'Best $/DBS' },
		{ id: 'price', l: 'Cheapest' },
		{ id: 'dbs', l: 'Highest DBS' },
	];
</script>

<div class="sort-row">
	{#each PLAY_SORT_OPTIONS as o}
		<button
			class="sort-btn blue"
			class:active={playSort === o.id}
			onclick={() => onSortChange(o.id)}
		>
			{o.l}
		</button>
	{/each}
</div>
<div class="card-list">
	{#each plays as p, i}
		<a
			class="card-row"
			class:even={i % 2 === 0}
			href={buildEbaySearchUrl({ name: p.name, card_number: p.num })}
			target="_blank"
			rel="noopener noreferrer"
		>
			<div class="play-dbs-col">
				<div class="play-dbs-val">{p.dbs}</div>
				<div class="play-dbs-label">DBS</div>
			</div>
			<div class="card-info">
				<div class="card-hero">{p.name}</div>
				<div class="card-meta">
					<span class="rarity-badge" style="color: {RARITY_COLORS[p.r] || '#6b7d8e'}">{p.r}</span>
					<span>{p.num}</span>
					<span>{p.hd > 0 ? `${p.hd} HD` : 'Free'}</span>
					<span>{p.ls} listed</span>
				</div>
			</div>
			<div class="card-price-col">
				<div class="card-price">${fmtPrice(p.mid)}</div>
				{#if p.dpd !== null}
					<div class="card-dpd">${p.dpd}/dbs</div>
				{/if}
			</div>
			<span class="card-ebay-arrow">↗</span>
		</a>
	{/each}
</div>

<style>
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
	.sort-btn.blue.active {
		border-color: rgba(59, 130, 246, 0.25);
		background: rgba(59, 130, 246, 0.06);
		color: #3b82f6;
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
	.play-dbs-col {
		width: 32px;
		text-align: center;
		flex-shrink: 0;
	}
	.play-dbs-val {
		font-size: 16px;
		font-weight: 800;
		font-family: 'JetBrains Mono', monospace;
		color: #3b82f6;
		line-height: 1;
	}
	.play-dbs-label {
		font-size: 7px;
		color: #4a6178;
		font-weight: 600;
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
	.rarity-badge {
		font-weight: 700;
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
	.card-dpd {
		font-size: 9px;
		font-weight: 700;
		font-family: 'JetBrains Mono', monospace;
		color: #3b82f6;
	}
</style>
