<script lang="ts">
	import type { GridSize } from '$lib/services/cell-extractor';
	import type { BinderSnapshot } from '$lib/services/binder-coordinator';

	let {
		gridSize = '3x3',
		snapshot = null,
		cameraReady,
		showFlash,
		scanning,
		cameraError,
		onAlignmentStateChanged
	}: {
		gridSize?: GridSize;
		snapshot?: BinderSnapshot | null;
		cameraReady: boolean;
		showFlash: boolean;
		scanning: boolean;
		cameraError: string | null;
		onAlignmentStateChanged?: (state: 'no_card' | 'partial' | 'ready') => void;
	} = $props();

	const rowCount = $derived(gridSize === '2x2' ? 2 : gridSize === '4x4' ? 4 : 3);
	const colCount = $derived(rowCount);
	const totalCells = $derived(rowCount * colCount);

	// Map (row,col) → cell snapshot for constant-time lookup.
	const cellMap = $derived.by(() => {
		const map = new Map<string, { isBlank: boolean; consensusReached: boolean; cyclesRun: number }>();
		if (snapshot) {
			for (const c of snapshot.cells) {
				map.set(`${c.row}_${c.col}`, {
					isBlank: c.isBlank,
					consensusReached: c.consensusReached,
					cyclesRun: c.cyclesRun
				});
			}
		}
		return map;
	});

	const cellsReady = $derived(snapshot?.cells.filter((c) => c.consensusReached).length ?? 0);
	const cellsNonBlank = $derived(
		snapshot?.cells.filter((c) => !c.isBlank).length ?? totalCells
	);

	// Binder mode assumes the user is already aligned once they've framed the
	// page. Emit 'ready' immediately when the camera is up so the coordinator
	// kicks off its cycle; emit 'no_card' when it's not. This skips the
	// partial-alignment state the single-card classifier uses.
	$effect(() => {
		if (cameraReady && !scanning) {
			onAlignmentStateChanged?.('ready');
		} else {
			onAlignmentStateChanged?.('no_card');
		}
	});

	function cellStatus(
		row: number,
		col: number
	): 'untouched' | 'processing' | 'ready' | 'blank' {
		const cell = cellMap.get(`${row}_${col}`);
		if (!cell) return 'untouched';
		if (cell.isBlank) return 'blank';
		if (cell.consensusReached) return 'ready';
		if (cell.cyclesRun > 0) return 'processing';
		return 'untouched';
	}
</script>

{#if showFlash}
	<div class="flash-overlay"></div>
{/if}

<div class="binder-viewfinder" style="--rows:{rowCount};--cols:{colCount}">
	<div class="binder-grid" aria-hidden="true">
		{#each Array(rowCount) as _, r}
			{#each Array(colCount) as _, c}
				{@const status = cellStatus(r, c)}
				<div class="binder-cell binder-cell-{status}">
					{#if status === 'blank'}
						<span class="cell-icon cell-icon-blank">⊘</span>
					{:else if status === 'ready'}
						<span class="cell-icon cell-icon-ready">✓</span>
					{:else if status === 'processing'}
						<span class="cell-icon cell-icon-processing"></span>
					{/if}
				</div>
			{/each}
		{/each}
	</div>

	{#if snapshot && !scanning && cameraReady}
		<div class="binder-readiness" aria-live="polite">
			{cellsReady} / {cellsNonBlank} ready
		</div>
	{/if}
</div>

{#if cameraError && !cameraReady}
	<div class="camera-error">
		<p class="camera-error-text">{cameraError}</p>
		<button class="camera-error-retry" onclick={() => location.reload()}>Retry</button>
	</div>
{/if}

<style>
	.binder-viewfinder {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 2;
	}

	.binder-grid {
		position: absolute;
		top: 5%;
		bottom: 5%;
		left: 5%;
		right: 5%;
		display: grid;
		grid-template-rows: repeat(var(--rows), 1fr);
		grid-template-columns: repeat(var(--cols), 1fr);
		gap: 4px;
	}

	.binder-cell {
		border: 2px solid rgba(255, 255, 255, 0.35);
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: border-color 200ms ease, background 200ms ease;
		background: rgba(0, 0, 0, 0.08);
	}

	.binder-cell-processing {
		border-color: rgba(59, 130, 246, 0.85);
		background: rgba(59, 130, 246, 0.1);
		animation: cell-processing-pulse 1.2s ease-in-out infinite;
	}

	.binder-cell-ready {
		border-color: rgba(34, 197, 94, 0.9);
		background: rgba(34, 197, 94, 0.12);
	}

	.binder-cell-blank {
		border-color: rgba(100, 116, 139, 0.5);
		border-style: dashed;
		background: rgba(15, 23, 42, 0.25);
	}

	.cell-icon {
		font-size: 1.4rem;
		font-weight: 700;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
	}
	.cell-icon-blank { color: rgba(148, 163, 184, 0.6); }
	.cell-icon-ready { color: rgb(134, 239, 172); }

	.cell-icon-processing {
		width: 16px;
		height: 16px;
		border: 2px solid rgba(147, 197, 253, 0.8);
		border-top-color: transparent;
		border-radius: 50%;
		animation: cell-spin 0.9s linear infinite;
	}

	@keyframes cell-spin {
		to { transform: rotate(360deg); }
	}

	@keyframes cell-processing-pulse {
		0%, 100% { box-shadow: 0 0 0 rgba(59, 130, 246, 0); }
		50% { box-shadow: 0 0 10px rgba(59, 130, 246, 0.35); }
	}

	.binder-readiness {
		position: absolute;
		top: calc(env(safe-area-inset-top, 0px) + 140px);
		left: 50%;
		transform: translateX(-50%);
		padding: 0.375rem 0.875rem;
		background: rgba(0, 0, 0, 0.55);
		border-radius: 16px;
		font-size: 0.8rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.9);
		z-index: 5;
	}

	.flash-overlay {
		position: absolute;
		inset: 0;
		background: white;
		z-index: 20;
		animation: flash-burst 0.15s ease-out forwards;
		pointer-events: none;
	}

	@keyframes flash-burst {
		0% { opacity: 0.8; }
		100% { opacity: 0; }
	}

	.camera-error {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 2rem;
		z-index: 10;
	}
	.camera-error-text {
		color: rgba(255, 255, 255, 0.85);
		font-size: 0.95rem;
		text-align: center;
		max-width: 300px;
		margin: 0;
		line-height: 1.5;
	}
	.camera-error-retry {
		padding: 0.5rem 1.5rem;
		background: var(--primary, #3b82f6);
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}

	@media (prefers-reduced-motion: reduce) {
		.binder-cell-processing { animation: none; }
		.cell-icon-processing { animation: none; }
	}
</style>
