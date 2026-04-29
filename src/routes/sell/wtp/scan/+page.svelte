<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { initScanner } from '$lib/stores/scanner.svelte';
	import { uploadScanImageForListing } from '$lib/stores/collection.svelte';
	import Scanner from '$lib/components/Scanner.svelte';
	import type { ScanResult } from '$lib/types';

	onMount(() => initScanner());

	async function handleResult(result: ScanResult, capturedImageUrl?: string) {
		if (!result.card || !result.id) return;

		if (result.game_id !== 'wonders') {
			goto(`/sell/wtp/wrong-game?card_id=${encodeURIComponent(result.card_id ?? '')}&game=${encodeURIComponent(result.game_id ?? 'boba')}&scan_id=${encodeURIComponent(result.id)}`);
			return;
		}

		// Persist the captured image to Supabase Storage so the composer can
		// reference a public URL when relaying to WTP. Failure is non-fatal:
		// the composer can fall back to the catalog image.
		if (capturedImageUrl) {
			uploadScanImageForListing(result.card.id, capturedImageUrl).catch((err) => {
				console.warn('[sell/wtp/scan] image upload failed', err);
			});
		}

		goto(`/sell/wtp/compose/${result.id}`);
	}
</script>

<svelte:head><title>Scan for WTP</title></svelte:head>

<div class="wtp-scan">
	<div class="header">
		<button class="back" onclick={() => goto('/sell/wtp')}>← Back</button>
		<h1>Scan a Wonders card</h1>
	</div>
	<div class="scanner-container">
		<Scanner onResult={handleResult} isAuthenticated={true} embedded={true} scanMode="single" gameHint="wonders" />
	</div>
</div>

<style>
	.wtp-scan { max-width: 600px; margin: 0 auto; }
	.header { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border, rgba(148,163,184,0.10)); }
	.back { background: none; border: none; color: var(--text-secondary, #94a3b8); font-size: 0.9rem; cursor: pointer; padding: 0.25rem; }
	h1 { font-size: 1.1rem; font-weight: 700; margin: 0; }
	.scanner-container { height: calc(100dvh - 56px - 68px - 52px - 44px); position: relative; }
</style>
