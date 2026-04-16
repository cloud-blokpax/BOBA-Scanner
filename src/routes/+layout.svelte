<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate, onNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import { getSupabase } from '$lib/services/supabase';
	import { setupAutoSync } from '$lib/services/sync';
	import { showToast } from '$lib/stores/toast.svelte';
	import { initErrorTracking } from '$lib/services/error-tracking';
	import { initVersionChecking } from '$lib/services/version.svelte';
	import {
		isPro, daysRemaining, proExpired,
		showExpiryWarning, showFinalWarning,
		showGoProModal, setShowGoProModal
	} from '$lib/stores/pro.svelte';
	import { scannerActive } from '$lib/stores/scanner.svelte';
	import { loadNavConfig, clearNavConfig, visibleNavItems } from '$lib/stores/nav-config.svelte';
	import { loadFeatureFlags } from '$lib/stores/feature-flags.svelte';
	import GoProModal from '$lib/components/GoProModal.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import UpdateBanner from '$lib/components/UpdateBanner.svelte';
	import CategoryTabs from '$lib/components/CategoryTabs.svelte';
	import { getCategoryForPath } from '$lib/data/category-tabs';
	import '../styles/index.css';

	let { children, data } = $props();

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
		// Bootstrap feature flags once per session so gated UI
		// (multi-game hub, Pro features, etc.) resolves correctly
		// on every route. Dedupes internally; safe to call anywhere.
		void loadFeatureFlags();

		// Verify IndexedDB health (fire-and-forget, non-blocking)
		import('$lib/services/idb').then(({ verifyIdbHealth }) =>
			verifyIdbHealth().then((status) => {
				if (status === 'recovered') {
					showToast('Local cache was reset — your data will resync from the cloud.', 'ℹ️', 5000);
				} else if (status === 'unavailable') {
					showToast('Offline storage unavailable — some features may not work.', 'ℹ️', 5000);
				}
			})
		).catch((err) => { console.warn('[layout] IDB health check failed:', err); });

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
			loadNavConfig();
		} else {
			// Load from localStorage even when not logged in
			loadNavConfig();
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
				loadNavConfig();
			} else {
				clearNavConfig();
			}

			// Process pending card from pre-auth scan (Change 10)
			if (event === 'SIGNED_IN' && newSession?.user) {
				const pendingRaw = sessionStorage.getItem('pending_add_card');
				if (pendingRaw) {
					sessionStorage.removeItem('pending_add_card');
					try {
						const pending = JSON.parse(pendingRaw);
						if (pending.card_id) {
							import('$lib/stores/collection.svelte').then(({ addToCollection }) => {
								addToCollection(pending.card_id).then(() => {
									showToast(`${pending.hero_name || pending.card_number || 'Card'} added to your collection!`, '✓');
								});
							});
						}
					} catch (err) { console.debug('[layout] Failed to parse pending card from sessionStorage:', err); }
				}
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
			navigator.storage.persist().catch((err) => console.debug('[layout] Storage persist request failed:', err));
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
	const categoryInfo = $derived(getCategoryForPath(currentPath, $page.url.search));
</script>

<div class="app-container" class:scanner-fullscreen={scannerActive()}>
	{#if !scannerActive()}
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
					<a href="/settings" class="header-profile-btn" aria-label="Settings">
						{#if isPro()}
							<span class="pro-dot"></span>
						{/if}
						<span class="profile-initial">{(data.user.email?.[0] || '?').toUpperCase()}</span>
					</a>
				{:else}
					<a href="/auth/login" class="btn-primary header-signin">Sign In</a>
				{/if}
			</div>
		</div>
	</header>
	{/if}

	<!-- Pro expiry banners -->
	{#if data.user && !scannerActive()}
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
		{#if !scannerActive() && categoryInfo}
			<CategoryTabs tabs={categoryInfo.tabs} category={categoryInfo.category} />
		{/if}
		{@render children()}
	</main>

	{#if !scannerActive()}
	<footer class="affiliate-footer">
		eBay Partner: we may earn from qualifying purchases. <a href="/privacy#6-ebay-affiliate-links">Learn more</a>
	</footer>

	{@const items = visibleNavItems()}
	{@const splitAt = Math.ceil(items.length / 2)}
	<nav class="bottom-nav">
		{#each items.slice(0, splitAt) as item (item.id)}
			<a href={item.path} class="bottom-nav-item" class:active={item.matchPaths ? item.matchPaths.some(p => currentPath.startsWith(p)) : currentPath === item.path}>
				<span class="bottom-nav-icon">{item.icon}</span>
				<span class="bottom-nav-label">{item.label}</span>
			</a>
		{/each}
		<a href="/scan" class="scan-fab" class:active={currentPath === '/scan'} aria-label="Scan Card">
			<span class="scan-fab-icon">📷</span>
		</a>
		{#each items.slice(splitAt) as item (item.id)}
			<a href={item.path} class="bottom-nav-item" class:active={item.matchPaths ? item.matchPaths.some(p => currentPath.startsWith(p)) : currentPath === item.path}>
				<span class="bottom-nav-icon">{item.icon}</span>
				<span class="bottom-nav-label">{item.label}</span>
			</a>
		{/each}
	</nav>
	{/if}
</div>

<UpdateBanner />
<Toast />

{#if data.user}
	<GoProModal open={showGoProModal()} onclose={() => setShowGoProModal(false)} />
{/if}

<style>
	/* Full-screen scanner mode — no header/footer chrome */
	.app-container.scanner-fullscreen {
		display: flex;
		flex-direction: column;
	}
	.app-container.scanner-fullscreen .app-main {
		padding: 0 !important;
		max-width: 100% !important;
		overflow: hidden !important;
	}

	.affiliate-footer {
		text-align: center;
		font-size: 0.65rem;
		color: var(--text-muted, #475569);
		padding: 0.5rem 1rem;
		opacity: 0.7;
	}
	.affiliate-footer a {
		color: var(--text-muted, #475569);
		text-decoration: underline;
	}

	/* Profile button in header */
	.header-profile-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		text-decoration: none;
		position: relative;
		transition: border-color 0.15s;
	}
	.header-profile-btn:hover {
		border-color: var(--gold, #f59e0b);
	}
	.profile-initial {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-primary, #e2e8f0);
		line-height: 1;
	}
	.pro-dot {
		position: absolute;
		top: -1px;
		right: -1px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--gold, #f59e0b);
		border: 2px solid var(--bg-base, #070b14);
	}
	.header-signin {
		padding: 0.375rem 0.75rem;
		font-size: 0.85rem;
		border-radius: 8px;
		text-decoration: none;
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
