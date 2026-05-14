<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { showToast } from '$lib/stores/toast.svelte';
	import { user } from '$lib/stores/auth.svelte';

	interface TokenHealth {
		access_token_valid: boolean;
		access_token_expires_at: string;
		refresh_token_expires_at: string;
		refresh_days_remaining: number;
		scopes: string | null;
	}

	interface ValidationResult {
		valid: boolean;
		sellingLimit?: { amount: number; quantity: number };
		error?: string;
	}

	let loading = $state(true);
	let configured = $state(false);
	let connected = $state(false);
	let connectedSince = $state<string | null>(null);
	let sellerUsername = $state<string | null>(null);
	let sellerEmail = $state<string | null>(null);
	let sellerUserId = $state<string | null>(null);
	let sellerReady = $state<boolean | null>(null);
	let sellerStatusMessage = $state<string | null>(null);
	let profileRefreshedAt = $state<string | null>(null);
	let tokenHealth = $state<TokenHealth | null>(null);

	let validating = $state(false);
	let disconnecting = $state(false);
	let validation = $state<ValidationResult | null>(null);
	let justDisconnected = $state(false);

	let loadOnce = false;
	$effect(() => {
		if (loadOnce || !user()) return;
		loadOnce = true;
		loadStatus();
	});

	$effect(() => {
		const param = $page.url.searchParams.get('ebay');
		if (param === 'connected') {
			showToast('eBay account connected!', 'check');
		} else if (param === 'error') {
			showToast('eBay connection failed', 'x');
		}
	});

	async function loadStatus() {
		loading = true;
		try {
			const res = await fetch('/api/ebay/status');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			configured = data.configured;
			connected = data.connected;
			connectedSince = data.connected_since ?? null;
			sellerUsername = data.seller_username ?? null;
			sellerEmail = data.seller_email ?? null;
			sellerUserId = data.seller_user_id ?? null;
			sellerReady = data.seller_account_ready ?? null;
			sellerStatusMessage = data.seller_account_status_message ?? null;
			profileRefreshedAt = data.profile_last_refreshed_at ?? null;
			tokenHealth = data.token_health ?? null;
		} catch (err) {
			console.debug('[settings/ebay] status fetch failed:', err);
			showToast('Failed to load eBay status', 'x');
		}
		loading = false;
	}

	async function validate() {
		validating = true;
		validation = null;
		try {
			const res = await fetch('/api/ebay/validate', { method: 'POST' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			validation = data;
			if (data.valid) {
				showToast('eBay connection verified', 'check');
				await loadStatus();
			} else {
				connected = false;
				showToast(data.error || 'eBay connection invalid', 'x');
			}
		} catch (err) {
			console.debug('[settings/ebay] validate failed:', err);
			validation = { valid: false, error: 'Validation request failed' };
			showToast('Could not validate eBay connection', 'x');
		}
		validating = false;
	}

	async function disconnect() {
		if (!confirm('Disconnect eBay account? You can reconnect anytime.')) return;
		disconnecting = true;
		try {
			const res = await fetch('/api/ebay/disconnect', { method: 'POST' });
			if (!res.ok) throw new Error();
			connected = false;
			connectedSince = null;
			sellerUsername = null;
			sellerEmail = null;
			tokenHealth = null;
			justDisconnected = true;
			showToast('eBay account disconnected', 'check');
		} catch (err) {
			console.debug('[settings/ebay] disconnect failed:', err);
			showToast('Failed to disconnect eBay', 'x');
		}
		disconnecting = false;
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function formatDateTime(iso: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
			' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
	}

	const scopeList = $derived(tokenHealth?.scopes?.split(/\s+/).filter(Boolean) ?? []);
</script>

<svelte:head>
	<title>eBay Account - Card Scanner</title>
</svelte:head>

<div class="page">
	<div class="header">
		<button class="back-btn" onclick={() => goto('/settings')} aria-label="Back to settings">
			<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75">
				<path d="M12 4L6 10L12 16" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>
		<h1>eBay Account</h1>
	</div>

	{#if loading}
		<div class="loading">Loading eBay status...</div>
	{:else if !configured}
		<div class="card warning">
			<strong>eBay integration is not configured on this server.</strong>
			<p>Contact the administrator if you expected to connect an eBay account.</p>
		</div>
	{:else if !connected}
		<div class="card">
			<h2>Not connected</h2>
			<p class="muted">
				Connect your eBay account to create listings directly from scanned cards. Card Scanner will use your eBay
				shipping, payment, and return policies — no extra setup required.
			</p>

			<details class="disclosure">
				<summary>What will Card Scanner access?</summary>
				<div class="disclosure-body">
					<p><strong>When you connect, Card Scanner will be able to:</strong></p>
					<ul>
						<li>See your eBay username and email so we can show which account is connected.</li>
						<li>Create and update card listings on your behalf — only when you initiate a listing.</li>
						<li>Read your shipping, payment, and return policies so listings inherit them.</li>
					</ul>
					<p><strong>Card Scanner will not:</strong></p>
					<ul>
						<li>See your bank or payment details.</li>
						<li>Read your messages, sales history, or buyer information.</li>
						<li>Make any changes outside listings you initiate.</li>
					</ul>
				</div>
			</details>

			<div class="actions">
				<a
					href={justDisconnected ? '/auth/ebay?from=/settings/integrations/ebay&force_login=1' : '/auth/ebay?from=/settings/integrations/ebay'}
					class="btn primary"
					data-sveltekit-reload
				>
					Connect eBay account
				</a>
			</div>

			{#if justDisconnected}
				<p class="hint">
					Disconnected from Card Scanner. To fully revoke access at eBay, visit
					<a href="https://accounts.ebay.com/uas/PreferencesApplications" target="_blank" rel="noopener noreferrer">eBay → Apps you've authorized</a>.
				</p>
			{/if}
		</div>
	{:else}
		<!-- Account identity -->
		<div class="card">
			<h2>Account</h2>
			<div class="info-grid">
				<div class="info-row">
					<span class="label">eBay username</span>
					<span class="value">{sellerUsername ? `@${sellerUsername}` : '—'}</span>
				</div>
				<div class="info-row">
					<span class="label">Email on file</span>
					<span class="value">{sellerEmail || '—'}</span>
				</div>
				<div class="info-row">
					<span class="label">eBay user ID</span>
					<span class="value mono">{sellerUserId || '—'}</span>
				</div>
				<div class="info-row">
					<span class="label">Connected since</span>
					<span class="value">{formatDate(connectedSince)}</span>
				</div>
				<div class="info-row">
					<span class="label">Profile cached at</span>
					<span class="value">{formatDateTime(profileRefreshedAt)}</span>
				</div>
			</div>
		</div>

		<!-- Readiness -->
		<div class="card">
			<h2>Seller Readiness</h2>
			{#if sellerReady === true}
				<div class="status-banner ok">
					<span class="status-dot ok"></span>
					<span>Your eBay account is ready to create listings.</span>
				</div>
			{:else if sellerReady === false}
				<div class="status-banner warn">
					<span class="status-dot warn"></span>
					<span>{sellerStatusMessage || 'Account setup incomplete.'}</span>
				</div>
				<div class="actions">
					<a href="https://www.ebay.com/sh/" target="_blank" rel="noopener noreferrer" class="btn">
						Open eBay Seller Hub →
					</a>
				</div>
			{:else}
				<p class="muted">Readiness not yet checked. Press Test below to probe eBay.</p>
			{/if}

			{#if validation && validation.sellingLimit}
				<div class="info-row" style="margin-top:0.75rem;">
					<span class="label">Selling limit</span>
					<span class="value">
						{validation.sellingLimit.quantity} items / ${validation.sellingLimit.amount.toLocaleString()}
					</span>
				</div>
			{/if}
		</div>

		<!-- Token health -->
		{#if tokenHealth}
			<div class="card">
				<h2>Token Health</h2>
				<div class="info-grid">
					<div class="info-row">
						<span class="label">
							<span class="status-dot" class:ok={tokenHealth.access_token_valid} class:warn={!tokenHealth.access_token_valid}></span>
							Access token
						</span>
						<span class="value">
							{tokenHealth.access_token_valid ? 'Active' : 'Expired (auto-refreshes on use)'}
						</span>
					</div>
					<div class="info-row">
						<span class="label">Access expires</span>
						<span class="value">{formatDateTime(tokenHealth.access_token_expires_at)}</span>
					</div>
					<div class="info-row">
						<span class="label">
							<span class="status-dot" class:ok={tokenHealth.refresh_days_remaining > 30} class:warn={tokenHealth.refresh_days_remaining <= 30}></span>
							Refresh token
						</span>
						<span class="value">
							{tokenHealth.refresh_days_remaining}d remaining
							{#if tokenHealth.refresh_days_remaining <= 30}
								<span class="warn-text">— reconnect soon</span>
							{/if}
						</span>
					</div>
					<div class="info-row">
						<span class="label">Refresh expires</span>
						<span class="value">{formatDate(tokenHealth.refresh_token_expires_at)}</span>
					</div>
				</div>

				{#if scopeList.length > 0}
					<details class="disclosure" style="margin-top:0.75rem;">
						<summary>Authorized scopes ({scopeList.length})</summary>
						<div class="disclosure-body">
							<ul class="scope-list">
								{#each scopeList as scope}
									<li class="mono">{scope}</li>
								{/each}
							</ul>
						</div>
					</details>
				{/if}
			</div>
		{/if}

		<!-- Actions -->
		<div class="card">
			<h2>Actions</h2>
			<div class="actions">
				<button class="btn" onclick={validate} disabled={validating}>
					{validating ? 'Testing...' : 'Test connection'}
				</button>
				<a href="/auth/ebay?from=/settings/integrations/ebay&force_login=1" class="btn" data-sveltekit-reload>
					Switch account
				</a>
				<button class="btn danger" onclick={disconnect} disabled={disconnecting}>
					{disconnecting ? 'Disconnecting...' : 'Disconnect'}
				</button>
			</div>

			{#if validation && !validation.valid}
				<p class="error-text">{validation.error || 'Connection invalid'}</p>
			{/if}

			<p class="hint" style="margin-top:1rem;">
				Disconnecting only removes the link from Card Scanner. To fully revoke this app's access at eBay, visit
				<a href="https://accounts.ebay.com/uas/PreferencesApplications" target="_blank" rel="noopener noreferrer">eBay → Apps you've authorized</a>.
			</p>
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 640px;
		margin: 0 auto;
		padding: 1rem 1rem 4rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.25rem;
	}

	.back-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		color: var(--text-secondary);
		cursor: pointer;
	}

	.back-btn:hover { color: var(--text-primary); }

	h1 {
		font-size: 1.4rem;
		font-weight: 700;
		margin: 0;
		color: var(--text-primary);
	}

	h2 {
		font-size: 0.85rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
		margin: 0 0 0.75rem 0;
	}

	.loading {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}

	.card {
		background: var(--bg-elevated);
		border-radius: 14px;
		padding: 1.25rem;
		border: 1px solid var(--border);
	}

	.card.warning {
		border-color: var(--warning);
	}

	.muted {
		color: var(--text-tertiary);
		font-size: 0.875rem;
		line-height: 1.5;
		margin: 0 0 1rem 0;
	}

	.info-grid {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.info-row {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: baseline;
		font-size: 0.875rem;
	}

	.label {
		color: var(--text-secondary);
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.value {
		color: var(--text-primary);
		font-weight: 500;
		text-align: right;
		word-break: break-word;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
		font-size: 0.8rem;
	}

	.status-banner {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.75rem 0.875rem;
		border-radius: 10px;
		font-size: 0.875rem;
	}

	.status-banner.ok {
		background: rgba(16, 185, 129, 0.1);
		color: var(--success);
		border: 1px solid rgba(16, 185, 129, 0.25);
	}

	.status-banner.warn {
		background: rgba(245, 158, 11, 0.1);
		color: var(--warning);
		border: 1px solid rgba(245, 158, 11, 0.25);
	}

	.status-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-tertiary);
		flex-shrink: 0;
	}

	.status-dot.ok { background: var(--success); }
	.status-dot.warn { background: var(--warning); }

	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.625rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-secondary);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
	}

	.btn:hover:not(:disabled) {
		border-color: var(--border-strong);
		color: var(--text-primary);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn.primary {
		border-color: var(--gold);
		color: var(--gold);
	}

	.btn.danger {
		border-color: var(--danger);
		color: var(--danger);
	}

	.disclosure {
		margin-top: 0.5rem;
		font-size: 0.875rem;
	}

	.disclosure summary {
		cursor: pointer;
		color: var(--text-secondary);
		padding: 0.5rem 0;
	}

	.disclosure-body {
		padding: 0.5rem 0 0;
		color: var(--text-secondary);
	}

	.disclosure-body p { margin: 0.5rem 0; }
	.disclosure-body ul { margin: 0.5rem 0; padding-left: 1.25rem; }
	.disclosure-body li { margin: 0.25rem 0; line-height: 1.4; }

	.scope-list {
		list-style: none !important;
		padding-left: 0 !important;
	}

	.scope-list li {
		padding: 0.25rem 0.5rem;
		background: var(--bg-surface);
		border-radius: 4px;
		margin: 0.25rem 0;
		word-break: break-all;
	}

	.hint {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		line-height: 1.5;
		margin: 0.75rem 0 0;
	}

	.hint a { color: var(--gold); }

	.error-text {
		color: var(--danger);
		font-size: 0.875rem;
		margin: 0.75rem 0 0;
	}

	.warn-text {
		color: var(--warning);
		font-size: 0.8rem;
	}
</style>
