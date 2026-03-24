<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import Scanner from '$lib/components/Scanner.svelte';
	import ScanConfirmation from '$lib/components/ScanConfirmation.svelte';
	import ScannerErrorBoundary from '$lib/components/ScannerErrorBoundary.svelte';
	import { initScanner } from '$lib/stores/scanner.svelte';
	import type { ScanResult } from '$lib/types';

	let scanResult = $state<ScanResult | null>(null);
	let capturedImageUrl = $state<string | null>(null);
	const isAuthenticated = $derived(!!$page.data.user);

	// Mode from URL param or default
	let scanMode = $state<'single' | 'batch' | 'binder' | 'roll'>('single');

	onMount(() => {
		initScanner();
		const modeParam = $page.url.searchParams.get('mode');
		if (modeParam === 'batch' || modeParam === 'binder' || modeParam === 'roll') {
			scanMode = modeParam;
		}
	});

	// Revoke blob URL on unmount to prevent memory leak from orphaned object URLs
	onDestroy(() => {
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
</script>

<svelte:head>
	<title>Scan | BOBA Scanner</title>
</svelte:head>

<div class="scan-page">
	<ScannerErrorBoundary>
		{#if scanMode === 'single'}
			<Scanner onResult={handleResult} {isAuthenticated} paused={!!scanResult} {scanMode} onModeChange={handleModeChange} />
		{:else if scanMode === 'batch'}
			{#await import('$lib/components/BatchScanner.svelte') then { default: BatchScanner }}
				<BatchScanner />
			{/await}
		{:else if scanMode === 'binder'}
			{#await import('$lib/components/BinderScanner.svelte') then { default: BinderScanner }}
				<BinderScanner />
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
		/* Fill available space between header and bottom nav */
		height: calc(100svh - var(--header-height, 56px) - var(--bottom-nav-height, 68px) - var(--safe-bottom, env(safe-area-inset-bottom, 20px)));
		/* Fallback for browsers that don't support svh */
		height: calc(100dvh - var(--header-height, 56px) - var(--bottom-nav-height, 68px) - var(--safe-bottom, env(safe-area-inset-bottom, 20px)));
		max-height: calc(100dvh - var(--header-height, 56px) - var(--bottom-nav-height, 68px) - var(--safe-bottom, env(safe-area-inset-bottom, 20px)));
		display: flex;
		flex-direction: column;
		position: relative;
		overflow: hidden;
	}

	/* Make scanner full-bleed: remove .app-main padding on scan page */
	:global(.app-main:has(.scan-page)) {
		padding: 0 !important;
		max-width: 100% !important;
		overflow: hidden !important;
	}
</style>
