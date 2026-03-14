<script lang="ts">
	import { onMount } from 'svelte';
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
		height: calc(100vh - 120px); /* Subtract header + nav */
		display: flex;
		flex-direction: column;
		position: relative;
	}
</style>
