<script lang="ts">
	import { featureEnabled } from '$lib/stores/feature-flags.svelte';
	import type { Snippet } from 'svelte';

	const multiGameEnabled = featureEnabled('multi_game_ui');

	let {
		message = 'This tool is currently BoBA-only. Wonders support coming soon.',
		children,
	}: {
		message?: string;
		children?: Snippet;
	} = $props();
</script>

{#if multiGameEnabled()}
	<div class="boba-only-banner">
		{#if children}
			{@render children()}
		{:else}
			<span>⚔️ {message}</span>
		{/if}
	</div>
{/if}

<style>
	.boba-only-banner {
		padding: 0.6rem 0.85rem;
		margin: 0 0 1rem;
		background: rgba(245, 158, 11, 0.08);
		border: 1px solid rgba(245, 158, 11, 0.2);
		border-radius: var(--radius-md, 10px);
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
	}
	.boba-only-banner :global(a) {
		color: var(--primary, #3b82f6);
		text-decoration: underline;
	}
</style>
