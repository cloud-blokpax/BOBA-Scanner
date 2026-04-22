<script lang="ts">
	import { PARALLEL_ABBREV, PARALLEL_FULL_NAME, PARALLEL_COLOR, normalizeParallel } from '$lib/data/parallels';

	let {
		parallel,
		size = 'md',
		showName = false,
	}: {
		parallel: string | null | undefined;
		size?: 'sm' | 'md' | 'lg';
		/** When true, render the full parallel name; otherwise just the abbreviation. */
		showName?: boolean;
	} = $props();

	const code = $derived(normalizeParallel(parallel));
	const color = $derived(PARALLEL_COLOR[code]);
	const abbrev = $derived(PARALLEL_ABBREV[code]);
	const fullName = $derived(PARALLEL_FULL_NAME[code]);
</script>

<span
	class="parallel-badge parallel-badge-{size}"
	data-parallel={code}
	style={`--parallel-color: ${color}`}
	title={fullName}
	aria-label={fullName}
>
	<span class="parallel-abbrev">{abbrev}</span>
	{#if showName}
		<span class="parallel-name">{fullName}</span>
	{/if}
</span>

<style>
	.parallel-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		border: 1px solid var(--parallel-color);
		border-radius: 6px;
		background: color-mix(in srgb, var(--parallel-color) 15%, transparent);
		color: var(--parallel-color);
		font-family: var(--font-sans);
		font-weight: 700;
		line-height: 1;
		white-space: nowrap;
	}
	.parallel-badge-sm { font-size: 0.625rem; padding: 1px 5px; }
	.parallel-badge-md { font-size: 0.75rem; }
	.parallel-badge-lg { font-size: 0.9rem; padding: 4px 10px; }

	.parallel-abbrev { letter-spacing: 0.03em; }
	.parallel-name { font-weight: 600; }
</style>
