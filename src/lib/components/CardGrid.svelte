<script lang="ts">
	import type { CollectionItem } from '$lib/types';

	let {
		items = [],
		onCardClick
	}: {
		items: CollectionItem[];
		onCardClick?: (item: CollectionItem) => void;
	} = $props();

	let searchQuery = $state('');
	let sortBy = $state<'name' | 'added' | 'power'>('added');

	const filteredItems = $derived.by(() => {
		let result = items;

		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			result = result.filter(
				(item) =>
					item.card?.name?.toLowerCase().includes(q) ||
					item.card?.card_number?.toLowerCase().includes(q) ||
					item.card?.set_code?.toLowerCase().includes(q)
			);
		}

		return [...result].sort((a, b) => {
			switch (sortBy) {
				case 'name':
					return (a.card?.name || '').localeCompare(b.card?.name || '');
				case 'power':
					return (b.card?.power || 0) - (a.card?.power || 0);
				case 'added':
				default:
					return new Date(b.added_at).getTime() - new Date(a.added_at).getTime();
			}
		});
	});
</script>

<div class="card-grid-container">
	<div class="grid-controls">
		<input
			type="search"
			placeholder="Search cards..."
			bind:value={searchQuery}
			class="search-input"
		/>
		<select bind:value={sortBy} class="sort-select">
			<option value="added">Recently Added</option>
			<option value="name">Name</option>
			<option value="power">Power</option>
		</select>
	</div>

	<div class="card-grid">
		{#each filteredItems as item (item.id)}
			<button
				class="card-tile"
				onclick={() => onCardClick?.(item)}
			>
				{#if item.card?.image_url}
					<img src={item.card.image_url} alt={item.card.name} class="card-image" loading="lazy" />
				{:else}
					<div class="card-placeholder">
						<span class="card-emoji">🎴</span>
					</div>
				{/if}
				<div class="card-info">
					<span class="card-name">{item.card?.name || 'Unknown'}</span>
					<span class="card-number">{item.card?.card_number || ''}</span>
					{#if item.quantity > 1}
						<span class="card-qty">x{item.quantity}</span>
					{/if}
				</div>
			</button>
		{:else}
			<div class="empty-state">
				{#if searchQuery}
					No cards match "{searchQuery}"
				{:else}
					Your collection is empty. Start scanning!
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.card-grid-container {
		width: 100%;
	}

	.grid-controls {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.search-input {
		flex: 1;
		padding: 0.625rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--surface-secondary, #0d1524);
		color: var(--text-primary, #f1f5f9);
		font-size: 0.9rem;
	}

	.sort-select {
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--surface-secondary, #0d1524);
		color: var(--text-primary, #f1f5f9);
		font-size: 0.9rem;
	}

	.card-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.75rem;
	}

	.card-tile {
		display: flex;
		flex-direction: column;
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--surface-secondary, #0d1524);
		cursor: pointer;
		transition: transform 0.15s, border-color 0.15s;
		padding: 0;
		text-align: left;
		color: inherit;
	}

	.card-tile:hover {
		transform: translateY(-2px);
		border-color: var(--accent-primary, #3b82f6);
	}

	.card-image {
		width: 100%;
		aspect-ratio: 5 / 7;
		object-fit: cover;
	}

	.card-placeholder {
		width: 100%;
		aspect-ratio: 5 / 7;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--surface-primary, #070b14);
	}

	.card-emoji {
		font-size: 2rem;
	}

	.card-info {
		padding: 0.5rem;
	}

	.card-name {
		font-size: 0.8rem;
		font-weight: 600;
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.card-number {
		font-size: 0.7rem;
		color: var(--text-secondary, #94a3b8);
	}

	.card-qty {
		font-size: 0.7rem;
		color: var(--accent-gold, #f59e0b);
		font-weight: 600;
	}

	.empty-state {
		grid-column: 1 / -1;
		text-align: center;
		padding: 3rem;
		color: var(--text-secondary, #94a3b8);
	}

	@media (max-width: 480px) {
		.card-grid {
			grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		}
	}
</style>
