<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';

	interface CardPrice {
		id: string;
		name: string;
		hero_name: string | null;
		card_number: string | null;
		power: number | null;
		weapon_type: string | null;
		parallel: string | null;
		set_code: string | null;
		price_low: number | null;
		price_mid: number | null;
		price_high: number | null;
		listings_count: number | null;
		confidence_score: number | null;
		fetched_at: string | null;
		scan_count: number;
	}

	let loading = $state(true);
	let cards = $state<CardPrice[]>([]);
	let search = $state('');
	let searchInput = $state('');
	let filter = $state<'all' | 'priced' | 'searched' | 'unsearched'>('all');
	let sort = $state<'name' | 'price' | 'fetched' | 'scans'>('name');
	let order = $state<'asc' | 'desc'>('asc');
	let page = $state(1);
	let totalPages = $state(1);
	let total = $state(0);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		loadCards();
	});

	// Debounced search
	function onSearchInput() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			search = searchInput;
			page = 1;
			loadCards();
		}, 400);
	}

	function changeFilter(newFilter: typeof filter) {
		filter = newFilter;
		page = 1;
		loadCards();
	}

	function changeSort(newSort: typeof sort) {
		if (sort === newSort) {
			order = order === 'asc' ? 'desc' : 'asc';
		} else {
			sort = newSort;
			order = newSort === 'name' ? 'asc' : 'desc';
		}
		page = 1;
		loadCards();
	}

	function changePage(newPage: number) {
		page = newPage;
		loadCards();
	}

	async function loadCards() {
		loading = true;
		try {
			const params = new URLSearchParams({
				page: String(page),
				limit: '50',
				sort,
				order,
				filter
			});
			if (search) params.set('search', search);

			const res = await fetch(`/api/admin/card-prices?${params}`);
			if (!res.ok) throw new Error('Failed to load card prices');

			const data = await res.json();
			cards = data.cards;
			total = data.pagination.total;
			totalPages = data.pagination.totalPages;
		} catch {
			showToast('Failed to load card prices', 'x');
		}
		loading = false;
	}

	function formatPrice(val: number | null): string {
		if (val == null) return '—';
		return `$${val.toFixed(2)}`;
	}

	function formatAge(fetched_at: string | null): string {
		if (!fetched_at) return 'Never';
		const diff = Date.now() - new Date(fetched_at).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function sortIndicator(col: typeof sort): string {
		if (sort !== col) return '';
		return order === 'asc' ? ' ↑' : ' ↓';
	}

	const filterCounts = $derived({
		showing: cards.length,
		total,
		start: (page - 1) * 50 + 1,
		end: Math.min(page * 50, total)
	});
</script>

<div class="card-prices">
	<!-- Search & Filter Bar -->
	<div class="controls">
		<input
			type="text"
			class="search-input"
			placeholder="Search by name or card number..."
			bind:value={searchInput}
			oninput={onSearchInput}
		/>
		<div class="filter-row">
			<button class="filter-btn" class:active={filter === 'all'} onclick={() => changeFilter('all')}>All</button>
			<button class="filter-btn" class:active={filter === 'priced'} onclick={() => changeFilter('priced')}>Priced</button>
			<button class="filter-btn" class:active={filter === 'searched'} onclick={() => changeFilter('searched')}>No Price</button>
			<button class="filter-btn" class:active={filter === 'unsearched'} onclick={() => changeFilter('unsearched')}>Unsearched</button>
		</div>
	</div>

	<!-- Results count -->
	{#if total > 0}
		<div class="results-count">
			Showing {filterCounts.start}–{filterCounts.end} of {total.toLocaleString()} cards
		</div>
	{/if}

	{#if loading && cards.length === 0}
		<div class="loading">Loading card prices...</div>
	{:else if cards.length === 0}
		<div class="empty">No cards found matching your criteria.</div>
	{:else}
		<!-- Table -->
		<div class="table-wrapper">
			<table class="price-table">
				<thead>
					<tr>
						<th class="sortable" onclick={() => changeSort('name')}>
							Card{sortIndicator('name')}
						</th>
						<th class="sortable num" onclick={() => changeSort('price')}>
							Price{sortIndicator('price')}
						</th>
						<th class="num">Range</th>
						<th class="sortable num" onclick={() => changeSort('scans')}>
							Scans{sortIndicator('scans')}
						</th>
						<th class="sortable" onclick={() => changeSort('fetched')}>
							Last Checked{sortIndicator('fetched')}
						</th>
					</tr>
				</thead>
				<tbody>
					{#each cards as card (card.id)}
						{@const status = card.price_mid != null ? 'priced' : card.fetched_at ? 'no-price' : 'unsearched'}
						<tr class={status}>
							<td class="card-cell">
								<div class="card-name">{card.name || card.hero_name || '—'}</div>
								<div class="card-meta">
									{card.card_number || ''}
									{#if card.weapon_type}
										· {card.weapon_type}
									{/if}
									{#if card.parallel && card.parallel !== 'Standard'}
										· {card.parallel}
									{/if}
								</div>
							</td>
							<td class="num">
								<span class="price-val" class:has-price={card.price_mid != null}>
									{formatPrice(card.price_mid)}
								</span>
							</td>
							<td class="num range">
								{#if card.price_low != null && card.price_high != null}
									<span class="range-text">{formatPrice(card.price_low)} – {formatPrice(card.price_high)}</span>
								{:else}
									<span class="range-text dim">—</span>
								{/if}
							</td>
							<td class="num">
								<span class="scan-count" class:zero={card.scan_count === 0}>
									{card.scan_count}
								</span>
							</td>
							<td>
								<span class="age" class:stale={card.fetched_at != null && (Date.now() - new Date(card.fetched_at).getTime()) > 7 * 86400000}>
									{formatAge(card.fetched_at)}
								</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="pagination">
				<button
					class="page-btn"
					disabled={page <= 1}
					onclick={() => changePage(page - 1)}
				>Prev</button>

				{#each Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
					if (totalPages <= 7) return i + 1;
					if (page <= 4) return i + 1;
					if (page >= totalPages - 3) return totalPages - 6 + i;
					return page - 3 + i;
				}) as p (p)}
					<button
						class="page-btn"
						class:active={p === page}
						onclick={() => changePage(p)}
					>{p}</button>
				{/each}

				<button
					class="page-btn"
					disabled={page >= totalPages}
					onclick={() => changePage(page + 1)}
				>Next</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.card-prices {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.controls {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.search-input {
		width: 100%;
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		font-size: 0.85rem;
		outline: none;
	}

	.search-input:focus {
		border-color: var(--gold);
	}

	.filter-row {
		display: flex;
		gap: 0.25rem;
	}

	.filter-btn {
		flex: 1;
		padding: 0.375rem 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-tertiary);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
	}

	.filter-btn:hover {
		border-color: var(--border-strong);
		color: var(--text-secondary);
	}

	.filter-btn.active {
		border-color: var(--gold);
		color: var(--gold);
		background: var(--bg-elevated);
	}

	.results-count {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.loading, .empty {
		text-align: center;
		padding: 2rem;
		color: var(--text-tertiary);
		font-size: 0.85rem;
	}

	.table-wrapper {
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		border-radius: 8px;
		border: 1px solid var(--border);
	}

	.price-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
		min-width: 500px;
	}

	.price-table thead {
		background: var(--bg-surface);
		position: sticky;
		top: 0;
	}

	.price-table th {
		padding: 0.5rem 0.625rem;
		text-align: left;
		font-weight: 600;
		color: var(--text-secondary);
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}

	.price-table th.sortable {
		cursor: pointer;
		user-select: none;
	}

	.price-table th.sortable:hover {
		color: var(--gold);
	}

	.price-table th.num,
	.price-table td.num {
		text-align: right;
	}

	.price-table td {
		padding: 0.5rem 0.625rem;
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
	}

	.price-table tr.unsearched {
		opacity: 0.6;
	}

	.card-cell {
		max-width: 200px;
	}

	.card-name {
		font-weight: 500;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.card-meta {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.price-val {
		color: var(--text-tertiary);
	}

	.price-val.has-price {
		color: var(--success);
		font-weight: 600;
	}

	.range-text {
		font-size: 0.7rem;
		color: var(--text-tertiary);
	}

	.range-text.dim {
		opacity: 0.4;
	}

	.scan-count {
		font-variant-numeric: tabular-nums;
	}

	.scan-count.zero {
		color: var(--text-tertiary);
		opacity: 0.4;
	}

	.age {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.age.stale {
		color: var(--warning);
	}

	.pagination {
		display: flex;
		justify-content: center;
		gap: 0.25rem;
		padding-top: 0.5rem;
	}

	.page-btn {
		padding: 0.375rem 0.625rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-tertiary);
		font-size: 0.75rem;
		cursor: pointer;
		min-width: 2rem;
	}

	.page-btn:hover:not(:disabled) {
		border-color: var(--border-strong);
		color: var(--text-secondary);
	}

	.page-btn.active {
		border-color: var(--gold);
		color: var(--gold);
		font-weight: 600;
	}

	.page-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
