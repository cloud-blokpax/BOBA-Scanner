<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { startCamera, stopCamera, toggleTorch, captureFrame, checkCameraPermission, getActiveStream } from '$lib/services/camera';
	import { cropToCardRegion, cropFrame } from '$lib/services/card-cropper';
	import { scanImage, scanState, resetScanner } from '$lib/stores/scanner.svelte';
	import { checkImageQuality, analyzeFrame, compositeForFoilMode, computeFrameHash, computeHammingDistance, isFuzzyHashRpcDisabled, disableFuzzyHashRpc } from '$lib/services/recognition';
	import { triggerHaptic } from '$lib/utils/haptics';
	import type { ScanResult, Card } from '$lib/types';

	import ScannerViewfinder from './scanner/ScannerViewfinder.svelte';
	import ScannerControls from './scanner/ScannerControls.svelte';
	import ScannerStatus from './scanner/ScannerStatus.svelte';

	let {
		onResult,
		isAuthenticated = true,
		paused = false,
		scanMode = 'single' as const,
		embedded = false
	}: {
		onResult?: (result: ScanResult, capturedImageUrl?: string) => void;
		isAuthenticated?: boolean;
		paused?: boolean;
		scanMode?: 'single' | 'batch' | 'binder' | 'roll';
		/** When true, scanner fits its parent container instead of taking 100dvh */
		embedded?: boolean;
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
	const scanFailed = $derived(phase === 'result_fail');
	const cameraReady = $derived(!['initializing', 'error'].includes(phase));

	let videoEl = $state<HTMLVideoElement | null>(null);
	let torchOn = $state(false);
	let revealedCard = $state<Card | null>(null);
	let blurWarning = $state(false);
	let glareRegions = $state<Array<{ x: number; y: number; w: number; h: number }>>([]);
	let bracketState = $state<'idle' | 'detected' | 'locked'>('idle');
	let showFlash = $state(false);
	let autoAnalyzeInterval: ReturnType<typeof setInterval> | null = null;
	let cardDetectedSince = $state<number | null>(null);
	let cameraError = $state<string | null>(null);
	let guidanceText = $state<string | null>(null);
	let guidanceLastChanged = $state(0);
	const GUIDANCE_COOLDOWN = 1500;

	// Frame stability detection
	let lastFrameHash = $state<string | null>(null);
	let stableFrameCount = $state(0);
	const STABLE_FRAMES_REQUIRED = 3; // Reduced from 4 — mobile phones can't hold perfectly still for 1s
	const STABILITY_THRESHOLD = 5;    // Increased from 3 — allow more micro-jitter between frames

	let _visibilityHandler: (() => void) | null = null;

	// AR Price Overlay state
	let overlayData = $state<{
		cardName: string;
		cardNumber: string | null;
		price: number | null;
		priceFetchedAt: string | null;
		source: 'local' | 'community';
	} | null>(null);
	let overlayVisible = $state(false);
	let _overlayTimeout: ReturnType<typeof setTimeout> | null = null;
	let _overlayLookupInProgress = false;
	let _lastOverlayHash: string | null = null;

	let showFirstRunGuide = $state(false);
	let showCameraExplainer = $state(false);
	let showPermissionBlocked = $state(false);

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

	// Rarity → color mapping for bracket effects
	const RARITY_COLORS: Record<string, { color: string; glow: number; pulses: number }> = {
		common:     { color: '#9CA3AF', glow: 8,  pulses: 1 },
		uncommon:   { color: '#22C55E', glow: 12, pulses: 1 },
		rare:       { color: '#3B82F6', glow: 16, pulses: 1 },
		ultra_rare: { color: '#A855F7', glow: 20, pulses: 2 },
		legendary:  { color: '#F59E0B', glow: 28, pulses: 3 }
	};

	const stabilityProgress = $derived(stableFrameCount / STABLE_FRAMES_REQUIRED);
	const revealColor = $derived(RARITY_COLORS[revealedCard?.rarity ?? ''] ?? null);
	const bracketAnimClass = $derived.by(() => {
		if (!scanSuccess || !revealColor) return '';
		if (revealColor.pulses === 3) return 'bracket-reveal-triple';
		if (revealColor.pulses === 2) return 'bracket-reveal-double';
		return 'bracket-reveal';
	});

	const statusText = $derived.by(() => {
		const state = scanState();
		switch (state.status) {
			case 'tier1': return 'Checking cache...';
			case 'tier2': return 'Running OCR...';
			case 'tier3': return 'AI identifying...';
			case 'processing': return 'Processing...';
			case 'complete':
				if (!state.result?.card && state.result?.failReason) return state.result.failReason;
				if (!state.result?.card) return 'Card not recognized';
				return 'Card found!';
			case 'error': return state.error || 'Scan failed — try again';
			default: return 'Point camera at card';
		}
	});

	const statusType = $derived.by(() => {
		const state = scanState();
		if (state.status === 'complete' && state.result?.card) return 'success';
		if (state.status === 'complete' && !state.result?.card) return 'error';
		if (state.status === 'error') return 'error';
		if (['tier1', 'tier2', 'tier3', 'processing', 'capturing'].includes(state.status)) return 'scanning';
		return 'idle';
	});

	async function initCamera() {
		try {
			// Reuse existing active stream if available (avoids re-prompt on iOS)
			const existing = getActiveStream();
			let stream: MediaStream;
			if (existing) {
				stream = existing;
			} else {
				stream = await startCamera();
			}
			if (videoEl) {
				videoEl.srcObject = stream;
				await videoEl.play();
				phase = 'idle';
				startAutoAnalyze();

				// First-run check — show briefly then auto-dismiss
				const { idb } = await import('$lib/services/idb');
				const hasScanned = await idb.getMeta<boolean>('has_completed_first_scan');
				if (!hasScanned) {
					showFirstRunGuide = true;
					// Auto-dismiss after 3 seconds so it doesn't block the scanner
					setTimeout(() => {
						showFirstRunGuide = false;
						// Mark as seen so it doesn't show again
						idb.setMeta('has_completed_first_scan', true);
					}, 3000);
				}
			}
		} catch (err) {
			console.error('Camera error:', err);
			phase = 'error';
			if (err instanceof DOMException) {
				if (err.name === 'NotAllowedError') {
					showPermissionBlocked = true;
					cameraError = 'Camera access was denied. Please enable camera permissions in your browser settings and reload.';
				} else if (err.name === 'NotFoundError') {
					cameraError = 'No camera found on this device. Try uploading a photo instead.';
				} else if (err.name === 'NotReadableError') {
					cameraError = 'Camera is in use by another app. Close other apps and try again.';
				} else {
					cameraError = 'Could not access camera. Make sure you are using HTTPS.';
				}
			} else {
				cameraError = 'Camera failed to start. Please reload the page.';
			}
		}
	}

	onMount(async () => {
		// Check permission state before prompting
		const permission = await checkCameraPermission();

		if (permission === 'granted' || embedded) {
			// Already granted, or embedded mode (skip explainer) — go straight to camera
			await initCamera();
		} else if (permission === 'denied') {
			// Blocked — show help to re-enable
			phase = 'error';
			showPermissionBlocked = true;
			cameraError = 'Camera access was denied. Please enable camera permissions in your browser settings and reload.';
		} else {
			// First time or unknown — show pre-prompt explainer
			showCameraExplainer = true;
		}

		_visibilityHandler = () => {
			if (document.visibilityState === 'hidden') {
				// Don't stop the camera — just pause analysis.
				// Stopping the stream on iOS kills the permission grant,
				// causing a re-prompt when the user returns.
				stopAutoAnalyze();
				torchOn = false;
			} else if (document.visibilityState === 'visible' && phase !== 'error') {
				// Stream should still be alive — just restart analysis.
				// If the stream died (rare), re-acquire it.
				const existing = getActiveStream();
				if (existing && videoEl) {
					videoEl.srcObject = existing;
					videoEl.play().then(() => {
						phase = 'idle';
						startAutoAnalyze();
					}).catch(() => {
						// Stream died, re-acquire
						initCamera();
					});
				} else {
					initCamera();
				}
			}
		};
		document.addEventListener('visibilitychange', _visibilityHandler);
	});

	onDestroy(() => {
		stopAutoAnalyze();
		stopCamera();
		resetScanner();
		// Release any in-progress foil capture bitmaps (GPU memory)
		foilCaptures.forEach(b => b.close());
		foilCaptures = [];
		if (_overlayTimeout) {
			clearTimeout(_overlayTimeout);
			_overlayTimeout = null;
		}
		if (_visibilityHandler) {
			document.removeEventListener('visibilitychange', _visibilityHandler);
		}
	});

	function startAutoAnalyze() {
		if (autoAnalyzeInterval) return;
		autoAnalyzeInterval = setInterval(runAutoAnalyze, 250);
	}

	function stopAutoAnalyze() {
		if (autoAnalyzeInterval) {
			clearInterval(autoAnalyzeInterval);
			autoAnalyzeInterval = null;
		}
	}

	function updateGuidance(text: string | null) {
		const now = Date.now();
		if (now - guidanceLastChanged < GUIDANCE_COOLDOWN && guidanceText !== null) return;
		guidanceText = text;
		guidanceLastChanged = now;
	}

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

	async function lookupOverlayPrice(hash: string) {
		if (hash === _lastOverlayHash || _overlayLookupInProgress) return;
		_lastOverlayHash = hash;
		_overlayLookupInProgress = true;

		try {
			const { idb } = await import('$lib/services/idb');
			const { getCardById, loadCardDatabase } = await import('$lib/services/card-db');

			// Ensure card DB is loaded before attempting lookup — on cold start
			// the idIndex is empty and getCardById will always return undefined
			await loadCardDatabase();

			// Step 1: Local IndexedDB hash lookup
			let cardId: string | null = null;
			let source: 'local' | 'community' = 'local';

			const localEntry = await idb.getHash(hash) as { card_id: string; confidence: number } | undefined;
			if (localEntry && !localEntry.card_id.startsWith('__unrecognized:')) {
				cardId = localEntry.card_id;
				source = 'local';
			}

			// Step 2: Supabase shared hash lookup (only on local miss + online)
			if (!cardId && navigator.onLine) {
				try {
					const { getSupabase } = await import('$lib/services/supabase');
					const client = getSupabase();
					if (client) {
						// Exact match first
						const { data: exactMatch } = await client
							.from('hash_cache')
							.select('card_id, confidence')
							.eq('phash', hash)
							.maybeSingle();

						if (exactMatch && !(exactMatch.card_id as string).startsWith('__unrecognized:')) {
							cardId = exactMatch.card_id as string;
							source = 'community';
							await idb.setHash({
								phash: hash,
								card_id: exactMatch.card_id as string,
								confidence: exactMatch.confidence as number
							});
						}

						// Fuzzy match if exact missed
						if (!cardId && !isFuzzyHashRpcDisabled() && /^[0-9a-f]{16}$/.test(hash)) {
							const { data: fuzzyMatch, error: fuzzyErr } = await client.rpc('find_similar_hash', {
								query_hash: hash,
								max_distance: 5
							});
							if (fuzzyErr) {
								disableFuzzyHashRpc();
							}

							if (fuzzyMatch && (fuzzyMatch as Array<{ card_id: string; confidence: number; distance: number }>).length > 0) {
								const match = (fuzzyMatch as Array<{ card_id: string; confidence: number; distance: number }>)[0];
								if (!match.card_id.startsWith('__unrecognized:')) {
									cardId = match.card_id;
									source = 'community';
									const confidence = match.confidence * (1 - match.distance * 0.015);
									await idb.setHash({
										phash: hash,
										card_id: match.card_id,
										confidence
									});
								}
							}
						}
					}
				} catch (err) {
					console.debug('[ar-overlay] Supabase hash lookup failed:', err);
				}
			}

			if (!cardId) {
				overlayData = null;
				overlayVisible = false;
				return;
			}

			const card = getCardById(cardId);
			if (!card) {
				overlayData = null;
				overlayVisible = false;
				return;
			}

			// Step 3: Get price — local first, then Supabase
			let price: number | null = null;
			let priceFetchedAt: string | null = null;

			// Relax TTL to 7 days for overlay — stale price > no price
			const OVERLAY_PRICE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
			const localPrice = await idb.getPrice(cardId, OVERLAY_PRICE_MAX_AGE) as Record<string, unknown> | undefined;
			if (localPrice) {
				price = (localPrice.buy_now_low as number) ?? (localPrice.price_low as number) ?? (localPrice.price_mid as number) ?? null;
				priceFetchedAt = (localPrice.fetched_at as string) ?? null;
			}

			// Supabase price_cache if local miss and online
			if (price === null && navigator.onLine) {
				try {
					const { getSupabase } = await import('$lib/services/supabase');
					const client = getSupabase();
					if (client) {
						const { data: cachedPrice } = await client
							.from('price_cache')
							.select('price_low, price_mid, price_high, fetched_at, listings_count')
							.eq('card_id', cardId)
							.eq('source', 'ebay')
							.maybeSingle();

						if (cachedPrice) {
							const cp = cachedPrice as Record<string, unknown>;
							price = (cp.buy_now_low as number) ?? (cp.price_low as number) ?? (cp.price_mid as number) ?? null;
							priceFetchedAt = (cp.fetched_at as string) ?? null;
							await idb.setPrice({ card_id: cardId, ...cachedPrice });
						}
					}
				} catch (err) {
					console.debug('[ar-overlay] Supabase price lookup failed:', err);
				}
			}

			// Show the overlay
			overlayData = {
				cardName: card.hero_name || card.name || 'Unknown',
				cardNumber: card.card_number || null,
				price,
				priceFetchedAt,
				source
			};
			overlayVisible = true;

			if (_overlayTimeout) clearTimeout(_overlayTimeout);
			_overlayTimeout = setTimeout(() => {
				overlayVisible = false;
			}, 4000);
		} catch (err) {
			console.debug('[ar-overlay] Lookup failed:', err);
		} finally {
			_overlayLookupInProgress = false;
		}
	}

	async function runAutoAnalyze() {
		if (!videoEl || !cameraReady || scanning || paused || fileDialogOpen) {
			bracketState = 'idle';
			cardDetectedSince = null;
			stableFrameCount = 0;
			lastFrameHash = null;
			return;
		}

		let bitmap: ImageBitmap | null = null;
		try {
			bitmap = await captureFrame(videoEl);
			const result = await analyzeFrame(bitmap);

			if (result.cardDetected && result.isSharp) {
				const frameHash = await computeFrameHash(bitmap);
				bitmap.close();
				bitmap = null;

				if (lastFrameHash) {
					const dist = await computeHammingDistance(lastFrameHash, frameHash);
					if (dist <= STABILITY_THRESHOLD) {
						stableFrameCount++;
					} else {
						stableFrameCount = 1;
					}
				} else {
					stableFrameCount = 1;
				}
				lastFrameHash = frameHash;

				// AR Price Overlay: attempt lookup on first stable frame
				// to give Supabase round-trip time before auto-capture at frame 4
				if (stableFrameCount === 1) {
					lookupOverlayPrice(frameHash).catch((err) => console.debug('[scanner] AR overlay price lookup failed:', err));
				}

				if (stableFrameCount >= STABLE_FRAMES_REQUIRED) {
					bracketState = 'locked';
					stableFrameCount = 0;
					lastFrameHash = null;
					updateGuidance(null);
					triggerAutoCapture();
				} else if (!cardDetectedSince) {
					cardDetectedSince = Date.now();
					bracketState = 'detected';
					updateGuidance('Hold still...');
				}
			} else {
				bitmap.close();
				bitmap = null;
				stableFrameCount = 0;
				lastFrameHash = null;
				cardDetectedSince = null;
				overlayData = null;
				overlayVisible = false;
				_lastOverlayHash = null;
				if (result.cardDetected && !result.isSharp) {
					bracketState = 'idle';
					updateGuidance('Hold steady...');
				} else {
					bracketState = 'idle';
					updateGuidance('Position card within the frame');
				}
			}
		} catch (err) {
			console.debug('[Scanner] Frame analysis failed:', err);
			bitmap?.close();
		}
	}

	async function triggerAutoCapture() {
		if (scanning || paused || foilMode) return;
		overlayData = null;
		overlayVisible = false;
		showFlash = true;
		setTimeout(() => { showFlash = false; }, 150);
		triggerHaptic('tap');
		await handleCapture();
		bracketState = 'idle';
	}

	let lastFailReason = $state<string | null>(null);

	function handleScanResult(result: ScanResult | null, imageUrl?: string) {
		// Resume video feed (was paused during capture for freeze-frame effect)
		if (videoEl && videoEl.paused) {
			videoEl.play().catch(() => { /* stream may have ended */ });
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
			// Mark first scan complete
			if (showFirstRunGuide) {
				showFirstRunGuide = false;
				import('$lib/services/idb').then(({ idb }) => {
					idb.setMeta('has_completed_first_scan', true);
				});
			}
			setTimeout(() => { phase = 'idle'; revealedCard = null; }, 1800);
		} else {
			revealedCard = null;
			phase = 'result_fail';
			lastFailReason = result?.failReason || null;
			triggerHaptic('error');
			if (result) onResult?.(result, imageUrl);
			setTimeout(() => { phase = 'idle'; }, 1200);
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
		phase = 'capturing';
		blurWarning = false;
		glareRegions = [];

		// Visual feedback: flash + freeze the video feed
		showFlash = true;
		setTimeout(() => { showFlash = false; }, 150);
		videoEl.pause(); // Freeze the frame so user sees what was captured
		triggerHaptic('tap');

		try {
			const bitmap = await captureFrame(videoEl);

			const quality = await checkImageQuality(bitmap);
			if (quality.isBlurry) {
				bitmap.close();
				blurWarning = true;
				triggerHaptic('error');
				setTimeout(() => { blurWarning = false; }, 2000);
				phase = 'idle';
				return;
			}
			if (quality.hasGlare) {
				glareRegions = quality.glareRegions;
				setTimeout(() => { glareRegions = []; }, 2000);
			}

			phase = 'processing';
			// Compute crop region from viewfinder guide for both display and storage
			let cropRegion: { x: number; y: number; width: number; height: number } | null = null;
			try {
				const guideEl = videoEl.closest('.viewfinder')?.querySelector('.scanner-guide-rect');
				if (guideEl) {
					const guideRect = guideEl.getBoundingClientRect();
					const videoRect = videoEl.getBoundingClientRect();
					if (guideRect.width >= 10 && guideRect.height >= 10) {
						cropRegion = cropToCardRegion(
							videoEl.videoWidth,
							videoEl.videoHeight,
							guideRect,
							videoRect
						);
					}
				}
			} catch { /* ignore */ }

			// Use cropped image for display (cleaner), full frame for AI recognition
			const croppedUrl = cropRegion ? cropFrame(videoEl, cropRegion) : null;
			const imageUrl = croppedUrl ?? bitmapToDataUrl(bitmap);
			let scanResult;
			try {
				scanResult = await scanImage(bitmap, { isAuthenticated, skipBlurCheck: true, cropRegion });
			} finally {
				bitmap.close();
			}
			if (scanResult) {
				handleScanResult(scanResult, imageUrl);
			} else {
				const errorMsg = scanState().error || 'Scan failed unexpectedly';
				handleScanResult({
					card_id: null,
					card: null,
					scan_method: 'claude',
					confidence: 0,
					processing_ms: 0,
					failReason: errorMsg
				}, imageUrl);
			}
		} catch (err) {
			console.error('[Scanner] handleCapture error:', err);
			handleScanResult({
				card_id: null,
				card: null,
				scan_method: 'claude',
				confidence: 0,
				processing_ms: 0,
				failReason: 'Scanner error — please try again'
			});
		}
	}

	async function handleFoilCapture() {
		if (!videoEl || scanning) return;
		phase = 'foil_capturing';
		const bitmap = await captureFrame(videoEl);
		foilCaptures = [...foilCaptures, bitmap];
		foilStep = foilCaptures.length;
		triggerHaptic('tap');

		showFlash = true;
		setTimeout(() => { showFlash = false; }, 150);

		if (foilCaptures.length >= FOIL_CAPTURES_NEEDED) {
			phase = 'processing';
			try {
				const composite = await compositeForFoilMode(foilCaptures);
				foilCaptures.forEach(b => b.close());
				foilCaptures = [];
				foilStep = 0;

				const imageUrl = bitmapToDataUrl(composite);
				const scanResult = await scanImage(composite, { isAuthenticated, skipBlurCheck: true });
				composite.close();
				if (scanResult) {
					handleScanResult(scanResult, imageUrl);
				} else {
					const errorMsg = scanState().error || 'Scan failed unexpectedly';
					handleScanResult({
						card_id: null,
						card: null,
						scan_method: 'claude',
						confidence: 0,
						processing_ms: 0,
						failReason: errorMsg
					}, imageUrl);
				}
			} catch (err) {
				console.error('[Scanner] handleFoilCapture error:', err);
				foilCaptures.forEach(b => b.close());
				foilCaptures = [];
				foilStep = 0;
				handleScanResult({
					card_id: null,
					card: null,
					scan_method: 'claude',
					confidence: 0,
					processing_ms: 0,
					failReason: 'Foil scan error — please try again'
				});
			}
		} else {
			phase = 'idle';
		}
	}

	async function handleTorchToggle() {
		torchOn = !torchOn;
		triggerHaptic('tap');
		await toggleTorch(torchOn);
	}

	async function handleFileUpload(event: Event) {
		fileDialogOpen = false;
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		phase = 'processing';

		try {
			const imageUrl = URL.createObjectURL(file);
			const result = await scanImage(file, { isAuthenticated });
			if (result) {
				handleScanResult(result, imageUrl);
			} else {
				const errorMsg = scanState().error || 'Scan failed unexpectedly';
				handleScanResult({
					card_id: null,
					card: null,
					scan_method: 'claude',
					confidence: 0,
					processing_ms: 0,
					failReason: errorMsg
				}, imageUrl);
			}
		} catch (err) {
			console.error('[Scanner] handleFileUpload error:', err);
			handleScanResult({
				card_id: null,
				card: null,
				scan_method: 'claude',
				confidence: 0,
				processing_ms: 0,
				failReason: 'Failed to process image — try a different photo'
			});
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

		<ScannerViewfinder
			{bracketState}
			{bracketAnimClass}
			{scanFailed}
			{revealColor}
			{scanSuccess}
			{cameraReady}
			{showFlash}
			{blurWarning}
			{glareRegions}
			{statusType}
			{revealedCard}
			{guidanceText}
			{scanning}
			{foilMode}
			{foilStep}
			foilCapturesNeeded={FOIL_CAPTURES_NEEDED}
			foilGuidance={FOIL_GUIDANCE}
			{cameraError}
		/>

		<!-- AR Price Overlay -->
		{#if overlayVisible && overlayData && !scanning && !paused}
			<div class="ar-price-overlay">
				<div class="ar-price-badge">
					<span class="ar-price-name">{overlayData.cardName}</span>
					{#if overlayData.cardNumber}
						<span class="ar-price-number">{overlayData.cardNumber}</span>
					{/if}
					{#if overlayData.price !== null}
						<span class="ar-price-value">${overlayData.price.toFixed(2)}</span>
						{#if overlayData.priceFetchedAt}
							<span class="ar-price-date">
								Last recorded eBay price &middot; {formatOverlayDate(overlayData.priceFetchedAt)}
							</span>
						{/if}
					{:else}
						<span class="ar-price-nodata">No price data</span>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Torch toggle (top-right of viewfinder) -->
		{#if cameraReady}
			<button
				class="torch-btn"
				class:torch-on={torchOn}
				onclick={handleTorchToggle}
				aria-label={torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
			>
				⚡
			</button>
		{/if}

		<ScannerStatus {statusText} {statusType} />

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

		<!-- Camera permission pre-prompt explainer -->
		{#if showCameraExplainer}
			<div class="permission-explainer">
				<div class="permission-explainer-content">
					<div class="permission-icon">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
							<circle cx="12" cy="13" r="4" />
						</svg>
					</div>
					<h3 class="permission-title">Camera Access Needed</h3>
					<p class="permission-desc">BOBA Scanner uses your camera to identify cards instantly. We never store photos without your permission.</p>
					<button class="permission-continue" onclick={() => { showCameraExplainer = false; initCamera(); }}>
						Continue to Scan
					</button>
					<p class="permission-tip">
						Tip: When your browser asks, tap <strong>Allow</strong> to avoid being asked again.
					</p>
				</div>
			</div>
		{/if}

		<ScannerControls
			{torchOn}
			{foilMode}
			{cameraReady}
			{scanning}
			{stabilityProgress}
			onTorchToggle={handleTorchToggle}
			onCapture={handleCapture}
			onFoilCapture={handleFoilCapture}
			onFoilToggle={handleFoilToggle}
			onFileUpload={handleFileUpload}
			onFileDialogOpen={() => {
				fileDialogOpen = true;
				stableFrameCount = 0;
				lastFrameHash = null;
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

	/* Camera permission pre-prompt */
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
