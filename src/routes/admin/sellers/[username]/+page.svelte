<script lang="ts">
	import type { PageData } from './$types';
	import type { SellerListing } from './+page.server';

	let { data }: { data: PageData } = $props();

	const seller = $derived(data.seller);
	const listings = $derived(data.listings);

	type SortField = 'ask_price' | 'pct_vs_median' | 'percentile_in_card' | 'competitors';

	let sortField = $state<SortField>('ask_price');
	let sortAsc = $state(false);
	let parallelFilter = $state<string>('all');
	let gameFilter = $state<string>('all');

	const allParallels = $derived(
		Array.from(new Set(listings.map((l) => l.parallel))).sort()
	);

	const filteredListings = $derived.by(() => {
		let result = listings;
		if (parallelFilter !== 'all') result = result.filter((l) => l.parallel === parallelFilter);
		if (gameFilter !== 'all') result = result.filter((l) => l.game_id === gameFilter);
		const dir = sortAsc ? 1 : -1;
		return [...result].sort((a, b) => {
			const av = Number(a[sortField] ?? -Infinity);
			const bv = Number(b[sortField] ?? -Infinity);
			return (av - bv) * dir;
		});
	});

	function ebayItemUrl(itemId: string): string {
		const parts = itemId.split('|');
		return `https://www.ebay.com/itm/${parts[1] ?? itemId}`;
	}

	function percentileTone(p: number | null): string {
		if (p == null) return 'muted';
		if (p <= 0.25) return 'success';
		if (p <= 0.5) return 'gold';
		if (p <= 0.75) return 'warning';
		return 'danger';
	}

	function fmtCurrency(n: number | null | undefined): string {
		if (n == null) return '—';
		return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
	}

	function toggleSort(field: SortField): void {
		if (sortField === field) sortAsc = !sortAsc;
		else {
			sortField = field;
			sortAsc = false;
		}
	}

	function sortIndicator(field: SortField): string {
		if (sortField !== field) return '';
		return sortAsc ? '↑' : '↓';
	}

	function listingKey(l: SellerListing): string {
		return l.ebay_item_id;
	}
</script>

<svelte:head>
	<title>{seller.seller_username} — Seller Analytics</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<a href="/admin/sellers" class="back-link">← All sellers</a>
			<h1 class="page-title mono">{seller.seller_username}</h1>
		</div>
		<a
			class="ext-link"
			href={`https://www.ebay.com/usr/${encodeURIComponent(seller.seller_username)}`}
			target="_blank"
			rel="noopener noreferrer"
		>
			eBay profile ↗
		</a>
	</header>

	<!-- Top stats -->
	<div class="stat-grid">
		<div class="stat-card">
			<div class="stat-label">Active Listings</div>
			<div class="stat-value">{seller.unique_listings.toLocaleString()}</div>
			<div class="stat-sub muted">
				{seller.distinct_cards} unique cards · {Number(seller.listings_per_card ?? 0).toFixed(1)}×
				per card
			</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">Total Ask</div>
			<div class="stat-value">{fmtCurrency(seller.total_ask_usd)}</div>
			<div class="stat-sub muted">median ${Number(seller.median_ask ?? 0).toFixed(0)}</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">Best Offer</div>
			<div class="stat-value">{Number(seller.best_offer_pct ?? 0).toFixed(0)}%</div>
			<div class="stat-sub muted">of listings</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">Feedback</div>
			<div class="stat-value">{(seller.feedback_score ?? 0).toLocaleString()}</div>
			<div class="stat-sub muted">{Number(seller.feedback_pct ?? 0).toFixed(1)}% positive</div>
		</div>
	</div>

	<!-- Pricing position + tier mix -->
	<div class="two-col">
		<div class="panel">
			<h3>Pricing Position</h3>
			{#if seller.competitive_listings >= 10}
				{@const total = seller.competitive_listings || 1}
				<p class="muted small">
					Of {seller.competitive_listings} listings where competition exists:
				</p>
				<div class="dist-bar">
					<div
						class="dist-seg dist-bottom"
						style:width="{(seller.in_bottom_quartile / total) * 100}%"
					>
						{seller.in_bottom_quartile > 5 ? `${seller.in_bottom_quartile} bottom` : ''}
					</div>
					<div
						class="dist-seg dist-mid"
						style:width="{(seller.in_middle_half / total) * 100}%"
					>
						{seller.in_middle_half > 5 ? `${seller.in_middle_half} mid` : ''}
					</div>
					<div
						class="dist-seg dist-top"
						style:width="{(seller.in_top_quartile / total) * 100}%"
					>
						{seller.in_top_quartile > 5 ? `${seller.in_top_quartile} top` : ''}
					</div>
				</div>
				<div class="muted small panel-meta">
					Avg percentile: <span class="mono">{Number(seller.avg_percentile ?? 0).toFixed(2)}</span>
					(stddev <span class="mono">{Number(seller.percentile_stddev ?? 0).toFixed(2)}</span>)
				</div>
				<div class="panel-meta">
					Archetype: <span class="strong info">{seller.pricing_archetype}</span>
				</div>
			{:else}
				<p class="muted small">
					Only {seller.competitive_listings} listings with comparable competition. Need ≥10 for
					archetype classification.
				</p>
			{/if}
		</div>

		<div class="panel">
			<h3>Price Tier Mix</h3>
			<div class="tier-row">
				<span>Under $10</span><span class="mono">{seller.under_10_count}</span>
			</div>
			<div class="tier-row">
				<span>$10–$50</span><span class="mono">{seller.p10_50_count}</span>
			</div>
			<div class="tier-row">
				<span>$50–$200</span><span class="mono">{seller.p50_200_count}</span>
			</div>
			<div class="tier-row">
				<span>$200+</span><span class="mono">{seller.p200_plus_count}</span>
			</div>
			<hr />
			<div class="tier-row muted small">
				<span>Days active</span><span>{seller.days_seen_active}/14</span>
			</div>
			<div class="tier-row muted small">
				<span>BoBA / Wonders</span>
				<span>{seller.boba_listings} / {seller.wonders_listings}</span>
			</div>
			<div class="tier-row muted small">
				<span>Inventory</span><span>{seller.inventory_archetype}</span>
			</div>
		</div>
	</div>

	<!-- Inventory -->
	<section class="section">
		<header class="section-header">
			<h2>Active Inventory</h2>
			<div class="inline-filters">
				<select bind:value={parallelFilter}>
					<option value="all">All parallels</option>
					{#each allParallels as p (p)}
						<option value={p}>{p}</option>
					{/each}
				</select>
				<select bind:value={gameFilter}>
					<option value="all">All games</option>
					<option value="boba">BoBA</option>
					<option value="wonders">Wonders</option>
				</select>
			</div>
		</header>
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Card</th>
						<th>Parallel</th>
						<th class="ra sortable" onclick={() => toggleSort('ask_price')}>
							Ask {sortIndicator('ask_price')}
						</th>
						<th class="ra">Market Low / Med / High</th>
						<th class="ra sortable" onclick={() => toggleSort('pct_vs_median')}>
							vs Median {sortIndicator('pct_vs_median')}
						</th>
						<th class="ra sortable" onclick={() => toggleSort('percentile_in_card')}>
							%-ile {sortIndicator('percentile_in_card')}
						</th>
						<th class="ra sortable" onclick={() => toggleSort('competitors')}>
							Comp. {sortIndicator('competitors')}
						</th>
						<th>Offers?</th>
						<th>View</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredListings as l (listingKey(l))}
						<tr>
							<td>
								<div class="strong">{l.card_name}</div>
								<div class="sub muted">
									{l.card_number}{l.weapon_type ? ` · ${l.weapon_type}` : ''}
								</div>
							</td>
							<td class="small">{l.parallel}</td>
							<td class="ra strong">${Number(l.ask_price).toFixed(2)}</td>
							<td class="ra muted small">
								${Number(l.market_low ?? 0).toFixed(0)} / ${Number(l.market_median ?? 0).toFixed(
									0
								)} / ${Number(l.market_high ?? 0).toFixed(0)}
							</td>
							<td class="ra">
								{#if l.pct_vs_median != null}
									<span class="strong small {Number(l.pct_vs_median) < 0 ? 'success' : 'danger'}">
										{Number(l.pct_vs_median) > 0 ? '+' : ''}{Number(l.pct_vs_median).toFixed(0)}%
									</span>
								{:else}
									<span class="muted">—</span>
								{/if}
							</td>
							<td class="ra">
								{#if l.percentile_in_card != null}
									<span class="badge badge-{percentileTone(Number(l.percentile_in_card))}">
										{Math.round(Number(l.percentile_in_card) * 100)}
									</span>
								{:else}
									<span class="muted small">—</span>
								{/if}
							</td>
							<td class="ra">{l.competitors}</td>
							<td class="small">{l.accepts_offers ? 'Yes' : 'No'}</td>
							<td>
								<a
									class="ext-link"
									href={ebayItemUrl(l.ebay_item_id)}
									target="_blank"
									rel="noopener noreferrer"
								>
									eBay ↗
								</a>
							</td>
						</tr>
					{/each}
					{#if filteredListings.length === 0}
						<tr>
							<td colspan="9" class="empty">No listings match these filters.</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	</section>
</div>

<style>
	.page {
		max-width: 1280px;
		margin: 0 auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		color: var(--text-primary);
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1rem;
	}

	.back-link {
		font-size: 0.8rem;
		color: var(--info);
		text-decoration: none;
	}
	.back-link:hover {
		text-decoration: underline;
	}

	.page-title {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0.25rem 0 0;
	}

	.ext-link {
		color: var(--info);
		text-decoration: none;
		font-size: 0.85rem;
	}
	.ext-link:hover {
		text-decoration: underline;
	}

	/* Stat grid */
	.stat-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}
	@media (min-width: 768px) {
		.stat-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.stat-card {
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.75rem 0.875rem;
	}

	.stat-label {
		font-size: 0.7rem;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.stat-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--gold);
		margin-top: 0.125rem;
	}

	.stat-sub {
		font-size: 0.72rem;
		margin-top: 0.125rem;
	}

	/* Two-col panels */
	.two-col {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
	}
	@media (min-width: 768px) {
		.two-col {
			grid-template-columns: 1fr 1fr;
		}
	}

	.panel {
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.875rem 1rem;
	}

	.panel h3 {
		font-size: 0.85rem;
		font-weight: 700;
		margin: 0 0 0.5rem 0;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}

	.panel-meta {
		margin-top: 0.5rem;
		font-size: 0.85rem;
	}

	.dist-bar {
		display: flex;
		height: 1.5rem;
		border-radius: 6px;
		overflow: hidden;
		font-size: 0.7rem;
		color: white;
		font-weight: 600;
		margin: 0.25rem 0;
	}

	.dist-seg {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
	}

	.dist-bottom {
		background: var(--success);
	}
	.dist-mid {
		background: var(--gold);
	}
	.dist-top {
		background: var(--danger);
	}

	.tier-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
		padding: 0.125rem 0;
	}

	.panel hr {
		border: none;
		border-top: 1px solid var(--border);
		margin: 0.5rem 0;
	}

	/* Section */
	.section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 0.75rem;
	}

	.section-header h2 {
		font-size: 1.05rem;
		font-weight: 700;
		margin: 0;
	}

	.inline-filters {
		display: flex;
		gap: 0.5rem;
	}

	.inline-filters select {
		background: var(--bg-elevated);
		border: 1px solid var(--border-strong);
		color: var(--text-primary);
		padding: 0.3rem 0.5rem;
		border-radius: 6px;
		font-size: 0.8rem;
	}

	/* Table */
	.table-wrap {
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 10px;
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	thead tr {
		background: rgba(148, 163, 184, 0.05);
	}

	th {
		text-align: left;
		font-size: 0.7rem;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.5rem 0.625rem;
		font-weight: 600;
	}

	th.sortable {
		cursor: pointer;
		user-select: none;
	}

	th.sortable:hover {
		color: var(--text-primary);
	}

	td {
		padding: 0.5rem 0.625rem;
		border-top: 1px solid var(--border);
		vertical-align: middle;
	}

	tbody tr:hover {
		background: var(--bg-hover);
	}

	.ra {
		text-align: right;
	}

	.mono {
		font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
	}

	.strong {
		font-weight: 600;
	}

	.small {
		font-size: 0.78rem;
	}

	.sub {
		font-size: 0.72rem;
		margin-top: 1px;
	}

	.muted {
		color: var(--text-secondary);
	}

	.success {
		color: var(--success);
	}

	.danger {
		color: var(--danger);
	}

	.info {
		color: var(--info);
	}

	.empty {
		text-align: center;
		padding: 1.5rem;
		color: var(--text-secondary);
	}

	/* Badges */
	.badge {
		display: inline-block;
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		white-space: nowrap;
	}

	.badge-success {
		background: var(--success-light);
		color: var(--success);
	}
	.badge-danger {
		background: var(--danger-light);
		color: var(--danger);
	}
	.badge-warning {
		background: var(--warning-light);
		color: var(--warning);
	}
	.badge-info {
		background: var(--info-light);
		color: var(--info);
	}
	.badge-gold {
		background: var(--gold-light);
		color: var(--gold);
	}
	.badge-muted {
		background: rgba(148, 163, 184, 0.12);
		color: var(--text-secondary);
	}
</style>
