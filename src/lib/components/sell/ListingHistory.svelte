<script lang="ts">
	import { onMount } from 'svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import OptimizedCardImage from '$lib/components/OptimizedCardImage.svelte';

	interface Props {
		ebayConnected: boolean;
	}

	let { ebayConnected }: Props = $props();

	interface ListingItem {
		id: string;
		card_id: string;
		title: string;
		price: number;
		condition: string | null;
		status: string;
		ebay_listing_id: string | null;
		ebay_listing_url: string | null;
		scan_image_url: string | null;
		card_image_url: string | null;
		hero_name: string | null;
		card_number: string | null;
		set_code: string | null;
		parallel: string | null;
		weapon_type: string | null;
		sold_at: string | null;
		sold_price: number | null;
		error_message: string | null;
		created_at: string;
	}

	interface Summary {
		total: number;
		active: number;
		sold: number;
		revenue: number;
	}

	let listings = $state<ListingItem[]>([]);
	let summary = $state<Summary>({ total: 0, active: 0, sold: 0, revenue: 0 });
	let loading = $state(true);
	let syncing = $state(false);
	let activeFilter = $state<string>('all');

	const filters = ['all', 'active', 'sold', 'drafts'] as const;

	let filteredListings = $derived(
		activeFilter === 'all'
			? listings
			: activeFilter === 'active'
				? listings.filter(l => l.status === 'published' || l.status === 'draft')
				: activeFilter === 'sold'
					? listings.filter(l => l.status === 'sold')
					: activeFilter === 'drafts'
						? listings.filter(l => l.status === 'draft' || l.status === 'pending')
						: listings
	);

	onMount(() => {
		if (ebayConnected) loadListings();
	});

	async function loadListings() {
		loading = true;
		try {
			const res = await fetch('/api/ebay/listings');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			listings = data.listings || [];
			summary = data.summary || { total: 0, active: 0, sold: 0, revenue: 0 };
		} catch (err) {
			console.warn('[ListingHistory] Failed to load listings:', err);
		}
		loading = false;
	}

	async function syncStatus() {
		syncing = true;
		try {
			const res = await fetch('/api/ebay/sync-status', { method: 'POST' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			showToast(data.message || 'Status synced', 'check');
			// Reload listings to reflect updates
			await loadListings();
		} catch (err) {
			showToast('Sync failed — try again later', 'x');
			console.warn('[ListingHistory] Sync failed:', err);
		}
		syncing = false;
	}

	function statusLabel(status: string): string {
		switch (status) {
			case 'published': return 'Active';
			case 'draft': return 'Draft';
			case 'pending': return 'Pending';
			case 'sold': return 'Sold';
			case 'ended': return 'Ended';
			case 'error': return 'Error';
			default: return status;
		}
	}

	function formatDate(dateStr: string): string {
		const d = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - d.getTime();
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Yesterday';
		if (diffDays < 7) return `${diffDays}d ago`;
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	function formatPrice(price: number): string {
		return `$${price.toFixed(2)}`;
	}
</script>

{#if !ebayConnected}
	<!-- Don't render if not connected -->
{:else}
	<div class="lh-section">
		<div class="lh-header">
			<h2 class="section-heading">My Listings</h2>
			{#if listings.length > 0}
				<button
					class="lh-sync-btn"
					onclick={syncStatus}
					disabled={syncing}
					title="Refresh listing status from eBay"
				>
					<span class="lh-sync-icon" class:spinning={syncing}>&#x21bb;</span>
					{syncing ? 'Syncing...' : 'Refresh'}
				</button>
			{/if}
		</div>

		{#if loading}
			<div class="lh-loading">
				<div class="lh-skeleton"></div>
				<div class="lh-skeleton"></div>
				<div class="lh-skeleton short"></div>
			</div>
		{:else if listings.length === 0}
			<div class="lh-empty">
				<p>No listings yet. Scan or upload a card to create your first listing.</p>
			</div>
		{:else}
			<!-- Summary strip -->
			<div class="lh-summary">
				<div class="lh-stat">
					<span class="lh-stat-value">{summary.total}</span>
					<span class="lh-stat-label">Listed</span>
				</div>
				<div class="lh-stat">
					<span class="lh-stat-value">{summary.active}</span>
					<span class="lh-stat-label">Active</span>
				</div>
				<div class="lh-stat">
					<span class="lh-stat-value lh-sold-value">{summary.sold}</span>
					<span class="lh-stat-label">Sold</span>
				</div>
				<div class="lh-stat">
					<span class="lh-stat-value lh-revenue-value">{summary.revenue > 0 ? formatPrice(summary.revenue) : '—'}</span>
					<span class="lh-stat-label">Revenue</span>
				</div>
			</div>

			<!-- Filter tabs -->
			<div class="lh-filters">
				{#each filters as f}
					<button
						class="lh-filter-tab"
						class:active={activeFilter === f}
						onclick={() => { activeFilter = f; }}
					>
						{f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'sold' ? 'Sold' : 'Drafts'}
						{#if f === 'all'}
							<span class="lh-filter-count">{listings.length}</span>
						{:else if f === 'active'}
							<span class="lh-filter-count">{summary.active}</span>
						{:else if f === 'sold'}
							<span class="lh-filter-count">{summary.sold}</span>
						{:else}
							<span class="lh-filter-count">{listings.filter(l => l.status === 'draft' || l.status === 'pending').length}</span>
						{/if}
					</button>
				{/each}
			</div>

			<!-- Listing rows -->
			<div class="lh-list">
				{#each filteredListings as listing (listing.id)}
					<div class="lh-row">
						<div class="lh-thumb">
							{#if listing.scan_image_url}
								<img src={listing.scan_image_url} alt={listing.hero_name || 'Card'} class="lh-img" />
							{:else if listing.card_image_url}
								<OptimizedCardImage src={listing.card_image_url} alt={listing.hero_name || 'Card'} className="lh-img" size="thumb" />
							{:else}
								<span class="lh-placeholder">&#x1F3B4;</span>
							{/if}
						</div>
						<div class="lh-info">
							<span class="lh-name">{listing.hero_name || listing.title}</span>
							<span class="lh-meta">
								{listing.card_number || ''}{listing.set_code ? ` · ${listing.set_code}` : ''}{listing.parallel ? ` · ${listing.parallel}` : ''}
							</span>
							<span class="lh-meta">{formatDate(listing.created_at)}</span>
						</div>
						<div class="lh-right">
							<span class="lh-price">
								{#if listing.status === 'sold' && listing.sold_price}
									{formatPrice(listing.sold_price)}
								{:else}
									{formatPrice(listing.price)}
								{/if}
							</span>
							<span class="lh-badge lh-badge-{listing.status}">{statusLabel(listing.status)}</span>
							{#if listing.ebay_listing_url}
								<a
									href={listing.ebay_listing_url}
									target="_blank"
									rel="noopener noreferrer"
									class="lh-ebay-link"
								>
									eBay &#x2197;
								</a>
							{:else if listing.status === 'draft' || listing.status === 'pending'}
								<a
									href="https://www.ebay.com/sh/lst/drafts"
									target="_blank"
									rel="noopener noreferrer"
									class="lh-ebay-link"
								>
									Seller Hub &#x2197;
								</a>
							{/if}
						</div>
					</div>
					{#if listing.status === 'sold' && listing.sold_at}
						<div class="lh-sold-banner">
							Sold {formatDate(listing.sold_at)}{listing.sold_price ? ` for ${formatPrice(listing.sold_price)}` : ''}
						</div>
					{/if}
					{#if listing.status === 'error' && listing.error_message}
						<div class="lh-error-banner">{listing.error_message}</div>
					{/if}
				{/each}
			</div>

			{#if filteredListings.length === 0}
				<div class="lh-empty">
					<p>No {activeFilter === 'all' ? '' : activeFilter} listings found.</p>
				</div>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.lh-section {
		margin-bottom: 2rem;
	}

	.lh-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}

	.lh-header .section-heading {
		margin-bottom: 0;
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #475569);
	}

	.lh-sync-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.625rem;
		border-radius: 6px;
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		background: var(--bg-elevated, #121d34);
		color: var(--text-secondary, #94a3b8);
		font-size: 0.7rem;
		font-weight: 600;
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.lh-sync-btn:hover:not(:disabled) {
		border-color: var(--accent-primary, #3b82f6);
		color: var(--accent-primary, #3b82f6);
	}

	.lh-sync-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.lh-sync-icon {
		font-size: 0.85rem;
		display: inline-block;
	}

	.lh-sync-icon.spinning {
		animation: lh-spin 1s linear infinite;
	}

	@keyframes lh-spin {
		to { transform: rotate(360deg); }
	}

	/* Summary strip */
	.lh-summary {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.lh-stat {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.125rem;
		padding: 0.5rem 0.25rem;
		border-radius: 8px;
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
	}

	.lh-stat-value {
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary, #e2e8f0);
	}

	.lh-sold-value {
		color: var(--gold, #f59e0b);
	}

	.lh-revenue-value {
		color: var(--success, #10b981);
		font-size: 0.9rem;
	}

	.lh-stat-label {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-muted, #475569);
	}

	/* Filter tabs */
	.lh-filters {
		display: flex;
		gap: 0.375rem;
		margin-bottom: 0.75rem;
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
	}

	.lh-filter-tab {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.625rem;
		border-radius: 6px;
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		background: var(--bg-elevated, #121d34);
		color: var(--text-secondary, #94a3b8);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.15s;
	}

	.lh-filter-tab.active {
		border-color: var(--accent-primary, #3b82f6);
		background: rgba(59, 130, 246, 0.1);
		color: var(--accent-primary, #3b82f6);
	}

	.lh-filter-count {
		font-size: 0.65rem;
		padding: 0.0625rem 0.3rem;
		border-radius: 4px;
		background: rgba(148, 163, 184, 0.1);
		color: var(--text-muted, #475569);
	}

	.lh-filter-tab.active .lh-filter-count {
		background: rgba(59, 130, 246, 0.15);
		color: var(--accent-primary, #3b82f6);
	}

	/* Listing rows */
	.lh-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.lh-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
	}

	.lh-thumb {
		width: 40px;
		height: 52px;
		border-radius: 6px;
		background: var(--bg-surface, #0d1524);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		overflow: hidden;
	}

	.lh-thumb :global(.lh-img),
	.lh-thumb .lh-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 6px;
	}

	.lh-placeholder {
		font-size: 1.25rem;
	}

	.lh-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.lh-name {
		font-size: 0.85rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-primary, #e2e8f0);
	}

	.lh-meta {
		font-size: 0.7rem;
		color: var(--text-muted, #475569);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lh-right {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.lh-price {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-primary, #e2e8f0);
	}

	/* Status badges */
	.lh-badge {
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.lh-badge-published {
		background: rgba(34, 197, 94, 0.12);
		color: #22c55e;
	}

	.lh-badge-draft, .lh-badge-pending {
		background: rgba(59, 130, 246, 0.12);
		color: #3b82f6;
	}

	.lh-badge-sold {
		background: rgba(245, 158, 11, 0.12);
		color: #f59e0b;
	}

	.lh-badge-ended {
		background: rgba(148, 163, 184, 0.12);
		color: #94a3b8;
	}

	.lh-badge-error {
		background: rgba(239, 68, 68, 0.12);
		color: #ef4444;
	}

	.lh-ebay-link {
		font-size: 0.65rem;
		font-weight: 600;
		color: var(--accent-primary, #3b82f6);
		text-decoration: none;
		padding: 0.0625rem 0.3rem;
		border-radius: 3px;
		border: 1px solid rgba(59, 130, 246, 0.2);
		white-space: nowrap;
	}

	.lh-ebay-link:hover {
		background: rgba(59, 130, 246, 0.1);
	}

	/* Sold/Error banners */
	.lh-sold-banner {
		margin-top: -0.25rem;
		margin-bottom: 0.125rem;
		padding: 0.25rem 0.75rem 0.25rem 3.75rem;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--gold, #f59e0b);
		background: rgba(245, 158, 11, 0.06);
		border-radius: 0 0 8px 8px;
		border: 1px solid rgba(245, 158, 11, 0.08);
		border-top: none;
	}

	.lh-error-banner {
		margin-top: -0.25rem;
		margin-bottom: 0.125rem;
		padding: 0.25rem 0.75rem 0.25rem 3.75rem;
		font-size: 0.7rem;
		color: #ef4444;
		background: rgba(239, 68, 68, 0.06);
		border-radius: 0 0 8px 8px;
		border: 1px solid rgba(239, 68, 68, 0.08);
		border-top: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Loading skeleton */
	.lh-loading {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.lh-skeleton {
		height: 52px;
		border-radius: 8px;
		background: var(--bg-elevated, #121d34);
		animation: lh-shimmer 1.5s ease-in-out infinite;
	}

	.lh-skeleton.short {
		width: 60%;
	}

	@keyframes lh-shimmer {
		0%, 100% { opacity: 0.5; }
		50% { opacity: 0.8; }
	}

	/* Empty state */
	.lh-empty {
		text-align: center;
		padding: 1.5rem 1rem;
		color: var(--text-secondary, #94a3b8);
		font-size: 0.85rem;
	}
</style>
