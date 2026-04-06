<script lang="ts">
	import { onMount } from 'svelte';
	import { initScanner } from '$lib/stores/scanner.svelte';
	import Scanner from '$lib/components/Scanner.svelte';
	import BrowseView from '$lib/components/sell/BrowseView.svelte';
	import ListingView from '$lib/components/sell/ListingView.svelte';
	import type { ScanResult, Card } from '$lib/types';

	// ── eBay connection status ──────────────────────────────
	let ebayConfigured = $state(false);
	let ebayConnected = $state(false);
	let ebayChecked = $state(false);

	onMount(() => {
		fetch('/api/ebay/status')
			.then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
			.then(data => {
				ebayConfigured = data.configured;
				ebayConnected = data.connected;
			})
			.catch((err) => {
				console.warn('[sell] eBay status check failed:', err);
				ebayConfigured = false;
				ebayConnected = false;
			})
			.finally(() => { ebayChecked = true; });
	});

	// ── Three-view state machine ────────────────────────────
	type SellView = 'browse' | 'scanning' | 'listing';
	let view = $state<SellView>('browse');
	let listingCard = $state<Card | null>(null);
	let listingImageUrl = $state<string | null>(null);

	function startScanToList() {
		initScanner();
		listingCard = null;
		listingImageUrl = null;
		view = 'scanning';
	}

	function handleScanResult(result: ScanResult, capturedImageUrl?: string) {
		if (!result.card) return;
		listingCard = result.card;
		listingImageUrl = capturedImageUrl || null;
		view = 'listing';
	}
</script>

<svelte:head>
	<title>Sell - BOBA Scanner</title>
</svelte:head>

{#if view === 'scanning'}
	<div class="stl-scanner-view">
		<div class="stl-header">
			<button class="stl-back" onclick={() => { view = 'browse'; }}>← Back</button>
			<h1 class="stl-title">Scan to List</h1>
		</div>
		<div class="stl-scanner-container">
			<Scanner
				onResult={handleScanResult}
				isAuthenticated={!!ebayConnected}
				embedded={true}
				scanMode="single"
			/>
		</div>
	</div>
{:else if view === 'listing' && listingCard}
	<ListingView
		card={listingCard}
		imageUrl={listingImageUrl}
		{ebayConnected}
		onScanNext={() => { listingCard = null; view = 'scanning'; }}
		onDone={() => { listingCard = null; view = 'browse'; }}
	/>
{:else}
	<BrowseView
		{ebayConfigured} {ebayConnected} {ebayChecked}
		onStartScan={startScanToList}
	/>
{/if}

<style>
	.stl-scanner-view { max-width: 600px; margin: 0 auto; padding: 0; }
	.stl-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border, rgba(148,163,184,0.10)); }
	.stl-back { background: none; border: none; color: var(--text-secondary, #94a3b8); font-size: 0.9rem; cursor: pointer; padding: 0.25rem; }
	.stl-title { font-size: 1.1rem; font-weight: 700; }
	.stl-scanner-container { height: calc(100dvh - 56px - 68px - 52px); position: relative; }
</style>
