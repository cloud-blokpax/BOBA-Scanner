<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { showToast } from '$lib/stores/toast.svelte';
	import { useExplorerFilters } from '$lib/components/market/use-explorer-filters.svelte';
	import ExplorerFilters from '$lib/components/market/ExplorerFilters.svelte';
	import ExplorerResults from '$lib/components/market/ExplorerResults.svelte';
	import AffiliateNotice from '$lib/components/AffiliateNotice.svelte';
	import type { Facets, Aggregates, ExploreCard, ExplorePlayCard } from '$lib/components/market/explorer-types';

	// ── Data state ───────────────────────────────────
	let facets = $state<Facets | null>(null);
	let cards = $state<(ExploreCard | ExplorePlayCard)[]>([]);
	let aggregates = $state<Aggregates | null>(null);
	let loading = $state(false);
	let hasMore = $state(false);
	let currentOffset = $state(0);
	let loadingMore = $state(false);
	let totalPriced = $state(0);
	let totalCards = $state(0);

	const filters = useExplorerFilters($page.url.searchParams, () => loadResults());

	// ── Data fetching ────────────────────────────────
	async function loadFacets() {
		try {
			const res = await fetch('/api/market/facets');
			if (!res.ok) return;
			const data = await res.json();
			facets = data.facets || {};
			totalPriced = data.totalPriced ?? 0;
			totalCards = data.totalCards ?? 0;
		} catch {
			console.debug('[explorer] Failed to load facets');
		}
	}

	async function loadResults(append = false) {
		if (!append) {
			loading = true;
			currentOffset = 0;
		} else {
			loadingMore = true;
		}

		try {
			const params = filters.buildSearchParams();
			params.set('limit', '50');
			params.set('offset', String(currentOffset));

			const res = await fetch(`/api/market/explore?${params}`);
			if (!res.ok) {
				if (res.status === 401) {
					showToast('Sign in to explore market data', '\u{1F512}');
				}
				return;
			}

			const data = await res.json();

			if (append) {
				cards = [...cards, ...(data.cards || [])];
			} else {
				cards = data.cards || [];
			}

			aggregates = data.aggregates || null;
			hasMore = data.pagination?.hasMore ?? false;
		} catch {
			showToast('Failed to load market data', '\u26A0\uFE0F');
		} finally {
			loading = false;
			loadingMore = false;
		}
	}

	function loadMore() {
		if (loadingMore || !hasMore) return;
		currentOffset += 50;
		loadResults(true);
	}

	// ── Lifecycle ────────────────────────────────────
	onMount(() => {
		loadFacets();
		loadResults();
	});
</script>

<svelte:head>
	<title>Market Explorer | BOBA Scanner</title>
</svelte:head>

<div class="explorer">
	<!-- Header -->
	<header class="explorer-header">
		<h1 class="explorer-title">Market Explorer</h1>
		{#if aggregates}
			<div class="stats-bar">
				<span class="stat">
					<strong>{aggregates.totalResults.toLocaleString()}</strong> cards
					{#if aggregates.pricedCount < aggregates.totalResults}
						<span class="stat-detail">({aggregates.pricedCount} priced)</span>
					{/if}
				</span>
				{#if aggregates.pricedCount > 0}
					<span class="stat-sep">&middot;</span>
					<span class="stat">
						<strong>{aggregates.totalListings.toLocaleString()}</strong> listings
					</span>
					<span class="stat-sep">&middot;</span>
					<span class="stat">
						Avg <strong>${aggregates.avgPrice < 1 ? aggregates.avgPrice.toFixed(2) : aggregates.avgPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
					</span>
				{/if}
			</div>
		{:else if loading}
			<div class="stats-bar"><span class="stat">Loading market data...</span></div>
		{/if}
	</header>

	<ExplorerFilters {filters} {facets} />

	<ExplorerResults
		{cards}
		{loading}
		{hasMore}
		{loadingMore}
		cardType={filters.cardType}
		activeFilterCount={filters.activeFilterCount}
		onLoadMore={loadMore}
		onClearFilters={() => filters.clearFilters()}
	/>

	<!-- Footer stats -->
	{#if totalCards > 0 && !loading}
		<div class="footer-stats">
			{totalPriced.toLocaleString()} of {totalCards.toLocaleString()} cards have pricing data
		</div>
	{/if}

	{#if cards.length > 0}
		<div class="affiliate-footer">
			<AffiliateNotice compact />
		</div>
	{/if}
</div>

<style>
	.explorer {
		max-width: 640px;
		margin: 0 auto;
		padding: var(--space-4);
		padding-bottom: 100px;
	}

	.explorer-header {
		margin-bottom: var(--space-4);
	}
	.explorer-title {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: 800;
		color: var(--text-primary);
		margin: 0 0 var(--space-2);
	}
	.stats-bar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.stat strong {
		color: var(--gold);
		font-weight: 700;
	}
	.stat-sep {
		color: var(--text-muted);
	}
	.stat-detail {
		font-weight: 400;
		color: var(--text-muted);
	}
	.footer-stats {
		text-align: center;
		font-size: var(--text-xs);
		color: var(--text-muted);
		padding: var(--space-4) 0;
	}
	.affiliate-footer {
		text-align: center;
		padding-bottom: var(--space-2);
	}
</style>
