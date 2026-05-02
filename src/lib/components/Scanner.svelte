<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { captureFrame } from '$lib/services/camera';
	import { useScannerCamera } from './scanner/use-scanner-camera.svelte';
	import { useScannerAnalysis } from './scanner/use-scanner-analysis.svelte';
	import { cropToCardRegion, cropFrame } from '$lib/services/card-cropper';
	import { cropToCanonical, type ViewfinderRect } from '$lib/services/constrained-crop';
	import { detectCard, type CardDetection } from '$lib/services/upload-card-detector';
	import { scanImage, scanState, resetScanner, startNewScan, isScanStale } from '$lib/stores/scanner.svelte';
	import { checkImageQuality, compositeForFoilMode } from '$lib/services/recognition';
	import { showToast } from '$lib/stores/toast.svelte';
	import { triggerHaptic } from '$lib/utils/haptics';
	import type { ScanResult, Card } from '$lib/types';

	import ScannerViewfinder from './scanner/ScannerViewfinder.svelte';
	import ScannerControls from './scanner/ScannerControls.svelte';
	import CameraBrackets from './scan/CameraBrackets.svelte';
	import QuadOverlay from './scanner/QuadOverlay.svelte';
	import CameraStatusPill from './scan/CameraStatusPill.svelte';
	import ScanEffects from './ScanEffects.svelte';

	let {
		onResult,
		isAuthenticated = true,
		paused = false,
		scanMode = 'single' as const,
		embedded = false,
		gameHint = null
	}: {
		onResult?: (result: ScanResult, capturedImageUrl?: string) => void;
		isAuthenticated?: boolean;
		paused?: boolean;
		scanMode?: 'single' | 'batch' | 'binder' | 'roll';
		embedded?: boolean;
		/** 'boba' | 'wonders' for explicit game mode; null for auto-detect */
		gameHint?: string | null;
	} = $props();

	// ── Scanner State Machine ───────────────────────────────
	type ScanPhase =
		| 'initializing'
		| 'idle'
		| 'detecting'
		| 'stabilizing'
		| 'capturing'
		| 'processing'
		| 'result_success'
		| 'result_fail'
		| 'foil_capturing'
		| 'error';

	let phase = $state<ScanPhase>('initializing');

	const scanning = $derived(phase === 'processing' || phase === 'capturing');
	const scanSuccess = $derived(phase === 'result_success');
	const cameraReady = $derived(!['initializing', 'error'].includes(phase));

	let videoEl = $state<HTMLVideoElement | null>(null);
	// Phase 2 Doc 2.2 — track displayed video size for the quad overlay's
	// SVG viewBox. Updated on resize / orientation change via ResizeObserver.
	let videoDisplayW = $state(0);
	let videoDisplayH = $state(0);

	$effect(() => {
		if (!videoEl) return;
		const ro = new ResizeObserver(() => {
			if (!videoEl) return;
			videoDisplayW = videoEl.clientWidth;
			videoDisplayH = videoEl.clientHeight;
		});
		ro.observe(videoEl);
		// Initial measurement
		videoDisplayW = videoEl.clientWidth;
		videoDisplayH = videoEl.clientHeight;
		return () => ro.disconnect();
	});

	// Reduced-motion preference — disables fade and pulse animations.
	const prefersReducedMotion = $derived.by(() => {
		if (typeof window === 'undefined' || !window.matchMedia) return false;
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	});
	// svelte-ignore state_referenced_locally
	const camera = useScannerCamera(embedded);
	let revealedCard = $state<Card | null>(null);
	let blurWarning = $state(false);
	let glareRegions = $state<Array<{ x: number; y: number; w: number; h: number }>>([]);

	// Latest downsampled video frame for the live OCR coordinator. Updated by
	// the analysis loop; distinct from the high-res capture bitmap used at
	// shutter. Owned here so we can close the last bitmap before replacing it.
	let latestVideoFrameBitmap: ImageBitmap | null = null;
	let frameSamplerTimer: ReturnType<typeof setInterval> | null = null;
	// Tracks the post-scan phase-reset timer scheduled in handleScanResult.
	// Captured here so a fast Try Again → re-scan can cancel a stale timer
	// before it overwrites the new scan's phase.
	let phaseResetTimer: ReturnType<typeof setTimeout> | null = null;
	function clearPhaseResetTimer() {
		if (phaseResetTimer !== null) {
			clearTimeout(phaseResetTimer);
			phaseResetTimer = null;
		}
	}

	let showFirstRunGuide = $state(false);

	let foilMode = $state(false);
	let foilCaptures = $state<ImageBitmap[]>([]);
	let foilStep = $state(0);
	const FOIL_CAPTURES_NEEDED = 3;
	let fileDialogOpen = $state(false);
	const FOIL_GUIDANCE = [
		'Capture 1/3 — hold card at current angle',
		'Capture 2/3 — tilt card slightly right',
		'Capture 3/3 — tilt card slightly left'
	];

	/**
	 * Resolve the visible viewfinder rect (the DOM `.scanner-guide-rect`)
	 * into source-video-pixel coordinates. The video element uses
	 * object-fit: cover, so the displayed viewport may crop the video —
	 * we unwind that transform here.
	 *
	 * Returns null until video metadata is loaded.
	 */
	function computeViewfinderInVideoCoords(): ViewfinderRect | null {
		if (!videoEl || videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) return null;
		const guideEl = videoEl.closest('.viewfinder')?.querySelector('.scanner-guide-rect') as HTMLElement | null;
		if (!guideEl) return null;
		const guideRect = guideEl.getBoundingClientRect();
		const videoRect = videoEl.getBoundingClientRect();
		if (guideRect.width < 10 || guideRect.height < 10) return null;

		// object-fit: cover — map CSS-pixel rect into video-pixel rect,
		// accounting for the letterboxing the cover fit introduces.
		const videoAspect = videoEl.videoWidth / videoEl.videoHeight;
		const elemAspect = videoRect.width / videoRect.height;
		let displayedWidth: number;
		let displayedHeight: number;
		let offsetX: number;
		let offsetY: number;
		if (videoAspect > elemAspect) {
			displayedHeight = videoRect.height;
			displayedWidth = videoRect.height * videoAspect;
			offsetX = (displayedWidth - videoRect.width) / 2;
			offsetY = 0;
		} else {
			displayedWidth = videoRect.width;
			displayedHeight = videoRect.width / videoAspect;
			offsetX = 0;
			offsetY = (displayedHeight - videoRect.height) / 2;
		}
		const scaleX = videoEl.videoWidth / displayedWidth;
		const scaleY = videoEl.videoHeight / displayedHeight;
		const relativeX = guideRect.left - videoRect.left + offsetX;
		const relativeY = guideRect.top - videoRect.top + offsetY;

		const x = Math.max(0, Math.round(relativeX * scaleX));
		const y = Math.max(0, Math.round(relativeY * scaleY));
		const width = Math.min(videoEl.videoWidth - x, Math.round(guideRect.width * scaleX));
		const height = Math.min(videoEl.videoHeight - y, Math.round(guideRect.height * scaleY));
		return { x, y, width, height };
	}

	// ── Auto-analyze composable ─────────────────────────────
	const analysis = useScannerAnalysis(
		() => videoEl,
		() => cameraReady && !scanning && !paused && !fileDialogOpen,
		async () => {
			if (scanning || paused || foilMode) return;
			await handleCapture();
		},
		() => computeViewfinderInVideoCoords()
	);

	// Three-state-plus-failure machine surfaced as bracket color + status pill text.
	// 'reading' covers both alignment-detected-but-not-yet-captured AND the
	// active capture/process window — the user just sees one continuous "we're
	// working on it" signal until the scan resolves.
	type CameraUIState = 'searching' | 'reading' | 'got_it' | 'try_again';
	const cameraState = $derived.by((): CameraUIState => {
		if (phase === 'result_success') return 'got_it';
		if (phase === 'result_fail') return 'try_again';
		if (phase === 'capturing' || phase === 'processing' || phase === 'foil_capturing') {
			return 'reading';
		}
		if (analysis.alignmentState === 'ready' || analysis.alignmentState === 'partial') {
			return 'reading';
		}
		return 'searching';
	});

	const resolvedCardName = $derived(
		revealedCard?.hero_name || revealedCard?.name || ''
	);

	function onCameraReady() {
		phase = 'idle';
		analysis.start();
	}

	let _cleanupVisibility: (() => void) | null = null;

	onMount(async () => {
		// Warm live-OCR infrastructure lazily so we never block the camera prompt.
		// PaddleOCR pulls ~15MB of ONNX; catalog mirror pulls a compact card list.
		void (async () => {
			try {
				const [{ initPaddleOCR }, { warmCatalog }] = await Promise.all([
					import('$lib/services/paddle-ocr'),
					import('$lib/services/catalog-mirror')
				]);
				await Promise.allSettled([initPaddleOCR(), warmCatalog()]);
			} catch (err) {
				console.debug('[Scanner] Live-OCR warm failed (non-fatal):', err);
			}
		})();

		if (videoEl) {
			try {
				await camera.initCamera(videoEl, onCameraReady);
			} catch {
				phase = 'error';
			}

			const { idb } = await import('$lib/services/idb');
			const hasScanned = await idb.getMeta<boolean>('has_completed_first_scan');
			if (!hasScanned) {
				showFirstRunGuide = true;
				setTimeout(() => {
					showFirstRunGuide = false;
					idb.setMeta('has_completed_first_scan', true);
				}, 3000);
			}
		}

		// Sample a downsampled live frame at 2fps so the live-OCR coordinator
		// always has a fresh bitmap to probe. Cheap — runs whether or not the
		// coordinator is active; the coordinator decides when to consume.
		frameSamplerTimer = setInterval(async () => {
			if (!videoEl || videoEl.paused || videoEl.readyState < 2) return;
			if (videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) return;
			try {
				const next = await createImageBitmap(videoEl, {
					resizeWidth: 500,
					resizeHeight: 700,
					resizeQuality: 'medium'
				});
				if (latestVideoFrameBitmap) latestVideoFrameBitmap.close();
				latestVideoFrameBitmap = next;
			} catch {
				// ignore — transient decode errors are fine
			}
		}, 500);

		_cleanupVisibility = camera.setupVisibilityHandler(
			videoEl!,
			() => {
				phase = 'idle';
				analysis.start();
			},
			() => {
				analysis.stop();
				// Stop live OCR when the tab hides so we don't burn OCR on a
				// backgrounded camera feed.
				import('$lib/services/live-ocr-coordinator').then(({ liveOCRCoordinator }) => {
					liveOCRCoordinator.onVisibilityHidden();
				});
			}
		);
	});

	function handleAlignmentStateChanged(state: 'no_card' | 'partial' | 'ready') {
		import('$lib/services/live-ocr-coordinator').then(({ liveOCRCoordinator }) => {
			liveOCRCoordinator.configure({
				// Auto-detect defaults the coordinator to 'boba'; explicit gameHint wins.
				game: gameHint === 'wonders' ? 'wonders' : 'boba',
				getBitmap: () => latestVideoFrameBitmap
			});
			liveOCRCoordinator.onAlignmentChanged(state);
		});
	}

	onDestroy(() => {
		if (frameSamplerTimer) {
			clearInterval(frameSamplerTimer);
			frameSamplerTimer = null;
		}
		if (latestVideoFrameBitmap) {
			latestVideoFrameBitmap.close();
			latestVideoFrameBitmap = null;
		}
		import('$lib/services/live-ocr-coordinator').then(({ liveOCRCoordinator }) => {
			liveOCRCoordinator.reset();
		});
	});

	$effect(() => {
		return () => {
			analysis.destroy();
			camera.destroy();
			resetScanner();
			foilCaptures.forEach(b => b.close());
			foilCaptures = [];
			_cleanupVisibility?.();
			clearPhaseResetTimer();
		};
	});

	function formatOverlayDate(isoDate: string): string {
		const date = new Date(isoDate);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		if (diffHours < 1) return 'just now';
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays === 1) return 'yesterday';
		if (diffDays < 7) return `${diffDays}d ago`;
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	let lastFailReason = $state<string | null>(null);

	function handleScanResult(result: ScanResult | null, imageUrl?: string) {
		if (videoEl && videoEl.paused) {
			videoEl.play().catch(() => {});
		}
		if (result?.card) {
			revealedCard = result.card;
			phase = 'result_success';
			lastFailReason = null;
			const r = result.card.rarity;
			if (r === 'legendary') triggerHaptic('legendary');
			else if (r === 'ultra_rare') triggerHaptic('ultraRare');
			else triggerHaptic('success');
			onResult?.(result, imageUrl);
			if (showFirstRunGuide) {
				showFirstRunGuide = false;
				import('$lib/services/idb').then(({ idb }) => {
					idb.setMeta('has_completed_first_scan', true);
				});
			}
			clearPhaseResetTimer();
			phaseResetTimer = setTimeout(() => {
				phase = 'idle';
				revealedCard = null;
				phaseResetTimer = null;
			}, 1800);
		} else {
			revealedCard = null;
			phase = 'result_fail';
			lastFailReason = result?.failReason || null;
			triggerHaptic('error');
			if (result) onResult?.(result, imageUrl);
			clearPhaseResetTimer();
			phaseResetTimer = setTimeout(() => {
				phase = 'idle';
				phaseResetTimer = null;
			}, 1200);
		}
	}

	function bitmapToDataUrl(bitmap: ImageBitmap): string {
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(bitmap, 0, 0);
		return canvas.toDataURL('image/jpeg', 0.85);
	}

	async function handleCapture() {
		if (!videoEl || scanning || paused) return;
		// Cancel any pending phase reset from a previous scan — without this,
		// a stale 'idle' set could land mid-'capturing'.
		clearPhaseResetTimer();
		phase = 'capturing';
		blurWarning = false;
		glareRegions = [];

		videoEl.pause();
		triggerHaptic('tap');

		// Snapshot the alignment state at the moment of shutter so downstream
		// telemetry can segment hit rate by capture quality.
		const alignmentAtCapture = analysis.alignmentState;

		let rawBitmap: ImageBitmap | null = null;
		let croppedBitmap: ImageBitmap | null = null;
		let liveCardDetection: CardDetection | null = null;
		try {
			rawBitmap = await captureFrame(videoEl);

			const quality = await checkImageQuality(rawBitmap);
			if (quality.isBlurry) {
				blurWarning = true;
				triggerHaptic('error');
				setTimeout(() => { blurWarning = false; }, 2000);
				phase = 'idle';
				// Resume the video stream — we paused it before quality check, and
				// without this the analysis loop keeps reading the frozen frame
				// and auto-firing on the same blurry image.
				if (videoEl && videoEl.paused) videoEl.play().catch(() => {});
				return;
			}
			if (quality.hasGlare) {
				glareRegions = quality.glareRegions;
				setTimeout(() => { glareRegions = []; }, 2000);
			}

			phase = 'processing';

			// Resolve the viewfinder region in source-pixel coords and crop to a
			// canonical 500×700 frame for Tier 1/2. Tier 3 still sees the full
			// bitmap via the recognition pipeline (Claude benefits from context).
			const viewfinder = computeViewfinderInVideoCoords();
			// Geometry rebuild (Doc 1): detect corners first; pass homography
			// through to cropToCanonical so the canonical is a true perspective
			// warp, not a viewfinder rectangle.
			liveCardDetection = await detectCard(rawBitmap, { mode: 'live' });
			croppedBitmap = await cropToCanonical(
				rawBitmap,
				viewfinder ?? {
					x: liveCardDetection.boundingRect.x,
					y: liveCardDetection.boundingRect.y,
					width: liveCardDetection.boundingRect.width,
					height: liveCardDetection.boundingRect.height
				},
				liveCardDetection.homography
			);

			// Keep a cropped data URL for the scan-history thumbnail — the
			// existing UI expects one and the cropped frame is prettier than
			// the raw wide-angle capture.
			let cropRegion: { x: number; y: number; width: number; height: number } | null = null;
			if (viewfinder) {
				cropRegion = viewfinder;
			} else {
				try {
					const guideEl = videoEl.closest('.viewfinder')?.querySelector('.scanner-guide-rect');
					if (guideEl) {
						const guideRect = guideEl.getBoundingClientRect();
						const videoRect = videoEl.getBoundingClientRect();
						if (guideRect.width >= 10 && guideRect.height >= 10) {
							cropRegion = cropToCardRegion(videoEl.videoWidth, videoEl.videoHeight, guideRect, videoRect);
						}
					}
				} catch { /* ignore */ }
			}
			const croppedUrl = cropRegion ? cropFrame(videoEl, cropRegion) : null;
			const imageUrl = croppedUrl ?? bitmapToDataUrl(rawBitmap);

			// Probe live-OCR coordinator for a pre-computed consensus. If the
			// current session has already reached threshold, the recognition
			// pipeline uses it as a hint; otherwise we run the full canonical
			// path from scratch.
			let preConsensus:
				| import('$lib/services/live-ocr-coordinator').LiveOCRSnapshot
				| null = null;
			try {
				const { liveOCRCoordinator } = await import('$lib/services/live-ocr-coordinator');
				const snap = liveOCRCoordinator.snapshot();
				if (snap.consensus?.reachedThreshold) preConsensus = snap;
			} catch {
				// Ignore — recognition falls through to canonical-only path.
			}

			const myGen = startNewScan();
			let scanResult;
			try {
				scanResult = await scanImage(croppedBitmap, {
					isAuthenticated,
					skipBlurCheck: true,
					cropRegion,
					gameHint,
					alignmentStateAtCapture: alignmentAtCapture,
					viewfinder: viewfinder ?? null,
					liveConsensusSnapshot: preConsensus,
					geometry: liveCardDetection
						? {
								detection_method: liveCardDetection.method,
								detection_layer: liveCardDetection.detection_layer ?? null,
								px_per_mm_at_capture: liveCardDetection.pxPerMm,
								aspect_ratio_at_capture: liveCardDetection.aspectRatio,
								rectification_applied: !!liveCardDetection.homography,
								canonical_size: '750x1050',
								detected_corners: liveCardDetection.corners
							}
						: null
				}, myGen);
			} finally {
				// scanImage took ownership of croppedBitmap; null the local
				// reference so the finally block below doesn't double-close.
				croppedBitmap = null;
			}
			if (isScanStale(myGen)) {
				console.debug('[Scanner] Discarding stale scan result (Try Again superseded this run)');
				return;
			}
			if (scanResult) {
				handleScanResult(scanResult, imageUrl);
			} else {
				const errorMsg = scanState().error || 'Scan failed unexpectedly';
				handleScanResult({ card_id: null, card: null, scan_method: 'claude', confidence: 0, processing_ms: 0, failReason: errorMsg }, imageUrl);
			}
		} catch (err) {
			console.error('[Scanner] handleCapture error:', err);
			handleScanResult({ card_id: null, card: null, scan_method: 'claude', confidence: 0, processing_ms: 0, failReason: 'Scanner error — please try again' });
		} finally {
			rawBitmap?.close();
			croppedBitmap?.close();
		}
	}

	async function handleShutterTap() {
		if (analysis.alignmentState !== 'ready') {
			showToast('Align card with frame for best results', '📸', 2000);
		}
		await handleCapture();
	}

	async function handleFoilCapture() {
		if (!videoEl || scanning) return;
		phase = 'foil_capturing';
		const bitmap = await captureFrame(videoEl);
		foilCaptures = [...foilCaptures, bitmap];
		foilStep = foilCaptures.length;
		triggerHaptic('tap');

		if (foilCaptures.length >= FOIL_CAPTURES_NEEDED) {
			phase = 'processing';
			try {
				const composite = await compositeForFoilMode(foilCaptures);
				foilCaptures.forEach(b => b.close());
				foilCaptures = [];
				foilStep = 0;

				const imageUrl = bitmapToDataUrl(composite);
				const scanResult = await scanImage(composite, { isAuthenticated, skipBlurCheck: true, gameHint });
				composite.close();
				if (scanResult) {
					handleScanResult(scanResult, imageUrl);
				} else {
					const errorMsg = scanState().error || 'Scan failed unexpectedly';
					handleScanResult({ card_id: null, card: null, scan_method: 'claude', confidence: 0, processing_ms: 0, failReason: errorMsg }, imageUrl);
				}
			} catch (err) {
				console.error('[Scanner] handleFoilCapture error:', err);
				foilCaptures.forEach(b => b.close());
				foilCaptures = [];
				foilStep = 0;
				handleScanResult({ card_id: null, card: null, scan_method: 'claude', confidence: 0, processing_ms: 0, failReason: 'Foil scan error — please try again' });
			}
		} else {
			phase = 'idle';
		}
	}

	async function handleTorchToggle() {
		triggerHaptic('tap');
		await camera.handleTorchToggle();
	}

	async function handleFileUpload(event: Event) {
		fileDialogOpen = false;
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		phase = 'processing';

		try {
			const imageUrl = URL.createObjectURL(file);
			const result = await scanImage(file, { isAuthenticated, gameHint });
			if (result) {
				handleScanResult(result, imageUrl);
			} else {
				const errorMsg = scanState().error || 'Scan failed unexpectedly';
				handleScanResult({ card_id: null, card: null, scan_method: 'claude', confidence: 0, processing_ms: 0, failReason: errorMsg }, imageUrl);
			}
		} catch (err) {
			console.error('[Scanner] handleFileUpload error:', err);
			handleScanResult({ card_id: null, card: null, scan_method: 'claude', confidence: 0, processing_ms: 0, failReason: 'Failed to process image — try a different photo' });
		} finally {
			input.value = '';
		}
	}

	function handleFoilToggle() {
		foilMode = !foilMode;
		foilCaptures.forEach(b => b.close());
		foilCaptures = [];
		foilStep = 0;
	}
</script>

<div class="scanner" class:scanner-embedded={embedded}>
	<div class="viewfinder" style="flex:1">
		<video
			bind:this={videoEl}
			autoplay
			playsinline
			muted
			class="camera-feed"
			aria-label="Camera viewfinder"
		></video>

		<!-- Phase 2 Doc 2.2 — AR live-quad overlay. Renders the detected
		     card outline that follows the card in real-time. Sits below
		     CameraBrackets so the bracket target remains the dominant
		     visual; the quad is a confirmation that the system has the
		     card in sight. -->
		<QuadOverlay
			corners={analysis.quad.cssCorners}
			quadState={analysis.quad.quadState}
			viewportW={videoDisplayW}
			viewportH={videoDisplayH}
			reducedMotion={prefersReducedMotion}
		/>

		<!-- Single 5:7 bracket frame. Doubles as `.scanner-guide-rect` for crop math. -->
		<CameraBrackets state={cameraState} />

		<!-- Camera primitives: blur warning, glare regions, foil guidance, camera error, flash. -->
		<ScannerViewfinder
			alignmentState={analysis.alignmentState}
			{cameraReady}
			showFlash={analysis.showFlash}
			{blurWarning}
			{glareRegions}
			{scanning}
			{foilMode}
			{foilStep}
			foilCapturesNeeded={FOIL_CAPTURES_NEEDED}
			foilGuidance={FOIL_GUIDANCE}
			cameraError={camera.cameraError}
			onAlignmentStateChanged={handleAlignmentStateChanged}
		/>

		<!-- Particle reveal — runs during scan and on success, rarity-coded. -->
		<ScanEffects
			scanning={scanning}
			revealed={scanSuccess}
			rarity={revealedCard?.rarity ?? null}
			weaponType={revealedCard?.weapon_type ?? null}
		/>

		<!-- AR Price Overlay -->
		{#if analysis.overlayVisible && analysis.overlayData && !scanning && !paused}
			<div class="ar-price-overlay">
				<div class="ar-price-badge">
					<span class="ar-price-name">{analysis.overlayData.cardName}</span>
					{#if analysis.overlayData.cardNumber}
						<span class="ar-price-number">{analysis.overlayData.cardNumber}</span>
					{/if}
					{#if analysis.overlayData.price !== null}
						<span class="ar-price-value">${analysis.overlayData.price.toFixed(2)}</span>
						{#if analysis.overlayData.priceFetchedAt}
							<span class="ar-price-date">
								Last recorded eBay price &middot; {formatOverlayDate(analysis.overlayData.priceFetchedAt)}
							</span>
						{/if}
					{:else}
						<span class="ar-price-nodata">No price data</span>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Torch toggle -->
		{#if cameraReady}
			<button
				class="torch-btn"
				class:torch-on={camera.torchOn}
				onclick={handleTorchToggle}
				aria-label={camera.torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
			>
				⚡
			</button>
		{/if}

		<!-- Single state-driven pill replaces the persistent "Point at card" toast. -->
		{#if !foilMode && cameraReady}
			<CameraStatusPill state={cameraState} cardName={resolvedCardName} />
		{/if}

		{#if showFirstRunGuide && cameraReady}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="first-run-overlay" onclick={() => { showFirstRunGuide = false; }}>
				<div class="first-run-card-outline"></div>
				<div class="first-run-text">
					<p class="first-run-title">Center your card</p>
					<p class="first-run-subtitle">Hold still — we'll capture automatically</p>
				</div>
			</div>
		{/if}

		{#if camera.showExplainer}
			<div class="permission-explainer">
				<div class="permission-explainer-content">
					<div class="permission-icon">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
							<circle cx="12" cy="13" r="4" />
						</svg>
					</div>
					<h3 class="permission-title">Camera Access Needed</h3>
					<p class="permission-desc">Card Scanner uses your camera to identify cards instantly. We never store photos without your permission.</p>
					<button class="permission-continue" onclick={() => { if (videoEl) camera.acceptExplainer(videoEl, onCameraReady).catch(() => { phase = 'error'; }); }}>
						Continue to Scan
					</button>
					<p class="permission-tip">
						Tip: When your browser asks, tap <strong>Allow</strong> to avoid being asked again.
					</p>
				</div>
			</div>
		{/if}

		<ScannerControls
			torchOn={camera.torchOn}
			{foilMode}
			{cameraReady}
			{scanning}
			alignmentReady={analysis.alignmentState === 'ready'}
			onTorchToggle={handleTorchToggle}
			onCapture={handleShutterTap}
			onFoilCapture={handleFoilCapture}
			onFoilToggle={handleFoilToggle}
			onFileUpload={handleFileUpload}
			onFileDialogOpen={() => {
				fileDialogOpen = true;
				analysis.resetStability();
			}}
			onFileDialogClose={() => { fileDialogOpen = false; }}
		/>
	</div>
</div>

<style>
	.scanner {
		display: flex;
		flex-direction: column;
		height: 100%;
		height: 100dvh;
		background: black;
	}

	.scanner.scanner-embedded {
		height: 100%;
		min-height: 280px;
		max-height: 100%;
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

	.torch-btn {
		position: absolute;
		top: calc(env(safe-area-inset-top, 0px) + 12px);
		right: 12px;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.3);
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		color: rgba(255, 255, 255, 0.8);
		font-size: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		z-index: 6;
		transition: background 0.2s, border-color 0.2s;
	}

	.torch-btn.torch-on {
		background: rgba(245, 158, 11, 0.2);
		border-color: rgba(245, 158, 11, 0.5);
		color: #f59e0b;
	}

	.ar-price-overlay {
		position: absolute;
		bottom: 20%;
		left: 50%;
		transform: translateX(-50%);
		z-index: 8;
		pointer-events: none;
		animation: arFadeIn 0.3s ease-out;
	}

	.ar-price-badge {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		padding: 10px 20px 8px;
		background: rgba(0, 0, 0, 0.8);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-radius: 14px;
		border: 1px solid rgba(16, 185, 129, 0.3);
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
		min-width: 140px;
	}

	.ar-price-name {
		font-size: 0.8rem;
		font-weight: 700;
		color: rgba(255, 255, 255, 0.9);
		max-width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ar-price-number {
		font-size: 0.65rem;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.45);
		font-family: monospace;
		letter-spacing: 0.03em;
	}

	.ar-price-value {
		font-size: 1.6rem;
		font-weight: 800;
		color: #10b981;
		margin-top: 2px;
		line-height: 1;
	}

	.ar-price-date {
		font-size: 0.6rem;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.35);
		margin-top: 3px;
		white-space: nowrap;
	}

	.ar-price-nodata {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.4);
		margin-top: 2px;
	}

	@keyframes arFadeIn {
		from { opacity: 0; transform: translateX(-50%) translateY(8px); }
		to { opacity: 1; transform: translateX(-50%) translateY(0); }
	}

	.permission-explainer {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.85);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 20;
		padding: 2rem;
	}

	.permission-explainer-content {
		text-align: center;
		max-width: 320px;
	}

	.permission-icon {
		color: var(--gold, #f59e0b);
		margin-bottom: 1rem;
	}

	.permission-title {
		font-size: 1.25rem;
		font-weight: 700;
		color: white;
		margin: 0 0 0.75rem;
	}

	.permission-desc {
		font-size: 0.9rem;
		color: rgba(255, 255, 255, 0.7);
		line-height: 1.5;
		margin: 0 0 1.5rem;
	}

	.permission-continue {
		width: 100%;
		padding: 0.875rem;
		border-radius: 12px;
		border: none;
		background: var(--primary, #3b82f6);
		color: white;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		margin-bottom: 1rem;
	}

	.permission-continue:active {
		opacity: 0.85;
	}

	.permission-tip {
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.5);
		margin: 0;
		line-height: 1.4;
	}

	.permission-tip strong {
		color: rgba(255, 255, 255, 0.8);
	}

	.first-run-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		z-index: 10;
		cursor: pointer;
	}

	.first-run-card-outline {
		width: 60%;
		aspect-ratio: 2.5/3.5;
		border: 2px dashed rgba(245, 158, 11, 0.6);
		border-radius: 12px;
		pointer-events: none;
	}

	.first-run-text {
		text-align: center;
		margin-top: 1.5rem;
		pointer-events: none;
	}

	.first-run-title {
		font-size: 1.2rem;
		font-weight: 700;
		color: white;
	}

	.first-run-subtitle {
		font-size: 0.9rem;
		color: rgba(255, 255, 255, 0.7);
		margin-top: 0.25rem;
	}
</style>
