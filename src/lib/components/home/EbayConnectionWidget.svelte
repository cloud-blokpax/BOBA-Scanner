<script lang="ts">
	import { user } from '$lib/stores/auth.svelte';

	interface Status {
		configured: boolean;
		connected: boolean;
		seller_username?: string | null;
		seller_account_ready?: boolean | null;
		seller_account_status_message?: string | null;
		token_health?: { refresh_days_remaining: number } | null;
	}

	let status = $state<Status | null>(null);
	let loaded = false;

	$effect(() => {
		if (loaded || !user()) return;
		loaded = true;
		fetch('/api/ebay/status')
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => { status = data; })
			.catch(() => { status = null; });
	});

	const visible = $derived(!!status && status.configured);
	const needsSetup = $derived(
		status?.connected === true && status?.seller_account_ready === false
	);
	const expiringSoon = $derived(
		(status?.token_health?.refresh_days_remaining ?? 999) <= 30
	);
</script>

{#if visible && status}
	<a class="widget" href="/settings/integrations/ebay" data-state={status.connected ? (needsSetup ? 'warn' : 'ok') : 'connect'}>
		<span class="icon" aria-hidden="true">
			{#if status.connected && !needsSetup}✓{:else if needsSetup}!{:else}＋{/if}
		</span>
		<div class="body">
			{#if status.connected && !needsSetup}
				<div class="title">eBay connected</div>
				<div class="sub">
					{#if status.seller_username}@{status.seller_username}{:else}Listing-ready{/if}
					{#if expiringSoon} · token expires soon{/if}
				</div>
			{:else if needsSetup}
				<div class="title">eBay setup needed</div>
				<div class="sub">{status.seller_account_status_message ?? 'Complete seller setup to enable listings.'}</div>
			{:else}
				<div class="title">Connect eBay</div>
				<div class="sub">List scanned cards directly to your eBay store.</div>
			{/if}
		</div>
		<span class="chev" aria-hidden="true">→</span>
	</a>
{/if}

<style>
	.widget {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border: 1px solid var(--border, rgba(148, 163, 184, 0.15));
		border-radius: var(--radius-lg, 14px);
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #e2e8f0);
		text-decoration: none;
		transition: transform 0.15s, border-color 0.15s;
	}

	.widget:hover {
		transform: translateY(-1px);
	}

	.widget[data-state='ok']:hover { border-color: #10b981; }
	.widget[data-state='warn'] { border-color: rgba(245, 158, 11, 0.4); }
	.widget[data-state='warn']:hover { border-color: #f59e0b; }
	.widget[data-state='connect']:hover { border-color: #10b981; }

	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		font-size: 1.05rem;
		font-weight: 700;
		flex-shrink: 0;
	}

	.widget[data-state='ok'] .icon { background: rgba(16, 185, 129, 0.15); color: #10b981; }
	.widget[data-state='warn'] .icon { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
	.widget[data-state='connect'] .icon { background: rgba(148, 163, 184, 0.12); color: var(--text-secondary, #94a3b8); }

	.body {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.title {
		font-size: 0.95rem;
		font-weight: 700;
		line-height: 1.2;
	}

	.sub {
		font-size: 0.78rem;
		color: var(--text-secondary, #94a3b8);
		line-height: 1.25;
		margin-top: 3px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chev {
		color: var(--text-secondary, #94a3b8);
		font-size: 1.05rem;
		flex-shrink: 0;
	}
</style>
