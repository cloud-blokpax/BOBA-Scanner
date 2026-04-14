<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import { priceCache } from '$lib/stores/prices.svelte';
	import { isPro, setShowGoProModal } from '$lib/stores/pro.svelte';
	import {
		whatnotPendingCards, whatnotBatchTag, whatnotBatchNumber,
		removeCardFromBatch, updatePendingCard, finalizeBatch,
		getPreviousExportBatches
	} from '$lib/stores/whatnot-batch.svelte';
	import { generateWhatnotCSV, downloadWhatnotCSV, type WhatnotExportCard } from '$lib/services/whatnot-export';
	import { triggerHaptic } from '$lib/utils/haptics';

	interface Props {
		onScan: () => void;
		onUpload: () => void;
		onDone: () => void;
	}

	let { onScan, onUpload, onDone }: Props = $props();

	const pending = $derived(whatnotPendingCards());
	const batchTag = $derived(whatnotBatchTag());
	const batchNumber = $derived(whatnotBatchNumber());
	const previousBatches = $derived(getPreviousExportBatches());
	const prices = $derived(priceCache());

	let exporting = $state(false);
	let showHistory = $state(false);

	async function handleExport() {
		if (pending.length === 0) {
			showToast('No cards to export', 'x');
			return;
		}

		if (!isPro()) {
			setShowGoProModal(true);
			return;
		}

		exporting = true;
		try {
			// Build export cards with prices
			const exportCards: WhatnotExportCard[] = [];
			for (const p of pending) {
				const priceData = prices.get(p.cardId);
				exportCards.push({
					id: p.cardId,
					hero_name: p.card.hero_name,
					name: p.card.name,
					athlete_name: p.card.athlete_name,
					card_number: p.card.card_number,
					set_code: p.card.set_code,
					parallel: p.card.parallel,
					weapon_type: p.card.weapon_type,
					power: p.card.power,
					rarity: p.card.rarity,
					price_mid: p.priceOverride ?? priceData?.price_mid ?? null,
					quantity: 1,
					condition: p.condition,
					image_url: p.imageUrl?.startsWith('https://') ? p.imageUrl : null
				});
			}

			const csv = generateWhatnotCSV(exportCards);
			downloadWhatnotCSV(csv, `whatnot-export-${batchNumber}-${new Date().toISOString().split('T')[0]}.csv`);

			triggerHaptic('success');
			showToast(`Exported ${pending.length} cards as ${batchTag}`, 'check');

			// Finalize: clear pending and increment batch number
			await finalizeBatch();
		} catch (err) {
			console.error('[whatnot] Export failed:', err);
			showToast('Export failed — please try again', 'x');
		} finally {
			exporting = false;
		}
	}

	function handleRemove(cardId: string) {
		removeCardFromBatch(cardId);
		triggerHaptic('tap');
	}
</script>

<div class="wnp">
	<div class="wnp-header">
		<button class="wnp-back" onclick={onDone}>← Back</button>
		<h1 class="wnp-title">{batchTag}</h1>
		<span class="wnp-count">{pending.length} card{pending.length !== 1 ? 's' : ''}</span>
	</div>

	<!-- Action buttons -->
	<div class="wnp-actions">
		<button class="wnp-action-btn" onclick={onScan}>📷 Scan Card</button>
		<button class="wnp-action-btn" onclick={onUpload}>📤 Upload Photo</button>
	</div>

	<!-- Pending cards list -->
	{#if pending.length === 0}
		<div class="wnp-empty">
			<p class="wnp-empty-title">No cards in this batch yet</p>
			<p class="wnp-empty-hint">Scan or upload cards to add them to your Whatnot export</p>
		</div>
	{:else}
		<div class="wnp-cards">
			{#each pending as item (item.cardId)}
				<div class="wnp-card">
					<div class="wnp-card-image">
						{#if item.card.image_url}
							<img src={item.card.image_url} alt={item.card.hero_name || item.card.name || 'Card'} class="wnp-card-img" />
						{:else}
							<span class="wnp-card-placeholder">🎴</span>
						{/if}
					</div>
					<div class="wnp-card-info">
						<span class="wnp-card-hero">{item.card.hero_name || item.card.name || 'Unknown'}</span>
						<span class="wnp-card-num">{item.card.card_number || ''}</span>
						<select
							class="wnp-card-condition"
							value={item.condition}
							onchange={(e) => updatePendingCard(item.cardId, { condition: (e.target as HTMLSelectElement).value })}
						>
							<option value="Near Mint">Near Mint</option>
							<option value="Excellent">Lightly Played</option>
							<option value="Good">Moderately Played</option>
							<option value="Fair">Heavily Played</option>
							<option value="Poor">Damaged</option>
						</select>
					</div>
					<button class="wnp-card-remove" onclick={() => handleRemove(item.cardId)} title="Remove from batch">✕</button>
				</div>
			{/each}
		</div>

		<!-- Export button -->
		<div class="wnp-export">
			<button
				class="wnp-export-btn"
				onclick={handleExport}
				disabled={exporting || pending.length === 0}
			>
				{exporting ? 'Exporting...' : `Export ${pending.length} Cards as CSV`}
			</button>
		</div>
	{/if}

	<!-- Previous export history -->
	{#if previousBatches.length > 0}
		<button class="wnp-history-toggle" onclick={() => showHistory = !showHistory}>
			{showHistory ? 'Hide' : 'Show'} Previous Exports ({previousBatches.length})
		</button>
		{#if showHistory}
			<div class="wnp-history">
				{#each previousBatches as batch}
					<div class="wnp-history-item">
						<span class="wnp-history-label">Whatnot Export #{batch.batchNumber}</span>
						<span class="wnp-history-count">{batch.cardIds.length} cards</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.wnp { max-width: 600px; margin: 0 auto; padding: 0 0 5rem; }
	.wnp-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border, rgba(148,163,184,0.10)); }
	.wnp-back { background: none; border: none; color: var(--text-secondary, #94a3b8); font-size: 0.9rem; cursor: pointer; padding: 0.25rem; }
	.wnp-title { font-size: 1.1rem; font-weight: 700; flex: 1; }
	.wnp-count { font-size: 0.8rem; color: var(--text-muted, #475569); background: var(--surface-raised, rgba(148,163,184,0.08)); padding: 0.15rem 0.5rem; border-radius: 12px; }

	.wnp-actions { display: flex; gap: 0.5rem; padding: 0.75rem 1rem; }
	.wnp-action-btn { flex: 1; padding: 0.6rem; border-radius: 10px; background: var(--surface-raised, rgba(148,163,184,0.08)); border: 1px solid var(--border, rgba(148,163,184,0.10)); color: var(--text-primary, #e2e8f0); font-size: 0.85rem; font-weight: 600; cursor: pointer; }
	.wnp-action-btn:hover { background: var(--surface-hover, rgba(148,163,184,0.12)); }

	.wnp-empty { text-align: center; padding: 3rem 1rem; }
	.wnp-empty-title { font-size: 1rem; font-weight: 600; margin: 0 0 0.5rem; }
	.wnp-empty-hint { font-size: 0.85rem; color: var(--text-muted, #475569); margin: 0; }

	.wnp-cards { padding: 0 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
	.wnp-card { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0.75rem; border-radius: 10px; background: var(--surface-raised, rgba(148,163,184,0.05)); border: 1px solid var(--border, rgba(148,163,184,0.08)); }
	.wnp-card-image { width: 40px; height: 56px; flex-shrink: 0; border-radius: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: var(--bg-surface, #0d1524); }
	.wnp-card-img { width: 100%; height: 100%; object-fit: cover; }
	.wnp-card-placeholder { font-size: 1.25rem; }
	.wnp-card-info { flex: 1; display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
	.wnp-card-hero { font-size: 0.85rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.wnp-card-num { font-size: 0.75rem; color: var(--text-muted, #475569); }
	.wnp-card-condition { font-size: 0.7rem; padding: 0.15rem 0.3rem; border-radius: 4px; background: var(--surface-raised, rgba(148,163,184,0.1)); border: 1px solid var(--border, rgba(148,163,184,0.15)); color: var(--text-primary, #e2e8f0); width: fit-content; }
	.wnp-card-remove { background: none; border: none; color: var(--text-muted, #475569); cursor: pointer; font-size: 1rem; padding: 0.25rem; opacity: 0.6; }
	.wnp-card-remove:hover { opacity: 1; color: var(--danger, #ef4444); }

	.wnp-export { padding: 1rem; position: sticky; bottom: 68px; background: var(--bg-primary, #0a0a0a); }
	.wnp-export-btn { width: 100%; padding: 0.85rem; border-radius: 12px; background: #7c3aed; color: white; border: none; font-size: 0.95rem; font-weight: 700; cursor: pointer; }
	.wnp-export-btn:hover:not(:disabled) { opacity: 0.9; }
	.wnp-export-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.wnp-history-toggle { display: block; width: 100%; text-align: center; padding: 0.75rem; background: none; border: none; color: var(--text-muted, #475569); font-size: 0.8rem; cursor: pointer; }
	.wnp-history { padding: 0 1rem 1rem; display: flex; flex-direction: column; gap: 0.35rem; }
	.wnp-history-item { display: flex; justify-content: space-between; padding: 0.5rem 0.75rem; border-radius: 6px; background: var(--surface-raised, rgba(148,163,184,0.03)); font-size: 0.8rem; }
	.wnp-history-label { color: var(--text-secondary, #94a3b8); }
	.wnp-history-count { color: var(--text-muted, #475569); }
</style>
