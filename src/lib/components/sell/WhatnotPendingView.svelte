<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import { priceCache, getPrice } from '$lib/stores/prices.svelte';
	import type { PriceData } from '$lib/types';
	import { isPro, setShowGoProModal } from '$lib/stores/pro.svelte';
	import {
		whatnotPendingCards, whatnotBatchTag, whatnotBatchNumber,
		removeCardFromBatch, updatePendingCard, finalizeBatch,
		addImageToCard, removeImageFromCard,
		getPreviousExportBatches,
		type WhatnotPendingCard
	} from '$lib/stores/whatnot-batch.svelte';
	import { generateWhatnotCSV, downloadWhatnotCSV, type WhatnotExportCard } from '$lib/services/whatnot-export';
	import { uploadScanImageForListing } from '$lib/stores/collection.svelte';
	import { getCardImageUrl } from '$lib/utils/image-url';
	import { triggerHaptic } from '$lib/utils/haptics';
	import { PARALLEL_ABBREV, PARALLEL_COLOR, normalizeParallel } from '$lib/data/parallels';

	interface Props {
		onScan: () => void;
		onUpload: () => void;
		onDone: () => void;
	}

	let { onScan, onUpload, onDone }: Props = $props();

	const pending = $derived(whatnotPendingCards());
	const batchTag = $derived(whatnotBatchTag());
	const batchNumber = $derived(whatnotBatchNumber());
	const previousBatches = $derived(getPreviousExportBatches());
	const prices = $derived(priceCache());

	let exporting = $state(false);
	let showHistory = $state(false);

	// Track which pending cards have completed a price fetch attempt.
	// Lets us distinguish "still loading" from "loaded, no market data".
	let priceFetched = $state<Set<string>>(new Set());

	// Prefetch prices for every pending card so the UI can render real
	// state instead of $0.99 fallback. Tracked per (cardId, parallel).
	$effect(() => {
		for (const p of pending) {
			const parallel = p.card.parallel || 'Paper';
			const key = `${p.cardId}:${parallel}`;
			if (priceFetched.has(key)) continue;
			if (prices.has(key)) {
				priceFetched.add(key);
				continue;
			}
			getPrice(p.cardId, parallel)
				.catch(() => null)
				.finally(() => {
					const next = new Set(priceFetched);
					next.add(key);
					priceFetched = next;
				});
		}
	});

	function priceState(p: WhatnotPendingCard): 'loading' | 'no_data' | 'loaded' {
		const parallel = p.card.parallel || 'Paper';
		const key = `${p.cardId}:${parallel}`;
		if (prices.has(key)) return 'loaded';
		if (priceFetched.has(key)) return 'no_data';
		return 'loading';
	}

	function priceDataFor(p: WhatnotPendingCard): PriceData | null {
		const parallel = p.card.parallel || 'Paper';
		return (
			prices.get(`${p.cardId}:${parallel}`) ??
			prices.get(`${p.cardId}:Paper`) ??
			null
		);
	}

	async function handleExport() {
		if (pending.length === 0) {
			showToast('No cards to export', 'x');
			return;
		}

		if (!isPro()) {
			setShowGoProModal(true);
			return;
		}

		exporting = true;
		try {
			// Build export cards with prices, overrides, and image URLs.
			// Whatnot pending items are currently BoBA-only; the (card_id,
			// parallel) composite key lookup handles per-card parallels
			// (Battlefoil, etc.) and falls back to Paper.
			const exportCards: WhatnotExportCard[] = pending.map((p) => buildExportCard(p));

			const csv = generateWhatnotCSV(exportCards, { isPro: isPro() });
			downloadWhatnotCSV(csv, `whatnot-export-${batchNumber}-${new Date().toISOString().split('T')[0]}.csv`);

			triggerHaptic('success');
			showToast(`Exported ${pending.length} cards as ${batchTag}`, 'check');

			// Finalize: clear pending and increment batch number
			await finalizeBatch();
		} catch (err) {
			console.error('[whatnot] Export failed:', err);
			showToast('Export failed — please try again', 'x');
		} finally {
			exporting = false;
		}
	}

	function handleRemove(cardId: string) {
		removeCardFromBatch(cardId);
		triggerHaptic('tap');
	}

	// ── Effective-row builder ────────────────────────────────
	// Collapses pending overrides + computed defaults + reference-image fallback
	// into the WhatnotExportCard the CSV generator consumes. Reused by the
	// per-card editor preview so the user sees exactly what will land in the
	// CSV before clicking Export.
	// Compute SKU suffix map: for each (cardId, parallel) duplicated within
	// the batch, assign -01/-02/… by add order. Singletons get no suffix.
	const skuSuffixMap = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const p of pending) {
			const key = `${p.cardId}:${p.card.parallel || 'Paper'}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		const seen = new Map<string, number>();
		const suffixes = new Map<string, string>();
		for (const p of pending) {
			const key = `${p.cardId}:${p.card.parallel || 'Paper'}`;
			if ((counts.get(key) ?? 0) <= 1) {
				suffixes.set(p.cardId, '');
				continue;
			}
			const idx = (seen.get(key) ?? 0) + 1;
			seen.set(key, idx);
			suffixes.set(p.cardId, `-${String(idx).padStart(2, '0')}`);
		}
		return suffixes;
	});

	function buildExportCard(p: WhatnotPendingCard): WhatnotExportCard {
		const parallel = p.card.parallel || 'Paper';
		const priceData = prices.get(`${p.cardId}:${parallel}`) ?? prices.get(`${p.cardId}:Paper`);

		// Image fallback chain: user-uploaded slots → reference image (auto)
		// → legacy single-image field (only if https). Stays empty if nothing
		// resolves; the CSV column will be blank.
		const refImageUrl = getCardImageUrl({ id: p.cardId, image_url: p.card.image_url });
		const imageUrls: string[] = [];
		if (p.imageUrls.length > 0) {
			imageUrls.push(...p.imageUrls);
		} else if (refImageUrl?.startsWith('https://')) {
			imageUrls.push(refImageUrl);
		} else if (p.imageUrl?.startsWith('https://')) {
			imageUrls.push(p.imageUrl);
		}

		return {
			id: p.cardId,
			hero_name: p.card.hero_name,
			name: p.card.name,
			athlete_name: p.card.athlete_name,
			card_number: p.card.card_number,
			set_code: p.card.set_code,
			parallel,
			weapon_type: p.card.weapon_type,
			power: p.card.power,
			rarity: p.card.rarity,
			price_mid: p.priceOverride ?? priceData?.price_mid ?? null,
			quantity: p.quantityOverride ?? 1,
			condition: p.condition,
			image_urls: imageUrls,
			game_id: (p.card as { game_id?: string | null }).game_id ?? null,
			metadata: (p.card as { metadata?: Record<string, unknown> | null }).metadata ?? null,
			title_override: p.titleOverride,
			description_override: p.descriptionOverride,
			type_override: p.listingType,
			shipping_profile_override: p.shippingProfile,
			offerable_override: p.offerable,
			category_override: p.category,
			sub_category_override: p.subCategory,
			// SKU override priority: user-edited value (skuOverride) wins. If
			// the user hasn't touched it AND the batch has duplicates of this
			// (card_id, parallel), append the auto-generated suffix to the
			// computed default. Computing the default here (instead of in the
			// CSV generator) so the duplicate-suffix logic has batch context.
			sku_override: p.skuOverride ?? (skuSuffixMap.get(p.cardId)
				? buildSkuPreview({ ...buildExportCardWithoutSku(p), sku_override: null }) + skuSuffixMap.get(p.cardId)
				: null),
			cogs: p.cogs
		};
	}

	// Strips the override fields that buildSkuPreview would round-trip through;
	// avoids recursion when buildExportCard needs to resolve a default SKU
	// suffixed with the duplicate index.
	function buildExportCardWithoutSku(p: WhatnotPendingCard): WhatnotExportCard {
		const parallel = p.card.parallel || 'Paper';
		return {
			id: p.cardId,
			hero_name: p.card.hero_name,
			name: p.card.name,
			athlete_name: p.card.athlete_name,
			card_number: p.card.card_number,
			set_code: p.card.set_code,
			parallel,
			weapon_type: p.card.weapon_type,
			power: p.card.power,
			rarity: p.card.rarity,
			game_id: (p.card as { game_id?: string | null }).game_id ?? null,
			metadata: (p.card as { metadata?: Record<string, unknown> | null }).metadata ?? null
		};
	}

	// Track which card rows are expanded
	let expandedCardId = $state<string | null>(null);
	function toggleExpand(cardId: string) {
		expandedCardId = expandedCardId === cardId ? null : cardId;
	}

	// ── Bulk apply ──────────────────────────────────────────
	let bulkCondition = $state<string>('Near Mint');
	let bulkShipping = $state<string>('0-1 oz');
	let bulkListingType = $state<string>('Buy It Now');
	let bulkOfferable = $state<boolean>(true);

	function applyBulk() {
		if (pending.length === 0) return;
		const confirmed = confirm(
			`Apply Condition="${bulkCondition}", Shipping="${bulkShipping}", Type="${bulkListingType}", ` +
			`Offerable=${bulkOfferable ? 'Yes' : 'No'} to all ${pending.length} cards?\n\n` +
			`Per-card edits to these fields will be overwritten. Title, description, price, ` +
			`SKU, COGS, and photos are not affected.`
		);
		if (!confirmed) return;

		for (const p of pending) {
			updatePendingCard(p.cardId, {
				condition: bulkCondition,
				shippingProfile: bulkShipping,
				listingType: bulkListingType,
				offerable: bulkOfferable
			});
		}
		showToast(`Applied to ${pending.length} cards`, 'check');
		triggerHaptic('success');
	}

	// Per-card image upload handler — uploads to Supabase, appends to slots
	let uploadingFor = $state<string | null>(null);
	async function handlePhotoUpload(cardId: string, event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		input.value = '';

		uploadingFor = cardId;
		try {
			const blobUrl = URL.createObjectURL(file);
			try {
				const publicUrl = await uploadScanImageForListing(cardId, blobUrl);
				if (publicUrl) {
					addImageToCard(cardId, publicUrl);
					showToast('Photo added', 'check');
					triggerHaptic('success');
				} else {
					showToast('Upload failed', 'x');
				}
			} finally {
				URL.revokeObjectURL(blobUrl);
			}
		} catch (err) {
			console.error('[whatnot] photo upload failed:', err);
			showToast('Upload failed', 'x');
		} finally {
			uploadingFor = null;
		}
	}

	// Preview wrappers — call into the CSV generator's internal builders via a
	// dummy WhatnotExportCard so the user sees the same defaults the CSV will
	// produce. Cheap; runs only on render of the expanded editor.
	function buildTitlePreview(card: WhatnotExportCard): string {
		// Re-derive without overrides
		const c = { ...card, title_override: null };
		// generateWhatnotCSV's title/description/sku helpers are private; the
		// public path is to call generateWhatnotCSV with one card and parse.
		// Cheaper: inline rebuild using the same primitive — but to avoid
		// duplication, we just round-trip through generateWhatnotCSV.
		const csv = generateWhatnotCSV([c], { isPro: false });
		const lines = csv.split('\n');
		if (lines.length < 2) return '';
		// Title is column index 2 (Category, Sub Category, Title, …)
		return parseCsvCell(lines[1], 2);
	}
	function buildDescriptionPreview(card: WhatnotExportCard): string {
		const c = { ...card, description_override: null };
		const csv = generateWhatnotCSV([c], { isPro: false });
		const lines = csv.split('\n');
		if (lines.length < 2) return '';
		return parseCsvCell(lines[1], 3);
	}
	function buildSkuPreview(card: WhatnotExportCard): string {
		const c = { ...card, sku_override: null };
		const csv = generateWhatnotCSV([c], { isPro: false });
		const lines = csv.split('\n');
		if (lines.length < 2) return '';
		return parseCsvCell(lines[1], 10);
	}
	function parseCsvCell(line: string, idx: number): string {
		// Minimal CSV cell extractor — handles quoted fields with embedded
		// commas/quotes that escapeCSV produces. Sufficient for our own output.
		const cells: string[] = [];
		let cur = '';
		let inQuotes = false;
		for (let i = 0; i < line.length; i++) {
			const ch = line[i];
			if (inQuotes) {
				if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
				else if (ch === '"') { inQuotes = false; }
				else { cur += ch; }
			} else {
				if (ch === ',') { cells.push(cur); cur = ''; }
				else if (ch === '"') { inQuotes = true; }
				else { cur += ch; }
			}
		}
		cells.push(cur);
		return cells[idx] ?? '';
	}
</script>

<div class="wnp">
	<div class="wnp-header">
		<button class="wnp-back" onclick={onDone}>← Back</button>
		<h1 class="wnp-title">{batchTag}</h1>
		<span class="wnp-count">{pending.length} card{pending.length !== 1 ? 's' : ''}</span>
	</div>

	<!-- Action buttons -->
	<div class="wnp-actions">
		<button class="wnp-action-btn" onclick={onScan}>📷 Scan Card</button>
		<button class="wnp-action-btn" onclick={onUpload}>📤 Upload Photo</button>
	</div>

	<!-- Pending cards list -->
	{#if pending.length === 0}
		<div class="wnp-empty">
			<p class="wnp-empty-title">No cards in this batch yet</p>
			<p class="wnp-empty-hint">Scan or upload cards to add them to your Whatnot export</p>
		</div>
	{:else}
		{#if pending.length >= 2}
			<div class="wnp-bulk">
				<div class="wnp-bulk-header">
					<span class="wnp-bulk-title">Apply to all</span>
					<span class="wnp-bulk-count">{pending.length} cards</span>
				</div>
				<div class="wnp-bulk-row">
					<select class="wnp-bulk-input" bind:value={bulkCondition} aria-label="Bulk condition">
						<option value="Near Mint">Near Mint</option>
						<option value="Excellent">Lightly Played</option>
						<option value="Good">Moderately Played</option>
						<option value="Fair">Heavily Played</option>
						<option value="Poor">Damaged</option>
					</select>
					<select class="wnp-bulk-input" bind:value={bulkListingType} aria-label="Bulk listing type">
						<option value="Buy It Now">Buy It Now</option>
						<option value="Auction">Auction</option>
						<option value="Giveaway">Giveaway</option>
					</select>
					<input
						class="wnp-bulk-input"
						type="text"
						bind:value={bulkShipping}
						placeholder="Shipping profile"
						aria-label="Bulk shipping profile"
					/>
					<select class="wnp-bulk-input wnp-bulk-input-narrow" bind:value={bulkOfferable} aria-label="Bulk offerable">
						<option value={true}>Offerable</option>
						<option value={false}>Not offerable</option>
					</select>
					<button class="wnp-bulk-apply" onclick={applyBulk}>Apply</button>
				</div>
			</div>
		{/if}
		<div class="wnp-cards">
			{#each pending as item (item.cardId)}
				{@const effective = buildExportCard(item)}
				{@const isExpanded = expandedCardId === item.cardId}
				{@const photoCount = (item.imageUrls?.length ?? 0)}
				{@const pState = priceState(item)}
				{@const pData = priceDataFor(item)}
				<div class="wnp-card" class:wnp-card-expanded={isExpanded}>
					<!-- Summary row (always visible, click to expand) -->
					<button class="wnp-card-summary" onclick={() => toggleExpand(item.cardId)} aria-expanded={isExpanded}>
						<div class="wnp-card-image">
							{#if effective.image_urls && effective.image_urls.length > 0}
								<img src={effective.image_urls[0]} alt={item.card.hero_name || item.card.name || 'Card'} class="wnp-card-img" />
							{:else}
								<span class="wnp-card-placeholder">🎴</span>
							{/if}
						</div>
						<div class="wnp-card-info">
							<div class="wnp-card-line1">
								<span class="wnp-card-hero">{item.card.hero_name || item.card.name || 'Unknown'}</span>
								{#if item.card.parallel && item.card.parallel !== 'Paper'}
									{@const pCode = normalizeParallel(item.card.parallel)}
									<span
										class="wnp-card-parallel"
										style="background: {PARALLEL_COLOR[pCode]}22; color: {PARALLEL_COLOR[pCode]}; border-color: {PARALLEL_COLOR[pCode]}55;"
									>{PARALLEL_ABBREV[pCode]}</span>
								{/if}
							</div>
							<div class="wnp-card-line2">
								<span class="wnp-card-num">{item.card.card_number || ''}</span>
								{#if item.card.rarity}
									<span class="wnp-card-rarity">{String(item.card.rarity).replace(/_/g, ' ')}</span>
								{/if}
							</div>
							<div class="wnp-card-meta">
								{#if item.priceOverride != null}
									<span class="wnp-meta-pill wnp-meta-pill-set">${item.priceOverride.toFixed(2)}</span>
								{:else if pState === 'loading'}
									<span class="wnp-meta-pill wnp-meta-pill-loading">Pricing…</span>
								{:else if pState === 'no_data' || !pData?.price_mid}
									<span class="wnp-meta-pill wnp-meta-pill-warn" title="No recent sales found — defaulting to $0.99. Set a price below.">⚠ No market data</span>
								{:else}
									<span class="wnp-meta-pill">${pData.price_mid.toFixed(2)}</span>
								{/if}
								<span class="wnp-meta-pill">{photoCount}/8 📷</span>
								<span class="wnp-meta-pill">{item.condition}</span>
							</div>
						</div>
						<span class="wnp-expand-chev">{isExpanded ? '▾' : '▸'}</span>
					</button>

					<!-- Expanded editor -->
					{#if isExpanded}
						<div class="wnp-editor">
							<!-- Listing photos -->
							<div class="wnp-field-group">
								<span class="wnp-field-label">Photos ({photoCount}/8)</span>
								<div class="wnp-photo-grid">
									{#each item.imageUrls as url, idx}
										<div class="wnp-photo-slot">
											<img src={url} alt={`Photo ${idx + 1}`} />
											<button class="wnp-photo-remove" onclick={() => removeImageFromCard(item.cardId, idx)} title="Remove photo">✕</button>
											{#if idx === 0}<span class="wnp-photo-label">Front</span>{/if}
											{#if idx === 1}<span class="wnp-photo-label">Back</span>{/if}
										</div>
									{/each}
									{#if photoCount === 0}
										<label class="wnp-photo-cta">
											<input
												type="file"
												accept="image/*"
												capture="environment"
												onchange={(e) => handlePhotoUpload(item.cardId, e)}
												disabled={uploadingFor === item.cardId}
											/>
											<span class="wnp-photo-cta-icon">📷</span>
											<span class="wnp-photo-cta-text">
												{uploadingFor === item.cardId ? 'Uploading…' : 'Take front photo'}
											</span>
										</label>
									{:else if photoCount === 1}
										<label class="wnp-photo-cta wnp-photo-cta-back">
											<input
												type="file"
												accept="image/*"
												capture="environment"
												onchange={(e) => handlePhotoUpload(item.cardId, e)}
												disabled={uploadingFor === item.cardId}
											/>
											<span class="wnp-photo-cta-icon">🔄</span>
											<span class="wnp-photo-cta-text">
												{uploadingFor === item.cardId ? 'Uploading…' : 'Take back photo'}
											</span>
										</label>
									{:else if photoCount < 8}
										<label class="wnp-photo-add">
											<input
												type="file"
												accept="image/*"
												capture="environment"
												onchange={(e) => handlePhotoUpload(item.cardId, e)}
												disabled={uploadingFor === item.cardId}
											/>
											{uploadingFor === item.cardId ? '⏳' : '+ Add'}
										</label>
									{/if}
								</div>
								{#if photoCount === 0}
									<p class="wnp-field-hint">Whatnot listings convert better with front + back photos.</p>
								{:else if photoCount === 1}
									<p class="wnp-field-hint">One more — back of the card next.</p>
								{/if}
							</div>

							<!-- Title -->
							<div class="wnp-field-group">
								<span class="wnp-field-label">Title</span>
								<input
									class="wnp-field-input"
									type="text"
									value={item.titleOverride ?? effective.title_override ?? ''}
									placeholder={effective.title_override ?? buildTitlePreview(effective)}
									oninput={(e) => updatePendingCard(item.cardId, { titleOverride: (e.target as HTMLInputElement).value || null })}
								/>
							</div>

							<!-- Description -->
							<div class="wnp-field-group">
								<span class="wnp-field-label">Description</span>
								<textarea
									class="wnp-field-input wnp-field-textarea"
									rows="3"
									value={item.descriptionOverride ?? ''}
									placeholder={buildDescriptionPreview(effective)}
									oninput={(e) => updatePendingCard(item.cardId, { descriptionOverride: (e.target as HTMLTextAreaElement).value || null })}
								></textarea>
							</div>

							<!-- Two-column row: Type + Price -->
							<div class="wnp-field-row">
								<div class="wnp-field-group">
									<span class="wnp-field-label">Type</span>
									<select
										class="wnp-field-input"
										value={item.listingType ?? 'Buy It Now'}
										onchange={(e) => updatePendingCard(item.cardId, { listingType: (e.target as HTMLSelectElement).value })}
									>
										<option value="Buy It Now">Buy It Now</option>
										<option value="Auction">Auction</option>
										<option value="Giveaway">Giveaway</option>
									</select>
								</div>
								<div class="wnp-field-group">
									<span class="wnp-field-label">Price</span>
									<input
										class="wnp-field-input"
										type="number"
										step="0.01"
										min="0"
										value={item.priceOverride ?? effective.price_mid ?? ''}
										placeholder="0.99"
										oninput={(e) => {
											const v = (e.target as HTMLInputElement).value;
											const num = v === '' ? null : parseFloat(v);
											updatePendingCard(item.cardId, { priceOverride: Number.isFinite(num) ? num : null });
										}}
									/>
									{#if priceState(item) === 'loaded'}
										{@const pd = priceDataFor(item)}
										{#if pd?.price_low != null && pd?.price_high != null && pd.listings_count}
											<span class="wnp-field-hint">
												Comps: ${pd.price_low.toFixed(2)}–${pd.price_high.toFixed(2)}
												({pd.listings_count} {pd.listings_count === 1 ? 'sale' : 'sales'})
											</span>
										{/if}
									{:else if priceState(item) === 'no_data'}
										<span class="wnp-field-hint wnp-field-hint-warn">
											No recent comps — set price manually
										</span>
									{:else}
										<span class="wnp-field-hint">Loading market data…</span>
									{/if}
								</div>
							</div>

							<!-- Two-column row: Quantity + Condition -->
							<div class="wnp-field-row">
								<div class="wnp-field-group">
									<span class="wnp-field-label">Quantity</span>
									<input
										class="wnp-field-input"
										type="number"
										min="1"
										value={item.quantityOverride ?? 1}
										oninput={(e) => {
											const v = parseInt((e.target as HTMLInputElement).value, 10);
											updatePendingCard(item.cardId, { quantityOverride: Number.isFinite(v) && v > 0 ? v : null });
										}}
									/>
								</div>
								<div class="wnp-field-group">
									<span class="wnp-field-label">Condition</span>
									<select
										class="wnp-field-input"
										value={item.condition}
										onchange={(e) => updatePendingCard(item.cardId, { condition: (e.target as HTMLSelectElement).value })}
									>
										<option value="Near Mint">Near Mint</option>
										<option value="Excellent">Lightly Played</option>
										<option value="Good">Moderately Played</option>
										<option value="Fair">Heavily Played</option>
										<option value="Poor">Damaged</option>
									</select>
								</div>
							</div>

							<!-- Two-column row: Shipping + Offerable -->
							<div class="wnp-field-row">
								<div class="wnp-field-group">
									<span class="wnp-field-label">Shipping Profile</span>
									<input
										class="wnp-field-input"
										type="text"
										value={item.shippingProfile ?? '0-1 oz'}
										oninput={(e) => updatePendingCard(item.cardId, { shippingProfile: (e.target as HTMLInputElement).value || null })}
									/>
								</div>
								<div class="wnp-field-group">
									<span class="wnp-field-label">Offerable</span>
									<select
										class="wnp-field-input"
										value={String(item.offerable ?? true)}
										onchange={(e) => updatePendingCard(item.cardId, { offerable: (e.target as HTMLSelectElement).value === 'true' })}
									>
										<option value="true">Yes</option>
										<option value="false">No</option>
									</select>
								</div>
							</div>

							<!-- Two-column row: Category + Sub Category -->
							<div class="wnp-field-row">
								<div class="wnp-field-group">
									<span class="wnp-field-label">Category</span>
									<input
										class="wnp-field-input"
										type="text"
										value={item.category ?? 'Trading Card Games'}
										oninput={(e) => updatePendingCard(item.cardId, { category: (e.target as HTMLInputElement).value || null })}
									/>
								</div>
								<div class="wnp-field-group">
									<span class="wnp-field-label">Sub Category</span>
									<input
										class="wnp-field-input"
										type="text"
										value={item.subCategory ?? ''}
										placeholder="e.g. Bo Jackson"
										oninput={(e) => updatePendingCard(item.cardId, { subCategory: (e.target as HTMLInputElement).value || null })}
									/>
								</div>
							</div>

							<!-- Two-column row: SKU + COGS -->
							<div class="wnp-field-row">
								<div class="wnp-field-group">
									<span class="wnp-field-label">SKU</span>
									<input
										class="wnp-field-input"
										type="text"
										value={item.skuOverride ?? (buildSkuPreview(effective) + (skuSuffixMap.get(item.cardId) ?? ''))}
										oninput={(e) => updatePendingCard(item.cardId, { skuOverride: (e.target as HTMLInputElement).value || null })}
									/>
									{#if skuSuffixMap.get(item.cardId)}
										<span class="wnp-field-hint">Auto-suffixed because this card appears {pending.filter((q) => q.cardId === item.cardId && (q.card.parallel || 'Paper') === (item.card.parallel || 'Paper')).length}× in the batch.</span>
									{/if}
								</div>
								<div class="wnp-field-group">
									<span class="wnp-field-label">COGS</span>
									<input
										class="wnp-field-input"
										type="number"
										step="0.01"
										min="0"
										value={item.cogs ?? ''}
										placeholder="(optional)"
										oninput={(e) => {
											const v = (e.target as HTMLInputElement).value;
											const num = v === '' ? null : parseFloat(v);
											updatePendingCard(item.cardId, { cogs: Number.isFinite(num) ? num : null });
										}}
									/>
								</div>
							</div>

							<!-- Footer actions -->
							<div class="wnp-editor-footer">
								<button class="wnp-editor-remove" onclick={() => handleRemove(item.cardId)}>Remove from batch</button>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Export button -->
		<div class="wnp-export">
			<button
				class="wnp-export-btn"
				onclick={handleExport}
				disabled={exporting || pending.length === 0}
			>
				{exporting ? 'Exporting...' : `Export ${pending.length} Cards as CSV`}
			</button>
		</div>
	{/if}

	<!-- Previous export history -->
	{#if previousBatches.length > 0}
		<button class="wnp-history-toggle" onclick={() => showHistory = !showHistory}>
			{showHistory ? 'Hide' : 'Show'} Previous Exports ({previousBatches.length})
		</button>
		{#if showHistory}
			<div class="wnp-history">
				{#each previousBatches as batch}
					<div class="wnp-history-item">
						<span class="wnp-history-label">Whatnot Export #{batch.batchNumber}</span>
						<span class="wnp-history-count">{batch.cardIds.length} cards</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.wnp { max-width: 600px; margin: 0 auto; padding: 0 0 5rem; }
	.wnp-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border, rgba(148,163,184,0.10)); }
	.wnp-back { background: none; border: none; color: var(--text-secondary, #94a3b8); font-size: 0.9rem; cursor: pointer; padding: 0.25rem; }
	.wnp-title { font-size: 1.1rem; font-weight: 700; flex: 1; }
	.wnp-count { font-size: 0.8rem; color: var(--text-muted, #475569); background: var(--surface-raised, rgba(148,163,184,0.08)); padding: 0.15rem 0.5rem; border-radius: 12px; }

	.wnp-actions { display: flex; gap: 0.5rem; padding: 0.75rem 1rem; }
	.wnp-action-btn { flex: 1; padding: 0.6rem; border-radius: 10px; background: var(--surface-raised, rgba(148,163,184,0.08)); border: 1px solid var(--border, rgba(148,163,184,0.10)); color: var(--text-primary, #e2e8f0); font-size: 0.85rem; font-weight: 600; cursor: pointer; }
	.wnp-action-btn:hover { background: var(--surface-hover, rgba(148,163,184,0.12)); }

	.wnp-bulk {
		margin: 0.5rem 1rem;
		padding: 0.6rem 0.75rem;
		border-radius: 10px;
		background: var(--surface-raised, rgba(148,163,184,0.06));
		border: 1px solid var(--border, rgba(148,163,184,0.12));
		position: sticky;
		top: 0;
		z-index: 5;
		backdrop-filter: blur(8px);
	}
	.wnp-bulk-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
	.wnp-bulk-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary, #94a3b8); }
	.wnp-bulk-count { font-size: 0.7rem; color: var(--text-muted, #64748b); }
	.wnp-bulk-row { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
	.wnp-bulk-input {
		flex: 1;
		min-width: 100px;
		padding: 0.4rem 0.5rem;
		border-radius: 6px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		color: var(--text-primary, #e2e8f0);
		font-size: 0.8rem;
	}
	.wnp-bulk-input-narrow { flex: 0 1 auto; }
	.wnp-bulk-apply {
		padding: 0.4rem 0.85rem;
		border-radius: 6px;
		background: #7c3aed;
		color: white;
		border: none;
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
	}
	.wnp-bulk-apply:hover { opacity: 0.9; }

	.wnp-empty { text-align: center; padding: 3rem 1rem; }
	.wnp-empty-title { font-size: 1rem; font-weight: 600; margin: 0 0 0.5rem; }
	.wnp-empty-hint { font-size: 0.85rem; color: var(--text-muted, #475569); margin: 0; }

	.wnp-cards { padding: 0 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
	.wnp-card { display: flex; flex-direction: column; border-radius: 10px; background: var(--surface-raised, rgba(148,163,184,0.05)); border: 1px solid var(--border, rgba(148,163,184,0.08)); overflow: hidden; }
	.wnp-card-image { width: 40px; height: 56px; flex-shrink: 0; border-radius: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: var(--bg-surface, #0d1524); }
	.wnp-card-img { width: 100%; height: 100%; object-fit: cover; }
	.wnp-card-placeholder { font-size: 1.25rem; }
	.wnp-card-info { flex: 1; display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
	.wnp-card-line1 { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
	.wnp-card-line2 { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.05rem; }
	.wnp-card-hero { font-size: 0.9rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
	.wnp-card-num { font-size: 0.75rem; color: var(--text-muted, #475569); font-family: ui-monospace, monospace; }
	.wnp-card-parallel {
		font-size: 0.6rem;
		padding: 0.05rem 0.4rem;
		border-radius: 4px;
		font-weight: 700;
		letter-spacing: 0.03em;
		border: 1px solid;
		flex-shrink: 0;
	}
	.wnp-card-rarity {
		font-size: 0.65rem;
		color: var(--text-secondary, #94a3b8);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	/* Expanded editor */
	.wnp-card-summary {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.6rem 0.75rem;
		background: none;
		border: none;
		text-align: left;
		cursor: pointer;
		color: inherit;
	}
	.wnp-card-meta { display: flex; gap: 0.35rem; margin-top: 0.25rem; flex-wrap: wrap; }
	.wnp-meta-pill {
		font-size: 0.65rem;
		padding: 0.1rem 0.4rem;
		border-radius: 8px;
		background: var(--surface-raised, rgba(148,163,184,0.1));
		color: var(--text-secondary, #94a3b8);
	}
	.wnp-meta-pill-loading {
		background: var(--surface-raised, rgba(148,163,184,0.15));
		color: var(--text-muted, #64748b);
		font-style: italic;
	}
	.wnp-meta-pill-warn {
		background: rgba(245, 158, 11, 0.12);
		color: #f59e0b;
		border: 1px solid rgba(245, 158, 11, 0.25);
	}
	.wnp-meta-pill-set {
		background: rgba(124, 58, 237, 0.15);
		color: #a78bfa;
		border: 1px solid rgba(124, 58, 237, 0.3);
	}
	.wnp-field-hint-warn { color: #f59e0b; font-weight: 500; }
	.wnp-expand-chev { font-size: 0.85rem; color: var(--text-muted, #475569); flex-shrink: 0; }
	.wnp-card-expanded { background: var(--surface-raised, rgba(148,163,184,0.08)); }

	.wnp-editor {
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		border-top: 1px solid var(--border, rgba(148,163,184,0.1));
	}
	.wnp-field-group { display: flex; flex-direction: column; gap: 0.25rem; flex: 1; min-width: 0; }
	.wnp-field-row { display: flex; gap: 0.5rem; }
	.wnp-field-label { font-size: 0.7rem; color: var(--text-muted, #475569); font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
	.wnp-field-input {
		width: 100%;
		padding: 0.5rem 0.6rem;
		border-radius: 8px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		color: var(--text-primary, #e2e8f0);
		font-size: 0.85rem;
	}
	.wnp-field-input:focus { outline: none; border-color: #7c3aed; }
	.wnp-field-textarea { resize: vertical; min-height: 60px; font-family: inherit; }
	.wnp-field-hint { font-size: 0.7rem; color: var(--text-muted, #475569); margin: 0; }

	.wnp-photo-grid { display: flex; gap: 0.4rem; flex-wrap: wrap; }
	.wnp-photo-slot {
		position: relative;
		width: 56px;
		height: 78px;
		border-radius: 6px;
		overflow: hidden;
		background: var(--bg-surface, #0d1524);
	}
	.wnp-photo-slot img { width: 100%; height: 100%; object-fit: cover; }
	.wnp-photo-remove {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: rgba(0,0,0,0.7);
		color: white;
		border: none;
		font-size: 0.7rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.wnp-photo-label {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		padding: 0.1rem 0.25rem;
		font-size: 0.55rem;
		text-align: center;
		background: rgba(124, 58, 237, 0.85);
		color: white;
		font-weight: 600;
	}
	/* CTAs for front/back guided capture — wider than generic "+ Add" so the
	   labels read clearly and the action feels primary, not auxiliary. */
	.wnp-photo-cta {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		min-width: 96px;
		height: 78px;
		padding: 0.4rem 0.6rem;
		border-radius: 6px;
		border: 2px dashed rgba(124, 58, 237, 0.5);
		background: rgba(124, 58, 237, 0.08);
		color: #a78bfa;
		cursor: pointer;
		font-weight: 600;
	}
	.wnp-photo-cta:hover { background: rgba(124, 58, 237, 0.15); border-color: #7c3aed; }
	.wnp-photo-cta input { display: none; }
	.wnp-photo-cta-icon { font-size: 1.1rem; }
	.wnp-photo-cta-text { font-size: 0.7rem; text-align: center; line-height: 1.1; }
	.wnp-photo-cta-back { border-color: rgba(34, 211, 238, 0.5); background: rgba(34, 211, 238, 0.08); color: #22d3ee; }
	.wnp-photo-cta-back:hover { background: rgba(34, 211, 238, 0.15); border-color: #22d3ee; }
	.wnp-photo-add {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 56px;
		height: 78px;
		border-radius: 6px;
		border: 2px dashed var(--border, rgba(148,163,184,0.25));
		background: var(--surface-raised, rgba(148,163,184,0.05));
		color: var(--text-muted, #475569);
		font-size: 0.75rem;
		cursor: pointer;
	}
	.wnp-photo-add:hover { border-color: #7c3aed; color: #7c3aed; }
	.wnp-photo-add input { display: none; }

	.wnp-editor-footer { display: flex; justify-content: flex-end; padding-top: 0.25rem; }
	.wnp-editor-remove {
		background: none;
		border: 1px solid var(--danger, #ef4444);
		color: var(--danger, #ef4444);
		padding: 0.4rem 0.75rem;
		border-radius: 8px;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.wnp-editor-remove:hover { background: var(--danger, #ef4444); color: white; }

	.wnp-export { padding: 1rem; position: sticky; bottom: 68px; background: var(--bg-primary, #0a0a0a); }
	.wnp-export-btn { width: 100%; padding: 0.85rem; border-radius: 12px; background: #7c3aed; color: white; border: none; font-size: 0.95rem; font-weight: 700; cursor: pointer; }
	.wnp-export-btn:hover:not(:disabled) { opacity: 0.9; }
	.wnp-export-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.wnp-history-toggle { display: block; width: 100%; text-align: center; padding: 0.75rem; background: none; border: none; color: var(--text-muted, #475569); font-size: 0.8rem; cursor: pointer; }
	.wnp-history { padding: 0 1rem 1rem; display: flex; flex-direction: column; gap: 0.35rem; }
	.wnp-history-item { display: flex; justify-content: space-between; padding: 0.5rem 0.75rem; border-radius: 6px; background: var(--surface-raised, rgba(148,163,184,0.03)); font-size: 0.8rem; }
	.wnp-history-label { color: var(--text-secondary, #94a3b8); }
	.wnp-history-count { color: var(--text-muted, #475569); }
</style>
