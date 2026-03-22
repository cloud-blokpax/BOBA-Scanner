<script lang="ts">
	import PriceDisplay from './PriceDisplay.svelte';
	import OptimizedCardImage from '$lib/components/OptimizedCardImage.svelte';
	import { updateQuantity, removeFromCollection } from '$lib/stores/collection';
	import { featureEnabled } from '$lib/stores/feature-flags';
	import type { CollectionItem } from '$lib/types';
	import type { ActionReturn } from 'svelte/action';

	const hasPriceHistory = featureEnabled('price_history');

	// Lazy-load the tilt action — it's visual polish, not critical for initial render
	let tiltAction: ((node: HTMLElement, params?: any) => ActionReturn) | null = null;
	import('$lib/actions/tilt').then(m => { tiltAction = m.tilt; });

	function tilt(node: HTMLElement, params?: any): ActionReturn {
		if (tiltAction) return tiltAction(node, params);
		let cleanup: ActionReturn | void;
		import('$lib/actions/tilt').then(m => {
			cleanup = m.tilt(node, params);
		});
		return {
			destroy() {
				if (cleanup && typeof cleanup === 'object' && cleanup.destroy) {
					cleanup.destroy();
				}
			}
		};
	}

	let {
		item,
		onClose
	}: {
		item: CollectionItem | null;
		onClose: () => void;
	} = $props();

	async function handleRemove() {
		if (!item) return;
		if (confirm('Remove this card from your collection?')) {
			await removeFromCollection(item.id);
			onClose();
		}
	}

	let updating = $state(false);

	async function handleQuantityChange(delta: number) {
		if (!item || updating) return;
		const newQty = item.quantity + delta;
		if (newQty < 0) return;
		updating = true;
		try {
			await updateQuantity(item.id, newQty);
		} finally {
			updating = false;
		}
	}
</script>

{#if item}
	<div class="card-detail-overlay" role="dialog" aria-modal="true">
		<div class="card-detail-backdrop" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()} role="button" tabindex="-1" aria-label="Close detail"></div>
		<div class="card-detail-sheet">
			<button class="close-btn" onclick={onClose} aria-label="Close">x</button>

			<div class="detail-content">
				<div class="detail-header">
					{#if item.card?.image_url}
						<div
							class="detail-image-tilt"
							use:tilt={{
								gyro: item.card.rarity !== 'common',
								weaponType: item.card.weapon_type ?? null,
								shimmer: true,
								specular: item.card.rarity !== 'common'
							}}
						>
							<OptimizedCardImage src={item.card.image_url} alt={item.card.name} className="detail-image" size="large" />
						</div>
					{:else}
						<div class="detail-placeholder">🎴</div>
					{/if}
				</div>

				<div class="detail-info">
					<h2>{item.card?.name || 'Unknown Card'}</h2>

					<div class="detail-meta">
						{#if item.card?.card_number}
							<span class="meta-tag">#{item.card.card_number}</span>
						{/if}
						{#if item.card?.set_code}
							<span class="meta-tag">{item.card.set_code}</span>
						{/if}
						{#if item.card?.weapon_type}
							<span class="meta-tag">{item.card.weapon_type}</span>
						{/if}
						{#if item.card?.power}
							<span class="meta-tag power">PWR {item.card.power}</span>
						{/if}
						{#if item.card?.rarity}
							<span class="meta-tag rarity">{item.card.rarity}</span>
						{/if}
					</div>

					<div class="quantity-controls">
						<span class="qty-label">Quantity:</span>
						<button class="qty-btn" onclick={() => handleQuantityChange(-1)} disabled={item.quantity <= 1 || updating}>-</button>
						<span class="qty-value">{item.quantity}</span>
						<button class="qty-btn" onclick={() => handleQuantityChange(1)} disabled={updating}>+</button>
					</div>

					<div class="condition-badge">
						Condition: {item.condition?.replaceAll('_', ' ') || 'Near Mint'}
					</div>

					{#if item.card?.id}
						<div class="price-section">
							<h3>eBay Prices</h3>
							<PriceDisplay cardId={item.card.id} card={item.card} />
						</div>
						{#if $hasPriceHistory}
							{#await import('$lib/components/PriceTrends.svelte') then PriceTrends}
								<PriceTrends.default
									cardNumber={item.card.card_number || ''}
									heroName={item.card.hero_name || ''}
									currentPrice={null}
								/>
							{/await}
						{/if}
					{/if}

					{#if item.notes}
						<div class="notes-section">
							<h3>Notes</h3>
							<p>{item.notes}</p>
						</div>
					{/if}

					<button class="btn-danger" onclick={handleRemove}>
						Remove from Collection
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.card-detail-overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	.card-detail-backdrop {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
	}

	.card-detail-sheet {
		position: relative;
		width: 100%;
		max-width: 500px;
		max-height: 90vh;
		overflow-y: auto;
		background: var(--surface-secondary, #0d1524);
		border-radius: 16px 16px 0 0;
		padding: 1.5rem;
	}

	.close-btn {
		position: absolute;
		top: 1rem;
		right: 1rem;
		background: none;
		border: none;
		color: var(--text-secondary, #94a3b8);
		font-size: 1.25rem;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
	}

	.detail-content {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.detail-header {
		text-align: center;
	}

	.detail-image-tilt {
		display: inline-block;
		border-radius: 8px;
	}

	/* Class passed to child component via className prop */
	:global(.detail-image) {
		max-width: 200px;
		border-radius: 8px;
	}

	.detail-placeholder {
		font-size: 4rem;
	}

	.detail-info h2 {
		font-family: 'Syne', sans-serif;
		font-size: 1.3rem;
		margin-bottom: 0.5rem;
	}

	.detail-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.meta-tag {
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		background: var(--surface-primary, #070b14);
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
	}

	.meta-tag.power {
		color: var(--accent-gold, #f59e0b);
		font-weight: 600;
	}

	.meta-tag.rarity {
		text-transform: capitalize;
	}

	.quantity-controls {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.qty-label {
		font-size: 0.9rem;
		color: var(--text-secondary, #94a3b8);
	}

	.qty-btn {
		width: 32px;
		height: 32px;
		border-radius: 6px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--surface-primary, #070b14);
		color: var(--text-primary, #f1f5f9);
		cursor: pointer;
		font-size: 1rem;
	}

	.qty-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.qty-value {
		font-weight: 600;
		font-size: 1.1rem;
		min-width: 2rem;
		text-align: center;
	}

	.condition-badge {
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
		text-transform: capitalize;
		margin-bottom: 1rem;
	}

	.price-section,
	.notes-section {
		margin-top: 0.5rem;
	}

	.price-section h3,
	.notes-section h3 {
		font-size: 0.9rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
		color: var(--text-secondary, #94a3b8);
	}

	.notes-section p {
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
	}

	.btn-danger {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 8px;
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
		cursor: pointer;
		font-size: 0.9rem;
		margin-top: 1rem;
	}

	@media (min-width: 768px) {
		.card-detail-sheet {
			border-radius: 16px;
			margin-bottom: 2rem;
		}

		.card-detail-overlay {
			align-items: center;
		}
	}
</style>
