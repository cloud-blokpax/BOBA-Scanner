<script lang="ts">
	import type { DrawProbabilityAnalysis } from '$lib/services/playbook-engine';
	import { PLAY_CATEGORIES } from '$lib/data/play-categories';

	let { analysis }: { analysis: DrawProbabilityAnalysis } = $props();

	/** Only show categories that have at least 1 card in the deck */
	const activeCategories = $derived(
		PLAY_CATEGORIES.filter((cat) => {
			const rate = analysis.categoryDrawRates[cat.id];
			return rate && rate.count > 0;
		})
	);

	function probColor(prob: number): string {
		if (prob < 0.3) return 'var(--danger)';
		if (prob < 0.5) return 'var(--warning)';
		return 'var(--success)';
	}

	function probLabel(prob: number): string {
		if (prob < 0.3) return 'Unreliable';
		if (prob < 0.5) return 'Inconsistent';
		return 'Reliable';
	}
</script>

<div class="card">
	<h3 class="card-title">Draw Consistency</h3>

	{#if activeCategories.length === 0}
		<p class="empty">Add plays to see draw probabilities</p>
	{:else}
		<div class="category-list">
			{#each activeCategories as cat}
				{@const rate = analysis.categoryDrawRates[cat.id]}
				{@const pct = Math.round(rate.probInOpening4 * 100)}
				<div class="cat-row">
					<div class="cat-info">
						<span class="cat-name">{cat.name}</span>
						<span class="cat-count">{rate.count} cards</span>
					</div>
					<div class="cat-bar-track">
						<div
							class="cat-bar-fill"
							style="width: {pct}%; background: {probColor(rate.probInOpening4)}"
						></div>
					</div>
					<span class="cat-pct" style="color: {probColor(rate.probInOpening4)}">{pct}%</span>
				</div>
			{/each}
		</div>

		<div class="draw-summary">
			<span class="summary-label">Draw play in opening hand:</span>
			<span class="summary-value" style="color: {probColor(analysis.drawPlayInOpening)}">
				{Math.round(analysis.drawPlayInOpening * 100)}%
			</span>
		</div>
		<div class="draw-summary">
			<span class="summary-label">Expected plays seen per game:</span>
			<span class="summary-value">{analysis.expectedPlaysSeen.toFixed(1)}</span>
		</div>
	{/if}
</div>

<style>
	.card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
	}
	.card-title {
		font-family: var(--font-display);
		font-size: var(--text-sm);
		font-weight: var(--font-semibold);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--space-3);
	}
	.category-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}
	.cat-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.cat-info {
		width: 120px;
		flex-shrink: 0;
	}
	.cat-name {
		font-size: var(--text-xs);
		color: var(--text-primary);
		display: block;
		line-height: 1.2;
	}
	.cat-count {
		font-size: 10px;
		color: var(--text-muted);
	}
	.cat-bar-track {
		flex: 1;
		height: 6px;
		background: var(--bg-elevated);
		border-radius: var(--radius-full);
		overflow: hidden;
	}
	.cat-bar-fill {
		height: 100%;
		border-radius: var(--radius-full);
		transition: width var(--transition-base);
	}
	.cat-pct {
		font-size: var(--text-xs);
		font-weight: var(--font-semibold);
		width: 36px;
		text-align: right;
		flex-shrink: 0;
	}
	.draw-summary {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-1) 0;
	}
	.summary-label {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.summary-value {
		font-size: var(--text-sm);
		font-weight: var(--font-semibold);
		color: var(--text-primary);
	}
	.empty {
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin: 0;
	}
</style>
