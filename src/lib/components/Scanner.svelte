<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { startCamera, stopCamera, toggleTorch, captureFrame } from '$lib/services/camera';
	import { scanImage, scanState, resetScanner } from '$lib/stores/scanner';
	import { checkImageQuality, analyzeFrame, compositeForFoilMode } from '$lib/services/recognition';
	import ScanEffects from '$lib/components/ScanEffects.svelte';
	import { triggerHaptic } from '$lib/utils/haptics';
	import type { ScanResult, Card } from '$lib/types';

	let {
		onResult,
		isAuthenticated = true,
		paused = false
	}: {
		onResult?: (result: ScanResult, capturedImageUrl?: string) => void;
		isAuthenticated?: boolean;
		paused?: boolean;
	} = $props();

	let videoEl = $state<HTMLVideoElement | null>(null);
	let torchOn = $state(false);
	let cameraReady = $state(false);
	let scanning = $state(false);
	let scanSuccess = $state(false);
	let scanFailed = $state(false);
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

	const revealColor = $derived(RARITY_COLORS[revealedCard?.rarity ?? ''] ?? null);
	const bracketAnimClass = $derived.by(() => {
		if (!scanSuccess || !revealColor) return '';
		if (revealColor.pulses === 3) return 'bracket-reveal-triple';
		if (revealColor.pulses === 2) return 'bracket-reveal-double';
		return 'bracket-reveal';
	});

	const statusText = $derived.by(() => {
		const state = $scanState;
		switch (state.status) {
			case 'tier1':
				return 'Checking cache...';
			case 'tier2':
				return 'Running OCR...';
			case 'tier3':
				return 'AI identifying...';
			case 'processing':
				return 'Processing...';
			case 'complete':
				if (!state.result?.card && state.result?.failReason) return state.result.failReason;
				if (!state.result?.card) return 'Card not recognized';
				return 'Card found!';
			case 'error':
				return state.error || 'Scan failed — try again';
			default:
				return 'Point camera at card';
		}
	});

	const statusType = $derived.by(() => {
		const state = $scanState;
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
				cameraReady = true;
				startAutoAnalyze();
			}
		} catch (err) {
			console.error('Camera error:', err);
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
	});

	onDestroy(() => {
		stopAutoAnalyze();
		stopCamera();
		resetScanner();
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
			return;
		}

		try {
			const bitmap = await captureFrame(videoEl);
			const result = await analyzeFrame(bitmap);
			bitmap.close(); // Free GPU memory — this runs every 250ms

			if (result.cardDetected && result.isSharp) {
				if (!cardDetectedSince) {
					cardDetectedSince = Date.now();
					bracketState = 'detected';
					updateGuidance('Hold still to capture');
				} else if (Date.now() - cardDetectedSince >= 500) {
					// Card held steady for 500ms — auto-capture
					bracketState = 'locked';
					cardDetectedSince = null;
					updateGuidance(null);
					triggerAutoCapture();
				}
			} else if (result.cardDetected && !result.isSharp) {
				cardDetectedSince = null;
				bracketState = 'idle';
				updateGuidance('Hold steady...');
			} else {
				cardDetectedSince = null;
				bracketState = 'idle';
				updateGuidance('Position card within the frame');
			}
		} catch {
			// Frame analysis error — ignore silently
		}
	}

	async function triggerAutoCapture() {
		if (scanning || paused || foilMode) return;
		// Flash overlay
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
			scanSuccess = true;
			lastFailReason = null;
			const r = result.card.rarity;
			if (r === 'legendary') triggerHaptic('legendary');
			else if (r === 'ultra_rare') triggerHaptic('ultraRare');
			else triggerHaptic('success');
			onResult?.(result, imageUrl);
			setTimeout(() => { scanSuccess = false; revealedCard = null; }, 1800);
		} else {
			revealedCard = null;
			scanFailed = true;
			lastFailReason = result?.failReason || null;
			triggerHaptic('error');
			if (result) onResult?.(result, imageUrl);
			setTimeout(() => { scanFailed = false; }, 1200);
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
		scanning = true;
		scanSuccess = false;
		scanFailed = false;
		blurWarning = false;
		glareRegions = [];
		triggerHaptic('tap');

		try {
			const bitmap = await captureFrame(videoEl);

			// Pre-scan quality check
			const quality = await checkImageQuality(bitmap);
			if (quality.isBlurry) {
				bitmap.close();
				blurWarning = true;
				triggerHaptic('error');
				setTimeout(() => { blurWarning = false; }, 2000);
				scanning = false;
				return;
			}
			if (quality.hasGlare) {
				glareRegions = quality.glareRegions;
				setTimeout(() => { glareRegions = []; }, 2000);
			}

			const imageUrl = bitmapToDataUrl(bitmap);
			// scanImage transfers or consumes the bitmap; close it after
			// skipBlurCheck: true because we already ran checkImageQuality above
			const scanResult = await scanImage(bitmap, { isAuthenticated, skipBlurCheck: true });
			bitmap.close();
			if (scanResult) {
				handleScanResult(scanResult, imageUrl);
			} else {
				const errorMsg = $scanState.error || 'Scan failed unexpectedly';
				handleScanResult({
					card_id: null,
					card: null,
					scan_method: 'claude',
					confidence: 0,
					processing_ms: 0,
					failReason: errorMsg
				}, imageUrl);
			}
		} finally {
			scanning = false;
		}
	}

	async function handleFoilCapture() {
		if (!videoEl || scanning) return;
		const bitmap = await captureFrame(videoEl);
		foilCaptures = [...foilCaptures, bitmap];
		foilStep = foilCaptures.length;
		triggerHaptic('tap');

		// Flash effect
		showFlash = true;
		setTimeout(() => { showFlash = false; }, 150);

		if (foilCaptures.length >= FOIL_CAPTURES_NEEDED) {
			scanning = true;
			try {
				const composite = await compositeForFoilMode(foilCaptures);
				// Clean up captures
				foilCaptures.forEach(b => b.close());
				foilCaptures = [];
				foilStep = 0;

				const imageUrl = bitmapToDataUrl(composite);
				const scanResult = await scanImage(composite, { isAuthenticated, skipBlurCheck: true });
				composite.close();
				if (scanResult) {
					handleScanResult(scanResult, imageUrl);
				} else {
					const errorMsg = $scanState.error || 'Scan failed unexpectedly';
					handleScanResult({
						card_id: null,
						card: null,
						scan_method: 'claude',
						confidence: 0,
						processing_ms: 0,
						failReason: errorMsg
					}, imageUrl);
				}
			} finally {
				scanning = false;
			}
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

		scanning = true;
		scanSuccess = false;
		scanFailed = false;

		try {
			const imageUrl = URL.createObjectURL(file);
			const result = await scanImage(file, { isAuthenticated });
			if (result) {
				handleScanResult(result, imageUrl);
			} else {
				// scanImage returns null on internal errors — create a fail result
				const errorMsg = $scanState.error || 'Scan failed unexpectedly';
				handleScanResult({
					card_id: null,
					card: null,
					scan_method: 'claude',
					confidence: 0,
					processing_ms: 0,
					failReason: errorMsg
				}, imageUrl);
			}
		} finally {
			scanning = false;
			input.value = '';
		}
	}
</script>

<div class="scanner">
	<div class="viewfinder">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={videoEl}
			autoplay
			playsinline
			muted
			class="camera-feed"
		></video>

		<!-- Auto-capture flash overlay -->
		{#if showFlash}
			<div class="flash-overlay"></div>
		{/if}

		<!-- Dark overlay outside scanning zone -->
		<div class="viewfinder-overlay"></div>

		<!-- Corner brackets — rarity-colored on success, red on fail, green on card detected -->
		<div
			class="bracket top-left {bracketAnimClass}"
			class:bracket-fail={scanFailed}
			class:bracket-detected={bracketState === 'detected'}
			class:bracket-locked={bracketState === 'locked'}
			style:--reveal-color={revealColor?.color ?? ''}
			style:--reveal-glow="{revealColor?.glow ?? 0}px"
		></div>
		<div
			class="bracket top-right {bracketAnimClass}"
			class:bracket-fail={scanFailed}
			class:bracket-detected={bracketState === 'detected'}
			class:bracket-locked={bracketState === 'locked'}
			style:--reveal-color={revealColor?.color ?? ''}
			style:--reveal-glow="{revealColor?.glow ?? 0}px"
		></div>
		<div
			class="bracket bottom-left {bracketAnimClass}"
			class:bracket-fail={scanFailed}
			class:bracket-detected={bracketState === 'detected'}
			class:bracket-locked={bracketState === 'locked'}
			style:--reveal-color={revealColor?.color ?? ''}
			style:--reveal-glow="{revealColor?.glow ?? 0}px"
		></div>
		<div
			class="bracket bottom-right {bracketAnimClass}"
			class:bracket-fail={scanFailed}
			class:bracket-detected={bracketState === 'detected'}
			class:bracket-locked={bracketState === 'locked'}
			style:--reveal-color={revealColor?.color ?? ''}
			style:--reveal-glow="{revealColor?.glow ?? 0}px"
		></div>

		<!-- Scan line animation -->
		{#if cameraReady && !scanSuccess && !scanFailed}
			<div class="scan-line"></div>
		{/if}

		<!-- Scan effects overlay (particles, scan line, vignette) -->
		<ScanEffects
			scanning={statusType === 'scanning'}
			revealed={scanSuccess}
			rarity={revealedCard?.rarity ?? null}
			weaponType={revealedCard?.weapon_type ?? null}
		/>

		<!-- Blur warning overlay -->
		{#if blurWarning}
			<div class="blur-warning">
				<span>Hold steady — image is blurry</span>
			</div>
		{/if}

		<!-- Glare region overlays -->
		{#each glareRegions as region}
			<div
				class="glare-region"
				style="left: {region.x * 100}%; top: {region.y * 100}%; width: {region.w * 100}%; height: {region.h * 100}%"
			></div>
		{/each}

		<!-- Guidance text -->
		{#if foilMode && foilStep < FOIL_CAPTURES_NEEDED && !scanning}
			<div class="guidance-text foil-guidance">
				{FOIL_GUIDANCE[foilStep]}
			</div>
		{:else if guidanceText && !scanning && !foilMode}
			<div class="guidance-text">
				{guidanceText}
			</div>
		{/if}

		<!-- Foil capture progress -->
		{#if foilMode && foilStep > 0 && foilStep < FOIL_CAPTURES_NEEDED}
			<div class="foil-progress">
				{#each Array(FOIL_CAPTURES_NEEDED) as _, i}
					<div class="foil-dot" class:foil-dot-filled={i < foilStep}></div>
				{/each}
			</div>
		{/if}

		<!-- Camera error state -->
		{#if cameraError && !cameraReady}
			<div class="camera-error">
				<p class="camera-error-text">{cameraError}</p>
				<button class="camera-error-retry" onclick={() => location.reload()}>
					Retry
				</button>
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

		<!-- Status overlay -->
		<div class="status-overlay" class:status-success={statusType === 'success'} class:status-error={statusType === 'error'} class:status-scanning={statusType === 'scanning'}>
			{#if statusType === 'scanning'}
				<span class="status-spinner"></span>
			{/if}
			<span class="status-text">{statusText}</span>
		</div>
	</div>

	<div class="scanner-controls">
		<label class="control-btn upload-btn">
			<span>📁</span>
			<input
				type="file"
				accept="image/jpeg,image/png,image/webp"
				onchange={handleFileUpload}
				hidden
			/>
		</label>

		<button
			class="capture-btn"
			onclick={foilMode ? handleFoilCapture : handleCapture}
			disabled={!cameraReady || scanning || paused}
			aria-label="Capture"
		>
			<div class="capture-ring">
				{#if scanning}
					<div class="capture-spinner"></div>
				{/if}
			</div>
		</button>

		<button
			class="control-btn"
			class:foil-active={foilMode}
			onclick={() => { foilMode = !foilMode; foilCaptures.forEach(b => b.close()); foilCaptures = []; foilStep = 0; }}
			aria-label="Toggle foil mode"
		>
			<span>✨</span>
		</button>
	</div>
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

	/* Dark overlay outside scanning zone */
	.viewfinder-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		clip-path: polygon(evenodd,
			0% 0%, 100% 0%, 100% 100%, 0% 100%,
			10% 15%, 90% 15%, 90% 85%, 10% 85%
		);
		z-index: 1;
		pointer-events: none;
	}

	/* L-shaped corner brackets */
	.bracket {
		position: absolute;
		width: 40px;
		height: 40px;
		border-color: var(--accent-primary, #3b82f6);
		border-style: solid;
		border-width: 0;
		z-index: 2;
	}

	.bracket.top-left {
		top: 15%;
		left: 10%;
		border-top-width: 3px;
		border-left-width: 3px;
		border-top-left-radius: 8px;
	}

	.bracket.top-right {
		top: 15%;
		right: 10%;
		border-top-width: 3px;
		border-right-width: 3px;
		border-top-right-radius: 8px;
	}

	.bracket.bottom-left {
		bottom: 15%;
		left: 10%;
		border-bottom-width: 3px;
		border-left-width: 3px;
		border-bottom-left-radius: 8px;
	}

	.bracket.bottom-right {
		bottom: 15%;
		right: 10%;
		border-bottom-width: 3px;
		border-right-width: 3px;
		border-bottom-right-radius: 8px;
	}

	/* Bracket animations — rarity-driven reveal */
	.bracket-reveal {
		animation: bracket-flash-reveal 1s ease-out;
	}

	.bracket-reveal-double {
		animation: bracket-flash-reveal-double 1.2s ease-out;
	}

	.bracket-reveal-triple {
		animation: bracket-flash-reveal-triple 1.6s ease-out;
		border-width: 0; /* reset, animation controls it */
	}

	/* Keep the directional border widths during triple animation */
	.bracket-reveal-triple.top-left { border-top-width: 3px; border-left-width: 3px; }
	.bracket-reveal-triple.top-right { border-top-width: 3px; border-right-width: 3px; }
	.bracket-reveal-triple.bottom-left { border-bottom-width: 3px; border-left-width: 3px; }
	.bracket-reveal-triple.bottom-right { border-bottom-width: 3px; border-right-width: 3px; }

	.bracket-detected {
		border-color: #22C55E !important;
		box-shadow: 0 0 12px rgba(34, 197, 94, 0.3);
		transition: border-color 0.2s, box-shadow 0.2s;
	}

	.bracket-locked {
		border-color: #22C55E !important;
		box-shadow: 0 0 20px rgba(34, 197, 94, 0.5);
		transition: border-color 0.1s, box-shadow 0.1s;
	}

	.bracket-fail {
		animation: bracket-flash-fail 0.8s ease-out;
	}

	/* Auto-capture flash */
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

	@keyframes bracket-flash-reveal {
		0%   { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
		25%  { border-color: var(--reveal-color); box-shadow: 0 0 var(--reveal-glow) color-mix(in srgb, var(--reveal-color) 50%, transparent); }
		100% { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
	}

	@keyframes bracket-flash-reveal-double {
		0%   { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
		20%  { border-color: var(--reveal-color); box-shadow: 0 0 var(--reveal-glow) color-mix(in srgb, var(--reveal-color) 50%, transparent); }
		40%  { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
		55%  { border-color: var(--reveal-color); box-shadow: 0 0 var(--reveal-glow) color-mix(in srgb, var(--reveal-color) 40%, transparent); }
		100% { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
	}

	@keyframes bracket-flash-reveal-triple {
		0%   { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
		15%  { border-color: var(--reveal-color); box-shadow: 0 0 var(--reveal-glow) color-mix(in srgb, var(--reveal-color) 55%, transparent); }
		30%  { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
		45%  { border-color: var(--reveal-color); box-shadow: 0 0 var(--reveal-glow) color-mix(in srgb, var(--reveal-color) 45%, transparent); }
		60%  { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
		75%  { border-color: var(--reveal-color); box-shadow: 0 0 var(--reveal-glow) color-mix(in srgb, var(--reveal-color) 35%, transparent); }
		100% { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
	}

	@keyframes bracket-flash-fail {
		0%   { border-color: var(--accent-primary, #3b82f6); }
		25%  { border-color: var(--danger, #ef4444); box-shadow: 0 0 12px rgba(239, 68, 68, 0.4); }
		100% { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
	}

	.status-overlay {
		position: absolute;
		bottom: 2rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.5rem 1rem;
		background: rgba(0, 0, 0, 0.7);
		border-radius: 20px;
		backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		transition: background 0.3s, border-color 0.3s;
		border: 1px solid transparent;
	}

	.status-overlay.status-success {
		background: rgba(16, 185, 129, 0.15);
		border-color: rgba(16, 185, 129, 0.3);
	}

	.status-overlay.status-error {
		background: rgba(239, 68, 68, 0.15);
		border-color: rgba(239, 68, 68, 0.3);
	}

	.status-overlay.status-scanning {
		background: rgba(59, 130, 246, 0.12);
		border-color: rgba(59, 130, 246, 0.2);
	}

	.status-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex-shrink: 0;
	}

	.status-text {
		font-size: 0.85rem;
		color: white;
	}

	.scanner-controls {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 2rem;
		padding: 0.75rem 1.5rem;
		background: var(--surface-primary, #070b14);
		flex-shrink: 0;
	}

	.control-btn {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--surface-secondary, #0d1524);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		font-size: 1.2rem;
	}

	.upload-btn {
		cursor: pointer;
	}

	.capture-btn {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		border: 4px solid white;
		background: transparent;
		padding: 4px;
		cursor: pointer;
	}

	.capture-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.capture-ring {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		background: white;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.capture-spinner {
		width: 24px;
		height: 24px;
		border: 3px solid transparent;
		border-top-color: var(--accent-primary, #3b82f6);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Blur warning overlay */
	.blur-warning {
		position: absolute;
		inset: 0;
		background: rgba(239, 68, 68, 0.15);
		border: 2px solid rgba(239, 68, 68, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10;
		animation: fade-in 0.2s ease-out;
	}

	.blur-warning span {
		background: rgba(0, 0, 0, 0.8);
		color: #ef4444;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		font-size: 0.9rem;
		font-weight: 600;
	}

	/* Glare region highlights */
	.glare-region {
		position: absolute;
		background: rgba(239, 68, 68, 0.2);
		border: 1px solid rgba(239, 68, 68, 0.5);
		border-radius: 4px;
		z-index: 9;
		pointer-events: none;
		animation: fade-in 0.2s ease-out;
	}

	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	/* Guidance text */
	.guidance-text {
		position: absolute;
		bottom: 4.5rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.375rem 0.875rem;
		background: rgba(0, 0, 0, 0.6);
		border-radius: 16px;
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.85);
		pointer-events: none;
		z-index: 5;
		white-space: nowrap;
	}

	/* Scan line animation */
	.scan-line {
		position: absolute;
		left: 10%;
		right: 10%;
		height: 2px;
		background: rgba(34, 211, 238, 0.54);
		box-shadow: 0 0 12px rgba(34, 211, 238, 0.4), 0 0 4px rgba(34, 211, 238, 0.6);
		z-index: 3;
		pointer-events: none;
		animation: scan-sweep 2s ease-in-out infinite;
	}

	@keyframes scan-sweep {
		0%, 100% { top: 15%; }
		50% { top: 85%; }
	}

	@media (prefers-reduced-motion: reduce) {
		.scan-line {
			animation: none;
			top: 50%;
			opacity: 0.3;
		}
	}

	/* Camera error state */
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

	/* Torch button */
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

	/* Foil mode */
	.foil-active {
		background: rgba(245, 158, 11, 0.15) !important;
		border-color: rgba(245, 158, 11, 0.4) !important;
		color: #f59e0b;
	}

	.foil-guidance {
		background: rgba(245, 158, 11, 0.15);
		border: 1px solid rgba(245, 158, 11, 0.3);
		color: #fbbf24;
	}

	.foil-progress {
		position: absolute;
		top: 10%;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 6px;
		z-index: 5;
		pointer-events: none;
	}

	.foil-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.3);
		border: 1px solid rgba(255, 255, 255, 0.5);
	}

	.foil-dot-filled {
		background: #f59e0b;
		border-color: #f59e0b;
	}
</style>
