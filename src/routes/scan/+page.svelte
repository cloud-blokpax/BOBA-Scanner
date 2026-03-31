<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import Scanner from '$lib/components/Scanner.svelte';
	import ScanConfirmation from '$lib/components/ScanConfirmation.svelte';
	import ScannerErrorBoundary from '$lib/components/ScannerErrorBoundary.svelte';
	import CloseButton from '$lib/components/CloseButton.svelte';
	import { initScanner, setScannerActive } from '$lib/stores/scanner.svelte';
	import type { ScanResult } from '$lib/types';

	let scanResult = $state<ScanResult | null>(null);
	let capturedImageUrl = $state<string | null>(null);
	const isAuthenticated = $derived(!!$page.data.user);

	// Mode from URL param or default
	let scanMode = $state<'single' | 'batch' | 'binder' | 'roll'>('single');

	onMount(() => {
		setScannerActive(true);
		initScanner();
		const modeParam = $page.url.searchParams.get('mode');
		if (modeParam === 'batch' || modeParam === 'binder' || modeParam === 'roll') {
			scanMode = modeParam;
		}
	});

	// Revoke blob URL on unmount to prevent memory leak from orphaned object URLs
	onDestroy(() => {
		setScannerActive(false);
		cleanupImageUrl();
	});

	function handleResult(result: ScanResult, imageUrl?: string) {
		scanResult = result;
		capturedImageUrl = imageUrl ?? null;
	}

	function handleScanAnother() {
		cleanupImageUrl();
		scanResult = null;
		capturedImageUrl = null;
	}

	function handleClose() {
		cleanupImageUrl();
		scanResult = null;
		capturedImageUrl = null;
	}

	function cleanupImageUrl() {
		if (capturedImageUrl?.startsWith('blob:')) {
			URL.revokeObjectURL(capturedImageUrl);
		}
	}

	function handleModeChange(mode: 'single' | 'batch' | 'binder' | 'roll') {
		scanMode = mode;
	}

	function exitScanner() {
		setScannerActive(false);
		goto('/');
	}
</script>

<svelte:head>
	<title>Scan | BOBA Scanner</title>
</svelte:head>

<div class="scan-page">
	<!-- Close button (top left, always visible) -->
	<CloseButton onclick={exitScanner} position="top-left" variant="dark" />

	<ScannerErrorBoundary>
		<!-- Mode selector — top bar, out of the way -->
		{#if !scanResult}
			<div class="mode-bar">
				{#each [
					{ id: 'single', label: 'Single' },
					{ id: 'batch', label: 'Batch' },
					{ id: 'binder', label: 'Binder' },
					{ id: 'roll', label: 'Roll' },
				] as mode}
					<button
						class="mode-pill"
						class:mode-active={scanMode === mode.id}
						onclick={() => handleModeChange(mode.id as 'single' | 'batch' | 'binder' | 'roll')}
					>{mode.label}</button>
				{/each}
			</div>
		{/if}

		{#if scanMode === 'single'}
			<Scanner onResult={handleResult} {isAuthenticated} paused={!!scanResult} {scanMode} />
		{:else if scanMode === 'batch'}
			{#await import('$lib/components/BatchScanner.svelte') then { default: BatchScanner }}
				<BatchScanner onClose={() => { scanMode = 'single'; }} {isAuthenticated} />
			{/await}
		{:else if scanMode === 'binder'}
			{#await import('$lib/components/BinderScanner.svelte') then { default: BinderScanner }}
				<BinderScanner onClose={() => { scanMode = 'single'; }} {isAuthenticated} />
			{/await}
		{:else if scanMode === 'roll'}
			{#await import('$lib/components/CameraRollImport.svelte') then { default: CameraRollImport }}
				<CameraRollImport {isAuthenticated} onClose={() => { scanMode = 'single'; }} />
			{/await}
		{/if}
		{#if scanResult}
			<ScanConfirmation
				result={scanResult}
				{capturedImageUrl}
				{isAuthenticated}
				onScanAnother={handleScanAnother}
				onClose={handleClose}
			/>
		{/if}
	</ScannerErrorBoundary>
</div>

<style>
	.scan-page {
		/* Full-screen: fill entire viewport */
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		flex-direction: column;
		background: #000;
		overflow: hidden;
	}

	.mode-bar {
		position: fixed;
		top: calc(env(safe-area-inset-top, 0px) + 48px);
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 4px;
		z-index: 10;
		padding: 4px;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border-radius: 24px;
	}

	.mode-pill {
		padding: 6px 14px;
		border: none;
		border-radius: 20px;
		background: transparent;
		color: rgba(255, 255, 255, 0.5);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		font-family: var(--font-sans);
		transition: all 0.15s;
	}

	.mode-pill:active { transform: scale(0.95); }

	.mode-pill.mode-active {
		background: rgba(255, 255, 255, 0.2);
		color: #fff;
	}

	/* Make scanner full-bleed: remove .app-main padding on scan page */
	:global(.app-main:has(.scan-page)) {
		padding: 0 !important;
		max-width: 100% !important;
		overflow: hidden !important;
	}
</style>
