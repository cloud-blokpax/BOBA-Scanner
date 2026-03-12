<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { startCamera, stopCamera, toggleTorch, captureFrame } from '$lib/services/camera';
	import { scanImage, scanState, resetScanner } from '$lib/stores/scanner';
	import type { ScanResult } from '$lib/types';

	let {
		onResult
	}: {
		onResult?: (result: ScanResult) => void;
	} = $props();

	let videoEl = $state<HTMLVideoElement | null>(null);
	let torchOn = $state(false);
	let cameraReady = $state(false);
	let scanning = $state(false);

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
				return 'Done!';
			case 'error':
				return state.error || 'Error';
			default:
				return 'Point camera at card';
		}
	});

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

		try {
			const bitmap = await captureFrame(videoEl);
			const result = await scanImage(bitmap);
			if (result) {
				onResult?.(result);
			}
		} finally {
			scanning = false;
		}
	}

	async function handleTorchToggle() {
		torchOn = !torchOn;
		await toggleTorch(torchOn);
	}

	async function handleFileUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		scanning = true;
		try {
			const result = await scanImage(file);
			if (result) {
				onResult?.(result);
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

		<!-- Corner brackets -->
		<div class="bracket top-left"></div>
		<div class="bracket top-right"></div>
		<div class="bracket bottom-left"></div>
		<div class="bracket bottom-right"></div>

		<!-- Status overlay -->
		<div class="status-overlay">
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

	.status-overlay {
		position: absolute;
		bottom: 2rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.5rem 1rem;
		background: rgba(0, 0, 0, 0.7);
		border-radius: 20px;
		backdrop-filter: blur(8px);
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
