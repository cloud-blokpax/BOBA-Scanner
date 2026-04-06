<!--
	Market Explorer Results

	Renders the results list for both hero and play card types,
	loading/empty states, and the load-more button.
-->
<script lang="ts">
	import { buildEbaySearchUrl } from '$lib/services/ebay';
	import type { ExploreCard, ExplorePlayCard } from './explorer-types';

	let {
		cards,
		loading,
		hasMore,
		loadingMore = false,
		cardType,
		activeFilterCount = 0,
		onLoadMore,
		onClearFilters,
	}: {
		cards: (ExploreCard | ExplorePlayCard)[];
		loading: boolean;
		hasMore: boolean;
		loadingMore?: boolean;
		cardType: 'hero' | 'play';
		activeFilterCount?: number;
		onLoadMore: () => void;
		onClearFilters: () => void;
	} = $props();

	const LIQUIDITY_LABELS: Record<string, { label: string; color: string }> = {
		available: { label: 'Available', color: 'var(--success)' },
		limited: { label: 'Limited', color: 'var(--warning)' },
		scarce: { label: 'Scarce', color: 'var(--danger)' },
		none: { label: 'None Listed', color: 'var(--text-muted)' },
		unknown: { label: 'Not Priced', color: 'var(--text-muted)' },
	};

	function fmt(n: number | null | undefined): string {
		if (n == null || n === 0) return '--';
		return n < 1 ? `$${n.toFixed(2)}` : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	function confColor(score: number): string {
		if (score >= 0.8) return 'var(--success)';
		if (score >= 0.5) return 'var(--warning)';
		return 'var(--danger)';
	}

	function heroEbayUrl(c: ExploreCard): string {
		return buildEbaySearchUrl({
			card_number: c.num,
			hero_name: c.hero,
			athlete_name: c.athlete,
			parallel: c.parallel,
			weapon_type: c.weapon,
		});
	}

	function playEbayUrl(c: ExplorePlayCard): string {
		return buildEbaySearchUrl({
			card_number: c.num,
			name: c.name,
		});
	}
</script>

{#if loading}
	<div class="loading-state">
		<div class="spinner"></div>
		<p>Searching market data...</p>
	</div>
{:else if cards.length === 0}
	<div class="empty-state">
		<p class="empty-icon">{'\u{1F50D}'}</p>
		<p>No cards match your filters.</p>
		{#if activeFilterCount > 0}
			<button class="clear-btn" onclick={onClearFilters}>Clear Filters</button>
		{:else}
			<p class="empty-hint">Price data is populated by the nightly harvester. Cards without pricing won't appear here.</p>
		{/if}
	</div>
{:else if cardType === 'hero'}
	<div class="results-list">
		{#each cards as card (card.id)}
			{@const c = card as ExploreCard}
			<a class="card-row" class:unpriced={!c.hasPriceData} href={heroEbayUrl(c)} target="_blank" rel="noopener noreferrer">
				<div class="card-main">
					<div class="card-name">{c.hero}</div>
					<div class="card-meta">
						{c.num}
						{#if c.parallel && c.parallel !== 'Paper'}
							<span class="meta-sep">&middot;</span> {c.parallel}
						{/if}
						<span class="meta-sep">&middot;</span> {c.weapon}
						<span class="meta-sep">&middot;</span> {c.power} pwr
					</div>
				</div>
				{#if c.hasPriceData}
					<div class="card-pricing">
						<div class="price-main">{fmt(c.priceMid)}</div>
						<div class="price-details">
							{#if c.bnLow != null}
								BIN {fmt(c.bnLow)}
							{/if}
							<span class="meta-sep">&middot;</span>
							{c.listings} listed
						</div>
					</div>
					<div class="card-metrics">
						{#if c.pricePerPower != null}
							<span class="metric" title="Price per power point">
								{fmt(c.pricePerPower)}/pwr
							</span>
						{/if}
						<span class="liquidity-badge" style="color: {LIQUIDITY_LABELS[c.liquidity]?.color}">
							{LIQUIDITY_LABELS[c.liquidity]?.label}
						</span>
						<div class="confidence-bar" title="{Math.round(c.confidence * 100)}% confidence">
							<div class="confidence-fill" style="width: {c.confidence * 100}%; background: {confColor(c.confidence)}"></div>
						</div>
					</div>
				{:else}
					<div class="card-pricing">
						<div class="price-none">--</div>
					</div>
					<div class="card-metrics">
						<span class="liquidity-badge" style="color: var(--text-muted)">Not Priced</span>
					</div>
				{/if}
				<div class="ebay-link-indicator">eBay</div>
			</a>
		{/each}
	</div>
{:else}
	<div class="results-list">
		{#each cards as card (card.id)}
			{@const c = card as ExplorePlayCard}
			<a class="card-row" class:unpriced={!c.hasPriceData} href={playEbayUrl(c)} target="_blank" rel="noopener noreferrer">
				<div class="card-main">
					<div class="card-name">{c.name}</div>
					<div class="card-meta">
						{c.num}
						<span class="meta-sep">&middot;</span> {c.dbs} DBS
						<span class="meta-sep">&middot;</span> {c.hotDogCost} HD
					</div>
				</div>
				{#if c.hasPriceData}
					<div class="card-pricing">
						<div class="price-main">{fmt(c.priceMid)}</div>
						<div class="price-details">
							{#if c.bnLow != null}
								BIN {fmt(c.bnLow)}
							{/if}
							<span class="meta-sep">&middot;</span>
							{c.listings} listed
						</div>
					</div>
					<div class="card-metrics">
						{#if c.pricePerDbs != null}
							<span class="metric" title="Price per DBS point">
								{fmt(c.pricePerDbs)}/DBS
							</span>
						{/if}
						<span class="liquidity-badge" style="color: {LIQUIDITY_LABELS[c.liquidity]?.color}">
							{LIQUIDITY_LABELS[c.liquidity]?.label}
						</span>
						<div class="confidence-bar" title="{Math.round(c.confidence * 100)}% confidence">
							<div class="confidence-fill" style="width: {c.confidence * 100}%; background: {confColor(c.confidence)}"></div>
						</div>
					</div>
				{:else}
					<div class="card-pricing">
						<div class="price-none">--</div>
					</div>
					<div class="card-metrics">
						<span class="liquidity-badge" style="color: var(--text-muted)">Not Priced</span>
					</div>
				{/if}
				<div class="ebay-link-indicator">eBay</div>
			</a>
		{/each}
	</div>
{/if}

<!-- Load More -->
{#if hasMore && !loading}
	<div class="load-more">
		<button class="load-more-btn" onclick={onLoadMore} disabled={loadingMore}>
			{loadingMore ? 'Loading...' : 'Load More'}
		</button>
	</div>
{/if}

<style>
	/* ── Results List ──────────────────────────────── */
	.results-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.card-row {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: var(--space-3);
		align-items: center;
		padding: var(--space-3);
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		transition: border-color var(--transition-fast);
		text-decoration: none;
		color: inherit;
		position: relative;
	}
	.card-row:hover {
		border-color: var(--border-strong);
	}
	.ebay-link-indicator {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		font-size: 10px;
		font-weight: 700;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0;
		transition: opacity var(--transition-fast);
	}
	.card-row:hover .ebay-link-indicator {
		opacity: 1;
	}
	.card-row.unpriced {
		opacity: 0.7;
	}
	.price-none {
		font-family: var(--font-mono);
		font-weight: 700;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.card-name {
		font-weight: 700;
		color: var(--text-primary);
		font-size: var(--text-sm);
	}
	.card-meta {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		margin-top: 2px;
	}
	.meta-sep {
		color: var(--text-muted);
	}
	.card-pricing {
		text-align: right;
	}
	.price-main {
		font-family: var(--font-mono);
		font-weight: 700;
		color: var(--gold);
		font-size: var(--text-sm);
	}
	.price-details {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		margin-top: 2px;
	}
	.card-metrics {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 3px;
		min-width: 80px;
	}
	.metric {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.liquidity-badge {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.confidence-bar {
		width: 100%;
		height: 3px;
		background: var(--bg-base);
		border-radius: 2px;
		overflow: hidden;
	}
	.confidence-fill {
		height: 100%;
		border-radius: 2px;
		transition: width var(--transition-base);
	}

	/* ── States ─────────────────────────────────────── */
	.loading-state, .empty-state {
		text-align: center;
		padding: var(--space-12) var(--space-4);
		color: var(--text-secondary);
	}
	.empty-icon {
		font-size: 2rem;
		margin-bottom: var(--space-2);
	}
	.empty-hint {
		font-size: var(--text-xs);
		color: var(--text-muted);
		margin-top: var(--space-2);
	}
	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--border);
		border-top-color: var(--gold);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin: 0 auto var(--space-3);
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	.clear-btn {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.clear-btn:hover {
		border-color: var(--danger);
		color: var(--danger);
	}

	/* ── Load More ──────────────────────────────────── */
	.load-more {
		text-align: center;
		padding: var(--space-4);
	}
	.load-more-btn {
		padding: var(--space-2) var(--space-6);
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}
	.load-more-btn:hover:not(:disabled) {
		border-color: var(--gold);
		color: var(--gold);
	}
	.load-more-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ── Responsive ─────────────────────────────────── */
	@media (max-width: 480px) {
		.card-row {
			grid-template-columns: 1fr;
			gap: var(--space-2);
		}
		.card-pricing {
			text-align: left;
			display: flex;
			gap: var(--space-3);
			align-items: baseline;
		}
		.card-metrics {
			flex-direction: row;
			align-items: center;
			gap: var(--space-2);
			min-width: unset;
		}
		.confidence-bar {
			width: 60px;
		}
	}
</style>
