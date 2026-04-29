<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import WtpListingForm, { type WtpFormValues } from '$lib/components/wtp/WtpListingForm.svelte';

	const scanId = $derived($page.params.scan_id ?? '');

	interface ComposeContext {
		scan: { id: string; capture_source: string | null };
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
			game_id: string;
		};
		image_urls: string[];
		suggested_price: { value: number; source: string; sample_size: number | null } | null;
	}

	let context = $state<ComposeContext | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let busy = $state(false);
	let submitError = $state<string | null>(null);

	onMount(async () => {
		try {
			const r = await fetch(`/api/wtp/compose-context/${scanId}`);
			if (r.status === 400) {
				const data = (await r.json()) as { code?: string; details?: { game_id?: string } };
				if (data.code === 'wrong_game') {
					const gameParam = data.details?.game_id ?? '';
					goto(`/sell/wtp/wrong-game?game=${encodeURIComponent(gameParam)}&scan_id=${encodeURIComponent(scanId)}`);
					return;
				}
				loadError = 'This scan can\'t be listed (not a Wonders card or unresolved).';
				return;
			}
			if (!r.ok) {
				const data = (await r.json().catch(() => ({}))) as { error?: string };
				loadError = data.error ?? `Could not load scan (HTTP ${r.status})`;
				return;
			}
			context = (await r.json()) as ComposeContext;
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load scan';
		} finally {
			loading = false;
		}
	});

	async function submit(values: WtpFormValues) {
		if (!context) return;
		busy = true;
		submitError = null;
		try {
			const r = await fetch('/api/wtp/post', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					scan_id: scanId,
					...values,
					image_urls: context.image_urls
				})
			});
			const data = (await r.json()) as {
				ok?: boolean;
				wtp_url?: string;
				wtp_listing_id?: string;
				posting_id?: string;
				already_posted?: boolean;
				error?: string;
			};
			if (!r.ok || !data.ok) {
				submitError = data.error ?? 'Failed to post listing.';
				return;
			}
			const params = new URLSearchParams();
			if (data.wtp_url) params.set('wtp_url', data.wtp_url);
			if (data.posting_id) params.set('posting_id', data.posting_id);
			if (data.already_posted) params.set('already_posted', '1');
			goto(`/sell/wtp/success?${params.toString()}`);
		} catch (err) {
			submitError = err instanceof Error ? err.message : 'Network error';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Compose listing — WTP</title></svelte:head>

<div class="wtp-compose">
	<div class="header">
		<button class="back" onclick={() => goto('/sell/wtp')}>← Cancel</button>
		<h1>Listing details</h1>
	</div>

	{#if loading}
		<div class="state-msg"><span class="spinner"></span> Loading scan…</div>
	{:else if loadError}
		<div class="state-msg error">{loadError}</div>
	{:else if context}
		<WtpListingForm
			card={context.card}
			images={context.image_urls}
			suggestedPrice={context.suggested_price}
			onSubmit={submit}
			{busy}
			error={submitError}
		/>
	{/if}
</div>

<style>
	.wtp-compose { max-width: 640px; margin: 0 auto; }
	.header { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border, rgba(148,163,184,0.10)); }
	.back { background: none; border: none; color: var(--text-secondary, #94a3b8); font-size: 0.9rem; cursor: pointer; padding: 0.25rem; }
	h1 { font-size: 1.1rem; font-weight: 700; margin: 0; }
	.state-msg { padding: 4rem 1rem; text-align: center; color: var(--text-secondary, #94a3b8); display: flex; gap: 0.75rem; align-items: center; justify-content: center; }
	.state-msg.error { color: var(--danger, #ef4444); }
	.spinner { width: 16px; height: 16px; border: 2px solid var(--border-strong, rgba(148,163,184,0.3)); border-top-color: var(--accent-primary, #3b82f6); border-radius: 50%; animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
