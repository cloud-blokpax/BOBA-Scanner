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
	} from '$lib/stores/collection.svelte';
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
			<span class="stat">{uniqueCardCount()} unique</span>
			<span class="stat-divider">/</span>
			<span class="stat">{collectionCount()} total</span>
		</div>
	</div>

	{#if collectionLoading()}
		<div class="skeleton-grid">
			{#each Array(8) as _}
				<div class="skeleton-card">
					<div class="skeleton-image shimmer"></div>
					<div class="skeleton-text shimmer"></div>
				</div>
			{/each}
		</div>
	{:else}
		<CardGrid
			items={collectionItems()}
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

	.skeleton-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}

	.skeleton-card {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.skeleton-image {
		aspect-ratio: 5 / 7;
		border-radius: 8px;
		background: var(--bg-elevated, #121d34);
	}

	.skeleton-text {
		height: 12px;
		width: 70%;
		border-radius: 4px;
		background: var(--bg-elevated, #121d34);
	}

	.shimmer {
		background: linear-gradient(
			90deg,
			var(--bg-elevated, #121d34) 25%,
			var(--bg-hover, #182540) 50%,
			var(--bg-elevated, #121d34) 75%
		);
		background-size: 200% 100%;
		animation: shimmer 1.8s linear infinite;
	}

	@keyframes shimmer {
		0% { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}
</style>
