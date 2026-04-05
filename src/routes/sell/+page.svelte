<script lang="ts">
	import { onMount } from 'svelte';
	import { collectionItems, collectionLoading, loadCollection } from '$lib/stores/collection.svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import OptimizedCardImage from '$lib/components/OptimizedCardImage.svelte';
	import CardDetail from '$lib/components/CardDetail.svelte';
	import Scanner from '$lib/components/Scanner.svelte';
	import { initScanner } from '$lib/stores/scanner.svelte';
	import { getPriceWithReason } from '$lib/stores/prices.svelte';
	import { generateListingTemplate } from '$lib/services/listing-generator';
	import {
		getBuiltInTemplate,
		generateCSV,
		downloadFile
	} from '$lib/services/export-templates';
	import { getAllTags } from '$lib/stores/tags.svelte';
	import type { ScanResult, Card } from '$lib/types';

	let ebayConfigured = $state(false);
	let ebayConnected = $state(false);
	let ebayChecked = $state(false);

	onMount(() => {
		loadCollection();
		// Check eBay seller connection status
		fetch('/api/ebay/status')
			.then(res => res.ok ? res.json() : Promise.reject())
			.then(data => {
				ebayConfigured = data.configured;
				ebayConnected = data.connected;
			})
			.catch((err) => {
				console.warn('[sell] eBay status check failed:', err);
				ebayConfigured = false;
				ebayConnected = false;
			})
			.finally(() => { ebayChecked = true; });
	});

	const items = $derived(collectionItems());
	const loading = $derived(collectionLoading());

	let selectedItem = $state<(typeof items)[number] | null>(null);

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

	// ── Scan-to-List state machine ──────────────────────
	type SellView = 'browse' | 'scanning' | 'listing';
	let view = $state<SellView>('browse');

	let listingCard = $state<Card | null>(null);
	let listingImageUrl = $state<string | null>(null);
	let listingPriceData = $state<{ price_mid: number | null; price_low: number | null; price_high: number | null; listings_count: number | null } | null>(null);
	let listingPriceLoading = $state(false);
	let listingCondition = $state('Near Mint');
	let listingPrice = $state('');
	let listingCreating = $state(false);
	let listingCreated = $state(false);
	let listingError = $state<string | null>(null);

	const CONDITIONS = ['Mint', 'Near Mint', 'Excellent', 'Good', 'Fair'] as const;

	function startScanToList() {
		initScanner();
		listingCard = null;
		listingImageUrl = null;
		listingPriceData = null;
		listingCondition = 'Near Mint';
		listingPrice = '';
		listingCreated = false;
		listingError = null;
		view = 'scanning';
	}

	async function handleScanResult(result: ScanResult, capturedImageUrl?: string) {
		if (!result.card) {
			showToast('Could not identify card — try again', 'x');
			return;
		}

		listingCard = result.card;
		listingImageUrl = capturedImageUrl || null;
		listingCreated = false;
		listingError = null;
		view = 'listing';

		listingPriceLoading = true;
		listingPriceData = null;
		try {
			const priceResult = await getPriceWithReason(result.card.id);
			listingPriceData = priceResult.data;
			const suggested = priceResult.data?.price_mid
				? Math.round(priceResult.data.price_mid * 1.1 * 100) / 100
				: 1.99;
			listingPrice = suggested.toFixed(2);
		} catch {
			listingPrice = '1.99';
		}
		listingPriceLoading = false;
	}

	async function createEbayDraft() {
		if (!listingCard) return;
		const price = parseFloat(listingPrice);
		if (isNaN(price) || price <= 0) {
			showToast('Enter a valid price', 'x');
			return;
		}

		listingCreating = true;
		listingError = null;

		try {
			const template = generateListingTemplate(listingCard, listingPriceData, listingCondition);
			const res = await fetch('/api/ebay/create-draft', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cardId: listingCard.id,
					heroName: listingCard.hero_name || listingCard.name,
					cardNumber: listingCard.card_number,
					setCode: listingCard.set_code,
					parallel: listingCard.parallel,
					weaponType: listingCard.weapon_type,
					power: listingCard.power,
					athleteName: listingCard.athlete_name,
					condition: listingCondition,
					price,
					quantity: 1,
					notes: null,
					scanImageUrl: null
				})
			});

			if (!res.ok) {
				const errData = await res.json().catch(() => ({ message: 'Failed to create draft' }));
				throw new Error(errData.message || errData.error || `Failed: ${res.status}`);
			}

			listingCreated = true;
			showToast('Draft created in eBay Seller Hub', 'check');

			setTimeout(() => {
				if (view === 'listing' && listingCreated) {
					listingCard = null;
					listingCreated = false;
					view = 'scanning';
				}
			}, 1500);
		} catch (err) {
			listingError = err instanceof Error ? err.message : 'Failed to create draft';
		}
		listingCreating = false;
	}

	function scanNextCard() {
		listingCard = null;
		listingCreated = false;
		listingError = null;
		view = 'scanning';
	}

	function exitScanToList() {
		view = 'browse';
		listingCard = null;
	}

</script>

<svelte:head>
	<title>Sell - BOBA Scanner</title>
</svelte:head>

{#if view === 'scanning'}
	<!-- SCAN-TO-LIST: Camera -->
	<div class="stl-scanner-view">
		<div class="stl-header">
			<button class="stl-back" onclick={exitScanToList}>← Back</button>
			<h1 class="stl-title">Scan to List</h1>
		</div>
		<div class="stl-scanner-container">
			<Scanner
				onResult={handleScanResult}
				isAuthenticated={!!ebayConnected}
				embedded={true}
				scanMode="single"
			/>
		</div>
	</div>

{:else if view === 'listing' && listingCard}
	<!-- SCAN-TO-LIST: Confirm & Price -->
	<div class="stl-listing-view">
		<div class="stl-header">
			<button class="stl-back" onclick={scanNextCard}>← Scan Next</button>
			<h1 class="stl-title">List Card</h1>
		</div>

		<!-- Card info -->
		<div class="stl-card-info">
			{#if listingImageUrl}
				<img src={listingImageUrl} alt={listingCard.hero_name || 'Card'} class="stl-card-image" />
			{:else}
				<div class="stl-card-placeholder">🎴</div>
			{/if}
			<div class="stl-card-details">
				<span class="stl-card-name">{listingCard.hero_name || listingCard.name || 'Unknown'}</span>
				<span class="stl-card-meta">{listingCard.card_number || ''}</span>
				<span class="stl-card-meta">{listingCard.set_code || ''}{listingCard.parallel ? ` · ${listingCard.parallel}` : ''}</span>
			</div>
		</div>

		<!-- Condition picker -->
		<div class="stl-field">
			<!-- svelte-ignore a11y_label_has_associated_control -->
			<label class="stl-label">Condition</label>
			<div class="stl-condition-chips">
				{#each CONDITIONS as cond}
					<button
						class="stl-condition-chip"
						class:selected={listingCondition === cond}
						onclick={() => { listingCondition = cond; }}
					>
						{cond}
					</button>
				{/each}
			</div>
		</div>

		<!-- Price -->
		<div class="stl-field">
			<label class="stl-label" for="stl-price">Your Price</label>
			<div class="stl-price-row">
				<span class="stl-dollar">$</span>
				<input
					id="stl-price"
					type="number"
					class="stl-price-input"
					bind:value={listingPrice}
					step="0.01"
					min="0.01"
					inputmode="decimal"
				/>
			</div>
			{#if listingPriceLoading}
				<span class="stl-price-hint">Loading market data...</span>
			{:else if listingPriceData?.price_mid}
				<span class="stl-price-hint">
					Market: ${listingPriceData.price_mid.toFixed(2)} median
					{#if listingPriceData.price_low}· ${listingPriceData.price_low.toFixed(2)} low{/if}
					{#if listingPriceData.listings_count}· {listingPriceData.listings_count} listings{/if}
				</span>
			{:else}
				<span class="stl-price-hint">No market data available</span>
			{/if}
		</div>

		<!-- Actions -->
		{#if listingCreated}
			<div class="stl-success">
				<span class="stl-success-icon">✓</span>
				<span>Draft created — opening scanner...</span>
			</div>
		{:else if !ebayConnected}
			<a href="/settings?ebay=setup" class="stl-btn stl-btn-connect">Connect eBay Account</a>
		{:else}
			<button
				class="stl-btn stl-btn-create"
				onclick={createEbayDraft}
				disabled={listingCreating || !listingPrice}
			>
				{listingCreating ? 'Creating Draft...' : 'Create eBay Draft'}
			</button>
		{/if}

		{#if listingError}
			<p class="stl-error">{listingError}</p>
		{/if}

		<div class="stl-secondary-actions">
			<button class="stl-text-btn" onclick={scanNextCard}>Skip — Scan Next</button>
			<button class="stl-text-btn" onclick={exitScanToList}>Done</button>
		</div>
	</div>

{:else}
	<!-- BROWSE: Original sell page content -->
	<div class="sell-page">
		<header class="page-header">
			<h1>Sell</h1>
			<p class="subtitle">Export and price your collection</p>
		</header>

		<!-- Quick Export strip -->
		<div class="quick-export">
			<h2 class="section-heading">Quick Export</h2>
			<div class="export-strip">
				<button class="export-card scan-list-card" onclick={startScanToList} disabled={!ebayConnected && ebayChecked}>
					<span class="export-card-icon">📷</span>
					<span class="export-card-name">Scan & List</span>
				</button>
				<button class="export-card" onclick={() => quickExport('__builtin_general')}>
					<span class="export-card-icon">📄</span>
					<span class="export-card-name">Export CSV</span>
				</button>
				<button class="export-card" onclick={() => quickExport('__builtin_ebay')}>
					<span class="export-card-icon">🛒</span>
					<span class="export-card-name">eBay CSV</span>
				</button>
			</div>
			<a href="/export" class="custom-export-link">Custom Export Options &rarr;</a>
		</div>

		<!-- eBay Seller Connection -->
		{#if ebayChecked}
			<div class="ebay-connect-section">
				<h2 class="section-heading">eBay Seller</h2>
				{#if ebayConnected}
					<div class="ebay-status ebay-connected">
						<span class="ebay-status-dot"></span>
						<span>eBay account connected</span>
						<a href="/settings" class="ebay-manage-link">Manage</a>
					</div>
				{:else if ebayConfigured}
					<div class="ebay-connect-card">
						<p class="ebay-connect-text">Connect your eBay seller account to list cards directly from scans.</p>
						<a href="/settings?ebay=setup" class="btn-ebay-connect">Connect eBay Account</a>
					</div>
				{:else}
					<div class="ebay-connect-card">
						<p class="ebay-connect-text">eBay listing integration is coming soon. You'll be able to list cards for sale directly from scans.</p>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Scanned Cards -->
		<div class="scanned-cards">
			<h2 class="section-heading">Scanned Cards ({items.length})</h2>
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
						{@const ebayQuery = encodeURIComponent(`BoBA ${card?.hero_name || card?.name || ''} ${card?.card_number || ''}`)}
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
								<span class="card-row-condition">{item.condition || 'NM'}</span>
								<a
									href="https://www.ebay.com/sch/i.html?_nkw={ebayQuery}&_sacat=0"
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
		</div>

		<CardDetail item={selectedItem} ebayConnected={ebayConnected} onClose={() => { selectedItem = null; }} />
	</div>
{/if}

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

	/* Quick Export */
	.quick-export { margin-bottom: 2rem; }

	.export-strip {
		display: flex;
		gap: 0.75rem;
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		padding-bottom: 0.25rem;
	}

	.export-card {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
		padding: 1rem 1.25rem;
		border-radius: 10px;
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		color: var(--text-primary, #e2e8f0);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: border-color 0.15s, transform 0.15s;
		min-width: 110px;
	}

	.export-card:hover {
		border-color: var(--gold, #f59e0b);
		transform: translateY(-1px);
	}

	.export-card-icon { font-size: 1.5rem; }
	.export-card-name { font-size: 0.75rem; color: var(--text-secondary, #94a3b8); }

	.custom-export-link {
		display: inline-block;
		margin-top: 0.75rem;
		font-size: 0.8rem;
		color: var(--text-muted, #475569);
		text-decoration: none;
	}
	.custom-export-link:hover { color: var(--text-secondary, #94a3b8); }

	/* eBay connection */
	.ebay-connect-section { margin-bottom: 2rem; }

	.ebay-status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-radius: 8px;
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
	}

	.ebay-status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--success, #10b981);
		flex-shrink: 0;
	}

	.ebay-manage-link {
		margin-left: auto;
		font-size: 0.8rem;
		color: var(--text-muted, #475569);
		text-decoration: none;
	}
	.ebay-manage-link:hover { color: var(--text-secondary, #94a3b8); }

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

	.card-row-condition {
		font-size: 0.75rem;
		padding: 0.125rem 0.5rem;
		border-radius: 4px;
		background: var(--bg-surface, #0d1524);
		color: var(--text-secondary, #94a3b8);
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

	/* ── Scan-to-List ────────────────────────────── */
	.stl-scanner-view, .stl-listing-view {
		max-width: 600px;
		margin: 0 auto;
		padding: 0;
	}

	.stl-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border, rgba(148,163,184,0.10));
	}

	.stl-back {
		background: none;
		border: none;
		color: var(--text-secondary, #94a3b8);
		font-size: 0.9rem;
		cursor: pointer;
		padding: 0.25rem;
	}

	.stl-title {
		font-size: 1.1rem;
		font-weight: 700;
	}

	.stl-scanner-container {
		height: calc(100dvh - 56px - 68px - 52px);
		position: relative;
	}

	.stl-listing-view {
		padding: 1rem;
	}

	.stl-card-info {
		display: flex;
		gap: 1rem;
		padding: 1rem;
		background: var(--bg-elevated, #121d34);
		border-radius: 12px;
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		margin-bottom: 1.25rem;
	}

	.stl-card-image {
		width: 64px;
		height: 88px;
		object-fit: cover;
		border-radius: 8px;
		flex-shrink: 0;
	}

	.stl-card-placeholder {
		width: 64px;
		height: 88px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2rem;
		background: var(--bg-surface, #0d1524);
		border-radius: 8px;
		flex-shrink: 0;
	}

	.stl-card-details {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.25rem;
		min-width: 0;
	}

	.stl-card-name {
		font-size: 1rem;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.stl-card-meta {
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
	}

	.stl-field {
		margin-bottom: 1.25rem;
	}

	.stl-label {
		display: block;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #475569);
		margin-bottom: 0.5rem;
	}

	.stl-condition-chips {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.stl-condition-chip {
		padding: 0.375rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		background: var(--bg-elevated, #121d34);
		color: var(--text-secondary, #94a3b8);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}

	.stl-condition-chip.selected {
		border-color: var(--accent-primary, #3b82f6);
		background: rgba(59, 130, 246, 0.12);
		color: var(--accent-primary, #3b82f6);
	}

	.stl-price-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.stl-dollar {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text-secondary, #94a3b8);
	}

	.stl-price-input {
		flex: 1;
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		background: var(--bg-elevated, #121d34);
		color: var(--text-primary, #e2e8f0);
		font-size: 1.1rem;
		font-weight: 700;
		-moz-appearance: textfield;
		appearance: textfield;
	}

	.stl-price-input::-webkit-inner-spin-button { appearance: none; -webkit-appearance: none; }

	.stl-price-hint {
		display: block;
		font-size: 0.75rem;
		color: var(--text-muted, #475569);
		margin-top: 0.375rem;
	}

	.stl-btn {
		display: block;
		width: 100%;
		padding: 0.875rem;
		border-radius: 10px;
		border: none;
		font-size: 0.95rem;
		font-weight: 700;
		cursor: pointer;
		text-align: center;
		text-decoration: none;
	}

	.stl-btn-create {
		background: var(--accent-primary, #3b82f6);
		color: white;
	}

	.stl-btn-create:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.stl-btn-connect {
		background: var(--bg-elevated, #121d34);
		color: var(--accent-primary, #3b82f6);
		border: 1px solid var(--accent-primary, #3b82f6);
	}

	.stl-success {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.875rem;
		border-radius: 10px;
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.2);
		color: var(--success, #22c55e);
		font-weight: 600;
	}

	.stl-success-icon { font-size: 1.25rem; }

	.stl-error {
		margin-top: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		background: rgba(239, 68, 68, 0.08);
		color: #ef4444;
		font-size: 0.8rem;
	}

	.stl-secondary-actions {
		display: flex;
		justify-content: center;
		gap: 1.5rem;
		margin-top: 1rem;
	}

	.stl-text-btn {
		background: none;
		border: none;
		color: var(--text-muted, #475569);
		font-size: 0.85rem;
		cursor: pointer;
		padding: 0.5rem;
	}

	.stl-text-btn:hover { color: var(--text-secondary, #94a3b8); }

	.scan-list-card {
		border-color: var(--accent-primary, #3b82f6) !important;
	}

	.scan-list-card:disabled {
		border-color: var(--border, rgba(148,163,184,0.10)) !important;
		opacity: 0.5;
	}
</style>
