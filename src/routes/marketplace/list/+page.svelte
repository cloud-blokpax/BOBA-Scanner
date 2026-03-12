<script lang="ts">
	import type { Card } from '$lib/types';
	import { collectionItems } from '$lib/stores/collection';
	import { generateEbayListing, openEbaySearch } from '$lib/services/ebay';
	import { showToast } from '$lib/stores/toast';

	interface Listing {
		title: string;
		description: string;
		suggested_price: number;
		price_note: string;
		condition_code: string;
		keywords: string[];
	}

	let selectedCard = $state<Card | null>(null);
	let listing = $state<Listing | null>(null);
	let generating = $state(false);
	let searchQuery = $state('');

	let filteredCards = $derived.by(() => {
		const items = $collectionItems;
		if (!searchQuery.trim()) return items.map((i) => i.card).filter(Boolean) as Card[];
		const q = searchQuery.toLowerCase();
		return items
			.map((i) => i.card)
			.filter((c): c is Card =>
				!!c && (
					c.hero_name?.toLowerCase().includes(q) ||
					c.card_number?.toLowerCase().includes(q) ||
					c.name?.toLowerCase().includes(q) ||
					false
				)
			);
	});

	function selectCard(card: Card) {
		selectedCard = card;
		listing = null;
	}

	async function generate() {
		if (!selectedCard) return;
		generating = true;
		try {
			listing = await generateEbayListing(selectedCard);
			showToast('Listing generated', 'check');
		} catch (err) {
			showToast('Failed to generate listing', 'x');
		}
		generating = false;
	}

	async function copyToClipboard(text: string, label: string) {
		try {
			await navigator.clipboard.writeText(text);
			showToast(`${label} copied`, 'check');
		} catch {
			showToast('Copy failed', 'x');
		}
	}
</script>

<svelte:head>
	<title>eBay Lister - BOBA Scanner</title>
</svelte:head>

<div class="lister-page">
	<header class="page-header">
		<h1>eBay Lister</h1>
		<p class="subtitle">Generate AI-powered eBay listings for your cards</p>
	</header>

	{#if !selectedCard}
		<div class="card-picker">
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search your collection..."
				class="search-input"
			/>
			<div class="card-list">
				{#each filteredCards as card}
					<button class="card-option" onclick={() => selectCard(card)}>
						<div class="card-name">{card.hero_name || card.name}</div>
						<div class="card-meta">
							{card.card_number || ''} {card.set_code ? `· ${card.set_code}` : ''}
						</div>
					</button>
				{/each}
				{#if filteredCards.length === 0}
					<p class="empty">No cards found. Add cards to your collection first.</p>
				{/if}
			</div>
		</div>
	{:else}
		<div class="selected-card">
			<div class="selected-info">
				<strong>{selectedCard.hero_name || selectedCard.name}</strong>
				<span>{selectedCard.card_number || ''} · {selectedCard.set_code || ''}</span>
			</div>
			<button class="change-btn" onclick={() => { selectedCard = null; listing = null; }}>
				Change
			</button>
		</div>

		{#if !listing}
			<button class="generate-btn" onclick={generate} disabled={generating}>
				{generating ? 'Generating...' : 'Generate eBay Listing'}
			</button>
		{/if}

		{#if listing}
			<div class="listing-result">
				<div class="field-group">
					<label>Title</label>
					<div class="field-value copyable" onclick={() => copyToClipboard(listing!.title, 'Title')}>
						{listing.title}
					</div>
				</div>

				<div class="field-group">
					<label>Description</label>
					<div class="field-value copyable description" onclick={() => copyToClipboard(listing!.description, 'Description')}>
						{listing.description}
					</div>
				</div>

				<div class="field-row">
					<div class="field-group">
						<label>Suggested Price</label>
						<div class="field-value">${listing.suggested_price.toFixed(2)}</div>
					</div>
					<div class="field-group">
						<label>Condition</label>
						<div class="field-value">{listing.condition_code}</div>
					</div>
				</div>

				{#if listing.price_note}
					<p class="price-note">{listing.price_note}</p>
				{/if}

				<div class="field-group">
					<label>Keywords</label>
					<div class="keywords">
						{#each listing.keywords as kw}
							<span class="keyword">{kw}</span>
						{/each}
					</div>
				</div>

				<div class="actions">
					<button class="btn-secondary" onclick={() => openEbaySearch(selectedCard!)}>
						View on eBay
					</button>
					<button class="btn-primary" onclick={generate} disabled={generating}>
						Regenerate
					</button>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.lister-page {
		max-width: 500px;
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
	.search-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.9rem;
		margin-bottom: 0.75rem;
	}
	.card-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 400px;
		overflow-y: auto;
	}
	.card-option {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-primary);
		cursor: pointer;
	}
	.card-option:hover { background: var(--bg-hover); }
	.card-name { font-weight: 600; font-size: 0.9rem; }
	.card-meta { font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px; }
	.empty {
		text-align: center;
		color: var(--text-tertiary);
		padding: 2rem;
		font-size: 0.85rem;
	}
	.selected-card {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem;
		background: var(--bg-elevated);
		border-radius: 10px;
		margin-bottom: 1rem;
	}
	.selected-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.selected-info span {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.change-btn {
		background: none;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 0.375rem 0.75rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.generate-btn {
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
	.generate-btn:disabled { opacity: 0.6; cursor: not-allowed; }
	.listing-result {
		margin-top: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.field-group label {
		display: block;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 4px;
	}
	.field-value {
		padding: 0.625rem 0.75rem;
		background: var(--bg-elevated);
		border-radius: 8px;
		font-size: 0.9rem;
	}
	.copyable {
		cursor: pointer;
		transition: background 0.15s;
	}
	.copyable:hover { background: var(--bg-hover); }
	.description { white-space: pre-wrap; }
	.field-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	.price-note {
		font-size: 0.8rem;
		color: var(--text-secondary);
		font-style: italic;
	}
	.keywords {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	.keyword {
		padding: 2px 8px;
		border-radius: 4px;
		background: var(--bg-elevated);
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}
	.btn-secondary, .btn-primary {
		flex: 1;
		padding: 0.625rem;
		border-radius: 10px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
	.btn-secondary {
		background: transparent;
		border: 1px solid var(--border-color);
		color: var(--text-primary);
	}
	.btn-primary {
		background: var(--accent-primary);
		border: none;
		color: #fff;
	}
	.btn-primary:disabled { opacity: 0.6; }
</style>
