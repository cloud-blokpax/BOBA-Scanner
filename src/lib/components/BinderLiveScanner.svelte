<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { captureFrame, startCamera, stopCamera } from '$lib/services/camera';
	import { binderCoordinator, type BinderSnapshot } from '$lib/services/binder-coordinator';
	import {
		finalizeBinderCapture,
		type FinalizedCell
	} from '$lib/services/binder-capture-finalize';
	import { persistBinderScan } from '$lib/services/binder-persistence';
	import {
		extractCellBitmap,
		estimateCellResolution,
		computeCellRegions,
		type GridSize
	} from '$lib/services/cell-extractor';
	import { recognizeCard } from '$lib/services/recognition';
	import { userId } from '$lib/stores/auth.svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import { triggerHaptic } from '$lib/utils/haptics';
	import { deriveMaxConcurrent } from '$lib/services/ocr-worker-pool';
	import BinderViewfinder from './BinderViewfinder.svelte';
	import BinderReview from './BinderReview.svelte';

	let {
		isAuthenticated = true,
		gameHint = null,
		onClose
	}: {
		isAuthenticated?: boolean;
		gameHint?: string | null;
		onClose?: () => void;
	} = $props();

	type Phase = 'initializing' | 'idle' | 'capturing' | 'processing' | 'review' | 'error';

	let videoEl = $state<HTMLVideoElement | null>(null);
	let phase = $state<Phase>('initializing');
	let cameraError = $state<string | null>(null);
	let showFlash = $state(false);

	let gridSize = $state<GridSize>(readSavedGridSize());
	let gridPickerOpen = $state(false);
	let snapshot = $state<BinderSnapshot | null>(null);
	let snapshotTimer: ReturnType<typeof setInterval> | null = null;

	// Latest downsampled frame fed to the binder coordinator.
	let latestVideoFrameBitmap: ImageBitmap | null = null;
	let frameSamplerTimer: ReturnType<typeof setInterval> | null = null;

	let finalizedCells = $state<FinalizedCell[]>([]);
	let parentFrameUrl = $state<string | null>(null);

	const game = $derived<'boba' | 'wonders'>(gameHint === 'wonders' ? 'wonders' : 'boba');

	const GRID_OPTIONS: Array<{ id: GridSize; label: string }> = [
		{ id: '2x2', label: '2×2' },
		{ id: '3x3', label: '3×3' },
		{ id: '4x4', label: '4×4' }
	];

	function readSavedGridSize(): GridSize {
		if (typeof localStorage === 'undefined') return '3x3';
		const saved = localStorage.getItem('binder_grid_size');
		if (saved === '2x2' || saved === '3x3' || saved === '4x4') return saved;
		return '3x3';
	}

	function saveGridSize(size: GridSize) {
		try {
			localStorage.setItem('binder_grid_size', size);
		} catch {
			// ignore
		}
	}

	function selectGrid(size: GridSize) {
		gridSize = size;
		saveGridSize(size);
		gridPickerOpen = false;

		// Warn if 4×4 on a low-res camera will push cells below validated OCR range.
		if (size === '4x4' && videoEl) {
			const w = videoEl.videoWidth || 0;
			const h = videoEl.videoHeight || 0;
			if (w > 0 && h > 0) {
				const est = estimateCellResolution(w, h, '4x4');
				if (est.longEdge < 600) {
					showToast(
						'4×4 grid may produce unreliable reads on this camera. Try 3×3 for best accuracy.',
						'!',
						3500
					);
				}
			}
		}

		// Reconfigure coordinator mid-session so the next cycle uses the new grid.
		binderCoordinator.configure({
			game,
			gridSize: size,
			getBitmap: () => latestVideoFrameBitmap
		});
		binderCoordinator.onAlignmentChanged('ready');
	}

	onMount(async () => {
		// Warm OCR infra.
		void (async () => {
			try {
				const [{ initPaddleOCR }, { warmCatalog }] = await Promise.all([
					import('$lib/services/paddle-ocr'),
					import('$lib/services/catalog-mirror')
				]);
				await Promise.allSettled([initPaddleOCR(), warmCatalog()]);
			} catch (err) {
				console.debug('[BinderLiveScanner] warm failed', err);
			}
		})();

		try {
			const stream = await startCamera();
			if (videoEl) {
				videoEl.srcObject = stream;
				await videoEl.play();
				phase = 'idle';
			}
		} catch (err) {
			console.error('[BinderLiveScanner] camera start failed', err);
			cameraError = 'Could not access camera. Check permissions and reload.';
			phase = 'error';
			return;
		}

		// Warn low-memory devices — the pool will already drop to 2 workers but
		// the user should know if scans feel sluggish.
		const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
		if (typeof mem === 'number' && mem < 3) {
			showToast(
				'Binder mode may run slowly on this device. Try single-card mode if scans feel sluggish.',
				'!',
				3500
			);
		}

		binderCoordinator.configure({
			game,
			gridSize,
			getBitmap: () => latestVideoFrameBitmap
		});

		// Sample downsampled frames at 2fps for the coordinator.
		frameSamplerTimer = setInterval(async () => {
			if (!videoEl || videoEl.paused || videoEl.readyState < 2) return;
			if (videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) return;
			try {
				// 720px long-edge is enough for per-cell OCR at 2-4× grid; bigger
				// just burns CPU on the coordinator cycle.
				const next = await createImageBitmap(videoEl, {
					resizeWidth: 720,
					resizeHeight: 1008,
					resizeQuality: 'medium'
				});
				if (latestVideoFrameBitmap) latestVideoFrameBitmap.close();
				latestVideoFrameBitmap = next;
			} catch {
				// transient decode errors are fine
			}
		}, 500);

		// Poll the coordinator snapshot at ~3fps so the viewfinder UI stays fresh.
		snapshotTimer = setInterval(() => {
			snapshot = binderCoordinator.snapshot();
		}, 333);

		// Pause on tab hide.
		document.addEventListener('visibilitychange', handleVisibility);
	});

	function handleVisibility() {
		if (document.visibilityState === 'hidden') {
			binderCoordinator.onVisibilityHidden();
		} else if (phase === 'idle') {
			binderCoordinator.onAlignmentChanged('ready');
		}
	}

	onDestroy(() => {
		document.removeEventListener('visibilitychange', handleVisibility);
		if (frameSamplerTimer) clearInterval(frameSamplerTimer);
		if (snapshotTimer) clearInterval(snapshotTimer);
		if (latestVideoFrameBitmap) latestVideoFrameBitmap.close();
		latestVideoFrameBitmap = null;
		binderCoordinator.reset();
		void stopCamera();
		if (parentFrameUrl?.startsWith('blob:')) URL.revokeObjectURL(parentFrameUrl);
	});

	function bitmapToDataUrl(bitmap: ImageBitmap): string {
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) return '';
		ctx.drawImage(bitmap, 0, 0);
		return canvas.toDataURL('image/jpeg', 0.85);
	}

	async function handleAlignmentChanged(state: 'no_card' | 'partial' | 'ready') {
		binderCoordinator.onAlignmentChanged(state);
	}

	async function handleCapture() {
		if (!videoEl || phase !== 'idle') return;

		phase = 'capturing';
		showFlash = true;
		setTimeout(() => {
			showFlash = false;
		}, 150);
		triggerHaptic('tap');

		let highResBitmap: ImageBitmap | null = null;
		try {
			videoEl.pause();
			highResBitmap = await captureFrame(videoEl);
			const liveSnapshot = binderCoordinator.snapshot();

			// Keep a display-quality data URL for the review grid thumbnails.
			const displayUrl = bitmapToDataUrl(highResBitmap);
			parentFrameUrl = displayUrl || null;

			phase = 'processing';

			const cellResults = await finalizeBinderCapture(
				highResBitmap,
				gridSize,
				game,
				liveSnapshot
			);

			// Route Haiku fallbacks through the existing recognition pipeline per
			// cell bitmap. `recognizeCard` transparently handles Tier 1/2/3 and
			// returns a human-readable parallel via cards.parallel.
			for (const cell of cellResults) {
				if (cell.fallbackTierUsed === 'haiku' && !cell.cardId) {
					try {
						// Use the same region math the canonical pass used at shutter,
						// so Haiku's cell bitmap is byte-identical to what canonical saw.
						const allRegions = computeCellRegions(
							highResBitmap.width,
							highResBitmap.height,
							gridSize
						);
						const region = allRegions.find(
							(r) => r.row === cell.row && r.col === cell.col
						);
						if (!region) {
							console.debug('[BinderLiveScanner] No region match for cell', cell.row, cell.col);
							continue;
						}
						const cellBitmap = await extractCellBitmap(highResBitmap, region);
						try {
							const haiku = await recognizeCard(cellBitmap, undefined, {
								isAuthenticated,
								skipBlurCheck: true,
								gameHint: gameHint ?? null
							});
							if (haiku.card_id && haiku.card) {
								cell.cardId = haiku.card_id;
								cell.cardNumber = haiku.card.card_number ?? cell.cardNumber;
								cell.name = haiku.card.hero_name ?? haiku.card.name ?? cell.name;
								cell.parallel =
									haiku.card.parallel ?? haiku.parallel ?? cell.parallel ?? 'Paper';
								cell.confidence = haiku.confidence;
								cell.decisionContext = {
									...cell.decisionContext,
									haiku_fallback: {
										scan_method: haiku.scan_method,
										confidence: haiku.confidence,
										winning_tier: haiku.winningTier ?? null
									}
								};
							}
						} finally {
							cellBitmap.close();
						}
					} catch (err) {
						console.debug('[BinderLiveScanner] Haiku fallback failed for cell', err);
					}
				}
			}

			// Persist — one parent + N children.
			const uid = userId();
			if (uid) {
				try {
					await persistBinderScan({
						userId: uid,
						gameId: game,
						gridSize,
						parentPhotoPath: null,
						cellResults
					});
				} catch (err) {
					// Regression guard asserts a short-code leak; surface it for
					// debugging but don't block the review UI.
					console.warn('[BinderLiveScanner] persistBinderScan failed', err);
				}
			}

			finalizedCells = cellResults;
			phase = 'review';
		} catch (err) {
			console.error('[BinderLiveScanner] capture failed', err);
			showToast('Capture failed — try again', 'x');
			phase = 'idle';
			if (videoEl) videoEl.play().catch(() => {});
		} finally {
			highResBitmap?.close();
		}
	}

	function handleReviewClose() {
		// Resume camera & state for another binder capture.
		finalizedCells = [];
		if (parentFrameUrl?.startsWith('blob:')) URL.revokeObjectURL(parentFrameUrl);
		parentFrameUrl = null;
		phase = 'idle';
		if (videoEl) videoEl.play().catch(() => {});
		binderCoordinator.onAlignmentChanged('ready');
	}

	const maxWorkers = $derived(deriveMaxConcurrent());
</script>

<div class="binder-scanner-shell">
	{#if phase === 'review'}
		<BinderReview
			{gridSize}
			cells={finalizedCells}
			{parentFrameUrl}
			{isAuthenticated}
			onClose={() => {
				handleReviewClose();
				onClose?.();
			}}
		/>
	{:else}
		<div class="viewfinder" style="flex:1">
			<video
				bind:this={videoEl}
				autoplay
				playsinline
				muted
				class="camera-feed"
				aria-label="Binder camera viewfinder"
			></video>

			<BinderViewfinder
				{gridSize}
				{snapshot}
				cameraReady={phase !== 'initializing' && phase !== 'error'}
				{showFlash}
				scanning={phase === 'capturing' || phase === 'processing'}
				{cameraError}
				onAlignmentStateChanged={handleAlignmentChanged}
			/>

			<!-- Grid size selector (top-center above the grid) -->
			<div class="grid-picker-wrapper">
				<button
					class="grid-pill"
					onclick={() => (gridPickerOpen = !gridPickerOpen)}
					aria-haspopup="listbox"
					aria-expanded={gridPickerOpen}
				>
					Grid: {gridSize.toUpperCase()}
					<span class="chevron">▾</span>
				</button>
				{#if gridPickerOpen}
					<div class="grid-options" role="listbox">
						{#each GRID_OPTIONS as opt}
							<button
								class="grid-option"
								class:active={gridSize === opt.id}
								onclick={() => selectGrid(opt.id)}
							>
								{opt.label}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Dev/debug hint: show worker count in console only; not visible to user. -->
			<div class="sr-only" aria-hidden="true">max workers {maxWorkers}</div>

			<!-- Shutter -->
			<div class="shutter-row">
				<button
					class="shutter-btn"
					class:busy={phase === 'capturing' || phase === 'processing'}
					onclick={handleCapture}
					disabled={phase !== 'idle'}
					aria-label="Capture binder page"
				>
					<div class="shutter-ring">
						{#if phase === 'processing'}
							<div class="shutter-spinner"></div>
						{/if}
					</div>
				</button>
			</div>

			{#if phase === 'processing'}
				<div class="status-banner">Processing cells…</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.binder-scanner-shell {
		display: flex;
		flex-direction: column;
		height: 100%;
		height: 100dvh;
		background: black;
	}

	.viewfinder {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.camera-feed {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.grid-picker-wrapper {
		position: absolute;
		top: calc(env(safe-area-inset-top, 0px) + 96px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
	}

	.grid-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 20px;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		color: rgba(255, 255, 255, 0.9);
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}
	.chevron { font-size: 0.7rem; opacity: 0.7; }

	.grid-options {
		position: absolute;
		top: calc(100% + 4px);
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 4px;
		padding: 4px;
		background: rgba(0, 0, 0, 0.85);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 10px;
	}
	.grid-option {
		padding: 6px 12px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.grid-option.active {
		background: rgba(59, 130, 246, 0.3);
		color: #fff;
	}

	.shutter-row {
		position: absolute;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 2rem);
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
	}

	.shutter-btn {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		border: 3px solid rgba(255, 255, 255, 0.9);
		background: transparent;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: transform 120ms ease;
	}
	.shutter-btn:active { transform: scale(0.95); }
	.shutter-btn:disabled { opacity: 0.5; cursor: default; }

	.shutter-ring {
		width: 54px;
		height: 54px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.9);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.shutter-spinner {
		width: 22px;
		height: 22px;
		border: 3px solid rgba(15, 23, 42, 0.25);
		border-top-color: rgb(15, 23, 42);
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	.status-banner {
		position: absolute;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 6.5rem);
		left: 50%;
		transform: translateX(-50%);
		padding: 0.4rem 0.9rem;
		background: rgba(0, 0, 0, 0.7);
		color: rgba(255, 255, 255, 0.9);
		border-radius: 14px;
		font-size: 0.8rem;
		font-weight: 500;
		z-index: 5;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
