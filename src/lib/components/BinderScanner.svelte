<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { ScanResult, Card } from '$lib/types';
	import { recognizeCard } from '$lib/services/recognition';
	import { addToCollection } from '$lib/stores/collection.svelte';
	import CardCorrection from '$lib/components/CardCorrection.svelte';

	let { onClose, isAuthenticated = false }: { onClose?: () => void; isAuthenticated?: boolean } = $props();

	type GridPreset = { rows: number; cols: number; label: string };

	const PRESETS: GridPreset[] = [
		{ rows: 3, cols: 3, label: '3x3' },
		{ rows: 2, cols: 2, label: '2x2' },
		{ rows: 3, cols: 4, label: '3x4' },
		{ rows: 4, cols: 3, label: '4x3' },
		{ rows: 1, cols: 1, label: '1x1' }
	];

	interface Cell {
		row: number;
		col: number;
		skipped: boolean;
		status: 'pending' | 'processing' | 'done' | 'error' | 'empty';
		result: ScanResult | null;
		error: string | null;
	}

	let activePreset = $state(0);
	let grid = $state<Cell[]>([]);
	let imageFile = $state<File | null>(null);
	let imageUrl = $state('');
	let processing = $state(false);
	let committed = $state(false);
	let fileInput = $state<HTMLInputElement>(undefined!);
	let correctingIdx = $state<number | null>(null);
	let showCommitConfirm = $state(false);

	onDestroy(() => {
		if (imageUrl) URL.revokeObjectURL(imageUrl);
	});

	const preset = $derived(PRESETS[activePreset]);
	const totalCells = $derived(preset.rows * preset.cols);
	const activeCells = $derived(grid.filter((c) => !c.skipped));
	const doneCells = $derived(grid.filter((c) => c.status === 'done'));

	function initGrid() {
		grid = [];
		for (let r = 0; r < preset.rows; r++) {
			for (let c = 0; c < preset.cols; c++) {
				grid.push({
					row: r,
					col: c,
					skipped: false,
					status: 'pending',
					result: null,
					error: null
				});
			}
		}
	}

	function handleImageSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		imageFile = file;
		imageUrl = URL.createObjectURL(file);
		initGrid();
	}

	function toggleCell(index: number) {
		if (processing) return;
		const cell = grid[index];
		if (cell.status === 'done') {
			correctingIdx = index;
			return;
		}
		grid = grid.map((c, i) =>
			i === index ? { ...c, skipped: !c.skipped } : c
		);
	}

	async function processAllCells() {
		if (!imageFile) return;
		processing = true;

		const bitmap = await createImageBitmap(imageFile);
		try {
			const cellWidth = Math.floor(bitmap.width / preset.cols);
			const cellHeight = Math.floor(bitmap.height / preset.rows);

			// Process 2 cells concurrently
			const pending = grid.filter((c) => !c.skipped && c.status === 'pending');
			const concurrency = 2;

			// Helper: immutably update a cell in the grid by row+col identity
			function updateCell(cell: Cell, patch: Partial<Cell>) {
				grid = grid.map((c) =>
					c.row === cell.row && c.col === cell.col ? { ...c, ...patch } : c
				);
			}

			for (let i = 0; i < pending.length; i += concurrency) {
				const batch = pending.slice(i, i + concurrency);
				await Promise.all(
					batch.map(async (cell) => {
						updateCell(cell, { status: 'processing' });

						try {
							// Crop cell from image
							const canvas = new OffscreenCanvas(cellWidth, cellHeight);
							const ctx = canvas.getContext('2d')!;
							ctx.drawImage(
								bitmap,
								cell.col * cellWidth,
								cell.row * cellHeight,
								cellWidth,
								cellHeight,
								0,
								0,
								cellWidth,
								cellHeight
							);
							const cellBitmap = await createImageBitmap(canvas);

							let result;
							try {
								result = await recognizeCard(cellBitmap);
							} finally {
								cellBitmap.close();
							}
							if (result.card_id) {
								updateCell(cell, { result, status: 'done' });
							} else {
								updateCell(cell, { status: 'empty' });
							}
						} catch (err) {
							updateCell(cell, {
								error: err instanceof Error ? err.message : 'Failed',
								status: 'error'
							});
						}
					})
				);
			}
		} finally {
			bitmap.close();
		}
		processing = false;
	}

	function handleCellCorrection(idx: number, correctedCard: Partial<Card>) {
		if (correctedCard.id) {
			grid = grid.map((c, i) =>
				i === idx ? {
					...c,
					result: {
						card_id: correctedCard.id!,
						card: correctedCard as Card,
						scan_method: 'manual',
						confidence: 1,
						processing_ms: 0
					},
					status: 'done' as const,
					error: null
				} : c
			);
		}
		correctingIdx = null;
	}

	async function commitResults() {
		if (!isAuthenticated) {
			window.location.href = '/auth/login?redirectTo=/scan?mode=binder';
			return;
		}

		for (const cell of doneCells) {
			if (cell.result?.card_id) {
				try {
					await addToCollection(cell.result.card_id, 'near_mint');
				} catch (err) {
					console.warn('[BinderScanner] Failed to add card:', err);
				}
			}
		}
		committed = true;
	}

	onMount(() => {
		initGrid();
		return () => {
			if (imageUrl) URL.revokeObjectURL(imageUrl);
		};
	});
</script>

<div class="binder-scanner">
	<div class="binder-header">
		<h2>Binder Page Scanner</h2>
		<button class="close-btn" onclick={() => onClose?.()}>Close</button>
	</div>

	{#if !committed}
		<div class="preset-row">
			{#each PRESETS as p, i}
				<button
					class="preset-btn"
					class:active={activePreset === i}
					onclick={() => { activePreset = i; initGrid(); }}
				>
					{p.label}
				</button>
			{/each}
		</div>

		<div class="image-area">
			<input
				bind:this={fileInput}
				type="file"
				accept="image/*"
				onchange={handleImageSelect}
				style="display:none"
			/>

			{#if !imageFile}
				<button class="upload-btn" onclick={() => fileInput?.click()}>
					<span class="upload-icon">📸</span>
					<span>Take photo of binder page</span>
				</button>
			{:else}
				<div class="grid-container" style="--cols:{preset.cols};--rows:{preset.rows}">
					<img src={imageUrl} alt="Binder page" class="binder-image" />
					<div class="grid-overlay">
						{#each grid as cell, idx}
							<button
								class="grid-cell"
								class:skipped={cell.skipped}
								class:done={cell.status === 'done'}
								class:error={cell.status === 'error'}
								class:processing={cell.status === 'processing'}
								class:empty={cell.status === 'empty'}
								onclick={() => toggleCell(idx)}
							>
								{#if cell.status === 'done'}
									<span class="cell-badge done-badge">✓</span>
								{:else if cell.status === 'error'}
									<span class="cell-badge error-badge">✗</span>
								{:else if cell.status === 'processing'}
									<span class="cell-badge processing-badge">...</span>
								{:else if cell.skipped}
									<span class="cell-badge skip-badge">Skip</span>
								{:else if cell.status === 'empty'}
									<span class="cell-badge empty-badge">Empty</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>

				<div class="action-row">
					{#if !processing}
						<button class="btn-primary" onclick={processAllCells}>
							Scan {activeCells.length} Cells
						</button>
					{:else}
						<span class="processing-text">Processing...</span>
					{/if}

					{#if doneCells.length > 0 && !processing}
						<button class="btn-primary commit-btn" onclick={() => { showCommitConfirm = true; }}>
							Add {doneCells.length} to Collection
						</button>
					{/if}

					<button class="btn-secondary" onclick={() => fileInput?.click()}>
						New Photo
					</button>
				</div>
			{/if}
		</div>
		{#if correctingIdx !== null}
			{@const cell = grid[correctingIdx]}
			<div class="manual-search-container">
				<CardCorrection
					card={{ card_number: cell.result?.card?.card_number ?? '' }}
					onCorrect={(corrected) => handleCellCorrection(correctingIdx!, corrected)}
					onClose={() => { correctingIdx = null; }}
				/>
			</div>
		{/if}

		{#if showCommitConfirm}
			<div class="commit-confirm-overlay">
				<div class="commit-confirm-card">
					<h3>Add {doneCells.length} cards to your collection?</h3>
					<div class="commit-summary">
						{#each doneCells as cell}
							<div class="commit-item">
								<span class="commit-name">{cell.result?.card?.hero_name || cell.result?.card?.name || 'Unknown'}</span>
								<span class="commit-number">{cell.result?.card?.card_number || ''}</span>
							</div>
						{/each}
					</div>
					<div class="commit-actions">
						<button class="btn-primary" onclick={commitResults}>Confirm</button>
						<button class="btn-secondary" onclick={() => { showCommitConfirm = false; }}>Cancel</button>
					</div>
				</div>
			</div>
		{/if}
	{:else}
		<div class="commit-success">
			<p>Added {doneCells.length} cards to your collection!</p>
			<button class="btn-primary" onclick={() => onClose?.()}>Done</button>
		</div>
	{/if}
</div>

<style>
	.binder-scanner { padding: 1rem; }
	.binder-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	.binder-header h2 {
		font-family: 'Syne', sans-serif;
		font-weight: 700;
		font-size: 1.25rem;
	}
	.close-btn {
		background: none;
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		padding: 0.5rem 1rem;
		border-radius: 8px;
		cursor: pointer;
	}
	.preset-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.preset-btn {
		padding: 0.4rem 0.8rem;
		border-radius: 6px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 0.85rem;
	}
	.preset-btn.active {
		background: var(--accent-primary);
		color: white;
		border-color: var(--accent-primary);
	}
	.image-area { margin-top: 0.5rem; }
	.upload-btn {
		width: 100%;
		padding: 3rem;
		border: 2px dashed var(--border-color);
		border-radius: 12px;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}
	.upload-icon { font-size: 2rem; }
	.grid-container {
		position: relative;
		border-radius: 10px;
		overflow: hidden;
	}
	.binder-image {
		width: 100%;
		display: block;
	}
	.grid-overlay {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-columns: repeat(var(--cols), 1fr);
		grid-template-rows: repeat(var(--rows), 1fr);
		gap: 2px;
	}
	.grid-cell {
		border: 2px solid rgba(255, 255, 255, 0.3);
		background: transparent;
		cursor: pointer;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.grid-cell.skipped { background: rgba(239, 68, 68, 0.3); }
	.grid-cell.done { border-color: var(--success); background: rgba(16, 185, 129, 0.2); }
	.grid-cell.error { border-color: var(--danger); background: rgba(239, 68, 68, 0.2); }
	.grid-cell.processing { border-color: var(--accent-primary); }
	.grid-cell.empty { background: rgba(100, 116, 139, 0.2); }
	.cell-badge {
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 700;
		color: white;
		background: rgba(0, 0, 0, 0.6);
	}
	.action-row {
		display: flex;
		gap: 0.5rem;
		margin-top: 1rem;
		flex-wrap: wrap;
	}
	.commit-btn { background: var(--success) !important; }
	.processing-text {
		color: var(--accent-primary);
		font-weight: 600;
		padding: 0.625rem;
	}
	.commit-success {
		text-align: center;
		padding: 2rem;
	}
	.manual-search-container {
		margin-top: 1rem;
		padding: 1rem;
		border-radius: 10px;
		background: var(--bg-elevated, #111827);
		border: 1px solid var(--border-color);
	}
	.commit-confirm-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
		padding: 1rem;
	}
	.commit-confirm-card {
		background: var(--bg-elevated, #111827);
		border-radius: 16px;
		padding: 1.5rem;
		max-width: 400px;
		width: 100%;
		max-height: 70vh;
		overflow-y: auto;
	}
	.commit-confirm-card h3 {
		font-size: 1.1rem;
		font-weight: 700;
		margin-bottom: 1rem;
	}
	.commit-summary {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 1rem;
	}
	.commit-item {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
		padding: 0.25rem 0;
	}
	.commit-name { font-weight: 600; }
	.commit-number { color: var(--text-secondary); font-size: 0.8rem; }
	.commit-actions {
		display: flex;
		gap: 0.5rem;
	}
	.commit-actions button {
		flex: 1;
		padding: 0.75rem;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
	}
	.btn-secondary {
		background: transparent;
		border: 1px solid var(--border-color);
		color: var(--text-primary);
	}
</style>
