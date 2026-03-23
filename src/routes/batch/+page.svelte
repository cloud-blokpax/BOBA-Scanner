<script lang="ts">
	import { onMount } from 'svelte';
	import BatchScanner from '$lib/components/BatchScanner.svelte';
	import { initScanner } from '$lib/stores/scanner.svelte';
	import { goto } from '$app/navigation';

	onMount(() => {
		initScanner();
	});

	function handleClose() {
		goto('/collection');
	}
</script>

<svelte:head>
	<title>Batch Scanner | BOBA Scanner</title>
</svelte:head>

<div class="batch-page">
	<BatchScanner onClose={handleClose} />
</div>

<style>
	.batch-page {
		min-height: calc(100dvh - var(--header-height, 56px) - var(--bottom-nav-height, 68px));
	}
</style>
