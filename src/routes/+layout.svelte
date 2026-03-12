<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/stores';
	import { supabase } from '$lib/services/supabase';
	import '../styles/index.css';

	let { children, data } = $props();

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
	</nav>
</div>
