<script lang="ts">
	import { onMount } from 'svelte';
	import { collectionItems, collectionLoading, loadCollection } from '$lib/stores/collection.svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import { formatPrice } from '$lib/utils';
	import OptimizedCardImage from '$lib/components/OptimizedCardImage.svelte';
	import { featureEnabled } from '$lib/stores/feature-flags.svelte';
	import {
		BUILT_IN_TEMPLATES,
		getBuiltInTemplate,
		generateCSV,
		downloadFile,
		EXPORT_FIELDS,
		type ExportTemplate
	} from '$lib/services/export-templates';
	import { getAllTags } from '$lib/stores/tags.svelte';

	const hasScanToList = featureEnabled('scan_to_list');

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
			.catch(() => {
				ebayConfigured = false;
				ebayConnected = false;
			})
			.finally(() => { ebayChecked = true; });
	});

	const items = $derived(collectionItems());
	const loading = $derived(collectionLoading());

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

<svelte:head>
	<title>Sell - BOBA Scanner</title>
</svelte:head>

<div class="sell-page">
	<header class="page-header">
		<h1>Sell</h1>
		<p class="subtitle">Export and price your collection</p>
	</header>

	<!-- Quick Export strip -->
	<div class="quick-export">
		<h2 class="section-heading">Quick Export</h2>
		<div class="export-strip">
			<button class="export-card" onclick={() => quickExport('__builtin_general')}>
				<span class="export-card-icon">📄</span>
				<span class="export-card-name">General CSV</span>
			</button>
			<button class="export-card" onclick={() => quickExport('__builtin_ebay')}>
				<span class="export-card-icon">🛒</span>
				<span class="export-card-name">eBay Seller Hub</span>
			</button>
			</div>
		<a href="/export" class="custom-export-link">Custom Export Options &rarr;</a>
	</div>

	<!-- eBay Seller Connection -->
	{#if ebayChecked && ebayConfigured}
		<div class="ebay-connect-section">
			<h2 class="section-heading">eBay Seller</h2>
			{#if ebayConnected}
				<div class="ebay-status ebay-connected">
					<span class="ebay-status-dot"></span>
					<span>eBay account connected</span>
					<a href="/settings" class="ebay-manage-link">Manage</a>
				</div>
			{:else}
				<div class="ebay-connect-card">
					<p class="ebay-connect-text">Connect your eBay seller account to list cards directly from scans.</p>
					<a href="/auth/ebay" class="btn-ebay-connect">Connect eBay Account</a>
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
						<div class="card-row-thumb">
							{#if card?.image_url}
								<OptimizedCardImage src={card.image_url} alt={card?.hero_name || card?.name || 'Card'} className="card-row-img" size="thumb" />
							{:else}
								<span class="card-row-placeholder">🎴</span>
							{/if}
						</div>
						<div class="card-row-info">
							<span class="card-row-name">{card?.hero_name || card?.name || 'Unknown'}</span>
							<span class="card-row-meta">{card?.card_number || ''} {card?.set_code ? `· ${card.set_code}` : ''}</span>
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

	.card-row-thumb :global(.card-row-img) {
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
</style>
