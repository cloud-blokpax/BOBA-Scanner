<script lang="ts">
	import { page } from '$app/stores';

	const wtpUrl = $derived($page.url.searchParams.get('wtp_url'));
	const alreadyPosted = $derived($page.url.searchParams.get('already_posted') === '1');
</script>

<svelte:head><title>Listed on WTP</title></svelte:head>

<div class="success">
	<div class="check" aria-hidden="true">✓</div>
	{#if alreadyPosted}
		<h1>Already listed</h1>
		<p>This card was already posted to Wonders Trading Post.</p>
	{:else}
		<h1>Listed!</h1>
		<p>Your card is now live on Wonders Trading Post.</p>
	{/if}

	{#if wtpUrl}
		<a href={wtpUrl} target="_blank" rel="noopener" class="primary">View listing on WTP</a>
	{/if}
	<a href="/sell/wtp" class="secondary">Sell another card</a>
	<a href="/sell/wtp/history" class="text-link">See all my WTP listings</a>
</div>

<style>
	.success { max-width: 480px; margin: 3rem auto; padding: 2rem 1.5rem; text-align: center; display: flex; flex-direction: column; gap: 0.75rem; align-items: center; }
	.check { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; background: rgba(34, 197, 94, 0.15); color: #22c55e; font-size: 2rem; font-weight: 700; }
	h1 { font-size: 1.5rem; margin: 0.5rem 0 0; }
	p { color: var(--text-secondary, #94a3b8); margin: 0; }
	a { display: inline-block; padding: 0.75rem 1.25rem; border-radius: 10px; font-weight: 600; text-decoration: none; min-width: 220px; }
	a.primary { background: var(--accent-primary, #3b82f6); color: #fff; margin-top: 1rem; }
	a.secondary { border: 1px solid var(--border-strong, rgba(148,163,184,0.3)); color: inherit; }
	a.text-link { color: var(--text-secondary, #94a3b8); padding: 0.5rem; min-width: 0; font-size: 0.875rem; }
</style>
