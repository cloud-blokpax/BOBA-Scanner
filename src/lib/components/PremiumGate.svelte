<script lang="ts">
	import { featureEnabled } from '$lib/stores/feature-flags';
	import type { Snippet } from 'svelte';

	let { featureKey, featureName = '', featureIcon = '🔒', children }: {
		featureKey: string;
		featureName?: string;
		featureIcon?: string;
		children: Snippet;
	} = $props();

	const enabled = featureEnabled(featureKey);
</script>

{#if $enabled}
	{@render children()}
{:else}
	<div class="premium-gate">
		<div class="gate-icon">{featureIcon}</div>
		<h3 class="gate-title">{featureName || featureKey}</h3>
		<p class="gate-desc">This feature is available for premium members.</p>
		<a href="/settings" class="gate-cta">Learn More</a>
	</div>
{/if}

<style>
	.premium-gate { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 3rem 1.5rem; border-radius: 16px; background: var(--bg-elevated, #121d34); border: 1px dashed var(--border-strong, rgba(148,163,184,0.2)); gap: 0.75rem; }
	.gate-icon { font-size: 2.5rem; opacity: 0.6; }
	.gate-title { font-family: var(--font-display, 'Syne', sans-serif); font-size: 1.1rem; font-weight: 700; color: var(--text-primary, #e2e8f0); margin: 0; }
	.gate-desc { font-size: 0.85rem; color: var(--text-secondary, #94a3b8); margin: 0; max-width: 280px; }
	.gate-cta { display: inline-block; margin-top: 0.5rem; padding: 0.5rem 1.25rem; border-radius: 8px; background: var(--gold, #f59e0b); color: #000; font-weight: 600; font-size: 0.9rem; text-decoration: none; }
</style>
