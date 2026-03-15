<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import Scanner from '$lib/components/Scanner.svelte';
	import ScanConfirmation from '$lib/components/ScanConfirmation.svelte';
	import { initScanner } from '$lib/stores/scanner';
	import type { ScanResult } from '$lib/types';

	let scanResult = $state<ScanResult | null>(null);
	let capturedImageUrl = $state<string | null>(null);
	const isAuthenticated = $derived(!!$page.data.user);

	onMount(() => {
		initScanner();
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
</script>

<svelte:head>
	<title>Scan | BOBA Scanner</title>
</svelte:head>

<div class="scan-page">
	<Scanner onResult={handleResult} {isAuthenticated} paused={!!scanResult} />
	{#if scanResult}
		<ScanConfirmation
			result={scanResult}
			{capturedImageUrl}
			{isAuthenticated}
			onScanAnother={handleScanAnother}
			onClose={handleClose}
		/>
	{/if}
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
