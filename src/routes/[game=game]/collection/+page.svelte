<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { setGameFilter, loadCollection } from '$lib/stores/collection.svelte';

	let { data } = $props();

	onMount(() => {
		// Scope the unified collection view to this game, then redirect to /collection
		// which already renders a full, game-filtered list (feature-flag gated pills
		// let the user switch back to "All"). This avoids duplicating 361 lines of
		// collection UI for each game-scoped route.
		setGameFilter(data.gameId);
		loadCollection();
		goto('/collection', { replaceState: true });
	});
</script>

<svelte:head>
	<title>{data.gameConfig.shortName} Collection | Card Scanner</title>
</svelte:head>

<div class="game-collection-loader">
	<p>Loading {data.gameConfig.shortName} collection…</p>
</div>

<style>
	.game-collection-loader {
		max-width: 600px;
		margin: 0 auto;
		padding: 3rem 1rem;
		text-align: center;
		color: var(--text-secondary, #94a3b8);
	}
</style>
