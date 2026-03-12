<script lang="ts">
	import PriceDisplay from '$lib/components/PriceDisplay.svelte';
	import { addToCollection } from '$lib/stores/collection';
	import type { Database } from '$lib/types/database';

	type CardRow = Database['public']['Tables']['cards']['Row'];

	let { data } = $props();
	let card = $derived(data.card as CardRow);

	let adding = $state(false);

	async function handleAdd() {
		adding = true;
		try {
			await addToCollection(card.id);
		} finally {
			adding = false;
		}
	}
</script>

<svelte:head>
	<title>{card.name} | BOBA Scanner</title>
</svelte:head>

<div class="card-page">
	<div class="card-layout">
		<div class="card-visual">
			{#if card.image_url}
				<img src={card.image_url} alt={card.name} class="card-image" />
			{:else}
				<div class="card-placeholder">🎴</div>
			{/if}
		</div>

		<div class="card-details">
			<h1>{card.name}</h1>

			<div class="detail-grid">
				{#if card.card_number}
					<div class="detail-item">
						<span class="detail-label">Card Number</span>
						<span class="detail-value">#{card.card_number}</span>
					</div>
				{/if}
				{#if card.set_code}
					<div class="detail-item">
						<span class="detail-label">Set</span>
						<span class="detail-value">{card.set_code}</span>
					</div>
				{/if}
				{#if card.parallel}
					<div class="detail-item">
						<span class="detail-label">Parallel</span>
						<span class="detail-value">{card.parallel}</span>
					</div>
				{/if}
				{#if card.weapon_type}
					<div class="detail-item">
						<span class="detail-label">Weapon</span>
						<span class="detail-value">{card.weapon_type}</span>
					</div>
				{/if}
				{#if card.power}
					<div class="detail-item">
						<span class="detail-label">Power</span>
						<span class="detail-value power">{card.power}</span>
					</div>
				{/if}
				{#if card.year}
					<div class="detail-item">
						<span class="detail-label">Year</span>
						<span class="detail-value">{card.year}</span>
					</div>
				{/if}
			</div>

			<div class="price-section">
				<h2>Market Prices</h2>
				<PriceDisplay cardId={card.id} />
			</div>

			{#if data.session}
				<button class="btn-primary" onclick={handleAdd} disabled={adding}>
					{adding ? 'Adding...' : 'Add to Collection'}
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.card-page {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

	.card-layout {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 2rem;
		align-items: start;
	}

	.card-image {
		width: 100%;
		border-radius: 12px;
	}

	.card-placeholder {
		width: 100%;
		aspect-ratio: 5 / 7;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--surface-secondary, #0d1524);
		border-radius: 12px;
		font-size: 4rem;
	}

	h1 {
		font-family: 'Syne', sans-serif;
		font-size: 1.75rem;
		font-weight: 800;
		margin-bottom: 1rem;
	}

	.detail-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.detail-item {
		display: flex;
		flex-direction: column;
	}

	.detail-label {
		font-size: 0.75rem;
		color: var(--text-secondary, #94a3b8);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.detail-value {
		font-weight: 600;
		font-size: 0.95rem;
	}

	.detail-value.power {
		color: var(--accent-gold, #f59e0b);
	}

	.price-section {
		margin-bottom: 1.5rem;
	}

	.price-section h2 {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 0.75rem;
		color: var(--text-secondary, #94a3b8);
	}

	.btn-primary {
		width: 100%;
		padding: 0.875rem;
		border-radius: 8px;
		border: none;
		background: var(--accent-primary, #3b82f6);
		color: white;
		font-weight: 600;
		font-size: 1rem;
		cursor: pointer;
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 600px) {
		.card-layout {
			grid-template-columns: 1fr;
		}

		.card-image {
			max-width: 250px;
			margin: 0 auto;
		}
	}
</style>
