<script lang="ts">
	import { getOptimizedImageUrls, type ImageSize } from '$lib/utils/image-url';

	let {
		src,
		alt = '',
		size = 'medium' as ImageSize,
		loading = 'lazy' as 'lazy' | 'eager',
		className = ''
	}: {
		src: string;
		alt?: string;
		size?: ImageSize;
		loading?: 'lazy' | 'eager';
		className?: string;
	} = $props();

	const urls = $derived(getOptimizedImageUrls(src, size));

	let failed = $state(false);
	function handleError() { failed = true; }
</script>

{#if failed}
	<div class="card-img-placeholder {className}">🎴</div>
{:else if urls.avif || urls.webp}
	<picture>
		{#if urls.avif}
			<source srcset={urls.avif} type="image/avif" />
		{/if}
		{#if urls.webp}
			<source srcset={urls.webp} type="image/webp" />
		{/if}
		<img
			src={urls.fallback}
			{alt}
			{loading}
			decoding="async"
			width={urls.width}
			class="card-img {className}"
			onerror={handleError}
		/>
	</picture>
{:else}
	<img
		src={urls.fallback}
		{alt}
		{loading}
		decoding="async"
		class="card-img {className}"
		onerror={handleError}
	/>
{/if}

<style>
	.card-img {
		aspect-ratio: 5 / 7;
		object-fit: cover;
		border-radius: 8px;
		width: 100%;
	}
	.card-img-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-elevated, #121d34);
		border-radius: 8px;
		aspect-ratio: 5 / 7;
		font-size: 2rem;
	}
</style>
