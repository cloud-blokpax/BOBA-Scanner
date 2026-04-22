<script lang="ts">
	import type { FinalizedCell } from '$lib/services/binder-capture-finalize';
	import type { GridSize } from '$lib/services/cell-extractor';
	import { computeCellRegions } from '$lib/services/cell-extractor';
	import { addToCollection } from '$lib/stores/collection.svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import CardCorrection from '$lib/components/CardCorrection.svelte';
	import type { Card } from '$lib/types';

	let {
		gridSize,
		cells,
		parentFrameUrl,
		isAuthenticated,
		onClose
	}: {
		gridSize: GridSize;
		cells: FinalizedCell[];
		parentFrameUrl: string | null;
		isAuthenticated: boolean;
		onClose: () => void;
	} = $props();

	const rowCount = $derived(gridSize === '2x2' ? 2 : gridSize === '4x4' ? 4 : 3);
	const colCount = $derived(rowCount);

	// svelte-ignore state_referenced_locally
	let localCells = $state<FinalizedCell[]>(cells);
	let correctingIdx = $state<number | null>(null);
	let committed = $state(false);

	const nonBlank = $derived(localCells.filter((c) => !c.isBlank));
	const resolved = $derived(nonBlank.filter((c) => !!c.cardId));
	const flagged = $derived(
		nonBlank.filter((c) => !c.cardId || c.fallbackTierUsed === 'haiku')
	);

	// Pre-compute cell pixel rects so each thumbnail can crop from the parent
	// frame via CSS background-position. This avoids 9 separate image decodes.
	const cellRects = $derived.by(() => {
		if (!parentFrameUrl) return [];
		// A nominal 800×1120 parent frame is assumed for thumbnail layout;
		// actual ratios are handled by background-size: cover and cellRegion.
		return computeCellRegions(800, 1120, gridSize);
	});

	function cellBgStyle(idx: number): string {
		if (!parentFrameUrl) return '';
		const rect = cellRects[idx];
		if (!rect) return '';
		const bgW = (800 / rect.w) * 100;
		const bgH = (1120 / rect.h) * 100;
		const posX = (rect.x / (800 - rect.w)) * 100;
		const posY = (rect.y / (1120 - rect.h)) * 100;
		return `background-image: url(${parentFrameUrl}); background-size: ${bgW}% ${bgH}%; background-position: ${posX}% ${posY}%;`;
	}

	function handleCellCorrection(idx: number, corrected: Partial<Card>) {
		if (!corrected.id) {
			correctingIdx = null;
			return;
		}
		localCells = localCells.map((c, i) =>
			i === idx
				? {
						...c,
						card: {
							id: corrected.id!,
							game_id: (corrected.game_id as string | undefined) ?? 'boba',
							card_number: corrected.card_number ?? c.cardNumber ?? '',
							hero_name: corrected.hero_name ?? null,
							name: corrected.name ?? corrected.hero_name ?? null,
							parallel: corrected.parallel ?? null,
							set_code: corrected.set_code ?? null
						},
						cardId: corrected.id!,
						cardNumber: corrected.card_number ?? c.cardNumber,
						name: corrected.hero_name ?? corrected.name ?? c.name,
						parallel: corrected.parallel ?? c.parallel ?? null,
						confidence: 1,
						fallbackTierUsed: 'manual' as const
					}
				: c
		);
		correctingIdx = null;
	}

	async function commit() {
		if (!isAuthenticated) {
			window.location.href = '/auth/login?redirectTo=/scan?mode=binder';
			return;
		}
		let added = 0;
		let failed = 0;
		for (const cell of resolved) {
			if (cell.cardId) {
				try {
					await addToCollection(cell.cardId, 'near_mint');
					added++;
				} catch (err) {
					console.debug('[BinderReview] addToCollection failed', err);
					failed++;
				}
			}
		}
		if (failed > 0) {
			showToast(`Added ${added} cards. ${failed} failed — try again.`, 'x');
		} else {
			showToast(`Added ${added} cards to collection`, '✓');
		}
		committed = true;
	}

	function cellLabel(c: FinalizedCell): string {
		if (c.isBlank) return 'Empty';
		if (!c.cardId) return c.fallbackTierUsed === 'haiku' ? 'Needs review' : 'Pending';
		return c.name || c.cardNumber || 'Card';
	}
</script>

<div class="binder-review">
	<div class="binder-review-header">
		<h2>Review binder scan</h2>
		<button class="close-btn" onclick={onClose}>Close</button>
	</div>

	{#if !committed}
		<p class="review-summary">
			{resolved.length} of {nonBlank.length} cards identified
			{#if flagged.length > 0}
				· <span class="flagged-count">{flagged.length} need review</span>
			{/if}
		</p>

		<div
			class="review-grid"
			style="--rows:{rowCount};--cols:{colCount}"
		>
			{#each localCells as cell, idx}
				<button
					class="review-cell"
					class:review-cell-blank={cell.isBlank}
					class:review-cell-pending={!cell.isBlank && !cell.cardId}
					class:review-cell-flagged={!cell.isBlank && cell.fallbackTierUsed === 'haiku' && !!cell.cardId}
					class:review-cell-resolved={!cell.isBlank && !!cell.cardId && cell.fallbackTierUsed !== 'haiku'}
					onclick={() => {
						if (!cell.isBlank) correctingIdx = idx;
					}}
					disabled={cell.isBlank}
				>
					<div class="review-cell-thumb" style={cellBgStyle(idx)}></div>
					<div class="review-cell-meta">
						<div class="review-cell-name">{cellLabel(cell)}</div>
						{#if cell.cardNumber}
							<div class="review-cell-number">{cell.cardNumber}</div>
						{/if}
						{#if cell.parallel && cell.parallel !== 'Paper'}
							<div class="review-cell-parallel">{cell.parallel}</div>
						{/if}
					</div>
				</button>
			{/each}
		</div>

		<div class="review-actions">
			<button class="btn-primary" onclick={commit} disabled={resolved.length === 0}>
				Add {resolved.length} to Collection
			</button>
			{#if flagged.length > 0}
				<button
					class="btn-secondary"
					onclick={() => {
						const first = localCells.findIndex(
							(c) => !c.isBlank && (!c.cardId || c.fallbackTierUsed === 'haiku')
						);
						if (first !== -1) correctingIdx = first;
					}}
				>
					Review {flagged.length} flagged
				</button>
			{/if}
		</div>

		{#if correctingIdx !== null}
			{@const cell = localCells[correctingIdx]}
			<div class="correction-overlay">
				<div class="correction-card">
					<CardCorrection
						card={{
							card_number: cell.cardNumber ?? '',
							hero_name: cell.name ?? undefined,
							name: cell.name ?? undefined
						} as Partial<Card>}
						onCorrect={(corrected) =>
							handleCellCorrection(correctingIdx!, corrected)}
						onClose={() => {
							correctingIdx = null;
						}}
					/>
				</div>
			</div>
		{/if}
	{:else}
		<div class="binder-committed">
			<p>Added {resolved.length} cards to your collection.</p>
			<button class="btn-primary" onclick={onClose}>Done</button>
		</div>
	{/if}
</div>

<style>
	.binder-review {
		padding: 1rem;
		max-width: 720px;
		margin: 0 auto;
		color: var(--text-primary, #e5e7eb);
	}

	.binder-review-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.binder-review-header h2 {
		font-size: 1.1rem;
		font-weight: 700;
		margin: 0;
	}
	.close-btn {
		background: transparent;
		border: 1px solid var(--border-color, #374151);
		color: var(--text-secondary, #9ca3af);
		padding: 0.4rem 0.9rem;
		border-radius: 8px;
		cursor: pointer;
		font-size: 0.85rem;
	}

	.review-summary {
		color: var(--text-secondary, #9ca3af);
		font-size: 0.85rem;
		margin: 0.25rem 0 0.75rem;
	}
	.flagged-count { color: #fb923c; }

	.review-grid {
		display: grid;
		grid-template-rows: repeat(var(--rows), auto);
		grid-template-columns: repeat(var(--cols), 1fr);
		gap: 8px;
	}

	.review-cell {
		position: relative;
		border: 2px solid var(--border-color, #374151);
		border-radius: 10px;
		background: rgba(17, 24, 39, 0.5);
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		cursor: pointer;
		color: inherit;
		text-align: left;
		transition: border-color 150ms ease;
	}
	.review-cell:disabled { cursor: default; opacity: 0.5; }
	.review-cell-resolved { border-color: rgba(34, 197, 94, 0.8); }
	.review-cell-flagged { border-color: rgba(251, 146, 60, 0.9); }
	.review-cell-pending {
		border-color: rgba(239, 68, 68, 0.7);
		background: rgba(127, 29, 29, 0.15);
	}
	.review-cell-blank {
		border-style: dashed;
		background: rgba(15, 23, 42, 0.25);
	}

	.review-cell-thumb {
		width: 100%;
		aspect-ratio: 5 / 7;
		border-radius: 6px;
		background-color: rgba(15, 23, 42, 0.6);
		background-repeat: no-repeat;
	}

	.review-cell-meta {
		min-height: 2rem;
	}
	.review-cell-name {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-primary, #e5e7eb);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.review-cell-number {
		font-size: 0.7rem;
		color: var(--text-secondary, #9ca3af);
		font-family: monospace;
	}
	.review-cell-parallel {
		font-size: 0.65rem;
		color: #60a5fa;
		font-weight: 500;
	}

	.review-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 1rem;
		flex-wrap: wrap;
	}
	.btn-primary {
		flex: 1;
		padding: 0.75rem 1rem;
		border: none;
		border-radius: 10px;
		background: var(--success, #10b981);
		color: white;
		font-weight: 600;
		cursor: pointer;
	}
	.btn-primary:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.btn-secondary {
		padding: 0.75rem 1rem;
		border: 1px solid var(--border-color, #374151);
		border-radius: 10px;
		background: transparent;
		color: var(--text-primary, #e5e7eb);
		font-weight: 500;
		cursor: pointer;
	}

	.correction-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 1000;
	}
	.correction-card {
		width: 100%;
		max-width: 420px;
		max-height: 80vh;
		overflow-y: auto;
		background: var(--bg-elevated, #111827);
		border-radius: 12px;
		padding: 1rem;
	}

	.binder-committed {
		text-align: center;
		padding: 2rem 1rem;
	}
	.binder-committed p {
		margin-bottom: 1rem;
		color: var(--text-secondary, #9ca3af);
	}
</style>
