<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { initScanner } from '$lib/stores/scanner.svelte';
	import { recognizeCard, initWorkers } from '$lib/services/recognition';
	import Scanner from '$lib/components/Scanner.svelte';
	import BrowseView from '$lib/components/sell/BrowseView.svelte';
	import SellExportTab from '$lib/components/sell/SellExportTab.svelte';
	import ListingView from '$lib/components/sell/ListingView.svelte';
	import WhatnotPendingView from '$lib/components/sell/WhatnotPendingView.svelte';
	import {
		initWhatnotBatch, addCardToBatch, whatnotPendingCards,
		whatnotBatchTag, whatnotInitialized
	} from '$lib/stores/whatnot-batch.svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import {
		startFlow, updateFlowStep, endFlow, flowBreadcrumb
	} from '$lib/services/client-error-logger';
	import { releaseOcrWorker } from '$lib/services/paddle-ocr';
	import type { ScanResult, Card } from '$lib/types';

	// ── Tab routing (from category tabs) ────────────────────
	const isExportTab = $derived($page.url.searchParams.get('tab') === 'export');

	// ── eBay connection status ──────────────────────────────
	let ebayConfigured = $state(false);
	let ebayConnected = $state(false);
	let ebayChecked = $state(false);
	let ebaySellerUsername = $state<string | null>(null);
	let ebaySellerEmail = $state<string | null>(null);
	let ebayConnectedSince = $state<string | null>(null);
	let ebayTokenHealth = $state<{ access_token_valid: boolean; refresh_days_remaining: number } | null>(null);

	onMount(() => {
		fetch('/api/ebay/status')
			.then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
			.then(data => {
				ebayConfigured = data.configured;
				ebayConnected = data.connected;
				ebaySellerUsername = data.seller_username ?? null;
				ebaySellerEmail = data.seller_email ?? null;
				ebayConnectedSince = data.connected_since ?? null;
				ebayTokenHealth = data.token_health ? {
					access_token_valid: data.token_health.access_token_valid,
					refresh_days_remaining: data.token_health.refresh_days_remaining
				} : null;
			})
			.catch((err) => {
				console.warn('[sell] eBay status check failed:', err);
				ebayConfigured = false;
				ebayConnected = false;
			})
			.finally(() => { ebayChecked = true; });
	});

	// ── State machine ───────────────────────────────────────
	type SellView = 'browse' | 'scanning' | 'uploading' | 'listing' | 'whatnot-scanning' | 'whatnot-uploading' | 'whatnot-pending';
	let view = $state<SellView>('browse');
	let listingCard = $state<Card | null>(null);
	let listingImageUrl = $state<string | null>(null);
	// Provenance: the scan that produced `listingCard`. Forwarded into
	// `listing_templates.scan_id` so Phase 2 dashboards can measure
	// scan→listing conversion. Null for non-scan entry points.
	let listingScanId = $state<string | null>(null);

	// ── Upload state ────────────────────────────────────────
	let uploadProcessing = $state(false);
	let uploadError = $state<string | null>(null);
	let uploadThumbnailUrl = $state<string | null>(null);
	let uploadFileInput = $state<HTMLInputElement | null>(null);
	let listingSource = $state<'scan' | 'upload'>('scan');

	function startScanToList() {
		initScanner();
		listingCard = null;
		listingImageUrl = null;
		listingScanId = null;
		listingSource = 'scan';
		view = 'scanning';
	}

	function startUploadToList() {
		listingCard = null;
		listingImageUrl = null;
		listingScanId = null;
		listingSource = 'upload';
		uploadError = null;
		uploadProcessing = false;
		if (uploadThumbnailUrl) { URL.revokeObjectURL(uploadThumbnailUrl); uploadThumbnailUrl = null; }
		view = 'uploading';
	}

	// ── Whatnot flow ─────────────────────────────────────────
	onMount(() => { initWhatnotBatch(); });

	function startWhatnotScan() {
		initScanner();
		listingCard = null;
		listingImageUrl = null;
		view = 'whatnot-scanning';
	}

	function startWhatnotUpload() {
		listingCard = null;
		listingImageUrl = null;
		uploadError = null;
		uploadProcessing = false;
		if (uploadThumbnailUrl) { URL.revokeObjectURL(uploadThumbnailUrl); uploadThumbnailUrl = null; }
		view = 'whatnot-uploading';
	}

	function handleWhatnotScanResult(result: ScanResult, capturedImageUrl?: string) {
		if (!result.card) return;
		addCardToBatch(result.card, capturedImageUrl || null);
		showToast(`Added ${result.card.hero_name || result.card.name || 'card'} to ${whatnotBatchTag()}`, 'check');
		// Stay in scanning mode for continuous scanning
	}

	async function handleWhatnotUploadFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		input.value = '';

		uploadError = null;
		uploadProcessing = true;
		if (uploadThumbnailUrl) URL.revokeObjectURL(uploadThumbnailUrl);
		uploadThumbnailUrl = URL.createObjectURL(file);

		// Heartbeat-tracked flow. If iOS Safari OOM-kills the page during OCR,
		// the next page load will detect the stale heartbeat and write an
		// `inferred_crash` row to `client_errors` tagged with the active step.
		startFlow('whatnot_upload_card', 'file_selected', {
			size: file.size,
			type: file.type,
			name: file.name
		});

		let bitmap: ImageBitmap | null = null;
		try {
			updateFlowStep('init_workers');
			await initWorkers();

			updateFlowStep('image_decode');
			bitmap = await createImageBitmap(file, {
				resizeWidth: 2048, resizeHeight: 2048, resizeQuality: 'high'
			});
			flowBreadcrumb('decoded', { w: bitmap.width, h: bitmap.height });

			updateFlowStep('recognize_card');
			const result = await recognizeCard(bitmap, undefined, { isAuthenticated: true, skipBlurCheck: true });

			updateFlowStep('apply_result', { matched: !!result.card_id });
			if (result.card_id && result.card) {
				addCardToBatch(result.card, uploadThumbnailUrl);
				showToast(`Added ${result.card.hero_name || result.card.name || 'card'} to ${whatnotBatchTag()}`, 'check');
				uploadThumbnailUrl = null;
				view = 'whatnot-pending';
				endFlow('success');
			} else {
				uploadError = result.failReason || 'Could not identify card. Try a clearer photo.';
				endFlow('cancelled');
			}
		} catch (err) {
			flowBreadcrumb('handler_threw', {
				message: err instanceof Error ? err.message : String(err)
			});
			uploadError = err instanceof Error ? err.message : 'Processing failed';
			endFlow('error');
		} finally {
			bitmap?.close();
			// Release the PaddleOCR client between Whatnot uploads. iOS Safari's
			// per-tab memory ceiling otherwise kills the page on the second card.
			// Cold-start cost on the next card is acceptable for this flow.
			await releaseOcrWorker().catch(() => {});
			uploadProcessing = false;
		}
	}

	async function handleUploadFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		input.value = '';

		uploadError = null;
		uploadProcessing = true;
		if (uploadThumbnailUrl) URL.revokeObjectURL(uploadThumbnailUrl);
		uploadThumbnailUrl = URL.createObjectURL(file);

		let bitmap: ImageBitmap | null = null;
		try {
			await initWorkers();
			bitmap = await createImageBitmap(file, {
				resizeWidth: 2048,
				resizeHeight: 2048,
				resizeQuality: 'high'
			});
			const result = await recognizeCard(bitmap, undefined, {
				isAuthenticated: !!ebayConnected,
				skipBlurCheck: true
			});
			if (result.card_id && result.card) {
				listingCard = result.card;
				listingImageUrl = uploadThumbnailUrl;
				listingScanId = result.id ?? null;
				uploadThumbnailUrl = null; // Transfer ownership to listing view
				view = 'listing';
			} else {
				uploadError = result.failReason || 'Could not identify card. Try a clearer photo.';
			}
		} catch (err) {
			uploadError = err instanceof Error ? err.message : 'Processing failed';
		} finally {
			bitmap?.close();
			// Same OOM guard as handleWhatnotFile above. Without this, two
			// scan-to-list uploads in succession white-screen the page.
			await releaseOcrWorker().catch(() => {});
			uploadProcessing = false;
		}
	}

	function handleScanResult(result: ScanResult, capturedImageUrl?: string) {
		if (!result.card) return;
		listingCard = result.card;
		listingImageUrl = capturedImageUrl || null;
		listingScanId = result.id ?? null;
		view = 'listing';
	}
</script>

<svelte:head>
	<title>Sell - Card Scanner</title>
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
{:else if view === 'uploading'}
	<div class="stl-scanner-view">
		<div class="stl-header">
			<button class="stl-back" onclick={() => { if (uploadThumbnailUrl) { URL.revokeObjectURL(uploadThumbnailUrl); uploadThumbnailUrl = null; } view = 'browse'; }}>← Back</button>
			<h1 class="stl-title">Upload to List</h1>
		</div>
		<div class="upload-container">
			{#if uploadProcessing}
				<div class="upload-processing">
					{#if uploadThumbnailUrl}
						<img src={uploadThumbnailUrl} alt="Processing" class="upload-preview" />
					{/if}
					<div class="upload-spinner"></div>
					<p class="upload-status-text">Identifying card...</p>
				</div>
			{:else}
				<label class="upload-drop-zone">
					<span class="upload-icon">📤</span>
					<span class="upload-text">Select a card photo</span>
					<span class="upload-hint">JPEG, PNG, or WebP</span>
					<input
						bind:this={uploadFileInput}
						type="file"
						accept="image/jpeg,image/png,image/webp"
						onchange={handleUploadFile}
						class="upload-file-input"
					/>
				</label>
				{#if uploadError}
					<div class="upload-error">
						<p>{uploadError}</p>
						<button class="upload-retry-btn" onclick={() => { uploadError = null; uploadFileInput?.click(); }}>Try Another Photo</button>
					</div>
				{/if}
			{/if}
		</div>
	</div>
{:else if view === 'listing' && listingCard}
	<ListingView
		card={listingCard}
		imageUrl={listingImageUrl}
		scanId={listingScanId}
		{ebayConnected}
		onScanNext={() => { listingCard = null; listingImageUrl = null; listingScanId = null; if (listingSource === 'upload') { startUploadToList(); } else { startScanToList(); } }}
		onDone={() => { listingCard = null; listingImageUrl = null; listingScanId = null; view = 'browse'; }}
	/>
{:else if view === 'whatnot-scanning'}
	<div class="stl-scanner-view">
		<div class="stl-header">
			<button class="stl-back" onclick={() => { view = 'whatnot-pending'; }}>← Pending ({whatnotPendingCards().length})</button>
			<h1 class="stl-title">Scan for Whatnot</h1>
		</div>
		<div class="stl-scanner-container">
			<Scanner
				onResult={handleWhatnotScanResult}
				isAuthenticated={true}
				embedded={true}
				scanMode="single"
			/>
		</div>
	</div>
{:else if view === 'whatnot-uploading'}
	<div class="stl-scanner-view">
		<div class="stl-header">
			<button class="stl-back" onclick={() => { if (uploadThumbnailUrl) { URL.revokeObjectURL(uploadThumbnailUrl); uploadThumbnailUrl = null; } view = 'whatnot-pending'; }}>← Pending</button>
			<h1 class="stl-title">Upload for Whatnot</h1>
		</div>
		<div class="upload-container">
			{#if uploadProcessing}
				<div class="upload-processing">
					{#if uploadThumbnailUrl}
						<img src={uploadThumbnailUrl} alt="Processing" class="upload-preview" />
					{/if}
					<div class="upload-spinner"></div>
					<p class="upload-status-text">Identifying card...</p>
				</div>
			{:else}
				<label class="upload-drop-zone">
					<span class="upload-icon">📤</span>
					<span class="upload-text">Select a card photo</span>
					<span class="upload-hint">JPEG, PNG, or WebP</span>
					<input
						type="file"
						accept="image/jpeg,image/png,image/webp"
						onchange={handleWhatnotUploadFile}
						class="upload-file-input"
					/>
				</label>
				{#if uploadError}
					<div class="upload-error">
						<p>{uploadError}</p>
						<button class="upload-retry-btn" onclick={() => { uploadError = null; }}>Try Another Photo</button>
					</div>
				{/if}
			{/if}
		</div>
	</div>
{:else if view === 'whatnot-pending'}
	<WhatnotPendingView
		onScan={startWhatnotScan}
		onUpload={startWhatnotUpload}
		onDone={() => { view = 'browse'; }}
	/>
{:else if isExportTab}
	<SellExportTab />
{:else}
	<BrowseView
		{ebayConfigured} {ebayConnected} {ebayChecked}
		{ebaySellerUsername} {ebaySellerEmail} {ebayConnectedSince} {ebayTokenHealth}
		onStartScan={startScanToList}
		onStartUpload={startUploadToList}
		onEbayDisconnected={() => { ebayConnected = false; ebaySellerUsername = null; ebaySellerEmail = null; ebayConnectedSince = null; ebayTokenHealth = null; }}
		onStartWhatnot={() => { view = 'whatnot-pending'; }}
	/>
{/if}

<style>
	.stl-scanner-view { max-width: 600px; margin: 0 auto; padding: 0; }
	.stl-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border, rgba(148,163,184,0.10)); }
	.stl-back { background: none; border: none; color: var(--text-secondary, #94a3b8); font-size: 0.9rem; cursor: pointer; padding: 0.25rem; }
	.stl-title { font-size: 1.1rem; font-weight: 700; }
	.stl-scanner-container { height: calc(100dvh - 56px - 68px - 52px - 44px); position: relative; }

	/* Upload to List */
	.upload-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2rem 1rem;
		min-height: calc(100dvh - 56px - 68px - 52px - 44px);
		gap: 1.5rem;
	}

	.upload-drop-zone {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		width: 100%;
		max-width: 320px;
		padding: 3rem 1.5rem;
		border: 2px dashed var(--border-strong, rgba(148,163,184,0.3));
		border-radius: 16px;
		cursor: pointer;
		transition: border-color 0.2s;
	}

	.upload-drop-zone:hover, .upload-drop-zone:focus-within {
		border-color: var(--accent-primary, #3b82f6);
	}

	.upload-icon { font-size: 2.5rem; }
	.upload-text { font-size: 1rem; font-weight: 600; text-align: center; }
	.upload-hint { font-size: 0.8rem; color: var(--text-muted, #475569); }

	.upload-file-input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}

	.upload-processing {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.25rem;
	}

	.upload-preview {
		width: 200px;
		height: 280px;
		object-fit: cover;
		border-radius: 12px;
		border: 1px solid var(--border, rgba(148,163,184,0.10));
	}

	.upload-spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--border-strong, rgba(148,163,184,0.2));
		border-top-color: var(--accent-primary, #3b82f6);
		border-radius: 50%;
		animation: upload-spin 0.8s linear infinite;
	}

	@keyframes upload-spin {
		to { transform: rotate(360deg); }
	}

	.upload-status-text {
		font-size: 0.9rem;
		color: var(--text-secondary, #94a3b8);
		font-weight: 600;
	}

	.upload-error {
		text-align: center;
		padding: 1rem;
		border-radius: 10px;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.2);
		max-width: 320px;
		width: 100%;
	}

	.upload-error p {
		font-size: 0.85rem;
		color: var(--danger, #ef4444);
		margin: 0 0 0.75rem;
	}

	.upload-retry-btn {
		padding: 0.5rem 1.25rem;
		border-radius: 8px;
		background: var(--accent-primary, #3b82f6);
		color: white;
		border: none;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.upload-retry-btn:hover { opacity: 0.9; }
</style>
