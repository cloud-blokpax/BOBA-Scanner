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
</script>

{#if urls.avif || urls.webp}
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
			class={className}
		/>
	</picture>
{:else}
	<img
		src={urls.fallback}
		{alt}
		{loading}
		decoding="async"
		class={className}
	/>
{/if}
