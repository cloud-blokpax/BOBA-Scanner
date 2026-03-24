<script lang="ts">
	import CardCorrection from '$lib/components/CardCorrection.svelte';
	import type { Card } from '$lib/types';

	let {
		card,
		isAuthenticated,
		isOwned,
		addSuccess,
		adding,
		addError,
		showConfetti,
		hasScanToList,
		ebayConnected,
		ebayChecked,
		listingUrl,
		listingInProgress,
		listingError,
		priceData,
		isLowConfidence = false,
		onAdd,
		onListOnEbay,
		onScanAnother,
		onClose,
		onManualCorrection
	}: {
		card: Card;
		isAuthenticated: boolean;
		isOwned: boolean;
		addSuccess: boolean;
		adding: boolean;
		addError: string | null;
		showConfetti: boolean;
		hasScanToList: boolean;
		ebayConnected: boolean;
		ebayChecked: boolean;
		listingUrl: string | null;
		listingInProgress: boolean;
		listingError: string | null;
		priceData: { price_mid: number | null } | null;
		isLowConfidence?: boolean;
		onAdd: () => void;
		onListOnEbay: () => void;
		onScanAnother: () => void;
		onClose: () => void;
		onManualCorrection: (card: Partial<Card>) => void;
	} = $props();

	let showManualSearch = $state(false);

	function handleSignInToSave() {
		if (card?.id) {
			sessionStorage.setItem('pending_add_card', JSON.stringify({
				card_id: card.id,
				card_number: card.card_number,
				hero_name: card.hero_name
			}));
		}
		window.location.href = `/auth/login?redirectTo=/scan`;
	}
</script>

{#if addError}
	<p class="error-msg">{addError}</p>
{/if}

<!-- eBay listing (premium) -->
{#if hasScanToList && card}
	<div class="ebay-action">
		{#if listingUrl}
			<a href={listingUrl} target="_blank" rel="noopener noreferrer" class="btn btn-list btn-listed">View on eBay</a>
		{:else if !ebayConnected && ebayChecked}
			<a href="/auth/ebay" class="btn btn-list">Connect eBay</a>
		{:else if ebayConnected}
			<button class="btn btn-list" onclick={onListOnEbay} disabled={listingInProgress || !priceData}>
				{listingInProgress ? 'Creating...' : 'List on eBay'}
			</button>
		{/if}
		{#if listingError}
			<p class="listing-error">{listingError}</p>
		{/if}
	</div>
{/if}

<div class="actions-stacked">
	<!-- Primary action -->
	<div class="add-btn-wrapper">
		{#if isAuthenticated}
			{#if isLowConfidence}
				<button class="btn btn-add btn-verify" onclick={onAdd} disabled={adding || addSuccess}>
					{adding ? 'Adding...' : addSuccess ? 'Added!' : 'Verify & Add'}
				</button>
			{:else}
				<button class="btn btn-add" class:btn-added={addSuccess} onclick={onAdd} disabled={adding || addSuccess}>
					{#if adding}
						Adding...
					{:else if addSuccess}
						Added!
					{:else if isOwned}
						Add Another Copy
					{:else}
						Add to Collection
					{/if}
				</button>
			{/if}
		{:else}
			<button class="btn btn-add" onclick={handleSignInToSave}>
				Sign in to Save
			</button>
		{/if}
		{#if showConfetti}
			<div class="confetti-burst">
				{#each [
					{ x: 1, y: 0, dist: 22 },
					{ x: 0.5, y: 0.866, dist: 22 },
					{ x: -0.5, y: 0.866, dist: 22 },
					{ x: -1, y: 0, dist: 26 },
					{ x: -0.5, y: -0.866, dist: 22 },
					{ x: 0.5, y: -0.866, dist: 22 }
				] as dot}
					<span class="confetti-dot" style="--dx: {dot.x}; --dy: {dot.y}; --dist: {dot.dist}px"></span>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Secondary actions row -->
	<div class="secondary-row">
		<button class="btn btn-scan-another" onclick={onScanAnother}>
			Scan Another
		</button>
		<a href="/grader" class="btn btn-grade" onclick={onClose}>
			Grade Card
		</a>
	</div>

	<!-- Tertiary -->
	<button class="btn-text-link" onclick={() => { showManualSearch = true; }}>
		Wrong Card? Search Manually
	</button>
</div>

{#if showManualSearch}
	<div class="manual-search-container">
		<CardCorrection
			card={{ card_number: card?.card_number ?? '' }}
			onCorrect={onManualCorrection}
			onClose={() => { showManualSearch = false; }}
		/>
	</div>
{/if}

<style>
	.error-msg {
		color: var(--danger, #ef4444);
		font-size: 0.85rem;
		margin: 0;
	}

	.ebay-action { margin-bottom: 0.5rem; }
	.btn-list { display: block; width: 100%; padding: 0.75rem; border-radius: 8px; font-weight: 600; font-size: 0.9rem; cursor: pointer; border: 1px solid rgba(16, 185, 129, 0.3); background: var(--bg-elevated, #121d34); color: var(--success, #10b981); text-align: center; text-decoration: none; }
	.btn-list:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-listed { background: var(--success, #10b981); color: white; border-color: transparent; }
	.listing-error { font-size: 0.8rem; color: var(--danger, #ef4444); margin: 0.25rem 0 0; }

	.actions-stacked {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: auto;
		padding-top: 0.5rem;
	}

	.btn {
		padding: 0.875rem;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
		border: none;
		transition: opacity 0.15s, background 0.15s;
		width: 100%;
		text-align: center;
	}

	.btn:active { opacity: 0.85; }

	.btn-add {
		background: var(--primary, #3b82f6);
		color: white;
	}

	.btn-add:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-added {
		background: var(--success, #10b981) !important;
		animation: success-pop 0.35s ease-out;
	}

	.btn-verify {
		background: var(--warning, #f59e0b) !important;
		color: #000;
	}

	.secondary-row {
		display: flex;
		gap: 0.5rem;
	}

	.btn-grade {
		flex: 1;
		background: var(--bg-elevated, #121d34);
		border: 1px solid rgba(168, 85, 247, 0.3);
		color: #a855f7;
		text-decoration: none;
	}

	.btn-scan-another {
		flex: 1;
		background: transparent;
		border: 1px solid var(--border-strong, rgba(148,163,184,0.2));
		color: var(--text-primary, #e2e8f0);
	}

	.btn-text-link {
		background: none;
		border: none;
		color: var(--text-muted, #475569);
		font-size: 0.8rem;
		cursor: pointer;
		text-decoration: underline;
		padding: 0.25rem 0;
	}

	.add-btn-wrapper {
		position: relative;
	}

	.confetti-burst {
		position: absolute;
		top: 50%;
		left: 50%;
		pointer-events: none;
	}

	.confetti-dot {
		position: absolute;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--gold, #f59e0b);
		animation: confetti-fly 0.7s ease-out forwards;
	}

	.confetti-dot:nth-child(odd) { background: var(--primary, #3b82f6); }
	.confetti-dot:nth-child(3n) { background: var(--success, #10b981); }

	.manual-search-container {
		width: 100%;
		max-width: 400px;
		margin-top: 0.5rem;
		text-align: left;
	}

	@keyframes success-pop {
		0% { transform: scale(1); }
		50% { transform: scale(1.04); }
		100% { transform: scale(1); }
	}

	@keyframes confetti-fly {
		0% {
			opacity: 1;
			transform: translate(0, 0) scale(0);
		}
		50% {
			opacity: 1;
			transform: translate(
				calc(var(--dx) * var(--dist)),
				calc(var(--dy) * var(--dist))
			) scale(1);
		}
		100% {
			opacity: 0;
			transform: translate(
				calc(var(--dx) * var(--dist) * 1.5),
				calc(var(--dy) * var(--dist) * 1.5)
			) scale(0.5);
		}
	}
</style>
