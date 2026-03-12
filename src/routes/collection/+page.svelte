<script lang="ts">
	import { onMount } from 'svelte';
	import CardGrid from '$lib/components/CardGrid.svelte';
	import CardDetail from '$lib/components/CardDetail.svelte';
	import {
		collectionItems,
		collectionLoading,
		collectionCount,
		uniqueCardCount,
		loadCollection
	} from '$lib/stores/collection';
	import type { CollectionItem } from '$lib/types';

	let selectedItem = $state<CollectionItem | null>(null);

	onMount(() => {
		loadCollection();
	});
</script>

<svelte:head>
	<title>My Collection | BOBA Scanner</title>
</svelte:head>

<div class="collection-page">
	<div class="collection-header">
		<h1>My Collection</h1>
		<div class="stats">
			<span class="stat">{$uniqueCardCount} unique</span>
			<span class="stat-divider">/</span>
			<span class="stat">{$collectionCount} total</span>
		</div>
	</div>

	{#if $collectionLoading}
		<div class="loading-state">Loading collection...</div>
	{:else}
		<CardGrid
			items={$collectionItems}
			onCardClick={(item) => (selectedItem = item)}
		/>
	{/if}

	<CardDetail
		item={selectedItem}
		onClose={() => (selectedItem = null)}
	/>
</div>

<style>
	.collection-page {
		max-width: 1000px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	.collection-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.collection-header h1 {
		font-family: 'Syne', sans-serif;
		font-size: 1.5rem;
		font-weight: 700;
	}

	.stats {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-secondary, #94a3b8);
		font-size: 0.9rem;
	}

	.stat-divider {
		color: var(--border-color, #1e293b);
	}

	.loading-state {
		text-align: center;
		padding: 3rem;
		color: var(--text-secondary, #94a3b8);
	}
</style>
