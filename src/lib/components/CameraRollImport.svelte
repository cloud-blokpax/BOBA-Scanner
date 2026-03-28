<script lang="ts">
	import { onDestroy } from 'svelte';
	import { recognizeCard, initWorkers } from '$lib/services/recognition';
	import { addToCollection } from '$lib/stores/collection.svelte';
	import { triggerHaptic } from '$lib/utils/haptics';
	import { getPrice } from '$lib/stores/prices.svelte';
	import { generateCSV, downloadFile, BUILT_IN_TEMPLATES } from '$lib/services/export-templates';
	import type { ScanResult, Card } from '$lib/types';

	let {
		isAuthenticated = false,
		onComplete,
		onClose
	}: {
		isAuthenticated?: boolean;
		onComplete?: (results: BatchResult[]) => void;
		onClose?: () => void;
	} = $props();

	const MAX_PHOTOS = 50;

	interface BatchResult {
		file: File;
		thumbnailUrl: string;
		result: ScanResult | null;
		card: Card | null;
		price: number | null;
		priceLoading: boolean;
		status: 'pending' | 'processing' | 'success' | 'fail' | 'skipped';
		error: string | null;
	}

	let phase = $state<'select' | 'processing' | 'review'>('select');
	let items = $state<BatchResult[]>([]);
	let currentIndex = $state(0);
	let isPaused = $state(false);
	let addingAll = $state(false);
	let addedAll = $state(false);

	const totalValue = $derived(
		items.reduce((sum, item) => sum + (item.price ?? 0), 0)
	);
	const successCount = $derived(
		items.filter(i => i.status === 'success').length
	);
	const failCount = $derived(
		items.filter(i => i.status === 'fail').length
	);
	const progressPercent = $derived(
		items.length > 0 ? Math.round(((currentIndex + (phase === 'review' ? 1 : 0)) / items.length) * 100) : 0
	);

	onDestroy(() => {
		cleanup();
	});

	async function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = input.files;
		if (!files || files.length === 0) return;

		const selectedFiles = Array.from(files).slice(0, MAX_PHOTOS);

		items = selectedFiles.map(file => ({
			file,
			thumbnailUrl: URL.createObjectURL(file),
			result: null,
			card: null,
			price: null,
			priceLoading: false,
			status: 'pending' as const,
			error: null
		}));

		input.value = '';
		phase = 'processing';
		await initWorkers();
		await processSequentially();
	}

	async function processSequentially() {
		for (let i = 0; i < items.length; i++) {
			if (isPaused) {
				await new Promise<void>(resolve => {
					const check = setInterval(() => {
						if (!isPaused) { clearInterval(check); resolve(); }
					}, 200);
				});
			}

			currentIndex = i;
			items[i].status = 'processing';
			items = [...items];

			try {
				const bitmap = await createImageBitmap(items[i].file, {
					resizeWidth: 2048,
					resizeHeight: 2048,
					resizeQuality: 'high'
				});

				let result;
				try {
					result = await recognizeCard(bitmap, undefined, {
						isAuthenticated,
						skipBlurCheck: true
					});
				} finally {
					bitmap.close();
				}

				items[i].result = result;

				if (result.card_id && result.card) {
					items[i].status = 'success';
					items[i].card = result.card;
					triggerHaptic('tap');

					// Fetch price in background
					items[i].priceLoading = true;
					getPrice(result.card_id).then(priceData => {
						items[i].price = priceData?.price_low ?? null;
						items[i].priceLoading = false;
						items = [...items];
					}).catch(() => {
						items[i].priceLoading = false;
						items = [...items];
					});
				} else {
					items[i].status = 'fail';
					items[i].error = result.failReason || 'Could not identify card';
				}
			} catch (err) {
				items[i].status = 'fail';
				items[i].error = err instanceof Error ? err.message : 'Processing failed';
			}

			items = [...items];

			// Yield to event loop for GC
			await new Promise(r => setTimeout(r, 100));
		}

		phase = 'review';
		triggerHaptic('success');
		onComplete?.(items);
	}

	async function retryItem(index: number) {
		const item = items[index];
		if (!item || item.status !== 'fail') return;

		item.status = 'processing';
		item.error = null;
		items = [...items];

		let bitmap: ImageBitmap | null = null;
		try {
			bitmap = await createImageBitmap(item.file, {
				resizeWidth: 2048,
				resizeHeight: 2048,
				resizeQuality: 'high'
			});
			const result = await recognizeCard(bitmap, undefined, {
				isAuthenticated,
				skipBlurCheck: true
			});
			item.result = result;
			if (result.card_id && result.card) {
				item.status = 'success';
				item.card = result.card;
				triggerHaptic('tap');
				item.priceLoading = true;
				getPrice(result.card_id).then(priceData => {
					item.price = priceData?.price_low ?? null;
					item.priceLoading = false;
					items = [...items];
				}).catch(() => {
					item.priceLoading = false;
					items = [...items];
				});
			} else {
				item.status = 'fail';
				item.error = result.failReason || 'Could not identify card';
			}
		} catch (err) {
			item.status = 'fail';
			item.error = err instanceof Error ? err.message : 'Retry failed';
		} finally {
			bitmap?.close();
		}
		items = [...items];
	}

	async function addAllToCollection() {
		addingAll = true;
		const successes = items.filter(i => i.status === 'success' && i.result?.card_id);
		for (const item of successes) {
			try {
				await addToCollection(item.result!.card_id!);
			} catch {
				// Individual add failure is non-fatal
			}
		}
		addingAll = false;
		addedAll = true;
		triggerHaptic('successAdd');
	}

	function exportCSV() {
		const successes = items.filter(i => i.status === 'success' && i.card);
		const template = BUILT_IN_TEMPLATES.find(t => t.id === '__builtin_general');
		if (!template || successes.length === 0) return;

		const rows = successes.map(item => ({
			hero: item.card!.hero_name || item.card!.name || '',
			athlete: item.card!.athlete_name || '',
			cardNumber: item.card!.card_number || '',
			set: item.card!.set_code || '',
			year: '',
			rarity: item.card!.rarity || '',
			weapon: item.card!.weapon_type || '',
			power: item.card!.power ?? '',
			condition: '',
			ebayLowPrice: item.price != null ? item.price.toFixed(2) : ''
		}));

		const csv = generateCSV(rows, template.fields);
		downloadFile(csv, `boba-batch-import-${new Date().toISOString().slice(0, 10)}.csv`);
	}

	function cleanup() {
		for (const item of items) {
			if (item.thumbnailUrl) URL.revokeObjectURL(item.thumbnailUrl);
		}
		items = [];
	}

	function handleDone() {
		cleanup();
		onClose?.();
	}
</script>

<div class="camera-roll-import">
	{#if phase === 'select'}
		<!-- Phase 1: File Selection -->
		<div class="select-phase">
			<label class="drop-zone">
				<div class="drop-zone-icon">📸</div>
				<div class="drop-zone-text">Select up to {MAX_PHOTOS} photos from your camera roll</div>
				<div class="drop-zone-hint">JPEG, PNG, or WebP</div>
				<input
					type="file"
					multiple
					accept="image/jpeg,image/png,image/webp"
					onchange={handleFileSelect}
					class="file-input"
				/>
			</label>
			{#if onClose}
				<button class="btn-text" onclick={onClose}>Cancel</button>
			{/if}
		</div>

	{:else if phase === 'processing'}
		<!-- Phase 2: Processing -->
		<div class="processing-phase">
			<div class="progress-header">
				<span class="progress-label">Processing {currentIndex + 1} of {items.length}</span>
				<span class="progress-percent">{progressPercent}%</span>
			</div>
			<div class="progress-bar">
				<div class="progress-fill" style="width: {progressPercent}%"></div>
			</div>

			<!-- Current card being processed -->
			{#if items[currentIndex]}
				<div class="current-card">
					<img
						src={items[currentIndex].thumbnailUrl}
						alt="Processing"
						class="current-thumbnail"
					/>
					<div class="current-status">
						{#if items[currentIndex].status === 'processing'}
							<span class="status-text identifying">Identifying...</span>
						{:else if items[currentIndex].status === 'success'}
							<span class="status-text success">{items[currentIndex].card?.hero_name || items[currentIndex].card?.name || 'Identified'}</span>
						{:else if items[currentIndex].status === 'fail'}
							<span class="status-text fail">Not recognized</span>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Running tally -->
			<div class="tally-strip">
				<span class="tally-item">{successCount} identified</span>
				<span class="tally-sep">&middot;</span>
				<span class="tally-item">{failCount} failed</span>
				<span class="tally-sep">&middot;</span>
				<span class="tally-item tally-value">${totalValue.toFixed(2)}</span>
			</div>

			<button class="btn-pause" onclick={() => isPaused = !isPaused}>
				{isPaused ? 'Resume' : 'Pause'}
			</button>
		</div>

	{:else if phase === 'review'}
		<!-- Phase 3: Review -->
		<div class="review-phase">
			<div class="review-header">
				<h2 class="review-title">Import Complete</h2>
				<div class="review-summary">
					{successCount} identified &middot; {failCount} failed &middot; ${totalValue.toFixed(2)} total
				</div>
			</div>

			<div class="review-grid">
				{#each items as item, i}
					<div class="review-card" class:review-fail={item.status === 'fail'}>
						<img
							src={item.thumbnailUrl}
							alt={item.card?.hero_name || 'Unidentified'}
							class="review-thumbnail"
						/>
						<div class="review-info">
							{#if item.status === 'success' && item.card}
								<span class="review-name">{item.card.hero_name || item.card.name}</span>
								{#if item.card.athlete_name}
									<span class="review-athlete">{item.card.athlete_name}</span>
								{/if}
								<div class="review-meta">
									{#if item.card.parallel}
										<span class="review-pill parallel">{item.card.parallel}</span>
									{/if}
									{#if item.card.weapon_type}
										<span class="review-pill weapon">{item.card.weapon_type}</span>
									{/if}
								</div>
								{#if item.priceLoading}
									<span class="review-price loading">...</span>
								{:else if item.price != null}
									<span class="review-price">${item.price.toFixed(2)}</span>
								{/if}
							{:else}
								<span class="review-name dimmed">Unidentified</span>
								<button class="btn-retry" onclick={() => retryItem(i)}>Retry</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			<div class="review-actions">
				{#if isAuthenticated && successCount > 0}
					<button
						class="btn btn-add-all"
						onclick={addAllToCollection}
						disabled={addingAll || addedAll}
					>
						{addingAll ? 'Adding...' : addedAll ? 'Added!' : `Add All to Collection (${successCount})`}
					</button>
				{/if}
				{#if successCount > 0}
					<button class="btn btn-export" onclick={exportCSV}>Export CSV</button>
				{/if}
				<button class="btn btn-done" onclick={handleDone}>Done</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.camera-roll-import {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--bg-base, #070b14);
		color: var(--text-primary, #e2e8f0);
	}

	/* Phase 1: Select */
	.select-phase {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		flex: 1;
		padding: 2rem;
		gap: 1rem;
	}

	.drop-zone {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		width: 100%;
		max-width: 320px;
		padding: 2.5rem 1.5rem;
		border: 2px dashed var(--border-strong, rgba(148,163,184,0.3));
		border-radius: 16px;
		cursor: pointer;
		transition: border-color 0.2s;
	}

	.drop-zone:hover, .drop-zone:focus-within {
		border-color: var(--gold, #f59e0b);
	}

	.drop-zone-icon { font-size: 2.5rem; }
	.drop-zone-text { font-size: 1rem; font-weight: 600; text-align: center; }
	.drop-zone-hint { font-size: 0.8rem; color: var(--text-muted, #475569); }

	.file-input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}

	.btn-text {
		background: none;
		border: none;
		color: var(--text-muted, #475569);
		font-size: 0.9rem;
		cursor: pointer;
		text-decoration: underline;
	}

	/* Phase 2: Processing */
	.processing-phase {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 1.5rem;
		gap: 1rem;
		flex: 1;
	}

	.progress-header {
		display: flex;
		justify-content: space-between;
		width: 100%;
		font-size: 0.85rem;
	}

	.progress-label { color: var(--text-secondary, #94a3b8); }
	.progress-percent { font-weight: 700; color: var(--gold, #f59e0b); }

	.progress-bar {
		width: 100%;
		height: 6px;
		background: var(--bg-elevated, #121d34);
		border-radius: 3px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--gold, #f59e0b), var(--gold-dark, #d97706));
		border-radius: 3px;
		transition: width 0.3s ease-out;
	}

	.current-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
		width: 100%;
		max-width: 360px;
		background: var(--bg-elevated, #121d34);
		border-radius: 12px;
		border: 1px solid var(--border, rgba(148,163,184,0.1));
	}

	.current-thumbnail {
		width: 64px;
		height: 80px;
		object-fit: cover;
		border-radius: 8px;
	}

	.current-status { flex: 1; }

	.status-text {
		font-size: 0.9rem;
		font-weight: 600;
	}
	.status-text.identifying { color: var(--text-secondary, #94a3b8); }
	.status-text.success { color: var(--success, #10b981); }
	.status-text.fail { color: var(--danger, #ef4444); }

	.tally-strip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: var(--bg-elevated, #121d34);
		border-radius: 10px;
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
	}

	.tally-sep { opacity: 0.4; }
	.tally-value { color: var(--success, #10b981); font-weight: 700; }

	.btn-pause {
		padding: 0.5rem 1.5rem;
		border-radius: 8px;
		border: 1px solid var(--border-strong, rgba(148,163,184,0.2));
		background: transparent;
		color: var(--text-primary, #e2e8f0);
		font-weight: 600;
		cursor: pointer;
	}

	/* Phase 3: Review */
	.review-phase {
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: hidden;
	}

	.review-header {
		padding: 1rem 1.5rem;
		text-align: center;
	}

	.review-title {
		font-size: 1.25rem;
		font-weight: 700;
		margin: 0 0 0.25rem;
	}

	.review-summary {
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
	}

	.review-grid {
		flex: 1;
		overflow-y: auto;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.75rem;
		padding: 0 1rem;
		-webkit-overflow-scrolling: touch;
	}

	.review-card {
		display: flex;
		flex-direction: column;
		background: var(--bg-elevated, #121d34);
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid var(--border, rgba(148,163,184,0.1));
	}

	.review-card.review-fail {
		opacity: 0.5;
	}

	.review-thumbnail {
		width: 100%;
		aspect-ratio: 2.5/3.5;
		object-fit: cover;
	}

	.review-info {
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.review-name {
		font-size: 0.75rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.review-name.dimmed { color: var(--text-muted, #475569); }

	.review-athlete {
		font-size: 0.7rem;
		color: var(--text-secondary, #94a3b8);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.review-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem;
	}

	.review-pill {
		display: inline-block;
		padding: 0.1rem 0.375rem;
		border-radius: 8px;
		font-size: 0.6rem;
		font-weight: 600;
		color: #fff;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}

	.review-pill.parallel {
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
	}

	.review-pill.weapon {
		background: linear-gradient(135deg, #f59e0b, #d97706);
	}

	.review-price {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--success, #10b981);
	}

	.review-price.loading {
		color: var(--text-muted, #475569);
	}

	.btn-retry {
		background: none;
		border: none;
		color: var(--primary, #3b82f6);
		font-size: 0.75rem;
		cursor: pointer;
		text-decoration: underline;
		padding: 0;
	}

	.review-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1rem 1.5rem;
		padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
	}

	.btn {
		padding: 0.875rem;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
		border: none;
		width: 100%;
		text-align: center;
	}

	.btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.btn-add-all {
		background: var(--primary, #3b82f6);
		color: white;
	}

	.btn-export {
		background: var(--bg-elevated, #121d34);
		border: 1px solid rgba(16, 185, 129, 0.3);
		color: var(--success, #10b981);
	}

	.btn-done {
		background: transparent;
		border: 1px solid var(--border-strong, rgba(148,163,184,0.2));
		color: var(--text-primary, #e2e8f0);
	}
</style>
