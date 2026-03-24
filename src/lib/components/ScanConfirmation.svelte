<script lang="ts">
	import { addToCollection, ownedCardCounts } from '$lib/stores/collection.svelte';
	import { getPrice } from '$lib/stores/prices.svelte';
	import { triggerHaptic } from '$lib/utils/haptics';
	import { featureEnabled } from '$lib/stores/feature-flags.svelte';
	import { generateListingTemplate } from '$lib/services/listing-generator';
	import { tryAwardBadge } from '$lib/services/badges';
	import type { ScanResult, Card } from '$lib/types';

	import ScanCardImage from './scan-confirmation/ScanCardImage.svelte';
	import ScanCardHeader from './scan-confirmation/ScanCardHeader.svelte';
	import ScanPriceSection from './scan-confirmation/ScanPriceSection.svelte';
	import ScanMetaPills from './scan-confirmation/ScanMetaPills.svelte';
	import ScanStats from './scan-confirmation/ScanStats.svelte';
	import ScanActions from './scan-confirmation/ScanActions.svelte';
	import ScanFailState from './scan-confirmation/ScanFailState.svelte';

	const hasPriceHistory = featureEnabled('price_history');
	const hasScanToList = featureEnabled('scan_to_list');

	let {
		result,
		capturedImageUrl,
		onScanAnother,
		onClose,
		isAuthenticated = true
	}: {
		result: ScanResult;
		capturedImageUrl: string | null;
		onScanAnother: () => void;
		onClose: () => void;
		isAuthenticated?: boolean;
	} = $props();

	let adding = $state(false);
	let addError = $state<string | null>(null);
	let addSuccess = $state(false);
	let showConfetti = $state(false);
	let priceData = $state<{ price_mid: number | null; price_low: number | null; price_high: number | null; listings_count: number | null } | null>(null);
	let priceLoading = $state(false);
	let priceError = $state(false);

	// Price history state
	let historyData = $state<Array<{ date: string; price_mid: number | null }>>([]);
	let historyLoading = $state(false);

	// eBay listing state
	let ebayConnected = $state(false);
	let ebayChecked = $state(false);
	let listingInProgress = $state(false);
	let listingUrl = $state<string | null>(null);
	let listingError = $state<string | null>(null);

	let manualCard = $state<Card | null>(null);

	function handleManualCorrection(correctedCard: Partial<Card>) {
		manualCard = correctedCard as Card;
	}

	const card = $derived(manualCard ?? result.card);
	const activeResult = $derived(manualCard ? {
		...result,
		card: manualCard,
		card_id: manualCard.id ?? null,
		scan_method: 'manual' as const,
		confidence: 1.0,
		failReason: null
	} : result);
	const ownedCount = $derived(card ? (ownedCardCounts().get(card.id) || 0) : 0);
	const isOwned = $derived(ownedCount > 0);
	const isLowConfidence = $derived(activeResult.confidence < 0.7);

	// Fetch price when card is identified
	let lastPriceFetchCardId: string | null = null;
	$effect(() => {
		if (!card?.id || card.id === lastPriceFetchCardId) return;
		lastPriceFetchCardId = card.id;
		const cardId = card.id;
		priceLoading = true;
		priceError = false;
		priceData = null;

		getPrice(cardId)
			.then(data => {
				if (card?.id === cardId) priceData = data;
			})
			.catch(() => {
				if (card?.id === cardId) priceError = true;
			})
			.finally(() => {
				if (card?.id === cardId) priceLoading = false;
			});
	});

	// Fetch price history for premium users
	$effect(() => {
		if (!hasPriceHistory() || !card?.id) return;
		const controller = new AbortController();
		historyLoading = true;
		fetch(`/api/price/${encodeURIComponent(card.id)}/history`, { signal: controller.signal })
			.then(res => res.ok ? res.json() : Promise.reject())
			.then(data => { historyData = data.history || []; historyLoading = false; })
			.catch((err) => {
				if (err instanceof DOMException && err.name === 'AbortError') return;
				historyData = [];
				historyLoading = false;
			});
		return () => controller.abort();
	});

	// Check eBay connection status for scan-to-list users
	$effect(() => {
		if (!hasScanToList() || ebayChecked) return;
		const controller = new AbortController();
		fetch('/api/ebay/status', { signal: controller.signal })
			.then(res => res.ok ? res.json() : Promise.reject())
			.then(data => { ebayConnected = data.connected; })
			.catch((err) => {
				if (err instanceof DOMException && err.name === 'AbortError') return;
				ebayConnected = false;
			})
			.finally(() => {
				if (!controller.signal.aborted) ebayChecked = true;
			});
		return () => controller.abort();
	});

	async function handleListOnEbay() {
		if (!card || !priceData) return;
		listingInProgress = true;
		listingError = null;
		try {
			const template = generateListingTemplate(card, priceData);
			const res = await fetch('/api/ebay/listing', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					card_id: card.id,
					title: template.title,
					description: template.description,
					price: template.suggested_price || (priceData.price_mid ?? 1.99),
					condition: template.condition
				})
			});
			if (!res.ok) {
				const errData = await res.json().catch(() => ({ message: 'Listing failed' }));
				throw new Error(errData.message || `Listing failed: ${res.status}`);
			}
			const data = await res.json();
			listingUrl = data.listing_url;
		} catch (err) {
			listingError = err instanceof Error ? err.message : 'Failed to create listing';
		}
		listingInProgress = false;
	}

	async function handleAdd() {
		if (!card) return;
		adding = true;
		addError = null;
		addSuccess = false;
		try {
			await addToCollection(card.id);
			addSuccess = true;
			triggerHaptic('successAdd');
			showConfetti = true;
			setTimeout(() => { showConfetti = false; }, 800);

			const counts = ownedCardCounts();
			if (counts.size >= 100) {
				tryAwardBadge('collector');
			}
		} catch (err) {
			addError = err instanceof Error ? err.message : 'Failed to add card';
		} finally {
			adding = false;
		}
	}
</script>

<div class="confirmation-overlay">
	<div class="confirmation-backdrop"></div>
	<div class="confirmation-container">
		<div class="sheet-handle"></div>
		{#if card}
			<ScanCardImage
				imageUrl={capturedImageUrl ?? card.image_url ?? null}
				cardName={card.name}
				rarity={card.rarity ?? 'common'}
				weaponType={card.weapon_type ?? null}
			/>

			<div class="card-details">
				<ScanCardHeader
					name={card.name}
					heroName={card.hero_name ?? null}
					cardNumber={card.card_number ?? null}
					{isOwned}
					{ownedCount}
				/>

				<ScanPriceSection
					{priceData}
					{priceLoading}
					{priceError}
					{historyData}
					{historyLoading}
					showPriceHistory={hasPriceHistory()}
				/>

				<!-- Actions first — always visible without scrolling -->
				<ScanActions
					{card}
					{capturedImageUrl}
					{isAuthenticated}
					{isOwned}
					{addSuccess}
					{adding}
					{addError}
					{showConfetti}
					hasScanToList={hasScanToList()}
					{ebayConnected}
					{ebayChecked}
					{listingUrl}
					{listingInProgress}
					{listingError}
					{priceData}
					{isLowConfidence}
					onAdd={handleAdd}
					onListOnEbay={handleListOnEbay}
					{onScanAnother}
					{onClose}
					onManualCorrection={handleManualCorrection}
				/>

				<!-- Details section — collapsed by default -->
				<details class="scan-details-disclosure">
					<summary class="scan-details-toggle">Card Details</summary>
					<div class="scan-details-content">
						<ScanMetaPills
							setCode={card.set_code ?? null}
							parallel={card.parallel ?? null}
							weaponType={card.weapon_type ?? null}
							power={card.power ?? null}
							battleZone={card.battle_zone ?? null}
							rarity={card.rarity ?? null}
						/>

						<ScanStats
							scanMethod={activeResult.scan_method}
							confidence={activeResult.confidence}
							processingMs={activeResult.processing_ms}
							{isLowConfidence}
						/>
					</div>
				</details>
			</div>
		{:else}
			<ScanFailState
				{capturedImageUrl}
				failReason={result.failReason ?? null}
				{onScanAnother}
				{onClose}
				onManualCorrection={handleManualCorrection}
			/>
		{/if}
	</div>
</div>

<style>
	.confirmation-overlay {
		position: fixed;
		inset: 0;
		z-index: calc(var(--z-sticky, 1020) + 30);
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
	}

	.confirmation-backdrop {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		animation: fade-in 0.2s ease-out;
	}

	.confirmation-container {
		position: relative;
		max-height: 70vh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		padding-bottom: calc(var(--bottom-nav-height, 68px) + var(--safe-bottom, env(safe-area-inset-bottom, 20px)));
		background: var(--bg-base, #070b14);
		border-radius: 20px 20px 0 0;
		animation: sheet-slide-up 0.3s ease-out;
	}

	.card-details {
		flex: 1;
		padding: 1.25rem 1.5rem 2rem;
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.sheet-handle {
		width: 40px;
		height: 4px;
		background: rgba(148, 163, 184, 0.3);
		border-radius: 2px;
		margin: 8px auto 0;
		flex-shrink: 0;
	}

	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes sheet-slide-up {
		from { transform: translateY(100%); }
		to { transform: translateY(0); }
	}

	.scan-details-disclosure {
		border-top: 1px solid var(--border, rgba(148,163,184,0.1));
		margin-top: 0.5rem;
	}

	.scan-details-toggle {
		padding: 0.75rem 0;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary, #94a3b8);
		cursor: pointer;
		list-style: none;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.scan-details-toggle::before {
		content: '▸';
		transition: transform 0.2s;
	}

	details[open] .scan-details-toggle::before {
		transform: rotate(90deg);
	}

	.scan-details-content {
		padding-bottom: 0.5rem;
	}
</style>
