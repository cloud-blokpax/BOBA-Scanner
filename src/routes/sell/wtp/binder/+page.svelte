<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { initScanner } from '$lib/stores/scanner.svelte';
	import { uploadScanImageForListing } from '$lib/stores/collection.svelte';
	import Scanner from '$lib/components/Scanner.svelte';
	import { isPro } from '$lib/stores/pro.svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ScanResult } from '$lib/types';

	interface QueueRow {
		scan_id: string;
		card: {
			id: string;
			name: string;
			card_number: string | null;
			parallel: string;
			set_name: string | null;
			rarity: string | null;
			orbital: string | null;
			special_attribute: string | null;
			image_url: string | null;
		};
		images: string[];
		condition: string;
		price: number;
		skip: boolean;
	}

	const MAX_QUEUE = 15;

	const pro = $derived(isPro());
	let view = $state<'scan' | 'queue' | 'posting' | 'done'>('scan');
	let queue = $state<QueueRow[]>([]);
	let posting = $state(false);
	let results = $state<{ succeeded: number; failed: number } | null>(null);

	onMount(() => {
		if (!pro) return;
		initScanner();
	});

	async function handleScanResult(result: ScanResult, capturedImageUrl?: string) {
		if (!result.card || !result.id) return;
		if (result.game_id !== 'wonders') {
			showToast('Skipped — not a Wonders card', 'x');
			return;
		}
		if (queue.some((row) => row.scan_id === result.id)) return;
		if (queue.length >= MAX_QUEUE) {
			showToast(`Queue full (${MAX_QUEUE} max). Post these first.`, 'x');
			return;
		}

		if (capturedImageUrl) {
			uploadScanImageForListing(result.card.id, capturedImageUrl).catch(() => {});
		}

		try {
			const r = await fetch(`/api/wtp/compose-context/${result.id}`);
			if (!r.ok) {
				showToast('Could not load scan details', 'x');
				return;
			}
			const ctx = await r.json();
			queue = [
				...queue,
				{
					scan_id: result.id,
					card: ctx.card,
					images: ctx.image_urls,
					condition: 'Near Mint',
					price: ctx.suggested_price?.value ? Math.round(ctx.suggested_price.value) : 0,
					skip: false
				}
			];
			showToast(`Added ${result.card.name}`, 'check');
		} catch (err) {
			showToast('Failed to add to queue', 'x');
		}
	}

	function removeRow(scanId: string) {
		queue = queue.filter((r) => r.scan_id !== scanId);
	}

	async function postAll() {
		const items = queue
			.filter((r) => !r.skip && r.price > 0)
			.map((r) => ({
				scan_id: r.scan_id,
				condition: r.condition,
				price: r.price,
				quantity: 1,
				accepting_offers: true,
				open_to_trade: false,
				shipping_mode: 'free' as const,
				shipping_fee: 0,
				description: null,
				image_urls: r.images
			}));

		if (items.length === 0) {
			showToast('Set a price on at least one card', 'x');
			return;
		}

		posting = true;
		view = 'posting';
		try {
			const r = await fetch('/api/wtp/post-batch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items })
			});
			const data = (await r.json()) as { ok?: boolean; succeeded?: number; failed?: number; error?: string };
			if (!r.ok || !data.ok) {
				showToast(data.error ?? 'Batch post failed', 'x');
				view = 'queue';
				return;
			}
			results = { succeeded: data.succeeded ?? 0, failed: data.failed ?? 0 };
			view = 'done';
		} catch (err) {
			showToast(err instanceof Error ? err.message : 'Network error', 'x');
			view = 'queue';
		} finally {
			posting = false;
		}
	}
</script>

<svelte:head><title>Binder mode — WTP</title></svelte:head>

{#if !pro}
	<div class="pro-gate">
		<div class="lock" aria-hidden="true">🔒</div>
		<h1>Binder mode is a Pro feature</h1>
		<p>Scan a full binder page at once and post the whole queue to Wonders Trading Post.</p>
		<a href="/sell/wtp" class="back-link">← Back</a>
	</div>
{:else if view === 'scan'}
	<div class="binder-scan">
		<div class="header">
			<button class="back" onclick={() => goto('/sell/wtp')}>← Cancel</button>
			<h1>Binder mode <span class="count">({queue.length}/{MAX_QUEUE})</span></h1>
			<button class="review-btn" onclick={() => view = 'queue'} disabled={queue.length === 0}>Review →</button>
		</div>
		<div class="scanner-container">
			<Scanner onResult={handleScanResult} isAuthenticated={true} embedded={true} scanMode="single" gameHint="wonders" />
		</div>
	</div>
{:else if view === 'queue'}
	<div class="binder-queue">
		<div class="header">
			<button class="back" onclick={() => view = 'scan'}>← Scan more</button>
			<h1>Review queue</h1>
		</div>

		{#if queue.length === 0}
			<p class="empty">Queue is empty.</p>
		{:else}
			<ul class="queue-list">
				{#each queue as row (row.scan_id)}
					<li class="queue-row" class:skipped={row.skip}>
						{#if row.images[0] || row.card.image_url}
							<img src={row.images[0] ?? row.card.image_url} alt={row.card.name} />
						{:else}
							<div class="img-placeholder" aria-hidden="true"></div>
						{/if}
						<div class="row-info">
							<strong>{row.card.name}</strong>
							<span class="meta">
								{#if row.card.card_number}#{row.card.card_number} · {/if}{row.card.parallel}
							</span>
							<div class="row-controls">
								<label>Condition
									<select bind:value={row.condition}>
										<option>Mint</option>
										<option>Near Mint</option>
										<option>Lightly Played</option>
										<option>Moderately Played</option>
										<option>Heavily Played</option>
										<option>Damaged</option>
									</select>
								</label>
								<label>Price
									<input type="number" min="0.01" step="0.01" bind:value={row.price} />
								</label>
								<label class="skip-toggle">
									<input type="checkbox" bind:checked={row.skip} /> Skip
								</label>
								<button type="button" class="remove" onclick={() => removeRow(row.scan_id)}>Remove</button>
							</div>
						</div>
					</li>
				{/each}
			</ul>

			<div class="footer-actions">
				<button class="post-all" onclick={postAll} disabled={posting}>
					Post {queue.filter((r) => !r.skip && r.price > 0).length} cards to WTP
				</button>
			</div>
		{/if}
	</div>
{:else if view === 'posting'}
	<div class="state">
		<span class="spinner"></span>
		<p>Posting {queue.filter((r) => !r.skip && r.price > 0).length} listings to WTP…</p>
	</div>
{:else if view === 'done' && results}
	<div class="batch-done">
		<h1>Batch complete</h1>
		<p><strong>{results.succeeded}</strong> posted · <strong>{results.failed}</strong> failed</p>
		<div class="actions">
			<a href="/sell/wtp/history" class="primary">View my listings</a>
			<a href="/sell/wtp" class="secondary">Sell more cards</a>
		</div>
	</div>
{/if}

<style>
	.pro-gate { max-width: 480px; margin: 3rem auto; text-align: center; padding: 2rem 1rem; display: flex; flex-direction: column; gap: 0.75rem; align-items: center; }
	.lock { font-size: 3rem; }
	.pro-gate h1 { font-size: 1.4rem; margin: 0.5rem 0 0; }
	.pro-gate p { color: var(--text-secondary, #94a3b8); margin: 0; }
	.back-link { margin-top: 1rem; color: var(--text-secondary, #94a3b8); text-decoration: none; }

	.binder-scan { max-width: 600px; margin: 0 auto; }
	.header { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border, rgba(148,163,184,0.10)); }
	.back { background: none; border: none; color: var(--text-secondary, #94a3b8); font-size: 0.9rem; cursor: pointer; padding: 0.25rem; }
	h1 { font-size: 1.1rem; font-weight: 700; margin: 0; flex: 1; }
	.count { color: var(--text-secondary, #94a3b8); font-weight: 400; font-size: 0.85rem; }
	.review-btn { padding: 0.4rem 0.75rem; border-radius: 8px; background: var(--accent-primary, #3b82f6); color: #fff; border: none; font-weight: 600; cursor: pointer; font-size: 0.85rem; }
	.review-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.scanner-container { height: calc(100dvh - 56px - 68px - 52px - 44px); position: relative; }

	.binder-queue { max-width: 720px; margin: 0 auto; padding: 0 1rem 5rem; }
	.empty { padding: 3rem 0; text-align: center; color: var(--text-secondary, #94a3b8); }
	.queue-list { list-style: none; padding: 0; margin: 1rem 0 0; display: flex; flex-direction: column; gap: 0.5rem; }
	.queue-row { display: grid; grid-template-columns: 80px 1fr; gap: 0.75rem; padding: 0.625rem; border-radius: 10px; background: var(--surface, #0f172a); border: 1px solid var(--border, rgba(148,163,184,0.15)); }
	.queue-row.skipped { opacity: 0.5; }
	.queue-row img, .img-placeholder { width: 80px; height: 112px; object-fit: cover; border-radius: 6px; background: rgba(148,163,184,0.1); }
	.row-info { display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; }
	.row-info strong { font-size: 0.95rem; }
	.row-info .meta { font-size: 0.75rem; color: var(--text-secondary, #94a3b8); }
	.row-controls { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-top: 0.25rem; }
	.row-controls label { font-size: 0.75rem; display: flex; flex-direction: column; gap: 0.15rem; color: var(--text-secondary, #94a3b8); }
	.row-controls select, .row-controls input { padding: 0.3rem 0.4rem; border-radius: 6px; border: 1px solid var(--border-strong, rgba(148,163,184,0.3)); background: var(--surface, #0f172a); color: inherit; font-size: 0.8rem; }
	.row-controls input[type="number"] { width: 80px; }
	.skip-toggle { flex-direction: row; align-items: center; gap: 0.3rem; padding-top: 0.85rem; }
	.remove { padding: 0.3rem 0.6rem; border-radius: 6px; background: transparent; border: 1px solid var(--border-strong, rgba(148,163,184,0.3)); color: var(--text-secondary, #94a3b8); font-size: 0.75rem; cursor: pointer; align-self: flex-end; }

	.footer-actions { position: sticky; bottom: 0; background: var(--bg, #020617); padding: 1rem 0; border-top: 1px solid var(--border, rgba(148,163,184,0.15)); margin-top: 1rem; }
	.post-all { width: 100%; padding: 0.875rem 1rem; border-radius: 10px; border: none; background: var(--accent-primary, #3b82f6); color: #fff; font-size: 1rem; font-weight: 700; cursor: pointer; }
	.post-all:disabled { opacity: 0.5; cursor: not-allowed; }

	.state { display: flex; flex-direction: column; gap: 1rem; align-items: center; padding: 4rem 1rem; color: var(--text-secondary, #94a3b8); }
	.spinner { width: 32px; height: 32px; border: 3px solid var(--border-strong, rgba(148,163,184,0.2)); border-top-color: var(--accent-primary, #3b82f6); border-radius: 50%; animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	.batch-done { max-width: 480px; margin: 3rem auto; text-align: center; padding: 2rem 1rem; }
	.batch-done h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
	.batch-done p { color: var(--text-secondary, #94a3b8); margin: 0 0 1.5rem; }
	.batch-done .actions { display: flex; flex-direction: column; gap: 0.5rem; max-width: 240px; margin: 0 auto; }
	.batch-done .actions a { display: inline-block; padding: 0.75rem 1.25rem; border-radius: 10px; font-weight: 600; text-decoration: none; }
	.batch-done .actions a.primary { background: var(--accent-primary, #3b82f6); color: #fff; }
	.batch-done .actions a.secondary { border: 1px solid var(--border-strong, rgba(148,163,184,0.3)); color: inherit; }
</style>
