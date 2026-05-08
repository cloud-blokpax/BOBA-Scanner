<!--
	Comparable listings panel.

	Lazy-loaded eBay comparables for a card. Fetches /api/card-listings/[cardId]
	on first expand. All click-outs go through the affiliate URL (epn campid
	5339108029) which is already on every observation row.

	Reusable across surfaces — currently used by ScanPriceSection. Future
	wiring into War Room or a card detail page should use this component
	as-is; it owns its own state.
-->
<script lang="ts">
	import { onMount } from 'svelte';

	interface Listing {
		ebay_item_id: string;
		title: string;
		price_value: number | null;
		condition_label: string | null;
		image_url: string | null;
		item_affiliate_url: string | null;
		item_web_url: string | null;
		seller_username: string | null;
		seller_feedback_pct: number | null;
		observed_at: string;
	}

	let { cardId, limit = 8, defaultExpanded = false }: {
		cardId: string;
		limit?: number;
		defaultExpanded?: boolean;
	} = $props();

	let expanded = $state(defaultExpanded);
	let listings = $state<Listing[]>([]);
	let loading = $state(false);
	let loaded = $state(false);
	let errored = $state(false);

	// Fetch on first expand. Idempotent — won't re-fetch on collapse/re-expand.
	async function fetchListings() {
		if (loaded || loading) return;
		loading = true;
		errored = false;
		try {
			const res = await fetch(`/api/card-listings/${cardId}?limit=${limit}`);
			if (!res.ok) throw new Error(`${res.status}`);
			const data = await res.json();
			listings = data.listings ?? [];
			loaded = true;
		} catch (err) {
			console.error('[ComparableListings] fetch failed:', err);
			errored = true;
		} finally {
			loading = false;
		}
	}

	function toggle() {
		expanded = !expanded;
		if (expanded) void fetchListings();
	}

	function effectiveUrl(l: Listing): string | null {
		// Always prefer affiliate. Fall back to web URL only if affiliate is missing.
		return l.item_affiliate_url || l.item_web_url || null;
	}

	function fmtPrice(v: number | null): string {
		return v == null ? '—' : `$${v.toFixed(2)}`;
	}

	function fmtCondition(c: string | null): string {
		if (!c) return '';
		if (c === 'Ungraded') return 'Raw';
		if (c === 'New/Factory Sealed') return 'Sealed';
		return c;
	}

	function fmtRelative(iso: string): string {
		const ms = Date.now() - new Date(iso).getTime();
		const hours = Math.floor(ms / 3_600_000);
		if (hours < 1) return 'now';
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function handleImageError(ev: Event) {
		const img = ev.target as HTMLImageElement;
		img.style.display = 'none';
	}

	if (defaultExpanded) {
		onMount(() => {
			void fetchListings();
		});
	}
</script>

<div class="comparables">
	<button
		class="toggle"
		class:open={expanded}
		onclick={toggle}
		type="button"
		aria-expanded={expanded}
	>
		<span class="toggle-label">
			{expanded ? 'Hide' : 'See'} comparable listings
			{#if loaded && listings.length > 0}<span class="count-pill">{listings.length}</span>{/if}
		</span>
		<span class="caret" class:open={expanded}>▾</span>
	</button>

	{#if expanded}
		<div class="panel">
			{#if loading}
				<div class="state">Loading listings…</div>
			{:else if errored}
				<div class="state error">Couldn't load listings. Try again later.</div>
			{:else if listings.length === 0}
				<div class="state">No recent listings on eBay for this card.</div>
			{:else}
				<ul class="listing-list">
					{#each listings as l (l.ebay_item_id)}
						{@const url = effectiveUrl(l)}
						<li class="listing-row">
							{#if url}
								<a href={url} target="_blank" rel="noopener noreferrer sponsored" class="listing-link">
									{#if l.image_url}
										<img
											class="listing-thumb"
											src={l.image_url}
											alt=""
											loading="lazy"
											onerror={handleImageError}
										/>
									{:else}
										<div class="listing-thumb listing-thumb-placeholder"></div>
									{/if}
									<div class="listing-meta">
										<div class="listing-title" title={l.title}>{l.title}</div>
										<div class="listing-sub">
											<span class="listing-price">{fmtPrice(l.price_value)}</span>
											{#if l.condition_label}
												<span class="listing-condition">{fmtCondition(l.condition_label)}</span>
											{/if}
											<span class="listing-date">{fmtRelative(l.observed_at)}</span>
										</div>
									</div>
									<span class="listing-arrow" aria-hidden="true">↗</span>
								</a>
							{/if}
						</li>
					{/each}
				</ul>
				<div class="affiliate-note">
					Tapping a listing opens it on eBay. Card Scanner earns a commission on qualifying sales at no cost to you.
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.comparables {
		margin-top: 0.5rem;
	}

	.toggle {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
		padding: 0.45rem 0.75rem;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: var(--text-secondary, #94a3b8);
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s;
	}
	.toggle:hover { background: rgba(255, 255, 255, 0.06); }
	.toggle.open { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }

	.toggle-label { display: flex; align-items: center; gap: 0.4rem; }
	.count-pill {
		font-size: 0.7rem;
		font-weight: 700;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: rgba(59, 130, 246, 0.15);
		color: #3b82f6;
	}
	.caret { transition: transform 0.15s; font-size: 0.65rem; }
	.caret.open { transform: rotate(180deg); }

	.panel {
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-top: none;
		border-bottom-left-radius: 6px;
		border-bottom-right-radius: 6px;
		background: rgba(255, 255, 255, 0.015);
		padding: 0.5rem;
	}

	.state {
		padding: 0.75rem;
		text-align: center;
		font-size: 0.8rem;
		color: var(--text-muted, #475569);
	}
	.state.error { color: var(--danger, #ef4444); }

	.listing-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.listing-link {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.03);
		text-decoration: none;
		color: inherit;
		transition: background 0.15s;
	}
	.listing-link:hover { background: rgba(255, 255, 255, 0.06); }

	.listing-thumb {
		width: 48px;
		height: 48px;
		flex-shrink: 0;
		border-radius: 4px;
		object-fit: cover;
		background: rgba(255, 255, 255, 0.05);
	}
	.listing-thumb-placeholder {
		background: linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08));
	}

	.listing-meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.listing-title {
		font-size: 0.78rem;
		line-height: 1.25;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
	}
	.listing-sub {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.72rem;
	}
	.listing-price {
		font-weight: 700;
		color: var(--success, #10b981);
	}
	.listing-condition {
		padding: 0.05rem 0.35rem;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-secondary, #94a3b8);
		font-size: 0.65rem;
		font-weight: 600;
	}
	.listing-date {
		color: var(--text-muted, #475569);
		font-size: 0.7rem;
	}

	.listing-arrow {
		flex-shrink: 0;
		color: var(--text-muted, #475569);
		font-size: 0.85rem;
	}

	.affiliate-note {
		padding: 0.5rem 0.5rem 0.25rem;
		font-size: 0.65rem;
		color: var(--text-muted, #475569);
		text-align: center;
		line-height: 1.3;
	}
</style>
