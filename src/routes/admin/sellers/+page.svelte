<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	let { data }: { data: PageData } = $props();

	let searchInput = $state('');
	$effect(() => {
		searchInput = data.filters.search;
	});

	function updateFilters(updates: Record<string, string>): void {
		const params = new URLSearchParams(page.url.searchParams);
		for (const [k, v] of Object.entries(updates)) {
			if (v) params.set(k, v);
			else params.delete(k);
		}
		void goto(`/admin/sellers?${params.toString()}`, { replaceState: true });
	}

	function ebayItemUrl(itemId: string): string {
		// eBay v1 item ids look like "v1|306392128528|0" — the legacy numeric id is the middle segment.
		const parts = itemId.split('|');
		const legacy = parts[1] ?? itemId;
		return `https://www.ebay.com/itm/${legacy}`;
	}

	const PRICING_BADGE: Record<string, { label: string; tone: string }> = {
		undercutter: { label: 'Undercutter', tone: 'success' },
		premium_asker: { label: 'Premium Asker', tone: 'danger' },
		mixed_strategy: { label: 'Mixed', tone: 'warning' },
		mid_competitive: { label: 'Mid Competitive', tone: 'info' },
		mid_premium: { label: 'Mid Premium', tone: 'gold' },
		insufficient_data: { label: 'Too Few', tone: 'muted' }
	};

	const INVENTORY_BADGE: Record<string, { label: string; tone: string }> = {
		high_volume_dealer: { label: 'Dealer', tone: 'gold' },
		large_inventory: { label: 'Large', tone: 'info' },
		mid_inventory: { label: 'Mid', tone: 'info' },
		small_inventory: { label: 'Small', tone: 'muted' },
		casual: { label: 'Casual', tone: 'muted' }
	};

	function pricingBadge(arch: string): { label: string; tone: string } {
		return PRICING_BADGE[arch] ?? { label: arch, tone: 'muted' };
	}

	function inventoryBadge(arch: string): { label: string; tone: string } {
		return INVENTORY_BADGE[arch] ?? { label: arch, tone: 'muted' };
	}

	function fmtCurrency(n: number | null | undefined): string {
		if (n == null) return '—';
		return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
	}

	function fmtPct(n: number | null | undefined): string {
		if (n == null) return '—';
		return `${Number(n).toFixed(0)}%`;
	}
</script>

<svelte:head>
	<title>Seller Analytics — Card Scanner Admin</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<a href="/admin" class="back-link">← Admin home</a>
			<h1 class="page-title">Seller Analytics</h1>
			<p class="page-sub">14-day rolling snapshot of active BIN listings.</p>
		</div>
	</header>

	<!-- Stats cards -->
	<div class="stat-grid">
		<div class="stat-card">
			<div class="stat-label">Tracked Sellers</div>
			<div class="stat-value">{data.stats.totalSellers.toLocaleString()}</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">Total Active Listings</div>
			<div class="stat-value">{data.stats.totalListings.toLocaleString()}</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">Total Ask Volume</div>
			<div class="stat-value">{fmtCurrency(data.stats.totalAskVolume)}</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">Avg Listing</div>
			<div class="stat-value">
				{fmtCurrency(data.stats.totalAskVolume / Math.max(data.stats.totalListings, 1))}
			</div>
		</div>
	</div>

	<!-- Filter bar -->
	<div class="filter-bar">
		<div class="filter-field">
			<label for="sort">Sort by</label>
			<select
				id="sort"
				value={data.filters.sortBy}
				onchange={(e) => updateFilters({ sort: (e.target as HTMLSelectElement).value })}
			>
				<option value="total_ask_usd">Total Ask $</option>
				<option value="unique_listings"># Listings</option>
				<option value="median_ask">Median Ask</option>
				<option value="days_seen_active">Days Active</option>
				<option value="feedback_score">Feedback Score</option>
				<option value="avg_percentile">Avg Percentile</option>
			</select>
		</div>
		<div class="filter-field">
			<label for="archetype">Pricing Style</label>
			<select
				id="archetype"
				value={data.filters.archetype}
				onchange={(e) => updateFilters({ archetype: (e.target as HTMLSelectElement).value })}
			>
				<option value="all">All</option>
				<option value="undercutter">Undercutter</option>
				<option value="premium_asker">Premium Asker</option>
				<option value="mixed_strategy">Mixed</option>
				<option value="mid_competitive">Mid Competitive</option>
				<option value="mid_premium">Mid Premium</option>
				<option value="insufficient_data">Too Few Listings</option>
			</select>
		</div>
		<div class="filter-field">
			<label for="inventory">Inventory</label>
			<select
				id="inventory"
				value={data.filters.inventory}
				onchange={(e) => updateFilters({ inventory: (e.target as HTMLSelectElement).value })}
			>
				<option value="all">All</option>
				<option value="high_volume_dealer">High-Volume Dealer</option>
				<option value="large_inventory">Large (200+)</option>
				<option value="mid_inventory">Mid (50-199)</option>
				<option value="small_inventory">Small (10-49)</option>
				<option value="casual">Casual (1-9)</option>
			</select>
		</div>
		<div class="filter-field">
			<label for="min_listings">Min Listings</label>
			<input
				id="min_listings"
				type="number"
				class="num-input"
				value={data.filters.minListings}
				min="1"
				onchange={(e) => updateFilters({ min_listings: (e.target as HTMLInputElement).value })}
			/>
		</div>
		<form
			class="filter-field search-field"
			onsubmit={(e) => {
				e.preventDefault();
				updateFilters({ q: searchInput });
			}}
		>
			<label for="search">Search username</label>
			<div class="search-row">
				<input id="search" type="text" bind:value={searchInput} placeholder="username…" />
				<button type="submit">Go</button>
			</div>
		</form>
	</div>

	<!-- Sellers table -->
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Seller</th>
					<th class="ra">Listings</th>
					<th class="ra">Cards</th>
					<th class="ra">Total Ask</th>
					<th class="ra">Median</th>
					<th class="ra">BO %</th>
					<th>Pricing</th>
					<th>Inventory</th>
					<th class="ra">Days</th>
					<th class="ra">FB</th>
				</tr>
			</thead>
			<tbody>
				{#each data.sellers as s (s.seller_username)}
					{@const pa = pricingBadge(s.pricing_archetype)}
					{@const ia = inventoryBadge(s.inventory_archetype)}
					<tr>
						<td class="mono">
							<a class="seller-link" href="/admin/sellers/{encodeURIComponent(s.seller_username)}">
								{s.seller_username}
							</a>
						</td>
						<td class="ra">{s.unique_listings.toLocaleString()}</td>
						<td class="ra">{s.distinct_cards.toLocaleString()}</td>
						<td class="ra strong">{fmtCurrency(s.total_ask_usd)}</td>
						<td class="ra">${Number(s.median_ask ?? 0).toFixed(2)}</td>
						<td class="ra">{fmtPct(s.best_offer_pct)}</td>
						<td><span class="badge badge-{pa.tone}">{pa.label}</span></td>
						<td><span class="badge badge-{ia.tone}">{ia.label}</span></td>
						<td class="ra">{s.days_seen_active}</td>
						<td class="ra small">
							{(s.feedback_score ?? 0).toLocaleString()}
							<span class="muted">/{Number(s.feedback_pct ?? 0).toFixed(0)}%</span>
						</td>
					</tr>
				{/each}
				{#if data.sellers.length === 0}
					<tr>
						<td colspan="10" class="empty">No sellers match these filters.</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>

	<!-- Today's Deals -->
	<section class="section">
		<header class="section-header">
			<h2>Today's Deals</h2>
			<p>
				Active listings at 50%+ below their card's market median ($25+ cards only). Verify
				condition before acting — could be legit mispricing OR a damaged card.
			</p>
		</header>
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Card</th>
						<th>Parallel</th>
						<th class="ra">Ask</th>
						<th class="ra">Market</th>
						<th class="ra">Δ</th>
						<th>Seller</th>
						<th>Offers?</th>
						<th>View</th>
					</tr>
				</thead>
				<tbody>
					{#each data.deals as d (d.ebay_item_id)}
						<tr>
							<td>
								<div class="strong">{d.card_name}</div>
								<div class="sub muted">{d.card_number}</div>
							</td>
							<td class="small">{d.parallel}</td>
							<td class="ra strong success">${Number(d.ask_price).toFixed(2)}</td>
							<td class="ra muted">${Number(d.market_median ?? 0).toFixed(0)}</td>
							<td class="ra strong danger">{Number(d.pct_vs_median ?? 0).toFixed(0)}%</td>
							<td class="mono small">
								<a class="seller-link" href="/admin/sellers/{encodeURIComponent(d.seller_username)}">
									{d.seller_username}
								</a>
							</td>
							<td class="small">{d.accepts_offers ? 'Yes' : 'No'}</td>
							<td>
								<a
									class="ext-link"
									href={ebayItemUrl(d.ebay_item_id)}
									target="_blank"
									rel="noopener noreferrer"
								>
									eBay ↗
								</a>
							</td>
						</tr>
					{/each}
					{#if data.deals.length === 0}
						<tr>
							<td colspan="8" class="empty">No deals matching threshold right now.</td>
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
		margin: 0.25rem 0 0.125rem 0;
	}

	.page-sub {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin: 0;
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

	/* Filter bar */
	.filter-bar {
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.75rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: flex-end;
	}

	.filter-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.filter-field label {
		font-size: 0.7rem;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.filter-field select,
	.filter-field input {
		background: var(--bg-elevated);
		border: 1px solid var(--border-strong);
		color: var(--text-primary);
		padding: 0.375rem 0.5rem;
		border-radius: 6px;
		font-size: 0.85rem;
	}

	.filter-field select:focus,
	.filter-field input:focus {
		outline: none;
		border-color: var(--border-focus);
	}

	.num-input {
		width: 5rem;
	}

	.search-field {
		flex: 1;
		min-width: 220px;
	}

	.search-row {
		display: flex;
		gap: 0.5rem;
	}

	.search-row input {
		flex: 1;
	}

	.search-row button {
		padding: 0.375rem 0.875rem;
		border-radius: 6px;
		border: 1px solid var(--gold);
		background: var(--gold-light);
		color: var(--gold);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}
	.search-row button:hover {
		background: var(--gold-glow);
	}

	/* Tables */
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

	.empty {
		text-align: center;
		padding: 1.5rem;
		color: var(--text-secondary);
	}

	.seller-link {
		color: var(--info);
		text-decoration: none;
	}
	.seller-link:hover {
		text-decoration: underline;
	}

	.ext-link {
		color: var(--info);
		text-decoration: none;
		font-size: 0.78rem;
	}
	.ext-link:hover {
		text-decoration: underline;
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

	/* Section */
	.section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.section-header h2 {
		font-size: 1.05rem;
		font-weight: 700;
		margin: 0;
	}

	.section-header p {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin: 0.125rem 0 0 0;
	}
</style>
