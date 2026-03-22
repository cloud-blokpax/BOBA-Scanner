<script lang="ts">
	import type { Card, CollectionItem } from '$lib/types';

	let {
		heroCards,
		collectionItems,
		specPowerCap,
		heroDeckMax,
		onAddHero,
		onRemoveHero,
		onScanCard,
		onUploadImage
	}: {
		heroCards: Card[];
		collectionItems: CollectionItem[];
		specPowerCap: number | null;
		heroDeckMax: number | null;
		onAddHero: (cardId: string) => void;
		onRemoveHero: (cardId: string) => void;
		onScanCard: () => void;
		onUploadImage: () => void;
	} = $props();

	let heroSearch = $state('');

	const heroCardIds = $derived(new Set(heroCards.map(c => c.id)));

	const filteredCollection = $derived.by(() => {
		const query = heroSearch.toLowerCase();
		const results: CollectionItem[] = [];
		for (const item of collectionItems) {
			if (results.length >= 50) break;
			const card = item.card;
			if (!card || !card.power || card.power <= 0) continue;
			if (heroCardIds.has(item.card_id)) continue;
			if (specPowerCap !== null && card.power > specPowerCap) continue;
			if (query) {
				const matchName = card.hero_name?.toLowerCase().includes(query) ||
					card.name.toLowerCase().includes(query) ||
					card.card_number?.toLowerCase().includes(query);
				if (!matchName) continue;
			}
			results.push(item);
		}
		return results;
	});

	const atMax = $derived(heroDeckMax !== null && heroCards.length >= heroDeckMax);

	let collectionSection: HTMLElement | undefined = $state();

	function scrollToCollection() {
		collectionSection?.scrollIntoView({ behavior: 'smooth' });
	}
</script>

<div class="heroes-tab">
	<div class="action-row">
		<button class="action-btn" onclick={onScanCard}>Scan Card</button>
		<button class="action-btn" onclick={onUploadImage}>Upload</button>
		<button class="action-btn" onclick={scrollToCollection}>Collection</button>
	</div>

	<section class="in-deck">
		<h3>In Deck ({heroCards.length})</h3>
		{#if heroCards.length === 0}
			<p class="empty-hint">Add heroes using the buttons above</p>
		{:else}
			<div class="hero-list">
				{#each heroCards as card (card.id)}
					<div class="hero-row">
						<div class="hero-info">
							<span class="hero-name">{card.hero_name || card.name}</span>
							<span class="hero-number">{card.card_number}</span>
						</div>
						<div class="hero-meta">
							<span class="power-badge">{card.power}</span>
							{#if card.weapon_type}
								<span class="weapon-text">{card.weapon_type}</span>
							{/if}
						</div>
						<button class="remove-btn" onclick={() => onRemoveHero(card.id)} aria-label="Remove {card.hero_name || card.name}">x</button>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<hr class="divider" />

	<section class="from-collection" bind:this={collectionSection}>
		<h3>From Collection</h3>
		<input
			class="search-input"
			type="text"
			placeholder="Search by hero, name, or card #..."
			bind:value={heroSearch}
		/>
		{#if filteredCollection.length === 0}
			<p class="empty-hint">No matching cards</p>
		{:else}
			<div class="collection-list">
				{#each filteredCollection as item (item.id)}
					{@const card = item.card!}
					<button class="collection-row" onclick={() => onAddHero(item.card_id)} disabled={atMax}>
						<span class="hero-name">{card.hero_name || card.name}</span>
						<span class="hero-number">{card.card_number}</span>
						<span class="power-badge">{card.power}</span>
					</button>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.heroes-tab { padding: 0.75rem 1rem; }
	.action-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.action-btn {
		flex: 1;
		padding: 0.6rem;
		border: 1px solid var(--border-color, #334155);
		border-radius: 8px;
		background: var(--bg-elevated, #1e293b);
		color: var(--text-primary, #f1f5f9);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.action-btn:hover { background: var(--bg-hover, rgba(255,255,255,0.05)); }
	h3 {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-secondary, #94a3b8);
		margin: 0 0 0.5rem;
	}
	.empty-hint {
		color: var(--text-tertiary, #64748b);
		font-size: 0.85rem;
		padding: 1rem 0;
		text-align: center;
	}
	.hero-list, .collection-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.hero-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		border-radius: 8px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
	}
	.hero-info { flex: 1; min-width: 0; }
	.hero-name {
		color: var(--text-primary, #f1f5f9);
		font-size: 0.85rem;
		font-weight: 500;
	}
	.hero-number {
		color: var(--text-tertiary, #64748b);
		font-size: 0.75rem;
		margin-left: 0.375rem;
		font-family: monospace;
	}
	.hero-meta {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
	}
	.power-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 32px;
		padding: 0.125rem 0.375rem;
		border-radius: 10px;
		background: rgba(59, 130, 246, 0.15);
		color: #60a5fa;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.weapon-text {
		color: var(--text-tertiary, #64748b);
		font-size: 0.7rem;
	}
	.remove-btn {
		width: 28px;
		height: 28px;
		border: none;
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 700;
		flex-shrink: 0;
	}
	.remove-btn:hover { background: rgba(239, 68, 68, 0.2); }
	.divider {
		border: none;
		border-top: 1px solid var(--border-color, #334155);
		margin: 1rem 0;
	}
	.search-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border-color, #334155);
		border-radius: 8px;
		background: var(--bg-base, #0f172a);
		color: var(--text-primary, #f1f5f9);
		font-size: 0.85rem;
		margin-bottom: 0.5rem;
		box-sizing: border-box;
	}
	.search-input::placeholder { color: var(--text-tertiary, #64748b); }
	.collection-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--border-color, #1e293b);
		border-radius: 8px;
		background: var(--bg-elevated, #1e293b);
		color: inherit;
		cursor: pointer;
		text-align: left;
	}
	.collection-row:hover:not(:disabled) { background: var(--bg-hover, rgba(255,255,255,0.05)); }
	.collection-row:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
