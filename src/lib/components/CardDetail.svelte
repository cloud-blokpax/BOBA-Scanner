<script lang="ts">
	import { onMount } from 'svelte';
	import PriceDisplay from './PriceDisplay.svelte';
	import OptimizedCardImage from '$lib/components/OptimizedCardImage.svelte';
	import { getCardImageUrl } from '$lib/utils/image-url';
	import { updateQuantity, removeFromCollection, uploadScanImage } from '$lib/stores/collection.svelte';
	import { featureEnabled } from '$lib/stores/feature-flags.svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import { isPro, setShowGoProModal } from '$lib/stores/pro.svelte';
	import type { CollectionItem } from '$lib/types';
	import type { ActionReturn } from 'svelte/action';

	const hasPriceHistory = featureEnabled('price_history');

	let tiltAction: ((node: HTMLElement, params?: Record<string, unknown>) => ActionReturn) | null = null;
	import('$lib/actions/tilt').then(m => { tiltAction = m.tilt; });

	function tilt(node: HTMLElement, params?: Record<string, unknown>): ActionReturn {
		if (tiltAction) return tiltAction(node, params);
		let cleanup: ActionReturn | void;
		import('$lib/actions/tilt').then(m => { cleanup = m.tilt(node, params); });
		return {
			destroy() {
				if (cleanup && typeof cleanup === 'object' && cleanup.destroy) cleanup.destroy();
			}
		};
	}

	let {
		item,
		ebayConnected = false,
		onClose
	}: {
		item: CollectionItem | null;
		ebayConnected?: boolean;
		onClose: () => void;
	} = $props();

	// ── Quantity ────────────────────────────────────
	let updating = $state(false);

	async function handleQuantityChange(delta: number) {
		if (!item || updating) return;
		const newQty = item.quantity + delta;
		if (newQty < 0) return;
		updating = true;
		try { await updateQuantity(item.id, newQty); } finally { updating = false; }
	}

	async function handleRemove() {
		if (!item) return;
		if (confirm('Remove this card from your collection?')) {
			await removeFromCollection(item.id);
			onClose();
		}
	}

	// ── Retake Photo ───────────────────────────────
	let retakeInput = $state<HTMLInputElement>(undefined!);
	let retakeUploading = $state(false);

	function triggerRetake() {
		retakeInput?.click();
	}

	async function handleRetakeFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !item) return;

		retakeUploading = true;
		try {
			const blob = await resizeImageFile(file, 600, 840, 0.8);
			if (!blob) { showToast('Failed to process image', 'x'); return; }
			const url = await uploadScanImage(item.id, item.card_id, blob);
			if (url) {
				showToast('Photo updated', 'check');
			} else {
				showToast('Upload failed', 'x');
			}
		} catch (err) {
			console.error('[card-detail] Retake error:', err);
			showToast('Upload failed', 'x');
		} finally {
			retakeUploading = false;
		}
	}

	function resizeImageFile(file: File, maxW: number, maxH: number, quality: number): Promise<Blob | null> {
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				const scale = Math.min(maxW / img.width, maxH / img.height, 1);
				const w = Math.round(img.width * scale);
				const h = Math.round(img.height * scale);
				const canvas = document.createElement('canvas');
				canvas.width = w;
				canvas.height = h;
				const ctx = canvas.getContext('2d');
				if (!ctx) { resolve(null); return; }
				ctx.drawImage(img, 0, 0, w, h);
				canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
			};
			img.onerror = () => resolve(null);
			img.src = URL.createObjectURL(file);
		});
	}

	// ── eBay Draft Listing ──────────────────────────
	let showListingModal = $state(false);
	let listingPrice = $state('');
	let listingQuantity = $state(1);
	let listingLoading = $state(false);

	async function createDraftListing() {
		if (!item?.card) return;
		const price = parseFloat(listingPrice);
		if (isNaN(price) || price <= 0) { showToast('Enter a valid price', 'x'); return; }

		listingLoading = true;
		try {
			const card = item.card;
			const res = await fetch('/api/ebay/create-draft', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cardId: card.id,
					heroName: card.hero_name || card.name || '',
					cardNumber: card.card_number || '',
					setCode: card.set_code || '',
					parallel: card.parallel || null,
					weaponType: card.weapon_type || null,
					power: card.power ?? null,
					athleteName: card.athlete_name || null,
					condition: item.condition || 'near_mint',
					price,
					quantity: listingQuantity,
					notes: item.notes || null,
					scanImageUrl: item.scan_image_url || null
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Failed to create listing' }));
				showToast(err.message || 'Failed', 'x');
				return;
			}
			showToast('Draft created in eBay Seller Hub!', 'check');
			showListingModal = false;
		} catch {
			showToast('Failed to create listing', 'x');
		} finally {
			listingLoading = false;
		}
	}

	// ── Manual Correction ──────────────────────────
	let showCorrection = $state(false);

	onMount(() => {
		const closeBtn = document.querySelector('.card-detail-sheet .close-btn') as HTMLElement;
		closeBtn?.focus();
	});
</script>

{#if item}
	{@const card = item.card}
	{@const detailImgUrl = card ? getCardImageUrl(card) : null}

	<!-- Hidden file input for retake photo -->
	<input
		type="file"
		accept="image/*"
		capture="environment"
		bind:this={retakeInput}
		onchange={handleRetakeFile}
		style="display: none;"
	/>

	<div class="card-detail-overlay" role="dialog" aria-modal="true" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && onClose()}>
		<button class="card-detail-backdrop" type="button" onclick={onClose} tabindex="-1" aria-label="Close"></button>
		<div class="card-detail-sheet">
			<button class="close-btn" onclick={onClose} aria-label="Close">&#x2715;</button>

			<div class="detail-scroll">
			<div class="detail-content">

				<!-- Card Image -->
				<div class="detail-header">
					{#if item.scan_image_url}
						<div class="detail-image-tilt" use:tilt={{ gyro: card?.rarity !== 'common', weaponType: card?.weapon_type ?? null, shimmer: true, specular: card?.rarity !== 'common' }}>
							<img src={item.scan_image_url} alt={card?.hero_name || 'Card'} class="detail-image card-cropped" />
						</div>
					{:else if detailImgUrl}
						<div class="detail-image-tilt" use:tilt={{ gyro: card?.rarity !== 'common', weaponType: card?.weapon_type ?? null, shimmer: true, specular: card?.rarity !== 'common' }}>
							<OptimizedCardImage src={detailImgUrl} alt={card?.name || 'Card'} className="detail-image" size="large" />
						</div>
					{:else}
						<div class="detail-placeholder">🎴</div>
					{/if}

					<!-- Retake/Take Photo button under image -->
					<button class="retake-btn" onclick={triggerRetake} disabled={retakeUploading}>
						{#if retakeUploading}
							Uploading...
						{:else if item.scan_image_url}
							📷 Retake Photo
						{:else}
							📷 Take Photo
						{/if}
					</button>
				</div>

				<!-- Card Info -->
				<div class="detail-info">
					<h2>{card?.hero_name || card?.name || 'Unknown Card'}</h2>
					{#if card?.athlete_name}
						<p class="athlete-name">Inspired by {card.athlete_name}</p>
					{/if}

					<div class="detail-meta">
						{#if card?.card_number}
							<span class="meta-tag">#{card.card_number}</span>
						{/if}
						{#if card?.set_code}
							<span class="meta-tag">{card.set_code}</span>
						{/if}
						{#if card?.parallel}
							<span class="meta-tag parallel">{card.parallel}</span>
						{/if}
						{#if card?.weapon_type}
							<span class="meta-tag">{card.weapon_type}</span>
						{/if}
						{#if card?.power}
							<span class="meta-tag power">PWR {card.power}</span>
						{/if}
						{#if card?.rarity}
							<span class="meta-tag rarity">{card.rarity}</span>
						{/if}
					</div>

					<!-- Quantity + Condition -->
					<div class="quantity-row">
						<div class="quantity-controls">
							<span class="qty-label">Qty:</span>
							<button class="qty-btn" onclick={() => handleQuantityChange(-1)} disabled={item.quantity <= 1 || updating}>−</button>
							<span class="qty-value">{item.quantity}</span>
							<button class="qty-btn" onclick={() => handleQuantityChange(1)} disabled={updating}>+</button>
						</div>
						<span class="condition-badge">{item.condition?.replaceAll('_', ' ') || 'Near Mint'}</span>
					</div>

					<!-- Prices -->
					{#if card?.id}
						<div class="price-section">
							<h3>eBay Prices</h3>
							<PriceDisplay cardId={card.id} card={card} />
						</div>
						{#if hasPriceHistory()}
							{#await import('$lib/components/PriceTrends.svelte') then PriceTrends}
								<PriceTrends.default
									cardNumber={card.card_number || ''}
									heroName={card.hero_name || ''}
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

					<!-- Action Buttons -->
					<div class="action-buttons">
						<a href="/grader?cardId={card?.id}" class="action-btn action-grade">
							🎯 Grade This Card
						</a>

						{#if ebayConnected}
							<button class="action-btn action-list" onclick={() => { showListingModal = true; listingPrice = ''; listingQuantity = 1; }}>
								🛒 List on eBay
							</button>
						{/if}

						<button class="action-btn action-correction" onclick={() => { showCorrection = !showCorrection; }}>
							❌ Wrong Card? Fix It
						</button>
					</div>

					{#if showCorrection}
						{#await import('$lib/components/CardCorrection.svelte') then CardCorrection}
							<div class="correction-section">
								<CardCorrection.default
									card={card ?? {}}
									onCorrect={(corrected: Partial<import('$lib/types').Card>) => {
										showToast('Card corrected — save coming soon', 'check');
										showCorrection = false;
									}}
									onClose={() => { showCorrection = false; }}
								/>
							</div>
						{/await}
					{/if}

					<button class="btn-danger" onclick={handleRemove}>
						Remove from Collection
					</button>
				</div>
			</div>
			</div>
		</div>
	</div>

	<!-- eBay Listing Price Modal -->
	{#if showListingModal}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="listing-modal-overlay" onclick={() => { showListingModal = false; }}>
			<div class="listing-modal" onclick={(e) => e.stopPropagation()}>
				<h3>List on eBay</h3>
				<p class="listing-card-name">{card?.hero_name || card?.name} — {card?.card_number}</p>

				{#if !item.scan_image_url}
					<p class="listing-photo-hint">📷 No photo yet — consider taking one first for a better listing.</p>
				{/if}

				<div class="listing-fields">
					<label class="listing-field">
						<span>Price (USD)</span>
						<input type="number" step="0.01" min="0.01" placeholder="0.00" bind:value={listingPrice} class="listing-input" />
					</label>
					<label class="listing-field listing-field-small">
						<span>Qty</span>
						<input type="number" min="1" max="99" bind:value={listingQuantity} class="listing-input" />
					</label>
				</div>

				<p class="listing-note">Creates a draft in eBay Seller Hub. Review and publish from there.</p>

				<div class="listing-actions">
					<button class="listing-cancel" onclick={() => { showListingModal = false; }}>Cancel</button>
					<button class="listing-submit" onclick={createDraftListing} disabled={listingLoading || !listingPrice}>
						{listingLoading ? 'Creating...' : 'Create Draft'}
					</button>
				</div>
			</div>
		</div>
	{/if}
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
		z-index: var(--z-modal-backdrop, 1040);
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}
	.card-detail-backdrop {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.75);
		border: none;
		appearance: none;
		cursor: default;
	}
	.card-detail-sheet {
		position: relative;
		z-index: 1;
		width: 100%;
		max-width: 500px;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		background: var(--surface-secondary, #0d1524);
		border-radius: 16px 16px 0 0;
		padding: 1.5rem;
		padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
		box-shadow: 0 -4px 32px rgba(0, 0, 0, 0.5);
	}
	.detail-scroll {
		overflow-y: auto;
		flex: 1;
		min-height: 0;
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
		z-index: 1;
	}
	.detail-content {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* Image */
	.detail-header { text-align: center; }
	.detail-image-tilt {
		display: inline-block;
		border-radius: 8px;
	}
	.detail-image, :global(.detail-image) {
		max-width: 200px;
		border-radius: 8px;
	}
	.card-cropped {
		aspect-ratio: 5 / 7;
		object-fit: cover;
		border-radius: 12px;
		max-width: 100%;
	}
	.detail-placeholder { font-size: 4rem; }
	.retake-btn {
		display: inline-block;
		margin-top: 0.5rem;
		padding: 0.375rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, #334155);
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.8rem;
		cursor: pointer;
	}
	.retake-btn:hover { background: rgba(255,255,255,0.05); }
	.retake-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	/* Info */
	.detail-info h2 {
		font-family: 'Syne', sans-serif;
		font-size: 1.3rem;
		margin-bottom: 0.25rem;
	}
	.athlete-name {
		font-size: 0.85rem;
		color: var(--text-tertiary, #64748b);
		font-style: italic;
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
	.meta-tag.power { color: var(--accent-gold, #f59e0b); font-weight: 600; }
	.meta-tag.rarity { text-transform: capitalize; }
	.meta-tag.parallel { color: var(--accent-primary, #3b82f6); }

	/* Quantity + Condition */
	.quantity-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}
	.quantity-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.qty-label { font-size: 0.85rem; color: var(--text-secondary); }
	.qty-btn {
		width: 30px;
		height: 30px;
		border-radius: 6px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--surface-primary, #070b14);
		color: var(--text-primary);
		cursor: pointer;
		font-size: 1rem;
	}
	.qty-btn:disabled { opacity: 0.3; cursor: not-allowed; }
	.qty-value { font-weight: 600; min-width: 1.5rem; text-align: center; }
	.condition-badge {
		font-size: 0.8rem;
		color: var(--text-secondary);
		text-transform: capitalize;
		padding: 0.25rem 0.5rem;
		background: var(--surface-primary, #070b14);
		border-radius: 6px;
	}

	/* Prices */
	.price-section, .notes-section { margin-top: 0.5rem; }
	.price-section h3, .notes-section h3 {
		font-size: 0.9rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
		color: var(--text-secondary);
	}
	.notes-section p { font-size: 0.85rem; color: var(--text-secondary); }

	/* Action buttons */
	.action-buttons {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 1rem;
	}
	.action-btn {
		display: block;
		width: 100%;
		padding: 0.625rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, #334155);
		background: transparent;
		color: var(--text-primary);
		font-size: 0.85rem;
		cursor: pointer;
		text-align: center;
		text-decoration: none;
	}
	.action-btn:hover { background: rgba(255,255,255,0.05); }
	.action-grade { border-color: rgba(59, 130, 246, 0.3); color: #3b82f6; }
	.action-list { border-color: rgba(34, 197, 94, 0.3); color: #22c55e; }
	.action-correction { border-color: rgba(239, 68, 68, 0.2); color: var(--text-secondary); font-size: 0.8rem; }

	.correction-section {
		margin-top: 0.5rem;
		padding: 0.75rem;
		background: var(--bg-base, #0f172a);
		border-radius: 10px;
	}

	.btn-danger {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 8px;
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
		cursor: pointer;
		font-size: 0.85rem;
		margin-top: 1rem;
	}

	/* Listing modal */
	.listing-modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1100;
		padding: 1rem;
	}
	.listing-modal {
		background: var(--bg-elevated, #1e293b);
		border-radius: 16px;
		padding: 1.5rem;
		width: 100%;
		max-width: 340px;
	}
	.listing-modal h3 { font-size: 1rem; font-weight: 700; margin-bottom: 0.5rem; }
	.listing-card-name {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 1rem;
	}
	.listing-photo-hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-bottom: 0.75rem;
		padding: 0.5rem;
		border: 1px dashed var(--border-color);
		border-radius: 8px;
	}
	.listing-fields {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.listing-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
	}
	.listing-field span { font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); }
	.listing-field-small { max-width: 70px; flex: 0 0 70px; }
	.listing-input {
		padding: 0.5rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 1rem;
	}
	.listing-note { font-size: 0.7rem; color: var(--text-tertiary); margin-bottom: 0.75rem; }
	.listing-actions { display: flex; gap: 0.5rem; }
	.listing-cancel {
		flex: 1;
		padding: 0.625rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.listing-submit {
		flex: 2;
		padding: 0.625rem;
		border-radius: 8px;
		border: none;
		background: #22c55e;
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}
	.listing-submit:disabled { opacity: 0.5; cursor: not-allowed; }
	.listing-submit:hover:not(:disabled) { background: #16a34a; }

	@media (min-width: 768px) {
		.card-detail-sheet { border-radius: 16px; margin-bottom: 2rem; padding-bottom: 1.5rem; }
		.card-detail-overlay { align-items: center; }
	}
</style>
