<script lang="ts">
	import { onMount } from 'svelte';
	import PriceDisplay from './PriceDisplay.svelte';
	import OptimizedCardImage from '$lib/components/OptimizedCardImage.svelte';
	import { getCardImageUrl } from '$lib/utils/image-url';
	import { updateQuantity, removeFromCollection } from '$lib/stores/collection.svelte';
	import { featureEnabled } from '$lib/stores/feature-flags.svelte';
	import type { CollectionItem } from '$lib/types';
	import type { ActionReturn } from 'svelte/action';

	const hasPriceHistory = featureEnabled('price_history');
	import { isPro, setShowGoProModal } from '$lib/stores/pro.svelte';

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

	onMount(() => {
		// Focus the close button on mount for keyboard accessibility
		const closeBtn = document.querySelector('.card-detail-sheet .close-btn') as HTMLElement;
		closeBtn?.focus();
	});
</script>

{#if item}
	<div class="card-detail-overlay" role="dialog" aria-modal="true" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && onClose()}>
		<button class="card-detail-backdrop" type="button" onclick={onClose} tabindex="-1" aria-label="Close detail"></button>
		<div class="card-detail-sheet">
			<button class="close-btn" onclick={onClose} aria-label="Close">x</button>

			<div class="detail-content">
				<div class="detail-header">
					{#if item.card}
						{@const detailImgUrl = getCardImageUrl(item.card)}
						{#if detailImgUrl}
							<div
								class="detail-image-tilt"
								use:tilt={{
									gyro: item.card.rarity !== 'common',
									weaponType: item.card.weapon_type ?? null,
									shimmer: true,
									specular: item.card.rarity !== 'common'
								}}
							>
								<OptimizedCardImage src={detailImgUrl} alt={item.card.name} className="detail-image" size="large" />
							</div>
						{:else}
							<div class="detail-placeholder">🎴</div>
						{/if}
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
						{#if hasPriceHistory()}
							{#await import('$lib/components/PriceTrends.svelte') then PriceTrends}
								<PriceTrends.default
									cardNumber={item.card.card_number || ''}
									heroName={item.card.hero_name || ''}
									currentPrice={null}
								/>
							{/await}
						{:else if !isPro()}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="pro-preview" onclick={() => setShowGoProModal(true)}>
								<div class="pro-preview-blur">
									<svg viewBox="0 0 200 40" style="width:100%;height:40px">
										<polyline points="0,30 20,25 40,28 60,20 80,22 100,15 120,18 140,12 160,14 180,10 200,8"
											fill="none" stroke="var(--gold)" stroke-width="2" opacity="0.3" />
									</svg>
								</div>
								<span class="pro-preview-label">Price trends — available with Pro</span>
							</div>
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
	.pro-preview {
		cursor: pointer;
		position: relative;
		padding: 0.5rem;
		border-radius: 8px;
		background: var(--bg-base);
		text-align: center;
		margin: 0.5rem 0;
	}
	.pro-preview-blur { filter: blur(2px); opacity: 0.5; }
	.pro-preview-label {
		position: absolute; inset: 0;
		display: flex; align-items: center; justify-content: center;
		font-size: 0.75rem; font-weight: 600; color: var(--gold);
	}
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
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.6);
		border: none;
		appearance: none;
		cursor: default;
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
