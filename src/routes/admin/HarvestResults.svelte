<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import { buildEbaySearchQuery } from '$lib/utils/ebay-title';

	interface HarvestSummary {
		total: number;
		changed: number;
		newPrices: number;
		zeroResults: number;
		errors: number;
		avgDurationMs: number;
		maxChainDepth: number;
		startedAt: string | null;
		endedAt: string | null;
	}

	interface HarvestRow {
		card_id: string;
		hero_name: string | null;
		card_name: string | null;
		card_number: string | null;
		priority: number;
		price_mid: number | null;
		previous_mid: number | null;
		price_changed: boolean;
		price_delta: number | null;
		price_delta_pct: number | null;
		is_new_price: boolean;
		confidence_score: number;
		listings_count: number;
		success: boolean;
		zero_results: boolean;
		threshold_rejected: boolean;
		search_query: string;
		error_message: string | null;
		duration_ms: number;
		processed_at: string;
	}

	type Filter = 'all' | 'changed' | 'new' | 'zero' | 'rejected' | 'errors';

	const PAGE_SIZE = 50;

	let loading = $state(true);
	let runId = $state<string | null>(null);
	let availableRuns = $state<string[]>([]);
	let summary = $state<HarvestSummary | null>(null);
	let rows = $state<HarvestRow[]>([]);
	let filter = $state<Filter>('all');
	let sort = $state<'newest' | 'oldest'>('newest');
	let offset = $state(0);
	let total = $state(0);

	const hasMore = $derived(offset + PAGE_SIZE < total);
	const showingFrom = $derived(total > 0 ? offset + 1 : 0);
	const showingTo = $derived(Math.min(offset + PAGE_SIZE, total));

	$effect(() => {
		loadHarvestData();
	});

	// Re-fetch when filter changes (reset to page 1)
	$effect(() => {
		// Track filter to trigger re-fetch
		void filter;
		offset = 0;
		if (runId) loadDetail();
	});

	async function loadHarvestData() {
		loading = true;
		try {
			const res = await fetch(`/api/admin/harvest-log?limit=${PAGE_SIZE}&offset=0&sort=${sort}`);
			if (!res.ok) throw new Error('Failed to load harvest data');
			const data = await res.json();

			availableRuns = data.availableRuns;
			runId = data.runId;
			summary = data.summary;
			rows = data.rows;
			total = data.pagination.total;
			offset = 0;
			filter = 'all';
		} catch {
			showToast('Failed to load harvest results', 'x');
		}
		loading = false;
	}

	async function loadDetail() {
		if (!runId) return;
		try {
			const params = new URLSearchParams({
				run_id: runId,
				filter,
				sort,
				limit: String(PAGE_SIZE),
				offset: String(offset)
			});
			const res = await fetch(`/api/admin/harvest-log?${params}`);
			if (!res.ok) throw new Error('Failed to load');
			const data = await res.json();

			summary = data.summary;
			rows = data.rows;
			total = data.pagination.total;
		} catch {
			showToast('Failed to load harvest details', 'x');
		}
	}

	function onRunChange(e: Event) {
		const select = e.target as HTMLSelectElement;
		runId = select.value;
		offset = 0;
		filter = 'all';
		loadDetail();
	}

	function setFilter(f: Filter) {
		filter = f;
	}

	function toggleSort() {
		sort = sort === 'newest' ? 'oldest' : 'newest';
		offset = 0;
		loadDetail();
	}

	function nextPage() {
		offset += PAGE_SIZE;
		loadDetail();
	}

	function prevPage() {
		offset = Math.max(0, offset - PAGE_SIZE);
		loadDetail();
	}

	function formatRunDate(id: string): string {
		try {
			const d = new Date(id + 'T00:00:00Z');
			return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
		} catch {
			return id;
		}
	}

	function formatPrice(v: number | null): string {
		if (v == null) return '—';
		return `$${Number(v).toFixed(2)}`;
	}

	function formatDelta(row: HarvestRow): string {
		if (row.is_new_price) return 'NEW';
		if (row.price_delta == null) return '—';
		const sign = row.price_delta > 0 ? '+' : '';
		return `${sign}$${row.price_delta.toFixed(2)}`;
	}

	function deltaClass(row: HarvestRow): string {
		if (row.is_new_price) return 'delta-new';
		if (row.price_delta == null || row.price_delta === 0) return 'delta-flat';
		return row.price_delta > 0 ? 'delta-up' : 'delta-down';
	}

	const priorityLabels: Record<number, string> = {
		1: 'P1',
		2: 'P2',
		3: 'P3',
		4: 'P4'
	};

	const filterOptions: { key: Filter; label: string }[] = [
		{ key: 'all', label: 'All' },
		{ key: 'changed', label: 'Changed' },
		{ key: 'new', label: 'New' },
		{ key: 'zero', label: 'Zero Results' },
		{ key: 'rejected', label: 'Rejected' },
		{ key: 'errors', label: 'Errors' }
	];

	function ebaySearchUrl(row: HarvestRow): string {
		const query = buildEbaySearchQuery({
			hero_name: row.hero_name,
			name: row.card_name,
			card_number: row.card_number
		});
		return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`;
	}
</script>

<div class="harvest-results">
	<h3 class="section-title">Harvest Results</h3>

	{#if loading}
		<div class="loading">Loading harvest data...</div>
	{:else if availableRuns.length === 0}
		<div class="empty-state">No harvest runs found yet. The nightly harvester runs at 04:45 UTC.</div>
	{:else}
		<!-- Run selector -->
		<div class="run-selector">
			<label for="run-select">Run date</label>
			<select id="run-select" onchange={onRunChange} value={runId}>
				{#each availableRuns as run}
					<option value={run}>{formatRunDate(run)}</option>
				{/each}
			</select>
		</div>

		<!-- Summary cards -->
		{#if summary}
			<div class="summary-row">
				<div class="mini-card">
					<div class="mc-value">{summary.total.toLocaleString()}</div>
					<div class="mc-label">Processed</div>
				</div>
				<div class="mini-card">
					<div class="mc-value highlight">{summary.changed.toLocaleString()}</div>
					<div class="mc-label">Changed</div>
				</div>
				<div class="mini-card">
					<div class="mc-value new">{summary.newPrices.toLocaleString()}</div>
					<div class="mc-label">New</div>
				</div>
				<div class="mini-card">
					<div class="mc-value" class:warn={summary.zeroResults > 0}>{summary.zeroResults.toLocaleString()}</div>
					<div class="mc-label">Zero Results</div>
				</div>
				<div class="mini-card">
					<div class="mc-value" class:danger={summary.errors > 0}>{summary.errors.toLocaleString()}</div>
					<div class="mc-label">Errors</div>
				</div>
				<div class="mini-card">
					<div class="mc-value">{summary.avgDurationMs}ms</div>
					<div class="mc-label">Avg Duration</div>
				</div>
			</div>

			{#if summary.startedAt && summary.endedAt}
				<div class="run-timing">
					Chains: {summary.maxChainDepth + 1} &middot;
					Duration: {Math.round((new Date(summary.endedAt).getTime() - new Date(summary.startedAt).getTime()) / 1000)}s
				</div>
			{/if}
		{/if}

		<!-- Filter pills + sort toggle -->
		<div class="filter-bar">
			{#each filterOptions as opt}
				<button
					class="filter-pill"
					class:active={filter === opt.key}
					onclick={() => setFilter(opt.key)}
				>{opt.label}</button>
			{/each}
			<button class="sort-toggle" onclick={toggleSort} title="Sort by {sort === 'newest' ? 'oldest' : 'newest'} first">
				{sort === 'newest' ? '↓ Newest' : '↑ Oldest'}
			</button>
		</div>

		<!-- Results list -->
		{#if rows.length === 0}
			<div class="empty-state">No results match this filter.</div>
		{:else}
			<div class="results-list">
				{#each rows as row (row.card_id + row.processed_at)}
					<div class="result-row" class:error-row={!row.success}>
						<div class="row-main">
							<div class="card-info">
								<span class="card-name">{row.hero_name || row.card_name || row.card_id}</span>
								{#if row.card_number}
									<span class="card-number">#{row.card_number}</span>
								{/if}
							</div>
							<div class="price-info">
								{#if row.success}
									<span class="price-prev">{formatPrice(row.previous_mid)}</span>
									<span class="price-arrow">&rarr;</span>
									<span class="price-new">{formatPrice(row.price_mid)}</span>
									<span class="delta-badge {deltaClass(row)}">{formatDelta(row)}</span>
								{:else}
									<span class="error-msg">{row.error_message || 'Failed'}</span>
								{/if}
							</div>
						</div>
						<div class="row-meta">
							<span class="priority-badge p{row.priority}">{priorityLabels[row.priority] || `P${row.priority}`}</span>
							<span class="meta-item">{row.listings_count} listings</span>
							{#if row.confidence_score > 0}
								<span class="meta-item" title="Confidence score">
									<span class="confidence-dot" class:high={row.confidence_score >= 0.7} class:mid={row.confidence_score >= 0.4 && row.confidence_score < 0.7} class:low={row.confidence_score < 0.4}></span>
									{(row.confidence_score * 100).toFixed(0)}%
								</span>
							{/if}
							{#if row.threshold_rejected}
								<span class="meta-item rejected-badge">REJECTED</span>
							{/if}
							{#if row.zero_results}
								<span class="meta-item warn-text">0 results</span>
							{/if}
							<a href={ebaySearchUrl(row)} target="_blank" rel="noopener" class="meta-item ebay-link">eBay ↗</a>
							<span class="meta-item dim">{row.duration_ms}ms</span>
						</div>
					</div>
				{/each}
			</div>

			<!-- Pagination -->
			<div class="pagination">
				<span class="page-info">Showing {showingFrom}–{showingTo} of {total}</span>
				<div class="page-btns">
					<button class="page-btn" onclick={prevPage} disabled={offset === 0}>Prev</button>
					<button class="page-btn" onclick={nextPage} disabled={!hasMore}>Next</button>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.harvest-results {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.section-title {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-secondary);
		margin-bottom: 0;
	}

	.loading, .empty-state {
		text-align: center;
		padding: 2rem 1rem;
		color: var(--text-tertiary);
		font-size: 0.85rem;
	}

	/* Run selector */
	.run-selector {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.run-selector label {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		white-space: nowrap;
	}

	.run-selector select {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		font-size: 0.85rem;
	}

	/* Summary cards */
	.summary-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
		gap: 0.4rem;
	}

	.mini-card {
		background: var(--bg-elevated);
		border-radius: 8px;
		padding: 0.5rem;
		text-align: center;
	}

	.mc-value {
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.mc-value.highlight { color: var(--gold); }
	.mc-value.new { color: var(--success); }
	.mc-value.warn { color: var(--warning); }
	.mc-value.danger { color: var(--danger); }

	.mc-label {
		font-size: 0.65rem;
		color: var(--text-tertiary);
		margin-top: 1px;
	}

	.run-timing {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		text-align: center;
	}

	/* Filter pills */
	.filter-bar {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	.filter-pill {
		padding: 0.35rem 0.7rem;
		border-radius: 16px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-tertiary);
		font-size: 0.75rem;
		cursor: pointer;
		font-weight: 500;
		transition: all 0.15s;
	}

	.filter-pill:hover {
		border-color: var(--border-strong);
		color: var(--text-secondary);
	}

	.filter-pill.active {
		border-color: var(--gold);
		color: var(--gold);
		background: var(--bg-elevated);
	}

	.sort-toggle {
		margin-left: auto;
		padding: 0.35rem 0.7rem;
		border-radius: 16px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-tertiary);
		font-size: 0.75rem;
		cursor: pointer;
		font-weight: 500;
		transition: all 0.15s;
	}

	.sort-toggle:hover {
		border-color: var(--border-strong);
		color: var(--text-secondary);
	}

	/* Results list */
	.results-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-height: 500px;
		overflow-y: auto;
	}

	.result-row {
		background: var(--bg-elevated);
		border-radius: 8px;
		padding: 0.6rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.result-row.error-row {
		border-left: 3px solid var(--danger);
	}

	.row-main {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}

	.card-info {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
		min-width: 0;
		flex-shrink: 1;
	}

	.card-name {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.card-number {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		flex-shrink: 0;
	}

	.price-info {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
		font-size: 0.8rem;
	}

	.price-prev {
		color: var(--text-tertiary);
	}

	.price-arrow {
		color: var(--text-tertiary);
		font-size: 0.7rem;
	}

	.price-new {
		color: var(--text-primary);
		font-weight: 600;
	}

	.delta-badge {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
	}

	.delta-up {
		color: var(--success);
		background: color-mix(in srgb, var(--success) 15%, transparent);
	}

	.delta-down {
		color: var(--danger);
		background: color-mix(in srgb, var(--danger) 15%, transparent);
	}

	.delta-new {
		color: var(--gold);
		background: color-mix(in srgb, var(--gold) 15%, transparent);
	}

	.delta-flat {
		color: var(--text-tertiary);
	}

	.error-msg {
		color: var(--danger);
		font-size: 0.8rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 160px;
	}

	.row-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.priority-badge {
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.1rem 0.3rem;
		border-radius: 4px;
		background: var(--bg-hover);
		color: var(--text-tertiary);
	}

	.priority-badge.p1 { color: var(--danger); }
	.priority-badge.p2 { color: var(--warning); }
	.priority-badge.p3 { color: var(--text-secondary); }

	.meta-item {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		display: flex;
		align-items: center;
		gap: 0.2rem;
	}

	.meta-item.dim { opacity: 0.6; }
	.warn-text { color: var(--warning); }

	.confidence-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		display: inline-block;
	}

	.confidence-dot.high { background: var(--success); }
	.confidence-dot.mid { background: var(--warning); }
	.confidence-dot.low { background: var(--danger); }

	.ebay-link {
		color: var(--gold);
		text-decoration: none;
		font-weight: 600;
		font-size: 0.7rem;
	}

	.ebay-link:hover {
		text-decoration: underline;
	}

	.rejected-badge {
		color: var(--danger);
		font-weight: 700;
		font-size: 0.65rem;
		padding: 0.1rem 0.3rem;
		border-radius: 4px;
		background: color-mix(in srgb, var(--danger) 15%, transparent);
	}

	/* Pagination */
	.pagination {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding-top: 0.5rem;
	}

	.page-info {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.page-btns {
		display: flex;
		gap: 0.35rem;
	}

	.page-btn {
		padding: 0.35rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-secondary);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.page-btn:hover:not(:disabled) {
		border-color: var(--border-strong);
	}

	.page-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
