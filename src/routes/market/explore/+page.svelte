<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { showToast } from '$lib/stores/toast.svelte';
	import { buildEbaySearchUrl } from '$lib/services/ebay';
	import AffiliateNotice from '$lib/components/AffiliateNotice.svelte';

	// ── Types ────────────────────────────────────────
	interface FacetValue { value: string; count: number; pricedCount?: number }
	interface Facets {
		parallel: FacetValue[];
		weapon: FacetValue[];
		set: FacetValue[];
		rarity: FacetValue[];
		hero: FacetValue[];
		power: FacetValue[];
	}
	interface ExploreCard {
		id: string;
		hero: string;
		num: string;
		set: string;
		power: number;
		rarity: string;
		weapon: string;
		parallel: string;
		athlete: string;
		priceMid: number | null;
		priceLow: number | null;
		priceHigh: number | null;
		bnMid: number | null;
		bnLow: number | null;
		bnCount: number;
		listings: number;
		filtered: number;
		confidence: number;
		fetchedAt: string | null;
		pricePerPower: number | null;
		bnPremium: number | null;
		liquidity: string;
		hasPriceData: boolean;
	}
	interface PlayCard {
		id: string;
		name: string;
		num: string;
		release: string;
		dbs: number;
		hotDogCost: number;
		ability: string;
		priceMid: number | null;
		priceLow: number | null;
		priceHigh: number | null;
		bnMid: number | null;
		bnLow: number | null;
		bnCount: number;
		listings: number;
		filtered: number;
		confidence: number;
		fetchedAt: string | null;
		pricePerDbs: number | null;
		liquidity: string;
		hasPriceData: boolean;
	}
	interface Aggregates {
		totalResults: number;
		pricedCount: number;
		avgPrice: number;
		totalListings: number;
		totalBnAvailable: number;
		avgConfidence: number;
		priceRange: { min: number; max: number } | null;
	}

	// ── Filter state (synced with URL) ───────────────
	let filterParallel = $state($page.url.searchParams.get('parallel') || '');
	let filterWeapon = $state($page.url.searchParams.get('weapon') || '');
	let filterSet = $state($page.url.searchParams.get('set') || '');
	let filterHero = $state($page.url.searchParams.get('hero') || '');
	let filterRarity = $state($page.url.searchParams.get('rarity') || '');
	let filterPowerMin = $state($page.url.searchParams.get('power_min') || '');
	let filterPowerMax = $state($page.url.searchParams.get('power_max') || '');
	let filterPriceMin = $state($page.url.searchParams.get('price_min') || '');
	let filterPriceMax = $state($page.url.searchParams.get('price_max') || '');
	let filterSort = $state($page.url.searchParams.get('sort') || 'price_asc');
	let filterCardType = $state<'hero' | 'play'>(($page.url.searchParams.get('card_type') as 'hero' | 'play') || 'hero');
	let filterPricedOnly = $state($page.url.searchParams.get('priced_only') === 'true');

	// ── Data state ───────────────────────────────────
	let facets = $state<Facets | null>(null);
	let cards = $state<(ExploreCard | PlayCard)[]>([]);
	let aggregates = $state<Aggregates | null>(null);
	let loading = $state(false);
	let hasMore = $state(false);
	let currentOffset = $state(0);
	let loadingMore = $state(false);
	let totalPriced = $state(0);
	let totalCards = $state(0);
	let filtersExpanded = $state(false);

	const SORT_OPTIONS = [
		{ value: 'price_asc', label: 'Cheapest First' },
		{ value: 'price_desc', label: 'Most Expensive' },
		{ value: 'power_desc', label: 'Highest Power' },
		{ value: 'power_per_dollar', label: 'Best $/Power' },
		{ value: 'listings', label: 'Most Listed' },
		{ value: 'confidence', label: 'Highest Confidence' },
	];

	const LIQUIDITY_LABELS: Record<string, { label: string; color: string }> = {
		available: { label: 'Available', color: 'var(--success)' },
		limited: { label: 'Limited', color: 'var(--warning)' },
		scarce: { label: 'Scarce', color: 'var(--danger)' },
		none: { label: 'None Listed', color: 'var(--text-muted)' },
		unknown: { label: 'Not Priced', color: 'var(--text-muted)' },
	};

	// Active filter count for the badge
	let activeFilterCount = $derived(
		[filterParallel, filterWeapon, filterSet, filterHero, filterRarity,
		 filterPowerMin, filterPowerMax, filterPriceMin, filterPriceMax]
			.filter(v => v !== '').length
	);

	// ── URL sync ─────────────────────────────────────
	function buildSearchParams(): URLSearchParams {
		const params = new URLSearchParams();
		if (filterParallel) params.set('parallel', filterParallel);
		if (filterWeapon) params.set('weapon', filterWeapon);
		if (filterSet) params.set('set', filterSet);
		if (filterHero) params.set('hero', filterHero);
		if (filterRarity) params.set('rarity', filterRarity);
		if (filterPowerMin) params.set('power_min', filterPowerMin);
		if (filterPowerMax) params.set('power_max', filterPowerMax);
		if (filterPriceMin) params.set('price_min', filterPriceMin);
		if (filterPriceMax) params.set('price_max', filterPriceMax);
		if (filterSort !== 'price_asc') params.set('sort', filterSort);
		if (filterCardType !== 'hero') params.set('card_type', filterCardType);
		if (filterPricedOnly) params.set('priced_only', 'true');
		return params;
	}

	function syncUrl() {
		const params = buildSearchParams();
		const qs = params.toString();
		goto(`/market/explore${qs ? '?' + qs : ''}`, { replaceState: true, noScroll: true });
	}

	// ── Data fetching ────────────────────────────────
	async function loadFacets() {
		try {
			const res = await fetch('/api/market/facets');
			if (!res.ok) return;
			const data = await res.json();
			facets = data.facets;
			totalPriced = data.totalPriced;
			totalCards = data.totalCards;
		} catch {
			console.debug('[explorer] Failed to load facets');
		}
	}

	let searchTimeout: ReturnType<typeof setTimeout> | undefined;

	async function loadResults(append = false) {
		if (!append) {
			loading = true;
			currentOffset = 0;
		} else {
			loadingMore = true;
		}

		try {
			const params = buildSearchParams();
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
				cards = [...cards, ...data.cards];
			} else {
				cards = data.cards;
			}

			aggregates = data.aggregates;
			hasMore = data.pagination.hasMore;
		} catch {
			showToast('Failed to load market data', '\u26A0\uFE0F');
		} finally {
			loading = false;
			loadingMore = false;
		}
	}

	function triggerSearch() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			syncUrl();
			loadResults();
		}, 300);
	}

	function loadMore() {
		if (loadingMore || !hasMore) return;
		currentOffset += 50;
		loadResults(true);
	}

	function clearFilters() {
		filterParallel = '';
		filterWeapon = '';
		filterSet = '';
		filterHero = '';
		filterRarity = '';
		filterPowerMin = '';
		filterPowerMax = '';
		filterPriceMin = '';
		filterPriceMax = '';
		filterSort = 'price_asc';
		filterPricedOnly = false;
		triggerSearch();
	}

	function setCardType(type: 'hero' | 'play') {
		filterCardType = type;
		// Reset hero-specific filters when switching to play
		if (type === 'play') {
			filterParallel = '';
			filterWeapon = '';
			filterPowerMin = '';
			filterPowerMax = '';
			filterHero = '';
		}
		triggerSearch();
	}

	// ── Helpers ──────────────────────────────────────
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

	function playEbayUrl(c: PlayCard): string {
		return buildEbaySearchUrl({
			card_number: c.num,
			name: c.name,
		});
	}

	// ── Lifecycle ────────────────────────────────────
	onMount(() => {
		loadFacets();
		loadResults();
	});

	// Re-fetch when filters change via $effect
	$effect(() => {
		// Track all filter dependencies
		void filterParallel; void filterWeapon; void filterSet;
		void filterHero; void filterRarity; void filterSort;
		void filterPowerMin; void filterPowerMax;
		void filterPriceMin; void filterPriceMax;
		void filterCardType;
		void filterPricedOnly;
		// Don't trigger on initial mount — onMount handles that
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
						Avg <strong>{fmt(aggregates.avgPrice)}</strong>
					</span>
				{/if}
			</div>
		{:else if loading}
			<div class="stats-bar"><span class="stat">Loading market data...</span></div>
		{/if}
	</header>

	<!-- Card Type Toggle -->
	<div class="type-toggle">
		<button class="type-btn" class:active={filterCardType === 'hero'} onclick={() => setCardType('hero')}>
			Heroes
		</button>
		<button class="type-btn" class:active={filterCardType === 'play'} onclick={() => setCardType('play')}>
			Plays
		</button>
	</div>

	<!-- Filter Bar -->
	<div class="filter-bar">
		<button class="filter-toggle" onclick={() => filtersExpanded = !filtersExpanded}>
			Filters
			{#if activeFilterCount > 0}
				<span class="filter-badge">{activeFilterCount}</span>
			{/if}
			<span class="filter-arrow" class:open={filtersExpanded}>{'\u25BE'}</span>
		</button>

		<label class="priced-toggle">
			<input type="checkbox" bind:checked={filterPricedOnly} onchange={triggerSearch} />
			Priced
		</label>

		<select class="sort-select" bind:value={filterSort} onchange={triggerSearch}>
			{#each SORT_OPTIONS as opt}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>
	</div>

	{#if filtersExpanded}
		<div class="filters-panel">
			{#if filterCardType === 'hero'}
				<div class="filter-row">
					<label class="filter-label">
						Parallel
						<select class="filter-select" bind:value={filterParallel} onchange={triggerSearch}>
							<option value="">All</option>
							{#if facets?.parallel}
								{#each facets.parallel as f}
									<option value={f.value}>{f.value} ({f.count})</option>
								{/each}
							{/if}
						</select>
					</label>

					<label class="filter-label">
						Weapon
						<select class="filter-select" bind:value={filterWeapon} onchange={triggerSearch}>
							<option value="">All</option>
							{#if facets?.weapon}
								{#each facets.weapon as f}
									<option value={f.value}>{f.value} ({f.count})</option>
								{/each}
							{/if}
						</select>
					</label>
				</div>

				<div class="filter-row">
					<label class="filter-label">
						Set
						<select class="filter-select" bind:value={filterSet} onchange={triggerSearch}>
							<option value="">All</option>
							{#if facets?.set}
								{#each facets.set as f}
									<option value={f.value}>{f.value} ({f.count})</option>
								{/each}
							{/if}
						</select>
					</label>

					<label class="filter-label">
						Rarity
						<select class="filter-select" bind:value={filterRarity} onchange={triggerSearch}>
							<option value="">All</option>
							{#if facets?.rarity}
								{#each facets.rarity as f}
									<option value={f.value}>{f.value} ({f.count})</option>
								{/each}
							{/if}
						</select>
					</label>
				</div>

				<div class="filter-row">
					<label class="filter-label">
						Hero
						<select class="filter-select" bind:value={filterHero} onchange={triggerSearch}>
							<option value="">All Heroes</option>
							{#if facets?.hero}
								{#each facets.hero as f}
									<option value={f.value}>{f.value} ({f.count})</option>
								{/each}
							{/if}
						</select>
					</label>
				</div>

				<div class="filter-row">
					<label class="filter-label">
						Power Min
						<input class="filter-input" type="number" placeholder="e.g. 100" bind:value={filterPowerMin} oninput={triggerSearch} />
					</label>
					<label class="filter-label">
						Power Max
						<input class="filter-input" type="number" placeholder="e.g. 170" bind:value={filterPowerMax} oninput={triggerSearch} />
					</label>
				</div>
			{/if}

			<div class="filter-row">
				<label class="filter-label">
					Price Min ($)
					<input class="filter-input" type="number" step="0.01" placeholder="e.g. 5" bind:value={filterPriceMin} oninput={triggerSearch} />
				</label>
				<label class="filter-label">
					Price Max ($)
					<input class="filter-input" type="number" step="0.01" placeholder="e.g. 100" bind:value={filterPriceMax} oninput={triggerSearch} />
				</label>
			</div>

			{#if activeFilterCount > 0}
				<button class="clear-btn" onclick={clearFilters}>Clear All Filters</button>
			{/if}
		</div>
	{/if}

	<!-- Active Filter Chips -->
	{#if activeFilterCount > 0}
		<div class="active-chips">
			{#if filterParallel}
				<button class="chip" onclick={() => { filterParallel = ''; triggerSearch(); }}>
					{filterParallel} &times;
				</button>
			{/if}
			{#if filterWeapon}
				<button class="chip" onclick={() => { filterWeapon = ''; triggerSearch(); }}>
					{filterWeapon} &times;
				</button>
			{/if}
			{#if filterSet}
				<button class="chip" onclick={() => { filterSet = ''; triggerSearch(); }}>
					Set: {filterSet} &times;
				</button>
			{/if}
			{#if filterHero}
				<button class="chip" onclick={() => { filterHero = ''; triggerSearch(); }}>
					{filterHero} &times;
				</button>
			{/if}
			{#if filterRarity}
				<button class="chip" onclick={() => { filterRarity = ''; triggerSearch(); }}>
					{filterRarity} &times;
				</button>
			{/if}
			{#if filterPowerMin}
				<button class="chip" onclick={() => { filterPowerMin = ''; triggerSearch(); }}>
					Power &ge; {filterPowerMin} &times;
				</button>
			{/if}
			{#if filterPowerMax}
				<button class="chip" onclick={() => { filterPowerMax = ''; triggerSearch(); }}>
					Power &le; {filterPowerMax} &times;
				</button>
			{/if}
			{#if filterPriceMin}
				<button class="chip" onclick={() => { filterPriceMin = ''; triggerSearch(); }}>
					${filterPriceMin}+ &times;
				</button>
			{/if}
			{#if filterPriceMax}
				<button class="chip" onclick={() => { filterPriceMax = ''; triggerSearch(); }}>
					&le; ${filterPriceMax} &times;
				</button>
			{/if}
		</div>
	{/if}

	<!-- Results -->
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
				<button class="clear-btn" onclick={clearFilters}>Clear Filters</button>
			{:else}
				<p class="empty-hint">Price data is populated by the nightly harvester. Cards without pricing won't appear here.</p>
			{/if}
		</div>
	{:else if filterCardType === 'hero'}
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
				{@const c = card as PlayCard}
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
			<button class="load-more-btn" onclick={loadMore} disabled={loadingMore}>
				{loadingMore ? 'Loading...' : 'Load More'}
			</button>
		</div>
	{/if}

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

	/* ── Header ─────────────────────────────────────── */
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

	/* ── Card Type Toggle ─────────────────────────── */
	.type-toggle {
		display: flex;
		gap: 2px;
		background: var(--bg-surface);
		border-radius: var(--radius-lg);
		padding: 2px;
		margin-bottom: var(--space-3);
	}
	.type-btn {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--text-secondary);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}
	.type-btn.active {
		background: var(--bg-elevated);
		color: var(--gold);
	}

	/* ── Filter Bar ────────────────────────────────── */
	.filter-bar {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}
	.filter-toggle {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		transition: border-color var(--transition-fast);
	}
	.filter-toggle:hover {
		border-color: var(--border-strong);
	}
	.filter-badge {
		background: var(--gold);
		color: #000;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 1px 6px;
		border-radius: var(--radius-full);
	}
	.filter-arrow {
		margin-left: auto;
		transition: transform var(--transition-fast);
	}
	.filter-arrow.open {
		transform: rotate(180deg);
	}
	.priced-toggle {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-2);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text-secondary);
		white-space: nowrap;
		cursor: pointer;
		user-select: none;
	}
	.priced-toggle input {
		accent-color: var(--gold);
	}
	.sort-select {
		padding: var(--space-2) var(--space-3);
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		cursor: pointer;
	}

	/* ── Filters Panel ─────────────────────────────── */
	.filters-panel {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--space-3);
		margin-bottom: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.filter-row {
		display: flex;
		gap: var(--space-3);
	}
	.filter-label {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--text-xs);
		color: var(--text-muted);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.filter-select, .filter-input {
		width: 100%;
		padding: var(--space-2);
		background: var(--bg-input);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
	}
	.filter-select:focus, .filter-input:focus {
		outline: none;
		border-color: var(--border-focus);
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
		align-self: flex-start;
	}
	.clear-btn:hover {
		border-color: var(--danger);
		color: var(--danger);
	}

	/* ── Active Chips ──────────────────────────────── */
	.active-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		background: var(--gold-light);
		border: 1px solid rgba(245,158,11,0.3);
		border-radius: var(--radius-full);
		color: var(--gold);
		font-family: var(--font-sans);
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}
	.chip:hover {
		background: var(--danger-light);
		border-color: var(--danger);
		color: var(--danger);
	}

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
	.stat-detail {
		font-weight: 400;
		color: var(--text-muted);
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

	/* ── Footer Stats ──────────────────────────────── */
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
