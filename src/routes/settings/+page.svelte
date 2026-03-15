<script lang="ts">
	import { supabase } from '$lib/services/supabase';
	import { user } from '$lib/stores/auth';
	import { showToast } from '$lib/stores/toast';
	import { featureEnabled } from '$lib/stores/feature-flags';
	import { page } from '$app/stores';

	const hasScanToList = featureEnabled('scan_to_list');

	let loading = $state(true);
	let saving = $state(false);
	let profileName = $state('');
	let discordId = $state('');
	let email = $state('');

	// eBay connection state
	let ebayConfigured = $state(false);
	let ebayConnected = $state(false);
	let ebayLoading = $state(true);
	let ebayDisconnecting = $state(false);
	let ebayMessage = $state<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

	async function loadProfile() {
		loading = true;
		const currentUser = $user;
		if (!currentUser) {
			loading = false;
			return;
		}

		email = currentUser.email || '';

		const { data } = await supabase
			.from('users')
			.select('name, discord_id')
			.eq('auth_user_id', currentUser.id)
			.single();

		if (data) {
			profileName = data.name || '';
			discordId = data.discord_id || '';
		}
		loading = false;
	}

	async function saveProfile() {
		const currentUser = $user;
		if (!currentUser) return;

		saving = true;
		try {
			const { error } = await supabase
				.from('users')
				.update({
					name: profileName.trim() || null,
					discord_id: discordId.trim() || null
				})
				.eq('auth_user_id', currentUser.id);

			if (error) throw error;
			showToast('Profile saved', 'check');
		} catch {
			showToast('Failed to save profile', 'x');
		}
		saving = false;
	}

	$effect(() => {
		loadProfile();
	});

	// Check eBay OAuth callback params
	$effect(() => {
		const ebayParam = $page.url.searchParams.get('ebay');
		if (ebayParam === 'connected') {
			ebayMessage = { type: 'success', text: 'eBay account connected successfully!' };
			ebayConnected = true;
		} else if (ebayParam === 'declined') {
			ebayMessage = { type: 'info', text: 'eBay authorization was declined.' };
		} else if (ebayParam === 'error') {
			const reason = $page.url.searchParams.get('reason') || 'unknown';
			ebayMessage = { type: 'error', text: `eBay connection failed: ${reason}` };
		}
	});

	// Load eBay status
	$effect(() => {
		if (!$hasScanToList) { ebayLoading = false; return; }
		fetch('/api/ebay/status')
			.then(res => res.ok ? res.json() : Promise.reject())
			.then(data => {
				ebayConfigured = data.configured;
				ebayConnected = data.connected;
			})
			.catch(() => {})
			.finally(() => { ebayLoading = false; });
	});

	async function disconnectEbay() {
		ebayDisconnecting = true;
		try {
			const res = await fetch('/api/ebay/disconnect', { method: 'POST' });
			if (!res.ok) throw new Error();
			ebayConnected = false;
			showToast('eBay account disconnected', 'check');
		} catch {
			showToast('Failed to disconnect eBay', 'x');
		}
		ebayDisconnecting = false;
	}
</script>

<svelte:head>
	<title>Settings - BOBA Scanner</title>
</svelte:head>

<div class="settings-page">
	<header class="page-header">
		<h1>Settings</h1>
		<p class="subtitle">Manage your profile information</p>
	</header>

	{#if loading}
		<div class="loading">Loading profile...</div>
	{:else}
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

		{#if $hasScanToList}
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
					<p class="field-hint">eBay seller integration is not yet configured for this app.</p>
				{/if}
			</div>
		{/if}
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
</style>
