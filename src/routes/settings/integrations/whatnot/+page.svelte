<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';

	interface Status {
		configured: boolean;
		connected: boolean;
		wtp_username: string | null;
		stripe_connect_status: string | null;
		connected_at: string | null;
	}

	let status = $state<Status | null>(null);
	let loading = $state(true);
	let email = $state('');
	let password = $state('');
	let submitting = $state(false);
	let submitError = $state<string | null>(null);
	let submitOk = $state(false);
	let disconnecting = $state(false);

	const returnUrl = $derived($page.url.searchParams.get('return'));

	async function loadStatus() {
		const r = await fetch('/api/wtp/status');
		if (r.ok) status = (await r.json()) as Status;
	}

	onMount(async () => {
		await loadStatus();
		loading = false;
	});

	async function connect() {
		submitError = null;
		submitOk = false;
		if (!email.trim() || !password) {
			submitError = 'Email and password are required';
			return;
		}
		submitting = true;
		try {
			const r = await fetch('/api/wtp/connect', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: email.trim(), password })
			});
			const data = (await r.json()) as { ok?: boolean; error?: string };
			if (!r.ok || !data.ok) {
				submitError = data.error ?? 'Sign-in failed';
				return;
			}
			password = ''; // clear immediately
			submitOk = true;
			await loadStatus();
			if (returnUrl && returnUrl.startsWith('/')) {
				setTimeout(() => goto(returnUrl), 600);
			}
		} catch (err) {
			submitError = err instanceof Error ? err.message : 'Network error';
		} finally {
			submitting = false;
		}
	}

	async function disconnect() {
		if (!confirm('Disconnect from Wonders Trading Post? Your existing listings stay live; you just won\'t be able to post new ones until you reconnect.')) return;
		disconnecting = true;
		try {
			await fetch('/api/wtp/disconnect', { method: 'POST' });
			await loadStatus();
		} finally {
			disconnecting = false;
		}
	}
</script>

<svelte:head><title>Connect to WTP</title></svelte:head>

<div class="connect">
	<div class="header">
		<button class="back" onclick={() => goto(returnUrl && returnUrl.startsWith('/') ? returnUrl : '/settings')}>← Back</button>
		<h1>Wonders Trading Post</h1>
	</div>

	{#if loading}
		<div class="state">Loading…</div>
	{:else if status && !status.configured}
		<div class="error-block">
			WTP integration is not configured on the server. Ask the admin to set <code>WTP_SUPABASE_URL</code>, <code>WTP_SUPABASE_ANON_KEY</code>, and <code>WTP_CREDENTIAL_KEY</code> in env vars.
		</div>
	{:else if status?.connected}
		<div class="connected">
			<div class="check" aria-hidden="true">✓</div>
			<h2>Connected</h2>
			{#if status.wtp_username}<p>Signed in as <strong>{status.wtp_username}</strong></p>{/if}
			{#if status.stripe_connect_status}
				<p class="stripe">Stripe payouts: <span class="status-{status.stripe_connect_status}">{status.stripe_connect_status}</span></p>
			{/if}
			<button class="disconnect-btn" onclick={disconnect} disabled={disconnecting}>
				{disconnecting ? 'Disconnecting…' : 'Disconnect'}
			</button>
			{#if returnUrl && returnUrl.startsWith('/')}
				<a href={returnUrl} class="continue">Continue →</a>
			{/if}
		</div>
	{:else}
		<div class="connect-form">
			<h2>Sign in to your Wonders Trading Post account</h2>
			<p class="explainer">
				Enter your WTP credentials. We sign in once on your behalf and store a
				rotating session token (encrypted at rest). <strong>Your password is
				never stored.</strong> If you don't have a WTP account yet,
				<a href="https://wonderstradingpost.com" target="_blank" rel="noopener">create one here</a> first.
			</p>

			<form onsubmit={(e) => { e.preventDefault(); connect(); }}>
				<label class="field">
					Email
					<input type="email" bind:value={email} autocomplete="username" required />
				</label>
				<label class="field">
					Password
					<input type="password" bind:value={password} autocomplete="current-password" required />
				</label>

				{#if submitError}<p class="error-block">{submitError}</p>{/if}
				{#if submitOk}<p class="success-block">✓ Connected successfully</p>{/if}

				<button class="connect-btn" type="submit" disabled={submitting || !email || !password}>
					{submitting ? 'Signing in…' : 'Connect to WTP'}
				</button>
			</form>

			<details class="security-note">
				<summary>Why do you need my password?</summary>
				<p>
					Wonders Trading Post doesn't yet expose a partner API or "Sign in with WTP"
					button, so signing in on your behalf is the only way to post listings to
					your account. We send your password directly to WTP's auth server, store
					only the rotating refresh token they return, and discard the password
					immediately. You can disconnect at any time, which deletes the session
					token from our database. If WTP rolls out an official API, we'll switch
					to it and prompt you to reconnect via that flow.
				</p>
			</details>
		</div>
	{/if}
</div>

<style>
	.connect { max-width: 540px; margin: 0 auto; padding: 1rem; }
	.header { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0 1rem; border-bottom: 1px solid var(--border, rgba(148,163,184,0.10)); margin-bottom: 1.5rem; }
	.back { background: none; border: none; color: var(--text-secondary, #94a3b8); font-size: 0.9rem; cursor: pointer; padding: 0.25rem; }
	h1 { font-size: 1.25rem; font-weight: 700; margin: 0; }
	h2 { font-size: 1.1rem; font-weight: 700; margin: 0 0 0.75rem; }
	.state { padding: 3rem 1rem; text-align: center; color: var(--text-secondary, #94a3b8); }
	code { font-family: ui-monospace, monospace; font-size: 0.8rem; background: rgba(148,163,184,0.15); padding: 0.1rem 0.35rem; border-radius: 4px; }

	.connected { text-align: center; padding: 1.5rem 1rem; display: flex; flex-direction: column; gap: 0.75rem; align-items: center; }
	.check { width: 56px; height: 56px; border-radius: 50%; background: rgba(34,197,94,0.15); color: #22c55e; display: grid; place-items: center; font-size: 1.75rem; font-weight: 700; }
	.connected p { color: var(--text-secondary, #94a3b8); margin: 0; }
	.stripe span { padding: 0.15rem 0.55rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
	.status-active { background: rgba(34,197,94,0.15); color: #22c55e; }
	.status-pending { background: rgba(245,158,11,0.15); color: #f59e0b; }
	.status-restricted, .status-rejected { background: rgba(239,68,68,0.15); color: #ef4444; }
	.disconnect-btn { padding: 0.6rem 1.25rem; border-radius: 8px; background: transparent; border: 1px solid var(--border-strong, rgba(148,163,184,0.3)); color: inherit; cursor: pointer; margin-top: 0.5rem; }
	.continue { display: inline-block; padding: 0.75rem 1.25rem; border-radius: 10px; background: var(--accent-primary, #3b82f6); color: #fff; text-decoration: none; font-weight: 600; margin-top: 0.5rem; }

	.connect-form { display: flex; flex-direction: column; gap: 1rem; }
	.explainer { color: var(--text-secondary, #94a3b8); font-size: 0.875rem; line-height: 1.55; margin: 0; }
	.explainer a { color: var(--accent-primary, #3b82f6); text-decoration: underline; }
	.field { display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.875rem; font-weight: 600; }
	.field input { padding: 0.625rem 0.75rem; border-radius: 8px; border: 1px solid var(--border-strong, rgba(148,163,184,0.3)); background: var(--surface, #0f172a); color: inherit; font-size: 0.95rem; }
	.connect-btn { padding: 0.75rem 1rem; border-radius: 10px; border: none; background: var(--accent-primary, #3b82f6); color: #fff; font-weight: 700; cursor: pointer; font-size: 1rem; margin-top: 0.5rem; }
	.connect-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.security-note { font-size: 0.8rem; color: var(--text-secondary, #94a3b8); padding: 0.5rem 0; }
	.security-note summary { cursor: pointer; font-weight: 600; }
	.security-note p { margin: 0.5rem 0 0; line-height: 1.55; }

	.error-block { padding: 0.75rem 1rem; border-radius: 8px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: var(--danger, #ef4444); font-size: 0.875rem; margin: 0; }
	.success-block { padding: 0.75rem 1rem; border-radius: 8px; background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.2); color: #22c55e; font-size: 0.875rem; margin: 0; }
</style>
