<script lang="ts">
	import { collectionItems, collectionLoading, loadCollection } from '$lib/stores/collection.svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import { getCachedPriceMid } from '$lib/stores/prices.svelte';
	import { buildEbaySearchUrl } from '$lib/services/ebay';
	import OptimizedCardImage from '$lib/components/OptimizedCardImage.svelte';
	import CardDetail from '$lib/components/CardDetail.svelte';
	import ListingHistory from '$lib/components/sell/ListingHistory.svelte';
	import { getBuiltInTemplate, generateCSV, downloadFile } from '$lib/services/export-templates';
	import { getAllTags } from '$lib/stores/tags.svelte';
	import { onMount } from 'svelte';

	interface Props {
		ebayConfigured: boolean;
		ebayConnected: boolean;
		ebayChecked: boolean;
		ebaySellerUsername: string | null;
		ebaySellerEmail: string | null;
		ebayConnectedSince: string | null;
		ebayTokenHealth: { access_token_valid: boolean; refresh_days_remaining: number } | null;
		onStartScan: () => void;
		onStartUpload: () => void;
		onEbayDisconnected: () => void;
		onStartWhatnot?: () => void;
	}

	let { ebayConfigured, ebayConnected, ebayChecked, ebaySellerUsername, ebaySellerEmail, ebayConnectedSince, ebayTokenHealth, onStartScan, onStartUpload, onEbayDisconnected, onStartWhatnot }: Props = $props();

	let ebayDisconnecting = $state(false);
	let ebayValidating = $state(false);
	let ebayExpanded = $state(false);
	let ebayValidation = $state<{ valid: boolean; sellingLimit?: { amount: number; quantity: number }; error?: string } | null>(null);

	async function disconnectEbay() {
		ebayDisconnecting = true;
		try {
			const res = await fetch('/api/ebay/disconnect', { method: 'POST' });
			if (!res.ok) throw new Error();
			ebayValidation = null;
			onEbayDisconnected();
			showToast('eBay account disconnected', 'check');
		} catch {
			showToast('Failed to disconnect eBay', 'x');
		}
		ebayDisconnecting = false;
	}

	async function validateEbay() {
		ebayValidating = true;
		ebayValidation = null;
		try {
			const res = await fetch('/api/ebay/validate', { method: 'POST' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			ebayValidation = data;
			if (data.valid) {
				showToast('eBay connection verified', 'check');
			} else {
				showToast(data.error || 'eBay connection invalid', 'x');
			}
		} catch {
			ebayValidation = { valid: false, error: 'Validation request failed' };
			showToast('Could not validate eBay connection', 'x');
		}
		ebayValidating = false;
	}

	const rawItems = $derived(collectionItems());
	const loading = $derived(collectionLoading());
	let selectedItem = $state<(typeof items)[number] | null>(null);
	let sortBy = $state<'price' | 'recent'>('price');
	let scannedCollapsed = $state(false);
	let scannedFilter = $state<'all' | 'priced' | 'unpriced'>('all');

	// Sort items: by price (highest first) or by most recently added
	const items = $derived.by(() => {
		let list = [...rawItems];

		// Filter
		if (scannedFilter === 'priced') {
			list = list.filter(item => item.card && getCachedPriceMid(item.card.id) != null);
		} else if (scannedFilter === 'unpriced') {
			list = list.filter(item => !item.card || getCachedPriceMid(item.card.id) == null);
		}

		// Sort
		if (sortBy === 'price') {
			list.sort((a, b) => {
				const priceA = a.card ? (getCachedPriceMid(a.card.id) ?? -1) : -1;
				const priceB = b.card ? (getCachedPriceMid(b.card.id) ?? -1) : -1;
				return priceB - priceA; // highest price first
			});
		}
		// 'recent' = default Supabase order (added_at DESC), no re-sort needed
		return list;
	});

	onMount(() => { loadCollection(); });

	function buildExportRows(): Record<string, unknown>[] {
		return items.map((item) => {
			const card = item.card;
			const tags = card ? getAllTags() : {};
			const cardTags = card ? (tags[card.id] || []) : [];
			return {
				cardId: card?.id || '',
				hero: card?.hero_name || '',
				athlete: card?.athlete_name || '',
				year: '',
				set: card?.set_code || '',
				cardNumber: card?.card_number || '',
				weapon: card?.weapon_type || '',
				power: card?.power ?? '',
				condition: item.condition || '',
				notes: item.notes || '',
				tags: cardTags.join('; '),
				rarity: card?.rarity || '',
				ebayAvgPrice: '',
				ebayLowPrice: '',
				ebayBuyNowPrice: '',
				listingPrice: '',
				ebaySearchUrl: ''
			};
		});
	}

	function quickExport(templateId: string) {
		const tpl = getBuiltInTemplate(templateId);
		if (!tpl) return;
		const rows = buildExportRows();
		if (rows.length === 0) {
			showToast('No cards to export', 'x');
			return;
		}
		const csv = generateCSV(rows, tpl.fields);
		const date = new Date().toISOString().split('T')[0];
		downloadFile(csv, `boba-${tpl.name.toLowerCase().replace(/\s+/g, '-')}-${date}.csv`);
		showToast(`Exported ${rows.length} cards`, 'check');
	}
</script>

<div class="sell-page">
	<header class="page-header">
		<h1>Sell</h1>
		<p class="subtitle">Export and price your collection</p>
	</header>

	<!-- Primary Actions — scan/upload to start listing flow -->
	<div class="sell-actions">
		<button class="sell-cta" onclick={onStartScan} disabled={!ebayConnected && ebayChecked}>
			<span class="sell-cta-icon">📷</span>
			<div class="sell-cta-text">
				<span class="sell-cta-label">Scan to List</span>
				<span class="sell-cta-hint">Camera → eBay</span>
			</div>
		</button>
		<button class="sell-cta" onclick={onStartUpload} disabled={!ebayConnected && ebayChecked}>
			<span class="sell-cta-icon">📤</span>
			<div class="sell-cta-text">
				<span class="sell-cta-label">Upload to List</span>
				<span class="sell-cta-hint">Photo → eBay</span>
			</div>
		</button>
	</div>

	{#if !ebayConnected && ebayChecked && ebayConfigured}
		<p class="sell-connect-hint">Connect your eBay account below to enable listing</p>
	{/if}

	<!-- Whatnot batch export -->
	{#if onStartWhatnot}
		<div class="whatnot-section">
			<button class="sell-cta whatnot-cta" onclick={onStartWhatnot}>
				<span class="sell-cta-icon">📦</span>
				<div class="sell-cta-text">
					<span class="sell-cta-label">Whatnot CSV</span>
					<span class="sell-cta-hint">Batch scan → CSV import</span>
				</div>
			</button>
		</div>
	{/if}

	<!-- Export Options — secondary, for bulk operations -->
	<div class="export-section">
		<h2 class="section-heading">Export</h2>
		<div class="export-row">
			<button class="export-btn" onclick={() => quickExport('__builtin_general')}>
				📄 Collection CSV
			</button>
			<button class="export-btn" onclick={() => quickExport('__builtin_ebay')}>
				🛒 eBay CSV
			</button>
			<a href="/export" class="export-btn export-btn-link">
				⚙ Custom
			</a>
		</div>
	</div>

	<!-- eBay Seller Connection -->
	{#if ebayChecked}
		<div class="ebay-connect-section">
			<h2 class="section-heading">eBay Seller</h2>
			{#if ebayConnected}
				<div class="ebay-seller-card">
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="ebay-seller-header" onclick={() => ebayExpanded = !ebayExpanded}>
						<span class="ebay-status-dot"></span>
						<span class="ebay-seller-connected-label">
							Connected{ebaySellerUsername ? ` as ${ebaySellerUsername}` : ''}
						</span>
						<span class="ebay-chevron">{ebayExpanded ? '▾' : '▸'}</span>
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="ebay-seller-actions" onclick={(e) => e.stopPropagation()}>
							<button class="ebay-action-btn ebay-action-test" onclick={validateEbay} disabled={ebayValidating}>
								{ebayValidating ? '...' : 'Test'}
							</button>
							<button class="ebay-action-btn ebay-action-disconnect" onclick={disconnectEbay} disabled={ebayDisconnecting}>
								{ebayDisconnecting ? '...' : 'Disconnect'}
							</button>
						</div>
					</div>

					{#if ebayExpanded}
					<div class="ebay-seller-details">
						{#if ebaySellerUsername}
							<div class="ebay-detail-row">
								<span class="ebay-detail-label">Seller</span>
								<span class="ebay-detail-value">{ebaySellerUsername}</span>
							</div>
						{/if}
						{#if ebaySellerEmail}
							<div class="ebay-detail-row">
								<span class="ebay-detail-label">Email</span>
								<span class="ebay-detail-value ebay-email">{ebaySellerEmail}</span>
							</div>
						{/if}
						{#if ebayConnectedSince}
							<div class="ebay-detail-row">
								<span class="ebay-detail-label">Since</span>
								<span class="ebay-detail-value">{new Date(ebayConnectedSince).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
							</div>
						{/if}
						{#if ebayTokenHealth}
							<div class="ebay-detail-row">
								<span class="ebay-detail-label">Token</span>
								<span class="ebay-detail-value">
									<span class="ebay-token-dot" class:healthy={ebayTokenHealth.access_token_valid} class:expired={!ebayTokenHealth.access_token_valid}></span>
									{ebayTokenHealth.access_token_valid ? 'Active' : 'Refreshing'}
									{#if ebayTokenHealth.refresh_days_remaining <= 30}
										<span class="ebay-token-warning"> · {ebayTokenHealth.refresh_days_remaining}d left</span>
									{/if}
								</span>
							</div>
						{/if}
					</div>
					{/if}

					{#if ebayValidation}
						<div class="ebay-validation-banner" class:valid={ebayValidation.valid} class:invalid={!ebayValidation.valid}>
							{#if ebayValidation.valid}
								Verified
								{#if ebayValidation.sellingLimit}
									 · Limit: {ebayValidation.sellingLimit.quantity} items / ${ebayValidation.sellingLimit.amount.toLocaleString()}
								{/if}
							{:else}
								{ebayValidation.error || 'Connection invalid'}
							{/if}
						</div>
					{/if}

					{#if !ebaySellerUsername && !ebaySellerEmail}
						<p class="ebay-reconnect-hint">
							<a href="/auth/ebay" data-sveltekit-reload>Reconnect</a> to display your seller name and email.
						</p>
					{/if}
				</div>
			{:else if ebayConfigured}
				<div class="ebay-connect-card">
					<p class="ebay-connect-text">Connect your eBay seller account to list cards directly from scans.</p>
					<a href="/auth/ebay" class="btn-ebay-connect" data-sveltekit-reload>Connect eBay Account</a>
				</div>
			{:else}
				<div class="ebay-connect-card">
					<p class="ebay-connect-text">eBay listing integration is coming soon. You'll be able to list cards for sale directly from scans.</p>
				</div>
			{/if}
		</div>
	{/if}

	<!-- My Listings -->
	{#if ebayConnected}
		<ListingHistory {ebayConnected} />
	{/if}

	<!-- Scanned Cards -->
	<div class="scanned-cards">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="cards-header" onclick={() => scannedCollapsed = !scannedCollapsed}>
			<div class="cards-header-left">
				<span class="collapse-chevron">{scannedCollapsed ? '▸' : '▾'}</span>
				<h2 class="section-heading">Scanned Cards ({items.length})</h2>
			</div>
			{#if !scannedCollapsed}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="sort-toggle" onclick={(e) => e.stopPropagation()}>
					<button class="sort-btn" class:active={sortBy === 'price'} onclick={() => sortBy = 'price'}>Value</button>
					<button class="sort-btn" class:active={sortBy === 'recent'} onclick={() => sortBy = 'recent'}>Recent</button>
				</div>
			{/if}
		</div>
		{#if !scannedCollapsed}
			<div class="scanned-filter-row">
				<button class="scanned-filter-btn" class:active={scannedFilter === 'all'} onclick={() => scannedFilter = 'all'}>All {rawItems.length}</button>
				<button class="scanned-filter-btn" class:active={scannedFilter === 'priced'} onclick={() => scannedFilter = 'priced'}>Priced</button>
				<button class="scanned-filter-btn" class:active={scannedFilter === 'unpriced'} onclick={() => scannedFilter = 'unpriced'}>Unpriced</button>
			</div>
		{/if}
		{#if !scannedCollapsed}
			{#if loading}
				<div class="empty-state">
					<p>Loading your collection...</p>
				</div>
			{:else if items.length === 0}
				<div class="empty-state">
					<p>No cards in your collection yet.</p>
					<a href="/scan" class="btn-scan-link">Scan your first card</a>
				</div>
			{:else}
				<div class="cards-list">
					{#each items as item (item.id)}
						{@const card = item.card}
						{@const priceMid = card ? getCachedPriceMid(card.id) : null}
						<div class="card-row">
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="card-row-tappable" onclick={() => { selectedItem = item; }}>
								<div class="card-row-thumb">
									{#if item.scan_image_url}
										<img src={item.scan_image_url} alt={card?.hero_name || 'Card'} class="card-row-img" />
									{:else if card?.image_url}
										<OptimizedCardImage src={card.image_url} alt={card?.hero_name || card?.name || 'Card'} className="card-row-img" size="thumb" />
									{:else}
										<span class="card-row-placeholder">🎴</span>
									{/if}
								</div>
								<div class="card-row-info">
									<span class="card-row-name">{card?.hero_name || card?.name || 'Unknown'}</span>
									<span class="card-row-meta">{card?.card_number || ''} {card?.set_code ? `· ${card.set_code}` : ''}</span>
								</div>
							</div>
							<div class="card-row-actions">
								{#if priceMid != null}
									<span class="card-row-price">${priceMid.toFixed(2)}</span>
								{:else}
									<span class="card-row-price card-row-price-na">—</span>
								{/if}
								<a
									href={card ? buildEbaySearchUrl(card) : '#'}
									target="_blank"
									rel="noopener noreferrer"
									class="card-row-ebay-link"
									title="Search eBay for comps"
								>
									eBay ↗
								</a>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>

	<CardDetail item={selectedItem} ebayConnected={ebayConnected} onClose={() => { selectedItem = null; }} />
</div>

<style>
	.sell-page {
		max-width: 600px;
		margin: 0 auto;
		padding: 1rem;
	}

	.page-header { margin-bottom: 1.5rem; }
	h1 { font-size: 1.5rem; font-weight: 700; }
	.subtitle {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
	}

	.section-heading {
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #475569);
		margin-bottom: 0.75rem;
	}

	/* Primary sell CTAs */
	.sell-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.sell-cta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		border-radius: 12px;
		background: var(--bg-elevated, #121d34);
		border: 2px solid var(--accent-primary, #3b82f6);
		color: var(--text-primary, #e2e8f0);
		cursor: pointer;
		transition: transform 0.15s, box-shadow 0.15s;
	}

	.sell-cta:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
	}

	.sell-cta:disabled {
		border-color: var(--border, rgba(148,163,184,0.10));
		opacity: 0.4;
		cursor: not-allowed;
	}

	.sell-cta-icon { font-size: 1.5rem; flex-shrink: 0; }
	.sell-cta-text { display: flex; flex-direction: column; gap: 0.125rem; text-align: left; }
	.sell-cta-label { font-size: 0.9rem; font-weight: 700; }
	.sell-cta-hint { font-size: 0.7rem; color: var(--text-muted, #475569); }

	/* Whatnot CTA */
	.whatnot-section { margin-bottom: 1rem; }
	.whatnot-cta {
		width: 100%;
		border-color: #7c3aed;
	}
	.whatnot-cta:hover:not(:disabled) {
		box-shadow: 0 4px 12px rgba(124, 58, 237, 0.15);
	}

	.sell-connect-hint {
		font-size: 0.8rem;
		color: var(--text-muted, #475569);
		text-align: center;
		margin: -0.25rem 0 1rem;
	}

	/* Export section */
	.export-section { margin-bottom: 1.5rem; }

	.export-row {
		display: flex;
		gap: 0.5rem;
	}

	.export-btn {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		color: var(--text-secondary, #94a3b8);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		text-align: center;
		text-decoration: none;
		display: inline-block;
	}

	.export-btn:hover { border-color: var(--border-strong, rgba(148,163,184,0.25)); color: var(--text-primary, #e2e8f0); }

	/* eBay connection */
	.ebay-connect-section { margin-bottom: 2rem; }

	.ebay-seller-card {
		padding: 0.875rem 1rem;
		border-radius: 10px;
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
	}

	.ebay-seller-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		cursor: pointer;
	}

	.ebay-chevron {
		font-size: 0.75rem;
		color: var(--text-tertiary, #334155);
		margin-right: auto;
	}

	.ebay-status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--success, #10b981);
		flex-shrink: 0;
	}

	.ebay-seller-connected-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--success, #10b981);
	}

	.ebay-seller-actions {
		margin-left: auto;
		display: flex;
		gap: 0.375rem;
	}

	.ebay-action-btn {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.25rem 0.625rem;
		border-radius: 6px;
		border: 1px solid var(--border-strong, rgba(148,163,184,0.2));
		background: transparent;
		color: var(--text-secondary, #94a3b8);
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s;
	}
	.ebay-action-btn:disabled { opacity: 0.5; cursor: default; }
	.ebay-action-test { border-color: var(--info, #3b82f6); color: var(--info, #3b82f6); }
	.ebay-action-test:hover:not(:disabled) { background: rgba(59,130,246,0.08); }
	.ebay-action-disconnect:hover:not(:disabled) { border-color: var(--danger, #ef4444); color: var(--danger, #ef4444); }

	.ebay-seller-details {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.ebay-detail-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
	}

	.ebay-detail-label {
		width: 48px;
		flex-shrink: 0;
		color: var(--text-muted, #475569);
		font-weight: 500;
	}

	.ebay-detail-value {
		color: var(--text-secondary, #94a3b8);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ebay-email {
		font-size: 0.75rem;
	}

	.ebay-token-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		margin-right: 4px;
		vertical-align: middle;
	}
	.ebay-token-dot.healthy { background: var(--success, #10b981); }
	.ebay-token-dot.expired { background: var(--warning, #f59e0b); }

	.ebay-token-warning {
		color: var(--warning, #f59e0b);
		font-size: 0.7rem;
	}

	.ebay-validation-banner {
		margin-top: 0.625rem;
		padding: 0.375rem 0.625rem;
		border-radius: 6px;
		font-size: 0.75rem;
		font-weight: 500;
	}
	.ebay-validation-banner.valid {
		background: rgba(16,185,129,0.1);
		color: var(--success, #10b981);
	}
	.ebay-validation-banner.invalid {
		background: rgba(239,68,68,0.1);
		color: var(--danger, #ef4444);
	}

	.ebay-reconnect-hint {
		margin-top: 0.625rem;
		font-size: 0.75rem;
		color: var(--text-muted, #475569);
	}
	.ebay-reconnect-hint a {
		color: var(--accent-primary, #3b82f6);
		text-decoration: none;
	}
	.ebay-reconnect-hint a:hover { text-decoration: underline; }

	.ebay-connect-card {
		padding: 1rem;
		border-radius: 10px;
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
	}

	.ebay-connect-text {
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
		margin: 0 0 0.75rem;
	}

	.btn-ebay-connect {
		display: inline-block;
		padding: 0.5rem 1.25rem;
		border-radius: 8px;
		background: var(--accent-primary, #3b82f6);
		color: white;
		text-decoration: none;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.btn-ebay-connect:hover { opacity: 0.9; }

	.cards-header { cursor: pointer; }
	.cards-header-left { display: flex; align-items: center; gap: 0.5rem; }
	.collapse-chevron { font-size: 0.75rem; color: var(--text-tertiary, #334155); }

	.scanned-filter-row {
		display: flex;
		gap: 0.375rem;
		margin-bottom: 0.625rem;
	}
	.scanned-filter-btn {
		padding: 0.25rem 0.625rem;
		border-radius: 20px;
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		background: transparent;
		color: var(--text-tertiary, #334155);
		font-size: 0.7rem;
		font-weight: 600;
		cursor: pointer;
	}
	.scanned-filter-btn.active {
		background: var(--bg-elevated, #121d34);
		color: var(--text-primary, #e2e8f0);
		border-color: var(--accent-primary, #3b82f6);
	}

	/* Cards list */
	.empty-state {
		text-align: center;
		padding: 2rem 1rem;
		color: var(--text-secondary, #94a3b8);
	}

	.btn-scan-link {
		display: inline-block;
		margin-top: 0.75rem;
		padding: 0.5rem 1.25rem;
		border-radius: 8px;
		background: var(--accent-primary, #3b82f6);
		color: white;
		text-decoration: none;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.cards-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.card-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
	}

	.card-row-thumb {
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

	.card-row-thumb :global(.card-row-img),
	.card-row-thumb .card-row-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 6px;
	}

	.card-row-placeholder {
		font-size: 1.25rem;
	}

	.card-row-info { flex: 1; min-width: 0; }
	.card-row-name {
		display: block;
		font-size: 0.9rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.card-row-meta {
		font-size: 0.75rem;
		color: var(--text-muted, #475569);
	}

	.card-row-actions {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.25rem;
	}

	.card-row-ebay-link {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--primary, #3b82f6);
		text-decoration: none;
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
		border: 1px solid rgba(59, 130, 246, 0.2);
		white-space: nowrap;
	}

	.card-row-ebay-link:hover {
		background: rgba(59, 130, 246, 0.1);
	}

	/* Tappable card row */
	.card-row-tappable {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex: 1;
		min-width: 0;
		cursor: pointer;
	}
	.card-row-tappable:hover {
		opacity: 0.85;
	}

	/* Price display in card rows */
	.card-row-price {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--gold, #f59e0b);
		white-space: nowrap;
	}

	.card-row-price-na {
		color: var(--text-tertiary, #334155);
		font-weight: 400;
	}

	/* Cards header with sort toggle */
	.cards-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.cards-header .section-heading {
		margin-bottom: 0;
	}

	.sort-toggle {
		display: flex;
		gap: 2px;
		background: var(--bg-elevated, #121d34);
		border-radius: 6px;
		padding: 2px;
	}

	.sort-btn {
		padding: 0.25rem 0.625rem;
		border-radius: 5px;
		border: none;
		background: transparent;
		color: var(--text-tertiary, #334155);
		font-size: 0.7rem;
		font-weight: 600;
		cursor: pointer;
	}

	.sort-btn.active {
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #e2e8f0);
	}
</style>
