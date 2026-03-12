<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/stores';
	import { supabase } from '$lib/services/supabase';
	import '../styles/index.css';

	let { children, data } = $props();
	let showMore = $state(false);

	onMount(() => {
		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((_, session) => {
			// Re-run server load when auth state changes
			invalidate('supabase:auth');
		});

		return () => subscription.unsubscribe();
	});

	const currentPath = $derived($page.url.pathname);
</script>

<div class="app-container">
	<header class="app-header">
		<div class="header-content">
			<a href="/" class="app-logo">
				<div class="logo-icon">🎴</div>
				<div>
					<div>Card Scanner</div>
					<span class="app-tagline">AI Card Detection</span>
				</div>
			</a>
			<div class="header-actions">
				{#if data.user}
					<span class="user-name">{data.user.email}</span>
					<button class="btn-secondary" onclick={() => supabase.auth.signOut()}>Sign Out</button>
				{:else}
					<a href="/auth/login" class="btn-primary">Sign In</a>
				{/if}
			</div>
		</div>
	</header>

	<main class="app-main">
		{@render children()}
	</main>

	<nav class="bottom-nav">
		<a href="/scan" class="nav-item" class:active={currentPath === '/scan'}>
			<span class="nav-icon">📷</span>
			<span class="nav-label">Scan</span>
		</a>
		<a href="/collection" class="nav-item" class:active={currentPath === '/collection'}>
			<span class="nav-icon">📚</span>
			<span class="nav-label">Collection</span>
		</a>
		<a href="/deck" class="nav-item" class:active={currentPath === '/deck'}>
			<span class="nav-icon">🃏</span>
			<span class="nav-label">Deck</span>
		</a>
		<button class="nav-item" class:active={showMore} onclick={() => (showMore = !showMore)}>
			<span class="nav-icon">...</span>
			<span class="nav-label">More</span>
		</button>
	</nav>

	{#if showMore}
		<div class="more-menu" role="presentation" onclick={() => (showMore = false)}>
			<div class="more-panel" onclick={(e) => e.stopPropagation()}>
				<a href="/grader" class="more-item" onclick={() => (showMore = false)}>Card Grader</a>
				<a href="/set-completion" class="more-item" onclick={() => (showMore = false)}>Set Completion</a>
				<a href="/marketplace/list" class="more-item" onclick={() => (showMore = false)}>eBay Lister</a>
				<a href="/marketplace/monitor" class="more-item" onclick={() => (showMore = false)}>Seller Monitor</a>
				<a href="/export" class="more-item" onclick={() => (showMore = false)}>Export</a>
				<a href="/tournaments" class="more-item" onclick={() => (showMore = false)}>Tournaments</a>
				{#if data.user}
					<a href="/admin" class="more-item" onclick={() => (showMore = false)}>Admin</a>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.more-menu {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		z-index: 99;
	}
	.more-panel {
		position: fixed;
		bottom: 70px;
		right: 0.5rem;
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		min-width: 180px;
		z-index: 100;
	}
	.more-item {
		display: block;
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		font-size: 0.9rem;
		color: var(--text-primary);
		text-decoration: none;
	}
	.more-item:hover {
		background: var(--bg-hover);
	}
</style>
