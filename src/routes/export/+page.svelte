<script lang="ts">
	import { collectionItems } from '$lib/stores/collection';
	import { getAllTags } from '$lib/stores/tags';
	import {
		EXPORT_FIELDS,
		EBAY_CONDITION_MAP,
		generateCSV,
		downloadFile,
		getUserTemplates,
		saveUserTemplate,
		deleteUserTemplate,
		type ExportTemplate
	} from '$lib/services/export-templates';
	import { showToast } from '$lib/stores/toast';
	import { formatPrice } from '$lib/utils';

	type ExportScope = 'all' | 'current';
	type ExportFilter = 'all' | 'ready' | 'unlisted' | 'listed' | 'sold';

	let selectedFields = $state<Set<string>>(
		new Set(EXPORT_FIELDS.filter((f) => f.default).map((f) => f.key))
	);
	let scope = $state<ExportScope>('all');
	let filter = $state<ExportFilter>('all');
	let templates = $state<ExportTemplate[]>(getUserTemplates());
	let newTemplateName = $state('');
	let activeTab = $state<'csv' | 'deck' | 'ebay'>('csv');

	function toggleField(key: string) {
		const next = new Set(selectedFields);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		selectedFields = next;
	}

	function getFilteredCards(): Record<string, unknown>[] {
		return $collectionItems
			.filter((item) => {
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
					suggestedPrice: '',
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
		const items = $collectionItems;
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

		const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
		downloadFile(csv, 'boba-deck-export.csv');
		showToast('Deck exported', 'check');
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
				`BOBA ${c.hero || ''} ${c.cardNumber || ''} ${c.set || ''}`.trim(),
				condition,
				'0.99',
				'1',
				`BOBA Trading Card - ${c.hero || 'Unknown Hero'}`
			].join(',');
		});

		const csv = [header, cols.join(','), ...rows].join('\n');
		downloadFile(csv, 'boba-ebay-bulk-upload.csv');
		showToast(`eBay export: ${cards.length} cards`, 'check');
	}

	function saveTemplate() {
		if (!newTemplateName.trim()) {
			showToast('Enter a template name', 'x');
			return;
		}
		saveUserTemplate({
			id: crypto.randomUUID(),
			name: newTemplateName.trim(),
			fields: [...selectedFields],
			updatedAt: new Date().toISOString()
		});
		templates = getUserTemplates();
		newTemplateName = '';
		showToast('Template saved', 'check');
	}

	function loadTemplate(template: ExportTemplate) {
		selectedFields = new Set(template.fields);
		showToast(`Loaded: ${template.name}`, 'check');
	}

	function removeTemplate(id: string) {
		deleteUserTemplate(id);
		templates = getUserTemplates();
		showToast('Template deleted', 'check');
	}
</script>

<svelte:head>
	<title>Export - BOBA Scanner</title>
</svelte:head>

<div class="export-page">
	<header class="page-header">
		<h1>Export Collection</h1>
		<p class="subtitle">Download your collection data as CSV</p>
	</header>

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
			<p class="info-text">Generate an eBay Seller Hub bulk upload file for your collection.</p>
			<button class="export-btn" onclick={runEbayExport}>Download eBay CSV</button>
		</div>
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
	}
</style>
