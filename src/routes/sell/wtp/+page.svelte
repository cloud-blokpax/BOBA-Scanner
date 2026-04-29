<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { isPro } from '$lib/stores/pro.svelte';

	interface WtpStatus {
		configured: boolean;
		connected: boolean;
		wtp_username: string | null;
		stripe_connect_status: string | null;
		stripe_connect_checked_at: string | null;
		connected_at: string | null;
	}

	let status = $state<WtpStatus | null>(null);
	let loading = $state(true);
	const pro = $derived(isPro());

	onMount(async () => {
		try {
			const r = await fetch('/api/wtp/status');
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			status = (await r.json()) as WtpStatus;
			if (!status.connected) {
				goto(`/settings/wtp-connect?return=${encodeURIComponent('/sell/wtp')}`);
				return;
			}
		} catch (err) {
			console.warn('[sell/wtp] status check failed', err);
		} finally {
			loading = false;
		}
	});

	const stripeBannerKind = $derived.by(() => {
		const s = status?.stripe_connect_status;
		if (!s || s === 'active') return null;
		if (s === 'pending') return 'pending';
		if (s === 'restricted' || s === 'rejected') return 'blocked';
		return 'not_started';
	});
</script>

<svelte:head><title>Sell on Wonders Trading Post</title></svelte:head>

{#if loading}
	<div class="wtp-loading"><span class="spinner"></span> Checking WTP connection…</div>
{:else if status?.connected}
	<div class="wtp-entry">
		<header>
			<button class="back" onclick={() => goto('/sell')}>← Sell</button>
			<h1>Sell on Wonders Trading Post</h1>
			{#if status.wtp_username}
				<p class="subtitle">Connected as <strong>{status.wtp_username}</strong></p>
			{/if}
		</header>

		{#if stripeBannerKind}
			<div class="stripe-banner" class:blocked={stripeBannerKind === 'blocked'}>
				{#if stripeBannerKind === 'pending'}
					<strong>Finish your Stripe payout setup</strong> — your listings can post, but you won't be paid until Stripe Connect is active.
				{:else if stripeBannerKind === 'blocked'}
					<strong>Stripe Connect is restricted.</strong> Resolve the issue with WTP support before posting.
				{:else}
					<strong>Set up Stripe payouts.</strong> You'll need this to receive money for sales.
				{/if}
				<a href="https://wonderstradingpost.com/seller/payouts" target="_blank" rel="noopener">Open WTP payout settings →</a>
			</div>
		{/if}

		<div class="capture-modes">
			<a href="/sell/wtp/scan" class="capture-card">
				<span class="icon" aria-hidden="true">📷</span>
				<h2>Live scan</h2>
				<p>Use your camera. Best for one card at a time.</p>
			</a>

			<a href="/sell/wtp/upload" class="capture-card">
				<span class="icon" aria-hidden="true">📤</span>
				<h2>Upload photo</h2>
				<p>Upload an existing photo of the card.</p>
			</a>

			<a
				href={pro ? '/sell/wtp/binder' : '/sell/wtp'}
				class="capture-card pro"
				class:disabled={!pro}
				aria-disabled={!pro}
			>
				<span class="icon" aria-hidden="true">📚</span>
				<h2>Binder mode</h2>
				<p>Scan a full binder page at once.</p>
				{#if !pro}<span class="pro-badge">PRO</span>{/if}
			</a>
		</div>

		<footer>
			<a href="/sell/wtp/history">My WTP listings →</a>
		</footer>
	</div>
{/if}

<style>
	.wtp-loading { display: flex; gap: 0.75rem; align-items: center; justify-content: center; padding: 4rem 1rem; color: var(--text-secondary, #94a3b8); }
	.spinner { width: 18px; height: 18px; border: 2px solid var(--border-strong, rgba(148,163,184,0.3)); border-top-color: var(--accent-primary, #3b82f6); border-radius: 50%; animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	.wtp-entry { max-width: 640px; margin: 0 auto; padding: 1rem; }
	header { padding: 0.5rem 0 1rem; }
	.back { background: none; border: none; color: var(--text-secondary, #94a3b8); font-size: 0.9rem; cursor: pointer; padding: 0; }
	h1 { font-size: 1.5rem; font-weight: 700; margin: 0.5rem 0 0.25rem; }
	.subtitle { font-size: 0.875rem; color: var(--text-secondary, #94a3b8); margin: 0; }

	.stripe-banner { padding: 0.875rem 1rem; border-radius: 12px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); margin-bottom: 1rem; font-size: 0.875rem; line-height: 1.5; }
	.stripe-banner.blocked { background: rgba(239, 68, 68, 0.12); border-color: rgba(239, 68, 68, 0.3); }
	.stripe-banner a { display: inline-block; margin-top: 0.5rem; color: var(--accent-primary, #3b82f6); text-decoration: underline; font-weight: 600; }

	.capture-modes { display: grid; grid-template-columns: 1fr; gap: 0.75rem; margin: 1rem 0; }
	@media (min-width: 480px) { .capture-modes { grid-template-columns: 1fr 1fr; } }

	.capture-card { display: flex; flex-direction: column; gap: 0.5rem; padding: 1.25rem; border-radius: 14px; background: var(--surface, #0f172a); border: 1px solid var(--border, rgba(148,163,184,0.15)); text-decoration: none; color: inherit; position: relative; transition: border-color 0.15s, transform 0.1s; }
	.capture-card:hover { border-color: var(--accent-primary, #3b82f6); }
	.capture-card:active { transform: scale(0.99); }
	.capture-card.disabled { opacity: 0.55; pointer-events: none; }
	.capture-card .icon { font-size: 1.75rem; }
	.capture-card h2 { font-size: 1rem; margin: 0; font-weight: 700; }
	.capture-card p { font-size: 0.8125rem; color: var(--text-secondary, #94a3b8); margin: 0; }
	.pro-badge { position: absolute; top: 0.75rem; right: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 999px; background: linear-gradient(135deg, #f59e0b, #ef4444); color: #fff; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.05em; }

	footer { padding: 1rem 0; text-align: center; }
	footer a { color: var(--text-secondary, #94a3b8); font-size: 0.875rem; text-decoration: none; }
	footer a:hover { color: var(--accent-primary, #3b82f6); }
</style>
