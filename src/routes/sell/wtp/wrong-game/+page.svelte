<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';

	const game = $derived($page.url.searchParams.get('game') ?? 'unknown');
	const cardId = $derived($page.url.searchParams.get('card_id'));
	const scanId = $derived($page.url.searchParams.get('scan_id'));

	const gameLabel = $derived(game === 'boba' ? 'BoBA' : game === 'wonders' ? 'Wonders' : game);
</script>

<svelte:head><title>Not a Wonders card</title></svelte:head>

<div class="wrong-game">
	<div class="icon" aria-hidden="true">🤔</div>
	<h1>Not a Wonders card</h1>
	<p>You scanned a <strong>{gameLabel}</strong> card. Wonders Trading Post only sells Wonders of The First cards.</p>
	<div class="actions">
		<a href="/sell" class="primary">List on eBay instead</a>
		<a href="/sell/wtp" class="secondary">Try another card</a>
	</div>
	{#if cardId || scanId}
		<details class="diag">
			<summary>Details</summary>
			{#if scanId}<p>scan_id: <code>{scanId}</code></p>{/if}
			{#if cardId}<p>card_id: <code>{cardId}</code></p>{/if}
		</details>
	{/if}
</div>

<style>
	.wrong-game { max-width: 480px; margin: 3rem auto; padding: 2rem 1.5rem; text-align: center; display: flex; flex-direction: column; gap: 0.75rem; align-items: center; }
	.icon { font-size: 3rem; }
	h1 { font-size: 1.4rem; margin: 0.5rem 0 0; }
	p { color: var(--text-secondary, #94a3b8); margin: 0; line-height: 1.5; }
	.actions { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; min-width: 240px; }
	.actions a { display: inline-block; padding: 0.75rem 1.25rem; border-radius: 10px; font-weight: 600; text-decoration: none; }
	.actions a.primary { background: var(--accent-primary, #3b82f6); color: #fff; }
	.actions a.secondary { border: 1px solid var(--border-strong, rgba(148,163,184,0.3)); color: inherit; }
	.diag { margin-top: 2rem; font-size: 0.75rem; color: var(--text-muted, #475569); }
	.diag summary { cursor: pointer; }
	code { font-family: ui-monospace, monospace; font-size: 0.7rem; }
</style>
