<script lang="ts">
	import { onMount } from 'svelte';
	import { collectionItems } from '$lib/stores/collection.svelte';
	import { getAllTags } from '$lib/stores/tags.svelte';
	import type { CollectionItem } from '$lib/types';
	import {
		EXPORT_FIELDS,
		EBAY_CONDITION_MAP,
		generateCSV,
		downloadFile,
		getUserTemplates,
		saveUserTemplate,
		deleteUserTemplate,
		generateEbayCSV,
		generateEbayTitle,
		getConditionMultiplier,
		type ExportTemplate,
		type ExportCard
	} from '$lib/services/export-templates';
	import AffiliateNotice from '$lib/components/AffiliateNotice.svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import { formatPrice } from '$lib/utils';

	type ExportScope = 'all' | 'current';
	type ExportFilter = 'all' | 'ready' | 'unlisted' | 'listed' | 'sold';

	let selectedFields = $state<Set<string>>(
		new Set(EXPORT_FIELDS.filter((f) => f.default).map((f) => f.key))
	);
	let scope = $state<ExportScope>('all');
	let filter = $state<ExportFilter>('all');
	let templates = $state<ExportTemplate[]>([]);
	let newTemplateName = $state('');
	let activeTab = $state<'csv' | 'deck' | 'ebay'>('csv');

	onMount(async () => {
		templates = await getUserTemplates();
	});

	// eBay batch export state
	interface EbayQueueItem {
		id: string;
		heroName: string;
		athleteName: string;
		cardNumber: string;
		setCode: string;
		weaponType: string;
		parallel: string;
		condition: string;
		price: number;
	}

	let ebayQueue = $state<EbayQueueItem[]>([]);
	let ebayBulkCondition = $state('NM');

	function populateEbayQueue() {
		ebayQueue = collectionItems().map(item => ({
			id: item.id,
			heroName: item.card?.hero_name || item.card?.name || '',
			athleteName: item.card?.athlete_name || '',
			cardNumber: item.card?.card_number || '',
			setCode: item.card?.set_code || '',
			weaponType: item.card?.weapon_type || '',
			parallel: item.card?.parallel || '',
			condition: 'NM',
			price: 0.99
		}));
	}

	function setBulkCondition(condition: string) {
		ebayBulkCondition = condition;
		ebayQueue = ebayQueue.map(item => ({
			...item,
			condition,
			price: parseFloat((item.price * getConditionMultiplier(condition)).toFixed(2))
		}));
	}

	function removeFromEbayQueue(id: string) {
		ebayQueue = ebayQueue.filter(q => q.id !== id);
	}

	function runEnhancedEbayExport() {
		if (ebayQueue.length === 0) {
			showToast('No cards in export queue', 'x');
			return;
		}
		const cards: ExportCard[] = ebayQueue.map(item => ({
			heroName: item.heroName,
			athleteName: item.athleteName,
			cardNumber: item.cardNumber,
			setCode: item.setCode,
			weaponType: item.weaponType,
			parallel: item.parallel,
			conditionId: EBAY_CONDITION_MAP[item.condition === 'NM' ? 'Near Mint' : item.condition] || '3000',
			price: item.price
		}));
		const csv = generateEbayCSV(cards);
		downloadFile(csv, `boba-ebay-${new Date().toISOString().split('T')[0]}.csv`);
		showToast(`Exported ${cards.length} cards for eBay`, 'check');
	}

	function toggleField(key: string) {
		const next = new Set(selectedFields);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		selectedFields = next;
	}

	function getFilteredCards(): Record<string, unknown>[] {
		return collectionItems()
			.filter((item: CollectionItem) => {
				if (filter === 'all') return true;
				const card = item.card;
				if (!card) return false;
				// Simple filter based on available data
				return true;
			})
			.map((item) => {
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
					listingPrice: '',
					ebaySearchUrl: ''
				};
			});
	}

	function runExport() {
		const cards = getFilteredCards();
		if (cards.length === 0) {
			showToast('No cards to export', 'x');
			return;
		}
		const fields = [...selectedFields];
		const csv = generateCSV(cards, fields);
		const date = new Date().toISOString().split('T')[0];
		downloadFile(csv, `boba-collection-${date}.csv`);
		showToast(`Exported ${cards.length} cards`, 'check');
	}

	function runDeckExport() {
		const items = collectionItems();
		const headers = ['Slot', 'Card #', 'Name', 'Cost', 'Ability', 'DBS'];
		const rows: string[][] = [];
		let slot = 1;

		for (const item of items) {
			const card = item.card;
			if (!card) continue;
			const label = slot <= 30 ? String(slot) : `B${slot - 30}`;
			rows.push([label, card.card_number || '', card.hero_name || card.name, String(card.power ?? ''), '', '']);
			slot++;
			if (slot > 45) break;
		}

		const csv = [headers.join(','), ...rows.map((r) => r.map(escapeCsvField).join(','))].join('\n');
		downloadFile(csv, 'boba-deck-export.csv');
		showToast('Deck exported', 'check');
	}

	/** Escape a CSV field: wrap in quotes if it contains commas, quotes, or newlines. */
	function escapeCsvField(value: string): string {
		if (value.includes(',') || value.includes('"') || value.includes('\n')) {
			return '"' + value.replace(/"/g, '""') + '"';
		}
		return value;
	}

	function runEbayExport() {
		const cards = getFilteredCards();
		if (cards.length === 0) {
			showToast('No cards to export', 'x');
			return;
		}

		const header = 'Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)';
		const cols = ['*Action', '*Category', '*Title', '*ConditionID', '*Price', '*Quantity', 'Description'];
		const rows = cards.map((c) => {
			const condition = EBAY_CONDITION_MAP[String(c.condition)] || '3000';
			return [
				'Add',
				'183050',
				escapeCsvField(`BOBA ${c.hero || ''} ${c.cardNumber || ''} ${c.set || ''}`.trim()),
				condition,
				'0.99',
				'1',
				escapeCsvField(`BOBA Trading Card - ${c.hero || 'Unknown Hero'}`)
			].join(',');
		});

		const csv = [header, cols.join(','), ...rows].join('\n');
		downloadFile(csv, 'boba-ebay-bulk-upload.csv');
		showToast(`eBay export: ${cards.length} cards`, 'check');
	}

	async function saveTemplate() {
		if (!newTemplateName.trim()) {
			showToast('Enter a template name', 'x');
			return;
		}
		await saveUserTemplate({
			id: crypto.randomUUID(),
			name: newTemplateName.trim(),
			fields: [...selectedFields],
			updatedAt: new Date().toISOString()
		});
		templates = await getUserTemplates();
		newTemplateName = '';
		showToast('Template saved', 'check');
	}

	function loadTemplate(template: ExportTemplate) {
		selectedFields = new Set(template.fields);
		showToast(`Loaded: ${template.name}`, 'check');
	}

	async function removeTemplate(id: string) {
		await deleteUserTemplate(id);
		templates = await getUserTemplates();
		showToast('Template deleted', 'check');
	}
</script>

<svelte:head>
	<title>Export - Card Scanner</title>
</svelte:head>

<div class="export-page">
	<header class="page-header">
		<h1>Export Collection</h1>
		<p class="subtitle">Download your collection data as CSV</p>
	</header>

	{#if collectionItems().length === 0}
		<div class="empty-export">
			<h2>Nothing to Export</h2>
			<p>Add cards to your collection first, then come back to export them.</p>
			<a href="/scan" class="export-btn" style="display:inline-block;width:auto;padding:0.75rem 2rem;text-decoration:none;">Scan a Card</a>
		</div>
	{:else}
	<div class="tabs">
		<button class:active={activeTab === 'csv'} onclick={() => (activeTab = 'csv')}>CSV Export</button>
		<button class:active={activeTab === 'deck'} onclick={() => (activeTab = 'deck')}>Deck Export</button>
		<button class:active={activeTab === 'ebay'} onclick={() => (activeTab = 'ebay')}>eBay Bulk</button>
	</div>

	{#if activeTab === 'csv'}
		<div class="section">
			<h2>Fields</h2>
			<div class="fields-grid">
				{#each EXPORT_FIELDS as field}
					<label class="field-toggle">
						<input
							type="checkbox"
							checked={selectedFields.has(field.key)}
							onchange={() => toggleField(field.key)}
						/>
						<span>{field.label}</span>
					</label>
				{/each}
			</div>
		</div>

		{#if templates.length > 0}
			<div class="section">
				<h2>Templates</h2>
				<div class="templates-row">
					{#each templates as tpl}
						<div class="template-pill">
							<button class="template-btn" onclick={() => loadTemplate(tpl)}>{tpl.name}</button>
							{#if tpl.isUser}
								<button class="template-delete" onclick={() => removeTemplate(tpl.id)}>x</button>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<div class="section save-template">
			<input type="text" bind:value={newTemplateName} placeholder="Template name..." />
			<button class="btn-small" onclick={saveTemplate}>Save Template</button>
		</div>

		<button class="export-btn" onclick={runExport}>Download CSV</button>
	{:else if activeTab === 'deck'}
		<div class="section">
			<p class="info-text">Export your deck in BOBA tournament format (slots 1-30 + B1-B15).</p>
			<button class="export-btn" onclick={runDeckExport}>Download Deck CSV</button>
		</div>
	{:else if activeTab === 'ebay'}
		<div class="section">
			<AffiliateNotice />
			<p class="info-text">Generate an eBay Seller Hub-compatible CSV with optimized titles and pricing.</p>

			{#if ebayQueue.length === 0}
				<button class="export-btn" onclick={populateEbayQueue}>Load Collection into Queue</button>
			{:else}
				<!-- Bulk actions -->
				<div class="ebay-bulk-actions">
					<span class="bulk-label">{ebayQueue.length} cards</span>
					<select bind:value={ebayBulkCondition} onchange={() => setBulkCondition(ebayBulkCondition)} class="condition-select">
						<option value="NM">All NM</option>
						<option value="LP">All LP</option>
						<option value="MP">All MP</option>
						<option value="HP">All HP</option>
						<option value="D">All Damaged</option>
					</select>
				</div>

				<!-- Queue list -->
				<div class="ebay-queue">
					{#each ebayQueue as item, i (item.id)}
						<div class="ebay-item">
							<div class="ebay-item-info">
								<span class="ebay-item-name">{item.heroName}</span>
								<span class="ebay-item-number">{item.cardNumber}</span>
							</div>
							<select bind:value={ebayQueue[i].condition} class="condition-select-sm">
								<option value="NM">NM</option>
								<option value="LP">LP</option>
								<option value="MP">MP</option>
								<option value="HP">HP</option>
								<option value="D">D</option>
							</select>
							<div class="ebay-price-input">
								<span class="price-symbol">$</span>
								<input type="number" bind:value={ebayQueue[i].price} step="0.01" min="0" class="price-field" />
							</div>
							<button class="remove-btn-sm" onclick={() => removeFromEbayQueue(item.id)}>x</button>
						</div>
					{/each}
				</div>

				<button class="export-btn" onclick={runEnhancedEbayExport}>Download eBay CSV ({ebayQueue.length} cards)</button>
			{/if}
		</div>
	{/if}
	{/if}
</div>

<style>
	.export-page {
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
	.tabs {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 1.25rem;
		border-bottom: 1px solid var(--border-color);
	}
	.tabs button {
		background: none;
		border: none;
		padding: 0.625rem 1rem;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 0.9rem;
		border-bottom: 2px solid transparent;
	}
	.tabs button.active {
		color: var(--accent-primary);
		border-bottom-color: var(--accent-primary);
		font-weight: 600;
	}
	.section {
		margin-bottom: 1.25rem;
	}
	h2 {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}
	.fields-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.375rem;
	}
	.field-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		cursor: pointer;
		padding: 0.375rem;
		border-radius: 6px;
	}
	.field-toggle:hover { background: var(--bg-hover); }
	.templates-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	.template-pill {
		display: inline-flex;
		align-items: center;
		border-radius: 20px;
		background: var(--bg-elevated);
		overflow: hidden;
	}
	.template-btn {
		background: none;
		border: none;
		color: var(--text-primary);
		padding: 0.375rem 0.75rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.template-btn:hover { background: var(--bg-hover); }
	.template-delete {
		background: none;
		border: none;
		color: var(--text-tertiary);
		padding: 0.375rem 0.5rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.save-template {
		display: flex;
		gap: 0.5rem;
	}
	.save-template input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.85rem;
	}
	.btn-small {
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-primary);
		font-size: 0.85rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-small:hover { background: var(--bg-hover); }
	.info-text {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 1rem;
	}
	.export-btn {
		width: 100%;
		padding: 0.875rem;
		border-radius: 12px;
		border: none;
		background: var(--accent-primary);
		color: #fff;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		margin-top: 0.75rem;
	}

	/* eBay queue styles */
	.ebay-bulk-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.bulk-label {
		font-size: 0.85rem;
		color: var(--text-secondary);
		font-weight: 600;
	}

	.condition-select, .condition-select-sm {
		padding: 0.375rem 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.8rem;
	}

	.condition-select-sm { padding: 0.25rem 0.375rem; font-size: 0.75rem; }

	.ebay-queue {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		max-height: 400px;
		overflow-y: auto;
		margin-bottom: 0.75rem;
	}

	.ebay-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		border-radius: 6px;
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
	}

	.ebay-item-info { flex: 1; min-width: 0; }
	.ebay-item-name { font-size: 0.85rem; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.ebay-item-number { font-size: 0.7rem; color: var(--text-tertiary); }

	.ebay-price-input {
		display: flex;
		align-items: center;
		gap: 0.125rem;
	}

	.price-symbol { font-size: 0.8rem; color: var(--text-secondary); }

	.price-field {
		width: 60px;
		padding: 0.25rem 0.375rem;
		border-radius: 4px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.8rem;
		text-align: right;
	}

	.remove-btn-sm {
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 0.25rem;
		font-size: 0.8rem;
	}

	.remove-btn-sm:hover { color: var(--danger, #ef4444); }

	.empty-export {
		text-align: center;
		padding: 3rem 1rem;
	}
	.empty-export h2 {
		font-size: 1.2rem;
		font-weight: 700;
		margin-bottom: 0.5rem;
		color: var(--text-primary);
	}
	.empty-export p {
		color: var(--text-secondary);
		font-size: 0.9rem;
		margin-bottom: 1.5rem;
	}
</style>
