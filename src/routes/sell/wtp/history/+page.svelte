<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	interface Posting {
		id: string;
		status: string;
		posted_at: string | null;
		last_synced_at: string | null;
		wtp_listing_id: string | null;
		wtp_listing_url: string | null;
		error_message: string | null;
		scan_id: string | null;
		source_listing_id: string | null;
		card: { id: string; name: string; card_number: string | null; parallel: string | null; set_code: string } | null;
		payload: { price_cents?: number } | null;
	}

	let postings = $state<Posting[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	function statusLabel(s: string): string {
		switch (s) {
			case 'pending': return 'Pending';
			case 'posted': return 'Live';
			case 'sold': return 'Sold';
			case 'ended': return 'Ended';
			case 'failed': return 'Failed';
			default: return s;
		}
	}

	function formatPrice(cents: number | undefined | null): string {
		if (cents == null) return '';
		return `$${(cents / 100).toFixed(2)}`;
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '';
		return new Date(iso).toLocaleDateString();
	}

	onMount(async () => {
		try {
			const r = await fetch('/api/wtp/history');
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const data = (await r.json()) as { postings: Posting[] };
			postings = data.postings;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load history';
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head><title>My WTP listings</title></svelte:head>

<div class="history">
	<div class="header">
		<button class="back" onclick={() => goto('/sell/wtp')}>← Back</button>
		<h1>My WTP listings</h1>
	</div>

	{#if loading}
		<div class="state">Loading…</div>
	{:else if error}
		<div class="state error">{error}</div>
	{:else if postings.length === 0}
		<div class="empty">
			<p>No WTP listings yet.</p>
			<a href="/sell/wtp" class="primary">Sell your first card</a>
		</div>
	{:else}
		<ul class="list">
			{#each postings as p (p.id)}
				<li class="row" data-status={p.status}>
					<div class="row-main">
						<span class="status status-{p.status}">{statusLabel(p.status)}</span>
						<div class="card-info">
							{#if p.card}
								<strong>{p.card.name}</strong>
								<span class="meta">
									{#if p.card.card_number}#{p.card.card_number} · {/if}
									{p.card.parallel ?? 'Paper'}
								</span>
							{:else}
								<strong>(card removed)</strong>
							{/if}
						</div>
						<span class="price">{formatPrice(p.payload?.price_cents)}</span>
					</div>
					<div class="row-meta">
						<span class="date">{formatDate(p.posted_at)}</span>
						{#if p.wtp_listing_url}
							<a href={p.wtp_listing_url} target="_blank" rel="noopener" class="view-link">View on WTP →</a>
						{/if}
					</div>
					{#if p.status === 'failed' && p.error_message}
						<p class="row-error">{p.error_message}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.history { max-width: 720px; margin: 0 auto; padding: 1rem; }
	.header { display: flex; align-items: center; gap: 0.75rem; padding: 0 0 1rem; border-bottom: 1px solid var(--border, rgba(148,163,184,0.10)); margin-bottom: 1rem; }
	.back { background: none; border: none; color: var(--text-secondary, #94a3b8); font-size: 0.9rem; cursor: pointer; padding: 0.25rem; }
	h1 { font-size: 1.25rem; font-weight: 700; margin: 0; }
	.state { padding: 3rem 1rem; text-align: center; color: var(--text-secondary, #94a3b8); }
	.state.error { color: var(--danger, #ef4444); }
	.empty { padding: 3rem 1rem; text-align: center; }
	.empty p { color: var(--text-secondary, #94a3b8); margin-bottom: 1rem; }
	.empty .primary { display: inline-block; padding: 0.75rem 1.25rem; border-radius: 10px; background: var(--accent-primary, #3b82f6); color: #fff; text-decoration: none; font-weight: 600; }

	.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
	.row { padding: 0.75rem; border-radius: 10px; background: var(--surface, #0f172a); border: 1px solid var(--border, rgba(148,163,184,0.15)); display: flex; flex-direction: column; gap: 0.5rem; }
	.row-main { display: flex; align-items: center; gap: 0.75rem; }
	.card-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.card-info strong { font-size: 0.95rem; }
	.card-info .meta { font-size: 0.75rem; color: var(--text-secondary, #94a3b8); }
	.price { font-weight: 700; font-size: 0.95rem; }

	.status { padding: 0.15rem 0.55rem; border-radius: 999px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
	.status-posted { background: rgba(34,197,94,0.15); color: #22c55e; }
	.status-sold { background: rgba(59,130,246,0.15); color: #3b82f6; }
	.status-ended { background: rgba(148,163,184,0.15); color: #94a3b8; }
	.status-pending { background: rgba(245,158,11,0.15); color: #f59e0b; }
	.status-failed { background: rgba(239,68,68,0.15); color: #ef4444; }

	.row-meta { display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: var(--text-secondary, #94a3b8); }
	.view-link { color: var(--accent-primary, #3b82f6); text-decoration: none; font-weight: 600; }

	.row-error { font-size: 0.8rem; color: var(--danger, #ef4444); margin: 0; padding: 0.4rem 0.6rem; border-radius: 6px; background: rgba(239,68,68,0.08); }
</style>
