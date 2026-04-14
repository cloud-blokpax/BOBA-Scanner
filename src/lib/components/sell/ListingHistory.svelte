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
		description: string | null;
		price: number;
		condition: string | null;
		status: string;
		sku: string | null;
		ebay_listing_id: string | null;
		ebay_listing_url: string | null;
		ebay_offer_id: string | null;
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
		updated_at: string | null;
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
	let expandedId = $state<string | null>(null);
	let sortListingsBy = $state<'recent' | 'price-high' | 'price-low'>('recent');

	const filters = ['all', 'active', 'ended', 'sold', 'drafts'] as const;

	let filteredListings = $derived.by(() => {
		let result: ListingItem[];
		switch (activeFilter) {
			case 'active': result = listings.filter(l => l.status === 'published'); break;
			case 'ended': result = listings.filter(l => l.status === 'ended'); break;
			case 'sold': result = listings.filter(l => l.status === 'sold'); break;
			case 'drafts': result = listings.filter(l => l.status === 'draft' || l.status === 'pending'); break;
			default: result = [...listings];
		}
		if (sortListingsBy === 'price-high') {
			result = [...result].sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
		} else if (sortListingsBy === 'price-low') {
			result = [...result].sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
		}
		// 'recent' = default API order (created_at DESC), no re-sort
		return result;
	});

	const endedCount = $derived(listings.filter(l => l.status === 'ended').length);

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
			await loadListings();
		} catch (err) {
			showToast('Sync failed — try again later', 'x');
			console.warn('[ListingHistory] Sync failed:', err);
		}
		syncing = false;
	}

	async function endListing(id: string) {
		if (!confirm('End this listing on eBay? This cannot be undone.')) return;
		try {
			const res = await fetch('/api/ebay/end-listing', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ listingId: id })
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			showToast('Listing ended', 'check');
			expandedId = null;
			await loadListings();
		} catch (err) {
			showToast('Failed to end listing', 'x');
		}
	}

	async function removeListing(id: string) {
		if (!confirm('Remove from app? (Does not affect eBay)')) return;
		try {
			const res = await fetch('/api/ebay/end-listing', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ listingId: id })
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			showToast('Listing removed', 'check');
			expandedId = null;
			await loadListings();
		} catch (err) {
			showToast('Failed to remove', 'x');
		}
	}

	function toggleExpand(id: string) {
		expandedId = expandedId === id ? null : id;
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

	function formatFullDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString('en-US', {
			month: 'short', day: 'numeric', year: 'numeric',
			hour: 'numeric', minute: '2-digit'
		});
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
					<span class="lh-stat-value">{summary.active}</span>
					<span class="lh-stat-label">Active</span>
				</div>
				<div class="lh-stat">
					<span class="lh-stat-value">{endedCount}</span>
					<span class="lh-stat-label">Ended</span>
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
						{f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'ended' ? 'Ended' : f === 'sold' ? 'Sold' : 'Drafts'}
						{#if f === 'all'}
							<span class="lh-filter-count">{listings.length}</span>
						{:else if f === 'active'}
							<span class="lh-filter-count">{summary.active}</span>
						{:else if f === 'ended'}
							<span class="lh-filter-count">{endedCount}</span>
						{:else if f === 'sold'}
							<span class="lh-filter-count">{summary.sold}</span>
						{:else}
							<span class="lh-filter-count">{listings.filter(l => l.status === 'draft' || l.status === 'pending').length}</span>
						{/if}
					</button>
				{/each}
			</div>

			<!-- Sort control -->
			<div class="lh-sort-row">
				<span class="lh-sort-label">Sort:</span>
				<div class="lh-sort-toggle">
					<button class="lh-sort-btn" class:active={sortListingsBy === 'recent'} onclick={() => sortListingsBy = 'recent'}>Recent</button>
					<button class="lh-sort-btn" class:active={sortListingsBy === 'price-high'} onclick={() => sortListingsBy = 'price-high'}>Price ↓</button>
					<button class="lh-sort-btn" class:active={sortListingsBy === 'price-low'} onclick={() => sortListingsBy = 'price-low'}>Price ↑</button>
				</div>
			</div>

			<!-- Listing rows -->
			<div class="lh-list">
				{#each filteredListings as listing (listing.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="lh-card" class:expanded={expandedId === listing.id}
						onclick={() => toggleExpand(listing.id)}>
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
							</div>
						</div>

						{#if expandedId === listing.id}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="lh-detail" onclick={(e) => e.stopPropagation()}>
								<!-- Title -->
								<div class="lh-detail-section">
									<span class="lh-detail-label">Title</span>
									<span class="lh-detail-value">{listing.title}</span>
								</div>

								<!-- Card Details grid -->
								<div class="lh-detail-grid">
									{#if listing.hero_name}
										<div class="lh-detail-field">
											<span class="lh-detail-label">Hero</span>
											<span class="lh-detail-value">{listing.hero_name}</span>
										</div>
									{/if}
									{#if listing.card_number}
										<div class="lh-detail-field">
											<span class="lh-detail-label">Card #</span>
											<span class="lh-detail-value">{listing.card_number}</span>
										</div>
									{/if}
									{#if listing.set_code}
										<div class="lh-detail-field">
											<span class="lh-detail-label">Set</span>
											<span class="lh-detail-value">{listing.set_code}</span>
										</div>
									{/if}
									{#if listing.parallel}
										<div class="lh-detail-field">
											<span class="lh-detail-label">Parallel</span>
											<span class="lh-detail-value">{listing.parallel}</span>
										</div>
									{/if}
									{#if listing.weapon_type}
										<div class="lh-detail-field">
											<span class="lh-detail-label">Weapon</span>
											<span class="lh-detail-value">{listing.weapon_type}</span>
										</div>
									{/if}
									{#if listing.condition}
										<div class="lh-detail-field">
											<span class="lh-detail-label">Condition</span>
											<span class="lh-detail-value">{listing.condition}</span>
										</div>
									{/if}
								</div>

								<!-- Pricing -->
								<div class="lh-detail-grid">
									<div class="lh-detail-field">
										<span class="lh-detail-label">List Price</span>
										<span class="lh-detail-value">{formatPrice(listing.price)}</span>
									</div>
									{#if listing.sold_price}
										<div class="lh-detail-field">
											<span class="lh-detail-label">Sold Price</span>
											<span class="lh-detail-value lh-detail-sold">{formatPrice(listing.sold_price)}</span>
										</div>
									{/if}
									{#if listing.sold_at}
										<div class="lh-detail-field">
											<span class="lh-detail-label">Sold</span>
											<span class="lh-detail-value">{formatFullDate(listing.sold_at)}</span>
										</div>
									{/if}
								</div>

								<!-- Description (if exists) -->
								{#if listing.description}
									<div class="lh-detail-section">
										<span class="lh-detail-label">Description</span>
										<span class="lh-detail-value lh-detail-desc">{listing.description}</span>
									</div>
								{/if}

								<!-- System info -->
								<div class="lh-detail-system">
									{#if listing.sku}
										<div class="lh-detail-sys-row">
											<span class="lh-detail-sys-label">SKU</span>
											<span class="lh-detail-sys-value">{listing.sku}</span>
										</div>
									{/if}
									{#if listing.ebay_listing_id}
										<div class="lh-detail-sys-row">
											<span class="lh-detail-sys-label">eBay Item #</span>
											<span class="lh-detail-sys-value">{listing.ebay_listing_id}</span>
										</div>
									{/if}
									<div class="lh-detail-sys-row">
										<span class="lh-detail-sys-label">Created</span>
										<span class="lh-detail-sys-value">{formatFullDate(listing.created_at)}</span>
									</div>
									{#if listing.updated_at}
										<div class="lh-detail-sys-row">
											<span class="lh-detail-sys-label">Updated</span>
											<span class="lh-detail-sys-value">{formatFullDate(listing.updated_at)}</span>
										</div>
									{/if}
								</div>

								<!-- Error message -->
								{#if listing.error_message}
									<div class="lh-detail-error">{listing.error_message}</div>
								{/if}

								<!-- Actions -->
								<div class="lh-detail-actions">
									{#if listing.ebay_listing_url}
										<a href={listing.ebay_listing_url} target="_blank" rel="noopener noreferrer"
											class="lh-detail-btn lh-detail-btn-ebay">
											View on eBay &#x2197;
										</a>
									{/if}
									{#if listing.status === 'published' || listing.status === 'draft'}
										<button class="lh-detail-btn lh-detail-btn-end"
											onclick={() => endListing(listing.id)}>
											End Listing
										</button>
									{/if}
									<button class="lh-detail-btn lh-detail-btn-remove"
										onclick={() => removeListing(listing.id)}>
										Remove from App
									</button>
								</div>
							</div>
						{/if}
					</div>

					{#if listing.status === 'sold' && listing.sold_at && expandedId !== listing.id}
						<div class="lh-sold-banner">
							Sold {formatDate(listing.sold_at)}{listing.sold_price ? ` for ${formatPrice(listing.sold_price)}` : ''}
						</div>
					{/if}
					{#if listing.status === 'error' && listing.error_message && expandedId !== listing.id}
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

	.lh-sort-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.625rem;
	}
	.lh-sort-label {
		font-size: 0.7rem;
		color: var(--text-muted, #475569);
		font-weight: 500;
	}
	.lh-sort-toggle {
		display: flex;
		gap: 2px;
		background: var(--bg-elevated, #121d34);
		border-radius: 6px;
		padding: 2px;
	}
	.lh-sort-btn {
		padding: 0.2rem 0.5rem;
		border-radius: 5px;
		border: none;
		background: transparent;
		color: var(--text-tertiary, #334155);
		font-size: 0.65rem;
		font-weight: 600;
		cursor: pointer;
	}
	.lh-sort-btn.active {
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #e2e8f0);
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

	/* ── Expandable card ── */
	.lh-card {
		border-radius: 8px;
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		cursor: pointer;
		transition: border-color 0.15s;
		overflow: hidden;
	}

	.lh-card:hover {
		border-color: rgba(148,163,184,0.2);
	}

	.lh-card.expanded {
		border-color: var(--accent-primary, #3b82f6);
		border-width: 1px;
	}

	.lh-card .lh-row {
		background: none;
		border: none;
		border-radius: 0;
	}

	/* ── Detail panel ── */
	.lh-detail {
		padding: 0 0.75rem 0.75rem;
		border-top: 1px solid rgba(148,163,184,0.08);
		cursor: default;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.lh-detail-section {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding-top: 0.5rem;
	}

	.lh-detail-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem 0.75rem;
		padding-top: 0.5rem;
	}

	.lh-detail-field {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.lh-detail-label {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted, #475569);
	}

	.lh-detail-value {
		font-size: 0.8rem;
		color: var(--text-primary, #e2e8f0);
		word-break: break-word;
	}

	.lh-detail-sold {
		color: var(--gold, #f59e0b);
		font-weight: 700;
	}

	.lh-detail-desc {
		font-size: 0.75rem;
		color: var(--text-secondary, #94a3b8);
		line-height: 1.5;
		white-space: pre-wrap;
		max-height: 120px;
		overflow-y: auto;
	}

	/* System info */
	.lh-detail-system {
		padding: 0.5rem;
		border-radius: 6px;
		background: rgba(255,255,255,0.02);
		border: 1px solid rgba(148,163,184,0.06);
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.lh-detail-sys-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.lh-detail-sys-label {
		font-size: 0.65rem;
		color: var(--text-muted, #475569);
	}

	.lh-detail-sys-value {
		font-size: 0.7rem;
		color: var(--text-secondary, #94a3b8);
		text-align: right;
		max-width: 60%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lh-detail-error {
		padding: 0.375rem 0.5rem;
		border-radius: 6px;
		background: rgba(239, 68, 68, 0.08);
		color: #ef4444;
		font-size: 0.75rem;
	}

	/* Action buttons */
	.lh-detail-actions {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding-top: 0.25rem;
	}

	.lh-detail-btn {
		display: block;
		width: 100%;
		padding: 0.5rem;
		border-radius: 8px;
		font-size: 0.8rem;
		font-weight: 600;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
		transition: all 0.15s;
		border: 1px solid;
	}

	.lh-detail-btn-ebay {
		background: rgba(59, 130, 246, 0.08);
		border-color: rgba(59, 130, 246, 0.2);
		color: var(--accent-primary, #3b82f6);
	}

	.lh-detail-btn-ebay:hover {
		background: rgba(59, 130, 246, 0.15);
	}

	.lh-detail-btn-end {
		background: rgba(245, 158, 11, 0.08);
		border-color: rgba(245, 158, 11, 0.2);
		color: #f59e0b;
	}

	.lh-detail-btn-end:hover {
		background: rgba(245, 158, 11, 0.15);
	}

	.lh-detail-btn-remove {
		background: none;
		border-color: rgba(148, 163, 184, 0.1);
		color: var(--text-muted, #475569);
	}

	.lh-detail-btn-remove:hover {
		color: #ef4444;
		border-color: rgba(239, 68, 68, 0.2);
		background: rgba(239, 68, 68, 0.06);
	}
</style>
