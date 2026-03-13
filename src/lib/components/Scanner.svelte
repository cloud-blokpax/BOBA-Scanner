<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { startCamera, stopCamera, toggleTorch, captureFrame } from '$lib/services/camera';
	import { scanImage, scanState, resetScanner } from '$lib/stores/scanner';
	import ScanEffects from '$lib/components/ScanEffects.svelte';
	import type { ScanResult, Card } from '$lib/types';

	let {
		onResult
	}: {
		onResult?: (result: ScanResult) => void;
	} = $props();

	let videoEl = $state<HTMLVideoElement | null>(null);
	let torchOn = $state(false);
	let cameraReady = $state(false);
	let scanning = $state(false);
	let scanSuccess = $state(false);
	let scanFailed = $state(false);
	let revealedCard = $state<Card | null>(null);

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
				return 'Card found!';
			case 'error':
				return state.error || 'Scan failed — try again';
			default:
				return 'Point camera at card';
		}
	});

	const statusType = $derived.by(() => {
		const state = $scanState;
		if (state.status === 'complete') return 'success';
		if (state.status === 'error') return 'error';
		if (['tier1', 'tier2', 'tier3', 'processing', 'capturing'].includes(state.status)) return 'scanning';
		return 'idle';
	});

	function triggerHaptic(pattern: number[] = [15]) {
		if ('vibrate' in navigator) {
			navigator.vibrate(pattern);
		}
	}

	onMount(async () => {
		try {
			const stream = await startCamera();
			if (videoEl) {
				videoEl.srcObject = stream;
				await videoEl.play();
				cameraReady = true;
			}
		} catch (err) {
			console.error('Camera error:', err);
		}
	});

	onDestroy(() => {
		stopCamera();
		resetScanner();
	});

	async function handleCapture() {
		if (!videoEl || scanning) return;
		scanning = true;
		scanSuccess = false;
		scanFailed = false;
		triggerHaptic();

		try {
			const bitmap = await captureFrame(videoEl);
			const result = await scanImage(bitmap);
			if (result?.card) {
				revealedCard = result.card;
				scanSuccess = true;
				// Rarity-scaled haptics
				const r = result.card.rarity;
				if (r === 'legendary') triggerHaptic([20, 40, 20, 40, 60]);
				else if (r === 'ultra_rare') triggerHaptic([20, 40, 30, 50]);
				else triggerHaptic([30, 60, 30]);
				onResult?.(result);
				setTimeout(() => { scanSuccess = false; revealedCard = null; }, 1800);
			} else {
				revealedCard = null;
				scanFailed = true;
				triggerHaptic([50, 30, 50]);
				if (result) onResult?.(result);
				setTimeout(() => { scanFailed = false; }, 1200);
			}
		} finally {
			scanning = false;
		}
	}

	async function handleTorchToggle() {
		torchOn = !torchOn;
		triggerHaptic();
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
			const result = await scanImage(file);
			if (result?.card) {
				revealedCard = result.card;
				scanSuccess = true;
				const r = result.card.rarity;
				if (r === 'legendary') triggerHaptic([20, 40, 20, 40, 60]);
				else if (r === 'ultra_rare') triggerHaptic([20, 40, 30, 50]);
				else triggerHaptic([30, 60, 30]);
				onResult?.(result);
				setTimeout(() => { scanSuccess = false; revealedCard = null; }, 1800);
			} else {
				revealedCard = null;
				scanFailed = true;
				if (result) onResult?.(result);
				setTimeout(() => { scanFailed = false; }, 1200);
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

		<!-- Corner brackets — rarity-colored on success, red on fail -->
		<div
			class="bracket top-left {bracketAnimClass}"
			class:bracket-fail={scanFailed}
			style:--reveal-color={revealColor?.color ?? ''}
			style:--reveal-glow="{revealColor?.glow ?? 0}px"
		></div>
		<div
			class="bracket top-right {bracketAnimClass}"
			class:bracket-fail={scanFailed}
			style:--reveal-color={revealColor?.color ?? ''}
			style:--reveal-glow="{revealColor?.glow ?? 0}px"
		></div>
		<div
			class="bracket bottom-left {bracketAnimClass}"
			class:bracket-fail={scanFailed}
			style:--reveal-color={revealColor?.color ?? ''}
			style:--reveal-glow="{revealColor?.glow ?? 0}px"
		></div>
		<div
			class="bracket bottom-right {bracketAnimClass}"
			class:bracket-fail={scanFailed}
			style:--reveal-color={revealColor?.color ?? ''}
			style:--reveal-glow="{revealColor?.glow ?? 0}px"
		></div>

		<!-- Scan effects overlay (particles, scan line, vignette) -->
		<ScanEffects
			scanning={statusType === 'scanning'}
			revealed={scanSuccess}
			rarity={revealedCard?.rarity ?? null}
			weaponType={revealedCard?.weapon_type ?? null}
		/>

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
			onclick={handleCapture}
			disabled={!cameraReady || scanning}
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
			onclick={handleTorchToggle}
			aria-label="Toggle flash"
		>
			<span>{torchOn ? '🔦' : '💡'}</span>
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
		overflow: hidden;
	}

	.camera-feed {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	/* L-shaped corner brackets */
	.bracket {
		position: absolute;
		width: 40px;
		height: 40px;
		border-color: var(--accent-primary, #3b82f6);
		border-style: solid;
		border-width: 0;
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

	.bracket-fail {
		animation: bracket-flash-fail 0.8s ease-out;
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
		padding: 1.5rem;
		background: var(--surface-primary, #070b14);
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
</style>
