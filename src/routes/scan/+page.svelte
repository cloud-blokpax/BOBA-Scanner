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
		{#if scanMode === 'single'}
			<Scanner onResult={handleResult} {isAuthenticated} paused={!!scanResult} {scanMode} onModeChange={handleModeChange} />
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

	/* Make scanner full-bleed: remove .app-main padding on scan page */
	:global(.app-main:has(.scan-page)) {
		padding: 0 !important;
		max-width: 100% !important;
		overflow: hidden !important;
	}
</style>
