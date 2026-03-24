<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { startCamera, stopCamera, toggleTorch, captureFrame } from '$lib/services/camera';
	import { scanImage, scanState, resetScanner } from '$lib/stores/scanner.svelte';
	import { checkImageQuality, analyzeFrame, compositeForFoilMode, computeFrameHash, computeHammingDistance } from '$lib/services/recognition';
	import { triggerHaptic } from '$lib/utils/haptics';
	import type { ScanResult, Card } from '$lib/types';

	import ScannerViewfinder from './scanner/ScannerViewfinder.svelte';
	import ScannerControls from './scanner/ScannerControls.svelte';
	import ScannerStatus from './scanner/ScannerStatus.svelte';

	let {
		onResult,
		isAuthenticated = true,
		paused = false
	}: {
		onResult?: (result: ScanResult, capturedImageUrl?: string) => void;
		isAuthenticated?: boolean;
		paused?: boolean;
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
	const STABLE_FRAMES_REQUIRED = 4;
	const STABILITY_THRESHOLD = 3;

	let _visibilityHandler: (() => void) | null = null;

	let foilMode = $state(false);
	let foilCaptures = $state<ImageBitmap[]>([]);
	let foilStep = $state(0);
	const FOIL_CAPTURES_NEEDED = 3;
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

	onMount(async () => {
		try {
			const stream = await startCamera();
			if (videoEl) {
				videoEl.srcObject = stream;
				await videoEl.play();
				phase = 'idle';
				startAutoAnalyze();
			}
		} catch (err) {
			console.error('Camera error:', err);
			phase = 'error';
			if (err instanceof DOMException) {
				if (err.name === 'NotAllowedError') {
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

		_visibilityHandler = () => {
			if (document.visibilityState === 'hidden') {
				stopCamera();
				stopAutoAnalyze();
				torchOn = false;
			} else if (document.visibilityState === 'visible' && phase !== 'error') {
				startCamera().then((stream) => {
					if (videoEl) {
						videoEl.srcObject = stream;
						videoEl.play().then(() => {
							phase = 'idle';
							startAutoAnalyze();
						});
					}
				}).catch((err) => {
					console.warn('[Scanner] Camera resume after tab switch failed:', err);
				});
			}
		};
		document.addEventListener('visibilitychange', _visibilityHandler);
	});

	onDestroy(() => {
		stopAutoAnalyze();
		stopCamera();
		resetScanner();
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

	async function runAutoAnalyze() {
		if (!videoEl || !cameraReady || scanning || paused) {
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
		showFlash = true;
		setTimeout(() => { showFlash = false; }, 150);
		triggerHaptic('tap');
		await handleCapture();
		bracketState = 'idle';
	}

	let lastFailReason = $state<string | null>(null);

	function handleScanResult(result: ScanResult | null, imageUrl?: string) {
		if (result?.card) {
			revealedCard = result.card;
			phase = 'result_success';
			lastFailReason = null;
			const r = result.card.rarity;
			if (r === 'legendary') triggerHaptic('legendary');
			else if (r === 'ultra_rare') triggerHaptic('ultraRare');
			else triggerHaptic('success');
			onResult?.(result, imageUrl);
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
			const imageUrl = bitmapToDataUrl(bitmap);
			let scanResult;
			try {
				scanResult = await scanImage(bitmap, { isAuthenticated, skipBlurCheck: true });
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
		} catch {
			phase = 'idle';
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
			} catch {
				phase = 'idle';
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
		} catch {
			phase = 'idle';
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

<div class="scanner">
	<div class="viewfinder">
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
	</div>

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
	/>
</div>

<style>
	.scanner {
		display: flex;
		flex-direction: column;
		height: 100%;
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

	.torch-btn {
		position: absolute;
		top: 1rem;
		right: 1rem;
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
</style>
