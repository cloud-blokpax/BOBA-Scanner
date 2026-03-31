<script lang="ts">
	import { getSupabase } from '$lib/services/supabase';
	import { idb } from '$lib/services/idb';
	import { user } from '$lib/stores/auth.svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import { featureEnabled } from '$lib/stores/feature-flags.svelte';
	import { isPro, proUntil, daysRemaining, proExpired, setShowGoProModal } from '$lib/stores/pro.svelte';
	import { personaWeights, togglePersona, personaLoaded, type PersonaId } from '$lib/stores/persona.svelte';
	import { page } from '$app/stores';

	const personaOptions: { id: PersonaId; icon: string; name: string }[] = [
		{ id: 'collector', icon: '\u{1F4E6}', name: 'Collector' },
		{ id: 'deck_builder', icon: '\u{1F3D7}', name: 'Deck Builder' },
		{ id: 'seller', icon: '\u{1F4B0}', name: 'Seller' },
		{ id: 'tournament', icon: '\u{1F3C6}', name: 'Tournament Player' }
	];

	let personaSaving = $state(false);

	async function toggleAndSave(id: PersonaId) {
		personaSaving = true;
		try {
			await togglePersona(id);
		} catch (err) {
			console.debug('[settings] Persona save failed:', err);
			showToast('Failed to save persona', 'x');
		}
		personaSaving = false;
	}

	const hasScanToList = featureEnabled('scan_to_list');

	// Donation history
	let donations = $state<Array<{ tier_key: string; tier_amount: number; time_added: boolean; created_at: string }>>([]);

	async function loadDonations() {
		const client = getSupabase();
		if (!client || !user()) return;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { data } = await (client as any)
			.from('donations')
			.select('tier_key, tier_amount, time_added, created_at')
			.eq('user_id', user()!.id)
			.order('created_at', { ascending: false })
			.limit(20);
		donations = data || [];
	}

	let loading = $state(true);
	let saving = $state(false);
	let profileName = $state('');
	let discordId = $state('');
	let email = $state('');

	// Badges state
	let badges = $state<Array<{ badge_key: string; badge_name: string; badge_description: string; badge_icon: string; earned_at: string }>>([]);

	// eBay connection state
	let ebayConfigured = $state(false);
	let ebayConnected = $state(false);
	let ebayLoading = $state(true);
	let ebayDisconnecting = $state(false);
	let ebayMessage = $state<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

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

		email = currentUser.email || '';

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
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { data } = await (client as any)
			.from('user_badges')
			.select('badge_key, badge_name, badge_description, badge_icon, earned_at')
			.eq('user_id', user()!.id)
			.order('earned_at', { ascending: true });
		badges = data || [];
	}

	async function saveProfile() {
		const currentUser = user();
		if (!currentUser) return;
		const client = getSupabase();
		if (!client) return;

		saving = true;
		try {
			const { error } = await client
				.from('users')
				.update({
					name: profileName.trim() || null,
					discord_id: discordId.trim() || null
				})
				.eq('auth_user_id', currentUser.id);

			if (error) throw error;
			showToast('Profile saved', 'check');
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
	}

	$effect(() => {
		loadProfile();
		loadDonations();
	});

	// Check eBay OAuth callback params
	$effect(() => {
		const ebayParam = $page.url.searchParams.get('ebay');
		if (ebayParam === 'connected') {
			ebayMessage = { type: 'success', text: 'eBay account connected successfully!' };
			ebayConnected = true;
		} else if (ebayParam === 'declined') {
			ebayMessage = { type: 'info', text: 'eBay authorization was declined.' };
		} else if (ebayParam === 'setup') {
			ebayMessage = { type: 'info', text: 'Connect your eBay seller account below to start listing cards directly from scans.' };
		} else if (ebayParam === 'not_configured') {
			ebayMessage = { type: 'info', text: 'eBay seller integration is not yet available. Check back soon!' };
		} else if (ebayParam === 'error') {
			const reason = $page.url.searchParams.get('reason') || 'unknown';
			const reasonMessages: Record<string, string> = {
				session_expired: 'Your session expired during the eBay connection process. Please try again.',
				state_mismatch: 'Security verification failed. Please try connecting again.',
				no_code: 'eBay did not return an authorization code. Please try again.',
				token_exchange: 'Failed to complete eBay authorization. Please try again.'
			};
			ebayMessage = { type: 'error', text: reasonMessages[reason] || `eBay connection failed: ${reason}` };
		}
	});

	// Load eBay status
	$effect(() => {
		fetch('/api/ebay/status')
			.then(res => res.ok ? res.json() : Promise.reject())
			.then(data => {
				ebayConfigured = data.configured;
				ebayConnected = data.connected;
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
			showToast('eBay account disconnected', 'check');
		} catch (err) {
			console.debug('[settings] eBay disconnect failed:', err);
			showToast('Failed to disconnect eBay', 'x');
		}
		ebayDisconnecting = false;
	}

	const isAdmin = $derived($page.data?.session?.user?.app_metadata?.is_admin === true);
</script>

<svelte:head>
	<title>Settings - BOBA Scanner</title>
</svelte:head>

<div class="settings-page">
	<header class="page-header">
		<h1>Settings</h1>
		<p class="subtitle">Manage your profile and preferences</p>
	</header>

	{#if loading}
		<div class="loading">Loading profile...</div>
	{:else}
		<!-- Pro Status Section -->
		<div class="settings-card pro-status-card">
			{#if isPro()}
				<div class="pro-status-row">
					<span class="pro-badge-large">PRO</span>
					<div class="pro-status-info">
						<span class="pro-until">Pro until {proUntil()?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
						<span class="pro-days">{daysRemaining()} days remaining</span>
					</div>
					<button class="renew-btn" onclick={() => setShowGoProModal(true)}>Renew</button>
				</div>
				{#if donations.length > 0}
					<div class="donation-history">
						<h3>Donation History</h3>
						<table class="donation-table">
							<thead><tr><th>Tier</th><th>Date</th><th>Time Added</th></tr></thead>
							<tbody>
								{#each donations as d}
									<tr>
										<td class="tier-cell">{d.tier_key}</td>
										<td>{new Date(d.created_at).toLocaleDateString()}</td>
										<td>{d.time_added ? 'Yes' : 'No'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			{:else if proExpired()}
				<div class="pro-status-row">
					<div class="pro-status-info">
						<span class="pro-expired-text">Your Pro access expired on {proUntil()?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
					</div>
					<button class="renew-btn" onclick={() => setShowGoProModal(true)}>Renew</button>
				</div>
			{:else}
				<div class="pro-promo">
					<h2>Go Pro</h2>
					<p>Unlock AI grading, price trends, eBay listings, and more.</p>
					<button class="go-pro-btn" onclick={() => setShowGoProModal(true)}>Go Pro</button>
				</div>
			{/if}
		</div>

		<div class="settings-card">
			<h2>Profile</h2>

			<div class="form-group">
				<label for="s-email">Email</label>
				<input id="s-email" type="email" value={email} disabled class="disabled-input" />
				<span class="field-hint">Email is managed by your Google account</span>
			</div>

			<div class="form-group">
				<label for="s-name">Name <span class="optional">(optional)</span></label>
				<input id="s-name" type="text" bind:value={profileName} placeholder="Your name" />
			</div>

			<div class="form-group">
				<label for="s-discord">Discord ID <span class="optional">(optional)</span></label>
				<input id="s-discord" type="text" bind:value={discordId} placeholder="username#1234 or username" />
			</div>

			<button class="save-btn" onclick={saveProfile} disabled={saving}>
				{saving ? 'Saving...' : 'Save Changes'}
			</button>
		</div>

		{#if personaLoaded()}
			<div class="settings-card" style="margin-top: 1rem;">
				<h2>My Persona</h2>
				<p class="field-hint" style="margin-bottom: 0.75rem;">Controls what you see first on the home screen</p>
				<div class="persona-grid">
					{#each personaOptions as p}
						<button
							class="persona-chip"
							class:selected={personaWeights()[p.id] > 0}
							onclick={() => toggleAndSave(p.id)}
							disabled={personaSaving}
							type="button"
						>
							<span class="persona-chip-icon">{p.icon}</span>
							<span class="persona-chip-name">{p.name}</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}


		<div class="settings-card" style="margin-top: 1rem;">
			<h2>eBay Seller Account</h2>

			{#if ebayMessage}
				<div class="ebay-message ebay-message-{ebayMessage.type}">
					{ebayMessage.text}
				</div>
			{/if}

			{#if ebayLoading}
				<p class="field-hint">Checking eBay connection...</p>
			{:else if ebayConnected}
				<div class="ebay-status">
					<span class="ebay-badge ebay-connected">Connected</span>
					<p class="field-hint">Your eBay seller account is linked. You can create listings directly from scan results.</p>
				</div>
				<button class="save-btn ebay-disconnect" onclick={disconnectEbay} disabled={ebayDisconnecting}>
					{ebayDisconnecting ? 'Disconnecting...' : 'Disconnect eBay'}
				</button>
			{:else if ebayConfigured}
				<p class="field-hint">Connect your eBay seller account to create listings directly from scanned cards.</p>
				<a href="/auth/ebay" class="save-btn ebay-connect">Connect eBay Account</a>
			{:else}
				<p class="field-hint">eBay seller integration is coming soon. You'll be able to connect your eBay account and list cards directly from scans.</p>
			{/if}
		</div>

		<section class="badges-section">
			<h3>Badges</h3>
			{#if badges.length === 0}
				<p class="no-badges">No badges yet. Scan cards to earn your first!</p>
			{:else}
				<div class="badge-grid">
					{#each badges as badge}
						<div class="badge-card">
							<span class="badge-icon">{badge.badge_icon}</span>
							<div class="badge-info">
								<span class="badge-name">{badge.badge_name}</span>
								<span class="badge-desc">{badge.badge_description}</span>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- My Stuff -->
		<section class="settings-section">
			<h3 class="settings-section-title">My Stuff</h3>
			<a href="/collection" class="settings-link">My Collection</a>
			<a href="/deck" class="settings-link">My Decks</a>
			<a href="/export" class="settings-link">Export Collection</a>
		</section>

		<!-- Scanning Tools -->
		<section class="settings-section">
			<h3 class="settings-section-title">Scanning Tools</h3>
			<a href="/scan" class="settings-link">Single Scan</a>
			<a href="/scan?mode=batch" class="settings-link">Batch Scanner</a>
			<a href="/scan?mode=binder" class="settings-link">Binder Scanner</a>
			<a href="/scan?mode=roll" class="settings-link">Camera Roll Import</a>
			<a href="/grader" class="settings-link">Card Grader</a>
		</section>

		<!-- Card Tools -->
		<section class="settings-section">
			<h3 class="settings-section-title">Card Tools</h3>
			<a href="/set-completion" class="settings-link">Set Completion</a>
			<a href="/organize" class="settings-link">Organize Collection</a>
		</section>

		<!-- Competitive -->
		<section class="settings-section">
			<h3 class="settings-section-title">Competitive</h3>
			<a href="/deck/new" class="settings-link">Deck Builder</a>
			<a href="/tournaments" class="settings-link">Tournaments</a>
		</section>

		<!-- Community -->
		<section class="settings-section">
			<h3 class="settings-section-title">Community</h3>
			<a href="/speed" class="settings-link">Speed Challenge</a>
			<a href="/leaderboard" class="settings-link">Leaderboard</a>
			<a href="/marketplace/monitor" class="settings-link">Seller Monitor</a>
		</section>

		<!-- Sell -->
		<section class="settings-section">
			<h3 class="settings-section-title">Sell</h3>
			<a href="/sell" class="settings-link">Sell Cards</a>
		</section>

		{#if isAdmin}
			<section class="settings-section">
				<h3 class="settings-section-title">Admin</h3>
				<a href="/admin" class="settings-link">Admin Dashboard</a>
			</section>
		{/if}

		<!-- Legal -->
		<section class="settings-section">
			<h3 class="settings-section-title">Legal</h3>
			<a href="/privacy" class="settings-link">Privacy Policy</a>
			<a href="/terms" class="settings-link">Terms of Service</a>
		</section>

		{#if isAdmin}
			<!-- Admin -->
			<section class="settings-section">
				<h3 class="settings-section-title">Admin</h3>
				<a href="/admin" class="settings-link">Admin Dashboard</a>
			</section>
		{/if}

		<!-- Data Management -->
		<section class="settings-section">
			<h3 class="settings-section-title">Data Management</h3>
			<button class="export-btn" onclick={exportCardDatabase} disabled={exporting}>
				{exporting ? 'Exporting...' : 'Export Card Database (JSON)'}
			</button>
			<p class="export-hint">Download the local card database from your browser cache. Use this to re-seed your Supabase cards table.</p>
		</section>

		<!-- Sign Out -->
		<button class="sign-out-btn" onclick={handleSignOut}>Sign Out</button>
	{/if}
</div>

<style>
	.settings-page {
		max-width: 500px;
		margin: 0 auto;
		padding: 1rem;
	}
	.page-header { margin-bottom: 1.5rem; }
	h1 { font-size: 1.5rem; font-weight: 700; }
	.subtitle {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
	}
	.loading {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}
	.settings-card {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1.25rem;
	}
	.settings-card h2 {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 1rem;
		color: var(--text-secondary);
	}
	.form-group {
		margin-bottom: 1rem;
	}
	.form-group label {
		display: block;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 4px;
	}
	.optional {
		font-weight: 400;
		color: var(--text-tertiary);
	}
	.form-group input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.9rem;
	}
	.disabled-input {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.field-hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-top: 2px;
		display: block;
	}
	.save-btn {
		width: 100%;
		padding: 0.75rem;
		border-radius: 10px;
		border: none;
		background: var(--accent-primary);
		color: #fff;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		margin-top: 0.5rem;
	}
	.save-btn:disabled { opacity: 0.6; }
	.ebay-status { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.75rem; }
	.ebay-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; width: fit-content; }
	.ebay-connected { background: rgba(16, 185, 129, 0.12); color: #10b981; }
	.ebay-disconnect { background: transparent; border: 1px solid var(--border-color); color: var(--text-secondary); }
	.ebay-connect { display: block; text-align: center; text-decoration: none; background: var(--success, #10b981); }
	.ebay-message { padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.85rem; margin-bottom: 0.75rem; }
	.ebay-message-success { background: rgba(16, 185, 129, 0.12); color: #10b981; }
	.ebay-message-error { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
	.ebay-message-info { background: rgba(59, 130, 246, 0.12); color: #3b82f6; }

	/* Pro Status */
	.pro-status-card { margin-bottom: 1rem; }
	.pro-status-row {
		display: flex; align-items: center; gap: 0.75rem;
	}
	.pro-badge-large {
		display: inline-block; padding: 4px 10px; border-radius: 6px;
		font-size: 0.75rem; font-weight: 800; letter-spacing: 0.05em;
		background: var(--gold); color: #000;
	}
	.pro-status-info { flex: 1; display: flex; flex-direction: column; }
	.pro-until { font-size: 0.9rem; font-weight: 600; color: var(--text-primary); }
	.pro-days { font-size: 0.75rem; color: var(--text-secondary); }
	.pro-expired-text { font-size: 0.9rem; color: var(--text-secondary); }
	.renew-btn {
		padding: 0.375rem 0.75rem; border-radius: 8px; border: none;
		background: var(--gold); color: #000; font-size: 0.8rem; font-weight: 700;
		cursor: pointer;
	}
	.pro-promo { text-align: center; }
	.pro-promo h2 { font-size: 1rem; font-weight: 700; color: var(--gold); margin-bottom: 0.25rem; }
	.pro-promo p { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.75rem; }
	.go-pro-btn {
		padding: 0.5rem 1.5rem; border-radius: 10px; border: none;
		background: var(--gold); color: #000; font-size: 0.9rem; font-weight: 700;
		cursor: pointer; box-shadow: var(--shadow-gold);
	}
	.donation-history { margin-top: 1rem; }
	.donation-history h3 { font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.5rem; }
	.donation-table { width: 100%; font-size: 0.8rem; border-collapse: collapse; }
	.donation-table th { text-align: left; color: var(--text-tertiary); font-size: 0.7rem; font-weight: 600; padding: 0.25rem 0.5rem; }
	.donation-table td { padding: 0.25rem 0.5rem; color: var(--text-secondary); }
	.tier-cell { text-transform: capitalize; }

	.badges-section { margin-top: 2rem; }
	.badges-section h3 { font-size: 1rem; font-weight: 700; margin-bottom: 0.75rem; }
	.no-badges { font-size: 0.85rem; color: var(--text-secondary); }
	.badge-grid { display: flex; flex-direction: column; gap: 0.5rem; }
	.badge-card {
		display: flex; align-items: center; gap: 0.75rem;
		padding: 0.75rem; border-radius: 10px;
		background: var(--bg-elevated); border: 1px solid var(--border-color);
	}
	.badge-icon { font-size: 1.5rem; }
	.badge-name { display: block; font-weight: 600; font-size: 0.9rem; }
	.badge-desc { display: block; font-size: 0.75rem; color: var(--text-secondary); }

	/* Settings sections */
	.settings-section {
		margin-top: 1.5rem;
	}
	.settings-section-title {
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		margin-bottom: 0.5rem;
	}
	.settings-link {
		display: block;
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		font-size: 0.9rem;
		color: var(--text-primary);
		text-decoration: none;
	}
	.settings-link:hover {
		background: var(--bg-hover);
	}

	/* Persona grid */
	.persona-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.persona-chip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: 10px;
		border: 2px solid var(--border-color, rgba(148,163,184,0.15));
		background: var(--bg-base);
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}
	.persona-chip:hover { border-color: var(--text-secondary); }
	.persona-chip.selected {
		border-color: var(--accent-primary, #3b82f6);
		background: rgba(59, 130, 246, 0.08);
	}
	.persona-chip:disabled { opacity: 0.6; }
	.persona-chip-icon { font-size: 1.15rem; }
	.persona-chip-name { font-size: 0.85rem; font-weight: 600; color: var(--text-primary); }

	/* Sign out */
	.export-btn {
		width: 100%;
		padding: 0.75rem;
		border-radius: 10px;
		border: 1px solid rgba(59, 130, 246, 0.3);
		background: rgba(59, 130, 246, 0.1);
		color: var(--primary, #3b82f6);
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
	.export-btn:hover { background: rgba(59, 130, 246, 0.2); }
	.export-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.export-hint {
		font-size: 0.75rem;
		color: var(--text-muted, #475569);
		margin-top: 0.5rem;
	}
	.sign-out-btn {
		width: 100%;
		padding: 0.75rem;
		margin-top: 2rem;
		border-radius: 10px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
	}
	.sign-out-btn:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
</style>
