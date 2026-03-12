<script lang="ts">
	import { onMount } from 'svelte';
	import { collectionItems, loadCollection } from '$lib/stores/collection';
	import type { CollectionItem } from '$lib/types';

	let deckCards = $state<CollectionItem[]>([]);
	let deckName = $state('My Deck');

	const MAX_DECK_SIZE = 30;

	const totalPower = $derived(
		deckCards.reduce((sum, item) => sum + (item.card?.power || 0), 0)
	);

	const weaponCounts = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const item of deckCards) {
			const weapon = item.card?.weapon_type || 'None';
			counts[weapon] = (counts[weapon] || 0) + 1;
		}
		return counts;
	});

	onMount(() => {
		loadCollection();
	});

	function addToDeck(item: CollectionItem) {
		if (deckCards.length >= MAX_DECK_SIZE) return;
		if (deckCards.some((d) => d.id === item.id)) return;
		deckCards = [...deckCards, item];
	}

	function removeFromDeck(itemId: string) {
		deckCards = deckCards.filter((d) => d.id !== itemId);
	}
</script>

<svelte:head>
	<title>Deck Builder | BOBA Scanner</title>
</svelte:head>

<div class="deck-page">
	<div class="deck-header">
		<input
			type="text"
			bind:value={deckName}
			class="deck-name-input"
			placeholder="Deck name..."
		/>
		<span class="deck-count">{deckCards.length}/{MAX_DECK_SIZE}</span>
	</div>

	<div class="deck-layout">
		<!-- Current deck -->
		<div class="deck-panel">
			<h2>Deck ({deckCards.length})</h2>

			<div class="deck-stats">
				<span>Total Power: {totalPower}</span>
				{#each Object.entries(weaponCounts) as [weapon, count]}
					<span class="weapon-stat">{weapon}: {count}</span>
				{/each}
			</div>

			<div class="deck-list">
				{#each deckCards as item (item.id)}
					<div class="deck-card">
						<span class="deck-card-name">{item.card?.name}</span>
						{#if item.card?.power}
							<span class="deck-card-power">PWR {item.card.power}</span>
						{/if}
						<button class="remove-btn" onclick={() => removeFromDeck(item.id)}>x</button>
					</div>
				{:else}
					<p class="empty-deck">Add cards from your collection</p>
				{/each}
			</div>
		</div>

		<!-- Available cards from collection -->
		<div class="collection-panel">
			<h2>Collection</h2>
			<div class="available-list">
				{#each $collectionItems as item (item.id)}
					{@const inDeck = deckCards.some((d) => d.id === item.id)}
					<button
						class="available-card"
						class:in-deck={inDeck}
						onclick={() => addToDeck(item)}
						disabled={inDeck || deckCards.length >= MAX_DECK_SIZE}
					>
						<span>{item.card?.name}</span>
						{#if item.card?.power}
							<span class="avail-power">{item.card.power}</span>
						{/if}
					</button>
				{:else}
					<p class="empty-collection">No cards in collection</p>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.deck-page {
		max-width: 1000px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	.deck-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.deck-name-input {
		font-family: 'Syne', sans-serif;
		font-size: 1.25rem;
		font-weight: 700;
		background: transparent;
		border: none;
		color: var(--text-primary, #f1f5f9);
		padding: 0.25rem 0;
		border-bottom: 2px solid transparent;
	}

	.deck-name-input:focus {
		outline: none;
		border-bottom-color: var(--accent-primary, #3b82f6);
	}

	.deck-count {
		font-size: 0.9rem;
		color: var(--text-secondary, #94a3b8);
	}

	.deck-layout {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
	}

	.deck-panel h2,
	.collection-panel h2 {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 0.75rem;
		color: var(--text-secondary, #94a3b8);
	}

	.deck-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1rem;
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
	}

	.weapon-stat {
		padding: 0.125rem 0.5rem;
		border-radius: 4px;
		background: var(--surface-secondary, #0d1524);
	}

	.deck-list,
	.available-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.deck-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		background: var(--surface-secondary, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
	}

	.deck-card-name {
		flex: 1;
		font-size: 0.9rem;
	}

	.deck-card-power {
		font-size: 0.8rem;
		color: var(--accent-gold, #f59e0b);
		font-weight: 600;
	}

	.remove-btn {
		background: none;
		border: none;
		color: var(--text-secondary, #94a3b8);
		cursor: pointer;
		padding: 0.25rem 0.5rem;
	}

	.available-card {
		display: flex;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--surface-secondary, #0d1524);
		color: var(--text-primary, #f1f5f9);
		cursor: pointer;
		font-size: 0.9rem;
		text-align: left;
	}

	.available-card:hover:not(:disabled) {
		border-color: var(--accent-primary, #3b82f6);
	}

	.available-card.in-deck {
		opacity: 0.4;
	}

	.available-card:disabled {
		cursor: not-allowed;
	}

	.avail-power {
		font-size: 0.8rem;
		color: var(--accent-gold, #f59e0b);
	}

	.empty-deck,
	.empty-collection {
		text-align: center;
		color: var(--text-secondary, #94a3b8);
		padding: 2rem;
		font-size: 0.9rem;
	}

	@media (max-width: 600px) {
		.deck-layout {
			grid-template-columns: 1fr;
		}
	}
</style>
