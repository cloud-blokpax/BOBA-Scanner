<script lang="ts">
	import { getSupabase } from '$lib/services/supabase';
	import { idb } from '$lib/services/idb';
	import { user } from '$lib/stores/auth.svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import { isPro, proUntil, daysRemaining, proExpired, setShowGoProModal } from '$lib/stores/pro.svelte';
	import { getUserProfile, ensureProfileLoaded } from '$lib/stores/feature-flags.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	let loading = $state(true);
	let saving = $state(false);
	let profileName = $state('');
	let discordId = $state('');
	let email = $state('');
	let showProfile = $state(false);
	// Badges state
	let badges = $state<Array<{ badge_key: string; badge_name: string; badge_description: string | null; badge_icon: string | null; earned_at: string }>>([]);

	// eBay connection state
	let ebayConfigured = $state(false);
	let ebayConnected = $state(false);
	let ebayConnectedSince = $state<string | null>(null);
	let ebayLoading = $state(true);
	let ebayDisconnecting = $state(false);
	let ebayJustDisconnected = $state(false);
	let ebayValidating = $state(false);
	let ebayValidation = $state<{ valid: boolean; sellingLimit?: { amount: number; quantity: number }; error?: string } | null>(null);
	let ebayTokenHealth = $state<{ access_token_valid: boolean; access_token_expires_at: string; refresh_token_expires_at: string; refresh_days_remaining: number; scopes: string | null } | null>(null);

	async function loadProfile() {
		loading = true;
		const currentUser = user();
		if (!currentUser) {
			loading = false;
			return;
		}
		const client = getSupabase();
		if (!client) {
			loading = false;
			return;
		}

		// Prefer server-provided email (always available for authenticated users),
		// fall back to client-side auth store
		email = $page.data.user?.email || currentUser.email || '';

		const { data } = await client
			.from('users')
			.select('name, discord_id')
			.eq('auth_user_id', currentUser.id)
			.single();

		if (data) {
			profileName = data.name || '';
			discordId = data.discord_id || '';
		}
		await loadBadges();
		loading = false;
	}

	async function loadBadges() {
		const client = getSupabase();
		if (!client || !user()) return;
		const { data } = await client
			.from('user_badges')
			.select('badge_key, badge_name, badge_description, badge_icon, earned_at')
			.eq('user_id', user()!.id)
			.order('earned_at', { ascending: true });
		badges = data || [];
	}

	async function saveProfile() {
		saving = true;
		try {
			const res = await fetch('/api/profile', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: profileName.trim() || null,
					discord_id: discordId.trim() || null
				})
			});

			if (res.status === 401) {
				showToast('Please sign in to save', 'x');
				saving = false;
				return;
			}

			if (!res.ok) {
				const err = await res.json().catch(() => ({ error: 'Save failed' }));
				throw new Error(err.error || 'Save failed');
			}

			showToast('Profile saved', 'check');
			showProfile = false;
		} catch (err) {
			console.debug('[settings] Profile save failed:', err);
			showToast('Failed to save profile', 'x');
		}
		saving = false;
	}

	let exporting = $state(false);

	async function exportCardDatabase() {
		exporting = true;
		try {
			const cards = await idb.getCards();
			if (!cards || cards.length === 0) {
				showToast('No cards found in local cache', 'x');
				exporting = false;
				return;
			}
			const blob = new Blob([JSON.stringify(cards)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `boba-card-database-${new Date().toISOString().slice(0, 10)}.json`;
			a.click();
			URL.revokeObjectURL(url);
			showToast(`Exported ${cards.length} cards`, 'check');
		} catch (err) {
			console.debug('[settings] Card export failed:', err);
			showToast('Export failed', 'x');
		}
		exporting = false;
	}

	async function handleSignOut() {
		const client = getSupabase();
		await client?.auth.signOut();
		goto('/');
	}

	$effect(() => {
		const currentUser = user();
		if (currentUser) {
			loadProfile();
		} else {
			loading = false;
		}
	});

	// Check eBay OAuth callback params (guard to prevent re-firing)
	let ebayParamHandled = false;
	$effect(() => {
		const ebayParam = $page.url.searchParams.get('ebay');
		if (ebayParamHandled || !ebayParam) return;
		ebayParamHandled = true;
		if (ebayParam === 'connected') {
			showToast('eBay account connected!', 'check');
			ebayConnected = true;
		} else if (ebayParam === 'error') {
			showToast('eBay connection failed', 'x');
		}
	});

	// Load eBay status (run once on mount)
	let ebayStatusFetched = false;
	$effect(() => {
		if (ebayStatusFetched) return;
		ebayStatusFetched = true;
		fetch('/api/ebay/status')
			.then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
			.then(data => {
				ebayConfigured = data.configured;
				ebayConnected = data.connected;
				ebayConnectedSince = data.connected_since ?? null;
				ebayTokenHealth = data.token_health ?? null;
			})
			.catch((err) => console.warn('[settings] eBay status check failed:', err))
			.finally(() => { ebayLoading = false; });
	});

	async function disconnectEbay() {
		ebayDisconnecting = true;
		try {
			const res = await fetch('/api/ebay/disconnect', { method: 'POST' });
			if (!res.ok) throw new Error();
			ebayConnected = false;
			ebayConnectedSince = null;
			ebayJustDisconnected = true;
			showToast('eBay account disconnected', 'check');
		} catch (err) {
			console.debug('[settings] eBay disconnect failed:', err);
			showToast('Failed to disconnect eBay', 'x');
		}
		ebayDisconnecting = false;
	}

	async function validateEbay() {
		ebayValidating = true;
		ebayValidation = null;
		try {
			const res = await fetch('/api/ebay/validate', { method: 'POST' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			ebayValidation = data;
			if (data.valid) {
				showToast('eBay connection verified', 'check');
			} else {
				ebayConnected = false;
				showToast(data.error || 'eBay connection invalid', 'x');
			}
		} catch (err) {
			console.debug('[settings] eBay validation failed:', err);
			ebayValidation = { valid: false, error: 'Validation request failed' };
			showToast('Could not validate eBay connection', 'x');
		}
		ebayValidating = false;
	}

	$effect(() => { ensureProfileLoaded(); });

	const isAdmin = $derived(getUserProfile()?.is_admin === true);
</script>

<svelte:head>
	<title>Settings - Card Scanner</title>
</svelte:head>

<div class="settings-page">
	{#if loading}
		<div class="loading">Loading...</div>
	{:else}
		<!-- User Identity Card -->
		<div class="identity-card">
			<div class="identity-avatar">
				{(email?.[0] || '?').toUpperCase()}
			</div>
			<div class="identity-info">
				<div class="identity-name-row">
					<span class="identity-name">{discordId || profileName || email?.split('@')[0] || 'Coach'}</span>
					{#if isPro()}
						<span class="identity-pro-badge">PRO</span>
					{/if}
				</div>
				<span class="identity-sub">
					{#if isPro()}
						{daysRemaining()} days remaining
					{:else if proExpired()}
						Pro expired
					{:else}
						Free plan
					{/if}
				</span>
			</div>
			<svg class="chevron" viewBox="0 0 20 20" width="20" height="20">
				<path d="M7.5 4L13.5 10L7.5 16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
			</svg>
		</div>

		<!-- Account Group -->
		<div class="settings-group">
			<div class="group-label">Account</div>
			<div class="group-card">
				<button class="settings-row" onclick={() => showProfile = !showProfile}>
					<div class="row-icon" style="background: rgba(59,130,246,0.12);">
						<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" style="color: #3b82f6;">
							<path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0H3z"/>
						</svg>
					</div>
					<div class="row-content">
						<span class="row-title">Profile</span>
						<span class="row-sub">Name, email, Discord</span>
					</div>
					<svg class="chevron" viewBox="0 0 20 20" width="16" height="16">
						<path d="M7.5 4L13.5 10L7.5 16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
					</svg>
				</button>

				{#if showProfile}
					<div class="profile-form">
						<div>
							<label for="s-email">Email</label>
							<input id="s-email" type="email" value={email} disabled style="opacity: 0.6;" />
						</div>
						<div>
							<label for="s-name">Name</label>
							<input id="s-name" type="text" bind:value={profileName} placeholder="Your name" />
						</div>
						<div>
							<label for="s-discord">Discord ID</label>
							<input id="s-discord" type="text" bind:value={discordId} placeholder="username#1234" />
						</div>
						<button class="save-btn" onclick={saveProfile} disabled={saving}>
							{saving ? 'Saving...' : 'Save Changes'}
						</button>
					</div>
				{/if}

				<button class="settings-row" onclick={() => setShowGoProModal(true)}>
					<div class="row-icon" style="background: rgba(245,158,11,0.12);">
						<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" style="color: #f59e0b;">
							<path d="M10 2l2.5 5.5L18 8.5l-4 4 1 5.5-5-2.5-5 2.5 1-5.5-4-4 5.5-1z"/>
						</svg>
					</div>
					<div class="row-content">
						<span class="row-title">Subscription</span>
						<span class="row-sub">
							{#if isPro()}Pro until {proUntil()?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{:else}Free plan{/if}
						</span>
					</div>
					<svg class="chevron" viewBox="0 0 20 20" width="16" height="16">
						<path d="M7.5 4L13.5 10L7.5 16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
					</svg>
				</button>

				<div class="settings-row ebay-row">
					<div class="row-icon" style="background: rgba(16,185,129,0.12);">
						<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" style="color: #10b981;">
							<path d="M4 4h12v2H4V4zm0 5h12v2H4V9zm0 5h8v2H4v-2z"/>
						</svg>
					</div>
					<div class="row-content">
						<span class="row-title">eBay seller</span>
						<span class="row-sub" class:connected={ebayConnected && ebayValidation?.valid !== false}>
							{#if ebayLoading}Checking...
							{:else if ebayConnected}Connected{#if ebayConnectedSince} {new Date(ebayConnectedSince).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{/if}
							{:else if ebayConfigured}Not connected
							{:else}Coming soon
							{/if}
						</span>
						{#if ebayValidation}
							<span class="ebay-validation-result" class:valid={ebayValidation.valid} class:invalid={!ebayValidation.valid}>
								{#if ebayValidation.valid}
									Verified
									{#if ebayValidation.sellingLimit}
										&middot; Limit: {ebayValidation.sellingLimit.quantity} items / ${ebayValidation.sellingLimit.amount.toLocaleString()}
									{/if}
								{:else}
									{ebayValidation.error || 'Connection invalid'}
								{/if}
							</span>
						{/if}
						{#if ebayTokenHealth && ebayConnected}
							<div class="ebay-token-health">
								<span class="token-detail">
									<span class="token-dot" class:healthy={ebayTokenHealth.access_token_valid} class:expired={!ebayTokenHealth.access_token_valid}></span>
									Access token {ebayTokenHealth.access_token_valid ? 'active' : 'expired (will auto-refresh)'}
								</span>
								<span class="token-detail">
									<span class="token-dot healthy"></span>
									Refresh token &middot; {ebayTokenHealth.refresh_days_remaining}d remaining
									{#if ebayTokenHealth.refresh_days_remaining <= 30}
										<span class="token-warning">&#9888;</span>
									{/if}
								</span>
							</div>
						{/if}
					</div>
					<div class="ebay-actions">
						{#if ebayConnected}
							<button class="row-action-btn row-action-test" onclick={validateEbay} disabled={ebayValidating}>
								{ebayValidating ? '...' : 'Test'}
							</button>
							<button class="row-action-btn" onclick={disconnectEbay} disabled={ebayDisconnecting}>
								{ebayDisconnecting ? '...' : 'Disconnect'}
							</button>
						{:else if ebayConfigured}
							<a href="/auth/ebay?from=/settings" class="row-action-btn row-action-connect" data-sveltekit-reload>Connect</a>
						{/if}
					</div>
				</div>
				{#if ebayJustDisconnected && !ebayConnected}
					<div class="ebay-revoke-hint">
						Disconnected from this app. If you suspect your account was compromised, also revoke this app's authorization at
						<a href="https://accounts.ebay.com/uas/PreferencesApplications" target="_blank" rel="noopener noreferrer">eBay → Apps you've authorized</a>.
						Revoking here only deletes the connection from Card Scanner; revoking at eBay is what fully invalidates the access token.
					</div>
				{/if}
			</div>
		</div>

		<!-- Badges -->
		{#if badges.length > 0}
			<div class="settings-group">
				<div class="group-label">Badges</div>
				<div class="badges-strip">
					{#each badges as badge}
						<div class="badge-tile">
							<div class="badge-icon-wrap">{badge.badge_icon}</div>
							<span class="badge-name">{badge.badge_name}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Data Group -->
		<div class="settings-group">
			<div class="group-label">Data</div>
			<div class="group-card">
				<a href="/export" class="settings-row">
					<div class="row-icon" style="background: rgba(59,130,246,0.12);">
						<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" style="color: #3b82f6;">
							<path d="M3 17h14v-2H3v2zm7-4l5-5h-3V2H8v6H5l5 5z"/>
						</svg>
					</div>
					<div class="row-content">
						<span class="row-title">Export collection</span>
					</div>
					<svg class="chevron" viewBox="0 0 20 20" width="16" height="16">
						<path d="M7.5 4L13.5 10L7.5 16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
					</svg>
				</a>
				<button class="settings-row" onclick={exportCardDatabase} disabled={exporting}>
					<div class="row-icon" style="background: rgba(148,163,184,0.08);">
						<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" style="color: #94a3b8;">
							<path d="M4 4h12v2H4V4zm0 5h12v2H4V9zm0 5h8v2H4v-2z"/>
						</svg>
					</div>
					<div class="row-content">
						<span class="row-title">Export card database</span>
						<span class="row-sub">JSON backup of local cache</span>
					</div>
					<svg class="chevron" viewBox="0 0 20 20" width="16" height="16">
						<path d="M7.5 4L13.5 10L7.5 16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
					</svg>
				</button>
			</div>
		</div>

		<!-- About Group -->
		<div class="settings-group">
			<div class="group-label">About</div>
			<div class="group-card">
				<a href="/privacy" class="settings-row">
					<div class="row-content"><span class="row-title dim">Privacy policy</span></div>
					<svg class="chevron" viewBox="0 0 20 20" width="16" height="16">
						<path d="M7.5 4L13.5 10L7.5 16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
					</svg>
				</a>
				<a href="/terms" class="settings-row">
					<div class="row-content"><span class="row-title dim">Terms of service</span></div>
					<svg class="chevron" viewBox="0 0 20 20" width="16" height="16">
						<path d="M7.5 4L13.5 10L7.5 16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
					</svg>
				</a>
				<div class="settings-row">
					<div class="row-content"><span class="row-title dim">Version</span></div>
					<span class="row-version">1.0.0-beta</span>
				</div>
			</div>
		</div>

		{#if isAdmin}
			<div class="settings-group">
				<div class="group-label">Admin</div>
				<div class="group-card">
					<a href="/admin" class="settings-row">
						<div class="row-content"><span class="row-title">Admin dashboard</span></div>
						<svg class="chevron" viewBox="0 0 20 20" width="16" height="16">
							<path d="M7.5 4L13.5 10L7.5 16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
						</svg>
					</a>
				</div>
			</div>
		{/if}

		<!-- Sign Out -->
		<button class="sign-out-btn" onclick={handleSignOut}>Sign out</button>
	{/if}
</div>

<style>
	.settings-page {
		max-width: 500px;
		margin: 0 auto;
		padding: 1rem 1rem 3rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* Identity Card */
	.identity-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1.25rem;
		background: var(--bg-elevated);
		border-radius: 16px;
		border: 1px solid rgba(245,158,11,0.12);
		cursor: pointer;
	}
	.identity-avatar {
		width: 52px;
		height: 52px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--gold), var(--gold-dark));
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.25rem;
		color: var(--bg-base);
		flex-shrink: 0;
	}
	.identity-info { flex: 1; min-width: 0; }
	.identity-name-row { display: flex; align-items: center; gap: 0.5rem; }
	.identity-name { font-size: 1rem; font-weight: 600; }
	.identity-pro-badge {
		font-size: 0.625rem;
		font-weight: 800;
		letter-spacing: 0.05em;
		padding: 2px 7px;
		border-radius: 4px;
		background: var(--gold);
		color: var(--bg-base);
	}
	.identity-sub { font-size: 0.75rem; color: var(--text-secondary); display: block; margin-top: 2px; }

	/* Groups */
	.settings-group { display: flex; flex-direction: column; gap: 0; }
	.group-label {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
		margin-bottom: 0.5rem;
		padding-left: 0.25rem;
	}
	.group-card {
		background: var(--bg-elevated);
		border-radius: 14px;
		overflow: hidden;
	}

	/* Rows */
	.settings-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		width: 100%;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
		text-decoration: none;
		text-align: left;
		transition: background var(--transition-fast);
	}
	.settings-row:not(:last-child) {
		border-bottom: 1px solid rgba(148,163,184,0.06);
	}
	.settings-row:hover { background: var(--bg-hover); }
	.settings-row:active { background: var(--bg-hover); }

	.row-icon {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.row-content { flex: 1; min-width: 0; }
	.row-title { font-size: 0.875rem; font-weight: 500; display: block; }
	.row-title.dim { color: var(--text-secondary); }
	.row-sub { font-size: 0.6875rem; color: var(--text-muted); display: block; margin-top: 1px; }
	.row-sub.connected { color: var(--success); }
	.row-version { font-size: 0.8125rem; color: var(--text-muted); }

	.row-action-btn {
		padding: 0.3rem 0.6rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: none;
		color: var(--text-secondary);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
	}
	.row-action-connect { border-color: var(--success); color: var(--success); }
	.row-action-test { border-color: var(--info, #3b82f6); color: var(--info, #3b82f6); }

	.ebay-row { flex-wrap: wrap; }
	.ebay-actions { display: flex; gap: 0.375rem; flex-shrink: 0; }
	.ebay-validation-result {
		display: block;
		font-size: 0.625rem;
		margin-top: 3px;
		font-weight: 500;
	}
	.ebay-validation-result.valid { color: var(--success); }
	.ebay-validation-result.invalid { color: var(--danger); }
	.ebay-token-health {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 4px;
	}
	.token-detail {
		font-size: 0.625rem;
		color: var(--text-muted);
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.token-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.token-dot.healthy { background: var(--success); }
	.token-dot.expired { background: var(--warning, #f59e0b); }
	.token-warning { color: var(--warning, #f59e0b); font-size: 0.6875rem; }

	.ebay-revoke-hint {
		font-size: 0.75rem;
		color: var(--text-muted);
		line-height: 1.5;
		padding: 0.75rem;
		background: rgba(245, 158, 11, 0.08);
		border: 1px solid rgba(245, 158, 11, 0.25);
		border-radius: 8px;
		margin-top: 0.5rem;
	}
	.ebay-revoke-hint a { color: var(--accent, #3b82f6); text-decoration: underline; }

	.chevron { color: var(--text-muted); opacity: 0.4; flex-shrink: 0; }

	/* Profile form (expanded) */
	.profile-form {
		padding: 0 1rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		border-bottom: 1px solid rgba(148,163,184,0.06);
	}
	.profile-form label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-secondary);
		display: block;
		margin-bottom: 0.25rem;
	}
	.profile-form input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.875rem;
	}
	.save-btn {
		padding: 0.625rem;
		border-radius: 10px;
		border: none;
		background: var(--gold);
		color: var(--bg-base);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
	}
	.save-btn:disabled { opacity: 0.5; }

	/* Badges Strip */
	.badges-strip {
		display: flex;
		gap: 0.625rem;
		overflow-x: auto;
		scrollbar-width: none;
		padding-bottom: 4px;
	}
	.badges-strip::-webkit-scrollbar { display: none; }
	.badge-tile {
		flex-shrink: 0;
		width: 72px;
		text-align: center;
	}
	.badge-icon-wrap {
		width: 52px;
		height: 52px;
		margin: 0 auto 0.375rem;
		border-radius: 12px;
		background: var(--gold-light);
		border: 1px solid rgba(245,158,11,0.2);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.375rem;
	}
	.badge-name {
		font-size: 0.625rem;
		color: var(--text-secondary);
		line-height: 1.2;
	}

	/* Sign Out */
	.sign-out-btn {
		width: 100%;
		padding: 0.875rem;
		border-radius: 12px;
		border: 1px solid rgba(239,68,68,0.2);
		background: rgba(239,68,68,0.06);
		color: var(--danger);
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
		transition: background var(--transition-fast);
	}
	.sign-out-btn:hover { background: rgba(239,68,68,0.12); }

	.loading { text-align: center; padding: 3rem; color: var(--text-muted); }
</style>
