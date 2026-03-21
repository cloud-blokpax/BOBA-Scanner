<script lang="ts">
	import { onMount } from 'svelte';
	import BinderScanner from '$lib/components/BinderScanner.svelte';
	import { initScanner } from '$lib/stores/scanner';
	import { goto } from '$app/navigation';

	onMount(() => {
		initScanner();
	});

	function handleClose() {
		goto('/collection');
	}
</script>

<svelte:head>
	<title>Binder Scanner | BOBA Scanner</title>
</svelte:head>

<div class="binder-page">
	<BinderScanner onClose={handleClose} />
</div>

<style>
	.binder-page {
		min-height: calc(100dvh - var(--header-height, 56px) - var(--bottom-nav-height, 68px));
	}
</style>
