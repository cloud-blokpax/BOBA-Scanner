<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate, onNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import { getSupabase } from '$lib/services/supabase';
	import { setupAutoSync } from '$lib/services/sync';
	import { featureEnabled } from '$lib/stores/feature-flags.svelte';

	const hasScanToList = featureEnabled('scan_to_list');
	import { showToast } from '$lib/stores/toast.svelte';
	import { initErrorTracking } from '$lib/services/error-tracking';
	import { initVersionChecking } from '$lib/services/version';
	import {
		isPro, daysRemaining, proExpired,
		showExpiryWarning, showFinalWarning,
		showGoProModal, setShowGoProModal
	} from '$lib/stores/pro.svelte';
	import GoProModal from '$lib/components/GoProModal.svelte';
	import ProfilePrompt from '$lib/components/ProfilePrompt.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import UpdateBanner from '$lib/components/UpdateBanner.svelte';
	import '../styles/index.css';

	let { children, data } = $props();
	let showMore = $state(false);

	// Expiry banner dismiss state (persisted in localStorage)
	let expiryBannerDismissed = $state(false);
	let finalBannerDismissed = $state(false);
	let expiredBannerDismissed = $state(false);

	onMount(() => {
		// Restore dismiss state from localStorage
		const expiredDismissedAt = localStorage.getItem('proExpiredDismissedAt');
		if (expiredDismissedAt) {
			const dismissedAt = parseInt(expiredDismissedAt, 10);
			if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) {
				expiredBannerDismissed = true;
			}
		}
	});

	function dismissExpiryBanner() { expiryBannerDismissed = true; }
	function dismissFinalBanner() { finalBannerDismissed = true; }
	function dismissExpiredBanner() {
		expiredBannerDismissed = true;
		localStorage.setItem('proExpiredDismissedAt', Date.now().toString());
	}

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
		// Verify IndexedDB health (fire-and-forget, non-blocking)
		import('$lib/services/idb').then(({ verifyIdbHealth }) =>
			verifyIdbHealth().then((status) => {
				if (status === 'recovered') {
					showToast('Local cache was reset — your data will resync from the cloud.', 'ℹ️', 5000);
				} else if (status === 'unavailable') {
					showToast('Offline storage unavailable — some features may not work.', 'ℹ️', 5000);
				}
			})
		).catch(() => { /* IDB check failed — non-fatal */ });

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

		// Activate bidirectional collection sync (5-minute interval)
		let cleanupSync = () => {};
		if (data.user) {
			cleanupSync = setupAutoSync();
		}

		const authSubscription = client?.auth.onAuthStateChange((event, newSession) => {
			// Only invalidate when the session actually changes to avoid redundant server re-fetches
			if (newSession?.expires_at !== data.session?.expires_at) {
				invalidate('supabase:auth');
			}
			// Start/stop sync when auth changes
			cleanupSync();
			if (newSession?.user) {
				cleanupSync = setupAutoSync();
			}
		});

		// Initialize error tracking (sends client errors to /api/log)
		const cleanupErrors = initErrorTracking();

		// Initialize version checking (checks /version.json periodically)
		const cleanupVersion = initVersionChecking();

		// Register Service Worker for PWA offline support
		// SvelteKit generates service-worker.js from src/service-worker.ts
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.register('/service-worker.js').catch((err) => {
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

			// Filter out stale items (older than 24 hours)
			const STALE_THRESHOLD = 24 * 60 * 60 * 1000;
			const fresh = queued.filter(item => Date.now() - item.timestamp < STALE_THRESHOLD);
			const stale = queued.filter(item => Date.now() - item.timestamp >= STALE_THRESHOLD);

			// Remove stale items
			for (const item of stale) {
				await scanQueue.remove(item.id);
			}

			if (fresh.length === 0) return;

			showToast(`Processing ${fresh.length} queued scan(s)...`, 'ℹ️');

			const { recognizeCard } = await import('$lib/services/recognition');
			const { addToCollection } = await import('$lib/stores/collection.svelte');
			let successCount = 0;
			let failCount = 0;

			for (const item of fresh) {
				try {
					const result = await recognizeCard(item.imageBlob);
					if (result?.card_id) {
						try {
							await addToCollection(result.card_id, 'near_mint');
							successCount++;
						} catch {
							// Collection add failed but scan succeeded — still remove from queue
						}
					}
					await scanQueue.remove(item.id);
				} catch (err) {
					failCount++;
					// Don't remove from queue — it will be retried next time we come online
					console.debug('[scan-queue] Scan failed, will retry:', err);
				}
			}

			if (failCount > 0) {
				showToast(`Processed ${successCount} scan(s), ${failCount} will retry later.`, 'ℹ️');
			} else if (successCount > 0) {
				showToast(`Done! ${successCount} card(s) added to collection.`, '✓');
			}
		};
		window.addEventListener('online', handleOnline);

		return () => {
			authSubscription?.data.subscription.unsubscribe();
			cleanupErrors();
			cleanupVersion();
			cleanupSync();
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
					{#if isPro()}
						<span class="pro-badge-header">PRO</span>
					{/if}
					<span class="user-name">{data.user.email}</span>
					<button class="btn-secondary" onclick={() => getSupabase()?.auth.signOut()}>Sign Out</button>
				{:else}
					<a href="/auth/login" class="btn-primary">Sign In</a>
				{/if}
			</div>
		</div>
	</header>

	<!-- Pro expiry banners -->
	{#if data.user}
		{#if showExpiryWarning() && !expiryBannerDismissed}
			<div class="pro-expiry-banner expiry-soon">
				<span>Your Pro access expires in {daysRemaining()} days</span>
				<button class="banner-cta" onclick={() => setShowGoProModal(true)}>Renew</button>
				<button class="banner-dismiss" onclick={dismissExpiryBanner}>&times;</button>
			</div>
		{:else if showFinalWarning() && !finalBannerDismissed}
			<div class="pro-expiry-banner expiry-tomorrow">
				<span>Your Pro access expires tomorrow</span>
				<button class="banner-cta" onclick={() => setShowGoProModal(true)}>Renew</button>
				<button class="banner-dismiss" onclick={dismissFinalBanner}>&times;</button>
			</div>
		{:else if proExpired() && !expiredBannerDismissed}
			<div class="pro-expiry-banner expiry-lapsed">
				<span>Your Pro access has expired</span>
				<button class="banner-cta" onclick={() => setShowGoProModal(true)}>Renew</button>
				<button class="banner-dismiss" onclick={dismissExpiredBanner}>&times;</button>
			</div>
		{/if}
	{/if}

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
		<div class="more-menu" role="presentation" onkeydown={(e) => e.key === 'Escape' && (showMore = false)}>
			<button class="more-menu-dismiss" type="button" aria-label="Close menu" tabindex="-1" onclick={() => (showMore = false)}></button>
			<div class="more-panel">
				<a href="/" class="more-item" onclick={() => (showMore = false)}>Home</a>
				<a href="/deck" class="more-item" onclick={() => (showMore = false)}>My Decks</a>
				<a href="/dbs" class="more-item" onclick={() => (showMore = false)}>DBS Calculator</a>
				<a href="/grader" class="more-item" onclick={() => (showMore = false)}>Card Grader</a>
				<a href="/batch" class="more-item" onclick={() => (showMore = false)}>Batch Scanner</a>
				<a href="/binder" class="more-item" onclick={() => (showMore = false)}>Binder Scanner</a>
				<a href="/set-completion" class="more-item" onclick={() => (showMore = false)}>Set Completion</a>
				<a href="/marketplace/monitor" class="more-item" onclick={() => (showMore = false)}>Seller Monitor</a>
				<a href="/export" class="more-item" onclick={() => (showMore = false)}>Export</a>
				<a href="/tournaments" class="more-item" onclick={() => (showMore = false)}>Tournaments</a>
				<a href="/speed" class="more-item" onclick={() => (showMore = false)}>Speed Challenge</a>
				<a href="/leaderboard" class="more-item" onclick={() => (showMore = false)}>Leaderboard</a>
				{#if hasScanToList()}
					<a href="/settings" class="more-item" onclick={() => (showMore = false)}>
						<span class="premium-badge">PRO</span> eBay Listings
					</a>
				{/if}
				{#if data.user && !isPro()}
					<button class="more-item go-pro-item" onclick={() => { showMore = false; setShowGoProModal(true); }}>
						⭐ Go Pro
					</button>
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

<UpdateBanner />
<Toast />

{#if data.user}
	<ProfilePrompt />
	<GoProModal open={showGoProModal()} onclose={() => setShowGoProModal(false)} />
{/if}

<style>
	.more-menu {
		position: fixed;
		inset: 0;
		z-index: 99;
	}
	.more-menu-dismiss {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.4);
		border: none;
		appearance: none;
		cursor: default;
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
		background: none;
		border: none;
		text-align: left;
		cursor: pointer;
		width: 100%;
	}
	.more-item:hover {
		background: var(--bg-hover);
	}
	.go-pro-item {
		color: var(--gold);
		font-weight: 600;
	}
	.premium-badge {
		display: inline-block; padding: 1px 5px; border-radius: 3px;
		font-size: 0.6rem; font-weight: 700;
		background: var(--gold, #f59e0b); color: #000;
		margin-right: 4px; vertical-align: middle;
	}

	/* Pro badge in header */
	.pro-badge-header {
		display: inline-block;
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 0.6rem;
		font-weight: 800;
		letter-spacing: 0.05em;
		background: var(--gold);
		color: #000;
		vertical-align: middle;
	}

	/* Expiry banners */
	.pro-expiry-banner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 1rem;
		font-size: 0.85rem;
		color: var(--text-primary);
	}
	.pro-expiry-banner span:first-child {
		flex: 1;
	}
	.expiry-soon {
		background: var(--bg-elevated);
		border-left: 3px solid var(--gold);
	}
	.expiry-tomorrow {
		background: rgba(245, 158, 11, 0.08);
		border-left: 3px solid var(--gold);
	}
	.expiry-lapsed {
		background: var(--bg-elevated);
		border-left: 3px solid var(--text-tertiary);
	}
	.banner-cta {
		padding: 0.25rem 0.75rem;
		border-radius: 6px;
		border: none;
		background: var(--gold);
		color: #000;
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
	}
	.banner-dismiss {
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		font-size: 1.1rem;
		padding: 0.25rem;
		line-height: 1;
	}
</style>
