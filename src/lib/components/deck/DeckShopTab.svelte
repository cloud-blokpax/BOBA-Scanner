<script lang="ts">
	import AffiliateNotice from '$lib/components/AffiliateNotice.svelte';
	import type { GapAnalysis } from '$lib/services/deck-gap-finder';

	let {
		gapAnalysis,
		refreshing,
		refreshesRemaining,
		refreshLimit,
		onRefreshPrices
	}: {
		gapAnalysis: GapAnalysis | null;
		refreshing: boolean;
		refreshesRemaining: number | null;
		refreshLimit: number | null;
		onRefreshPrices: () => void;
	} = $props();

	const hasGaps = $derived(gapAnalysis !== null && gapAnalysis.gaps.length > 0);
	const displayCandidates = $derived(gapAnalysis?.candidates.slice(0, 25) ?? []);
	const totalCandidates = $derived(gapAnalysis?.totalCandidates ?? 0);
</script>

<div class="shop-tab">
	{#if !hasGaps}
		<div class="empty-state">
			<p>Your deck is fully filled at every power level. Nice work, Coach!</p>
		</div>
	{:else if gapAnalysis}
		<div class="gap-summary">
			<div class="gap-stat">
				<div class="gap-value">{gapAnalysis.cardsNeeded}</div>
				<div class="gap-label">Cards Needed</div>
			</div>
			<div class="gap-stat">
				<div class="gap-value">{gapAnalysis.gaps.length}</div>
				<div class="gap-label">Open Power Levels</div>
			</div>
			<div class="gap-stat">
				<div class="gap-value">{totalCandidates}</div>
				<div class="gap-label">Available Cards</div>
			</div>
		</div>

		<div class="refresh-bar">
			<button
				class="refresh-btn"
				onclick={onRefreshPrices}
				disabled={refreshing || refreshesRemaining === 0}
			>
				{refreshing ? 'Updating...' : 'Update 10 Prices'}
			</button>
			{#if refreshLimit !== null && refreshesRemaining !== null}
				<span class="refresh-budget">{refreshesRemaining}/{refreshLimit} refreshes today</span>
			{/if}
		</div>

		<AffiliateNotice />

		<div class="candidate-list">
			{#each displayCandidates as candidate (candidate.card.id)}
				<a class="candidate-row" href={candidate.ebayUrl} target="_blank" rel="noopener">
					<span class="candidate-power">{candidate.powerLevel}</span>
					<div class="candidate-info">
						<span class="candidate-name">{candidate.card.hero_name || candidate.card.name}</span>
						<span class="candidate-meta">
							{candidate.card.card_number}
							{#if candidate.card.parallel && candidate.card.parallel !== 'Paper'}
								&middot; {candidate.card.parallel}
							{/if}
							{#if candidate.card.weapon_type}
								&middot; {candidate.card.weapon_type}
							{/if}
						</span>
					</div>
					<div class="candidate-price">
						{#if candidate.priceMid !== null}
							<span class="price-value">${candidate.priceMid.toFixed(2)}</span>
						{:else if candidate.priceSearched}
							<span class="price-none">No listings</span>
						{:else}
							<span class="price-unknown">&mdash;</span>
						{/if}
						{#if candidate.priceLastUpdated}
							<span class="price-date">{new Date(candidate.priceLastUpdated).toLocaleDateString()}</span>
						{/if}
					</div>
				</a>
			{/each}
		</div>

		{#if totalCandidates > 25}
			<a class="see-all" href="/deck/shop?format={gapAnalysis.formatId}">
				See all {totalCandidates} candidates
			</a>
		{/if}
	{/if}
</div>

<style>
	.shop-tab { padding: 0.75rem 1rem; }
	.empty-state {
		text-align: center;
		padding: 2rem 1rem;
		color: var(--text-secondary, #94a3b8);
		font-size: 0.9rem;
	}
	.gap-summary {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.gap-stat {
		flex: 1;
		padding: 0.625rem;
		border-radius: 8px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		text-align: center;
	}
	.gap-value {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text-primary, #f1f5f9);
	}
	.gap-label {
		font-size: 0.65rem;
		color: var(--text-tertiary, #64748b);
		margin-top: 0.125rem;
	}
	.refresh-bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.refresh-btn {
		padding: 0.5rem 1rem;
		border: 1px solid var(--accent-primary, #3b82f6);
		border-radius: 8px;
		background: rgba(59, 130, 246, 0.1);
		color: var(--accent-primary, #3b82f6);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.refresh-btn:hover:not(:disabled) { background: rgba(59, 130, 246, 0.2); }
	.refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.refresh-budget {
		font-size: 0.75rem;
		color: var(--text-tertiary, #64748b);
	}
	.candidate-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.candidate-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.625rem;
		border-radius: 8px;
		background: var(--bg-elevated, #1e293b);
		border: 1px solid var(--border-color, #1e293b);
		text-decoration: none;
		color: inherit;
		cursor: pointer;
	}
	.candidate-row:hover { background: var(--bg-hover, rgba(255,255,255,0.05)); }
	.candidate-power {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 36px;
		padding: 0.25rem 0.375rem;
		border-radius: 10px;
		background: rgba(59, 130, 246, 0.15);
		color: #60a5fa;
		font-size: 0.8rem;
		font-weight: 700;
		flex-shrink: 0;
	}
	.candidate-info { flex: 1; min-width: 0; }
	.candidate-name {
		display: block;
		color: var(--text-primary, #f1f5f9);
		font-size: 0.85rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.candidate-meta {
		font-size: 0.7rem;
		color: var(--text-tertiary, #64748b);
	}
	.candidate-price {
		text-align: right;
		flex-shrink: 0;
	}
	.price-value {
		display: block;
		color: var(--color-success, #22c55e);
		font-size: 0.85rem;
		font-weight: 600;
	}
	.price-none {
		display: block;
		color: var(--text-tertiary, #64748b);
		font-size: 0.75rem;
	}
	.price-unknown {
		display: block;
		color: var(--text-tertiary, #64748b);
		font-size: 0.85rem;
	}
	.price-date {
		display: block;
		font-size: 0.6rem;
		color: var(--text-tertiary, #64748b);
	}
	.see-all {
		display: block;
		text-align: center;
		padding: 0.75rem;
		margin-top: 0.5rem;
		color: var(--accent-primary, #3b82f6);
		font-size: 0.85rem;
		font-weight: 600;
		text-decoration: none;
	}
	.see-all:hover { text-decoration: underline; }
</style>
