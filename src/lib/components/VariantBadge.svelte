<script lang="ts">
	import { VARIANT_ABBREV, VARIANT_FULL_NAME, VARIANT_COLOR, normalizeVariant } from '$lib/data/variants';

	let {
		variant,
		size = 'md',
		showName = false,
	}: {
		variant: string | null | undefined;
		size?: 'sm' | 'md' | 'lg';
		/** When true, render the full variant name; otherwise just the abbreviation. */
		showName?: boolean;
	} = $props();

	const code = $derived(normalizeVariant(variant));
	const color = $derived(VARIANT_COLOR[code]);
	const abbrev = $derived(VARIANT_ABBREV[code]);
	const fullName = $derived(VARIANT_FULL_NAME[code]);
</script>

<span
	class="variant-badge variant-badge-{size}"
	data-variant={code}
	style={`--variant-color: ${color}`}
	title={fullName}
	aria-label={fullName}
>
	<span class="variant-abbrev">{abbrev}</span>
	{#if showName}
		<span class="variant-name">{fullName}</span>
	{/if}
</span>

<style>
	.variant-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		border: 1px solid var(--variant-color);
		border-radius: 6px;
		background: color-mix(in srgb, var(--variant-color) 15%, transparent);
		color: var(--variant-color);
		font-family: var(--font-sans);
		font-weight: 700;
		line-height: 1;
		white-space: nowrap;
	}
	.variant-badge-sm { font-size: 0.625rem; padding: 1px 5px; }
	.variant-badge-md { font-size: 0.75rem; }
	.variant-badge-lg { font-size: 0.9rem; padding: 4px 10px; }

	.variant-abbrev { letter-spacing: 0.03em; }
	.variant-name { font-weight: 600; }
</style>
