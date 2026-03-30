<script lang="ts">
	import { page } from '$app/stores';
</script>

<svelte:head>
	<title>{$page.status} — BOBA Scanner</title>
</svelte:head>

<div class="error-page">
	<div class="error-code">{$page.status}</div>
	<div class="error-message">
		{#if $page.status === 404}
			This page doesn't exist.
		{:else if $page.status === 403}
			You don't have access to this page.
		{:else if $page.status === 500}
			Something went wrong on our end.
		{:else}
			{$page.error?.message || 'An unexpected error occurred.'}
		{/if}
	</div>
	<a href="/" class="home-link">Back to scanner</a>
</div>

<style>
	.error-page {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 60vh;
		text-align: center;
		padding: 2rem;
	}
	.error-code {
		font-size: 4rem;
		font-weight: 800;
		color: var(--accent-primary, #4ade80);
		line-height: 1;
		margin-bottom: 0.5rem;
	}
	.error-message {
		font-size: 1.1rem;
		color: var(--text-secondary, #94a3b8);
		margin-bottom: 2rem;
	}
	.home-link {
		padding: 0.6rem 1.5rem;
		border-radius: 8px;
		background: var(--accent-primary, #4ade80);
		color: #000;
		text-decoration: none;
		font-weight: 600;
		font-size: 0.9rem;
	}
	.home-link:hover {
		opacity: 0.9;
	}
</style>
