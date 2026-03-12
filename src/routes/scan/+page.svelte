<script lang="ts">
	import { onMount } from 'svelte';
	import Scanner from '$lib/components/Scanner.svelte';
	import BottomSheet from '$lib/components/BottomSheet.svelte';
	import { initScanner } from '$lib/stores/scanner';
	import type { ScanResult } from '$lib/types';

	let scanResult = $state<ScanResult | null>(null);

	onMount(() => {
		initScanner();
	});

	function handleResult(result: ScanResult) {
		scanResult = result;
	}

	function handleScanAnother() {
		scanResult = null;
	}

	function handleClose() {
		scanResult = null;
	}
</script>

<svelte:head>
	<title>Scan | BOBA Scanner</title>
</svelte:head>

<div class="scan-page">
	<Scanner onResult={handleResult} />

	<BottomSheet
		result={scanResult}
		onClose={handleClose}
		onScanAnother={handleScanAnother}
	/>
</div>

<style>
	.scan-page {
		height: calc(100vh - 120px); /* Subtract header + nav */
		display: flex;
		flex-direction: column;
	}
</style>
