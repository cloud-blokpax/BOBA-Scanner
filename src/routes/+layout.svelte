<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate, onNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import { getSupabase } from '$lib/services/supabase';
	import { featureEnabled } from '$lib/stores/feature-flags';

	const hasScanToList = featureEnabled('scan_to_list');
	import { showToast } from '$lib/stores/toast';
	import { initErrorTracking } from '$lib/services/error-tracking';
	import { initVersionChecking } from '$lib/services/version';
	import ProfilePrompt from '$lib/components/ProfilePrompt.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import '../styles/index.css';

	let { children, data } = $props();
	let showMore = $state(false);

	// View Transitions API for smooth page navigation
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	onMount(() => {
		const client = getSupabase();

		// Server-verified auth check — uses getUser() instead of getSession()
		// to prevent reliance on potentially tampered localStorage data.
		client?.auth.getUser().then(async ({ data: { user: clientUser } }) => {
			const serverHasUser = !!data.session;
			const clientHasUser = !!clientUser;
			if (clientHasUser && !serverHasUser) {
				// Client auth is valid but server didn't see it — refresh cookies
				try {
					await client.auth.refreshSession();
				} catch (err) {
					console.warn('Failed to refresh auth session:', err);
				}
				invalidate('supabase:auth');
			} else if (serverHasUser !== clientHasUser) {
				invalidate('supabase:auth');
			}
		}).catch((err) => {
			console.warn('Failed to verify client auth:', err);
		});

		const authSubscription = client?.auth.onAuthStateChange((event, newSession) => {
			// Only invalidate when the session actually changes to avoid redundant server re-fetches
			if (newSession?.expires_at !== data.session?.expires_at) {
				invalidate('supabase:auth');
			}
		});

		// Initialize error tracking (sends client errors to /api/log)
		const cleanupErrors = initErrorTracking();

		// Initialize version checking (checks /version.json periodically)
		const cleanupVersion = initVersionChecking();

		// Register Service Worker for PWA offline support
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.register('/sw.js').catch((err) => {
				console.warn('SW registration failed:', err);
			});
		}

		// Request persistent storage to prevent browser from evicting cached data
		if (navigator.storage?.persist) {
			navigator.storage.persist().catch(() => {});
		}

		// Process queued offline scans when connectivity returns
		const handleOnline = async () => {
			const { scanQueue } = await import('$lib/services/idb');
			const queued = await scanQueue.getAll();
			if (queued.length === 0) return;

			showToast(`Processing ${queued.length} queued scan(s)...`, 'info');

			const { recognizeCard } = await import('$lib/services/recognition');
			for (const item of queued) {
				try {
					await recognizeCard(item.imageBlob);
					await scanQueue.remove(item.id);
				} catch {
					// Leave failed items in queue for next attempt
				}
			}
			const remaining = await scanQueue.count();
			if (remaining === 0) {
				showToast('All queued scans processed!', 'check');
			}
		};
		window.addEventListener('online', handleOnline);

		return () => {
			authSubscription?.data.subscription.unsubscribe();
			cleanupErrors();
			cleanupVersion();
			window.removeEventListener('online', handleOnline);
		};
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
					<button class="btn-secondary" onclick={() => getSupabase()?.auth.signOut()}>Sign Out</button>
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
		<a href="/collection" class="bottom-nav-item" class:active={currentPath === '/collection'}>
			<span class="bottom-nav-icon">📚</span>
			<span class="bottom-nav-label">Collection</span>
		</a>
		<a href="/scan" class="scan-fab" class:active={currentPath === '/scan'} aria-label="Scan Card">
			<span class="scan-fab-icon">📷</span>
		</a>
		<button class="bottom-nav-item" class:active={showMore} onclick={() => (showMore = !showMore)}>
			<span class="bottom-nav-icon">👤</span>
			<span class="bottom-nav-label">More</span>
		</button>
	</nav>

	{#if showMore}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="more-menu" role="presentation" onclick={() => (showMore = false)}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="more-panel" onclick={(e) => e.stopPropagation()}>
				<a href="/" class="more-item" onclick={() => (showMore = false)}>Home</a>
				<a href="/deck" class="more-item" onclick={() => (showMore = false)}>Deck Builder</a>
				<a href="/dbs" class="more-item" onclick={() => (showMore = false)}>DBS Calculator</a>
				<a href="/grader" class="more-item" onclick={() => (showMore = false)}>Card Grader</a>
				<a href="/set-completion" class="more-item" onclick={() => (showMore = false)}>Set Completion</a>
				<a href="/marketplace/monitor" class="more-item" onclick={() => (showMore = false)}>Seller Monitor</a>
				<a href="/export" class="more-item" onclick={() => (showMore = false)}>Export</a>
				<a href="/tournaments" class="more-item" onclick={() => (showMore = false)}>Tournaments</a>
				<a href="/speed" class="more-item" onclick={() => (showMore = false)}>Speed Challenge</a>
				{#if $hasScanToList}
					<a href="/settings" class="more-item" onclick={() => (showMore = false)}>
						<span class="premium-badge">PRO</span> eBay Listings
					</a>
				{/if}
				{#if data.user}
					<a href="/settings" class="more-item" onclick={() => (showMore = false)}>Settings</a>
				{/if}
				{#if data.user?.is_admin}
					<a href="/admin" class="more-item" onclick={() => (showMore = false)}>Admin</a>
				{/if}
			</div>
		</div>
	{/if}
</div>

<Toast />

{#if data.user}
	<ProfilePrompt />
{/if}

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
	.premium-badge {
		display: inline-block; padding: 1px 5px; border-radius: 3px;
		font-size: 0.6rem; font-weight: 700;
		background: var(--gold, #f59e0b); color: #000;
		margin-right: 4px; vertical-align: middle;
	}
</style>
