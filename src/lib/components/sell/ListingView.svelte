<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import { getPriceWithReason } from '$lib/stores/prices.svelte';
	import { buildEbayListingTitle } from '$lib/utils/ebay-title';
	import { buildEbaySearchUrl } from '$lib/services/ebay';
	import { uploadScanImageForListing } from '$lib/stores/collection.svelte';
	import type { Card, PriceData } from '$lib/types';

	interface Props {
		card: Card;
		imageUrl: string | null;
		ebayConnected: boolean;
		onScanNext: () => void;
		onDone: () => void;
		initialCondition?: string;
		backLabel?: string;
	}

	let { card, imageUrl, ebayConnected, onScanNext, onDone, initialCondition, backLabel }: Props = $props();

	// ── Listing state ───────────────────────────────────────
	let priceData = $state<PriceData | null>(null);
	let priceLoading = $state(true);
	let condition = $state(initialCondition || 'Near Mint');
	let price = $state('');
	let quantity = $state(1);
	let notes = $state('');
	let creating = $state(false);
	let created = $state(false);
	let sellerHubUrl = $state<string | null>(null);
	let error = $state<string | null>(null);

	const CONDITIONS = ['Mint', 'Near Mint', 'Excellent', 'Good', 'Fair'] as const;

	// ── Editable card fields that feed into eBay listing ────
	let heroName = $state(card.hero_name || card.name || '');
	let cardNumber = $state(card.card_number || '');
	let setCode = $state(card.set_code || '');
	let parallel = $state(card.parallel || '');
	let weaponType = $state(card.weapon_type || '');
	let athleteName = $state(card.athlete_name || '');
	let power = $state(card.power ? String(card.power) : '');

	// ── Generated title & description (editable) ────────────
	function generateTitle(): string {
		return buildEbayListingTitle({
			hero_name: heroName,
			athlete_name: athleteName,
			parallel: parallel || null,
			weapon_type: weaponType || null
		});
	}

	function generateDescription(): string {
		const lines = [
			`Bo Jackson Battle Arena - ${heroName || 'Hero Card'}`,
			'',
		];
		if (cardNumber) lines.push(`Card Number: ${cardNumber}`);
		if (athleteName) lines.push(`Athlete Inspiration: ${athleteName}`);
		if (setCode) lines.push(`Set: ${setCode}`);
		if (parallel) lines.push(`Parallel/Variant: ${parallel}`);
		if (weaponType) lines.push(`Weapon Type: ${weaponType}`);
		if (power) lines.push(`Power: ${power}`);
		lines.push(`Condition: ${condition}`);
		if (notes) lines.push(`Notes: ${notes}`);
		lines.push('');
		lines.push('Listed with BOBA Scanner - boba.cards');
		return lines.filter(l => l !== undefined).join('\n');
	}

	let title = $state(generateTitle());
	let description = $state(generateDescription());
	let titleManuallyEdited = $state(false);
	let descManuallyEdited = $state(false);

	// Auto-regenerate title/description when card fields change, unless manually edited
	$effect(() => {
		// Touch all reactive deps
		const _deps = [heroName, cardNumber, setCode, parallel, weaponType, athleteName, power, condition, notes];
		if (!titleManuallyEdited) {
			title = generateTitle();
		}
		if (!descManuallyEdited) {
			description = generateDescription();
		}
	});

	// ── Aspects preview (what eBay sees as item specifics) ──
	let aspects = $derived(() => {
		const a: Array<{ label: string; value: string }> = [
			{ label: 'Card Name', value: heroName || 'Unknown' },
			{ label: 'Set', value: setCode || 'BoBA' },
			{ label: 'Sport', value: 'Multi-Sport' },
			{ label: 'Card Manufacturer', value: 'Bo Jackson Battle Arena' },
		];
		if (cardNumber) a.push({ label: 'Card Number', value: cardNumber });
		if (parallel) a.push({ label: 'Parallel/Variety', value: parallel });
		if (athleteName) a.push({ label: 'Player/Athlete', value: athleteName });
		return a;
	});

	const CONDITION_MAP: Record<string, string> = {
		'Mint': 'Mint (2750)',
		'Near Mint': 'Near Mint or Better (4000)',
		'Excellent': 'Near Mint or Better (4000)',
		'Good': 'Good (5000)',
		'Fair': 'Acceptable (6000)',
	};

	// Fetch price data on mount
	$effect(() => {
		loadPrice();
	});

	async function loadPrice() {
		priceLoading = true;
		priceData = null;
		try {
			const result = await getPriceWithReason(card.id);
			priceData = result.data;
			// Prefer BIN median for suggested price, fall back to overall median
			const median = result.data?.buy_now_mid ?? result.data?.price_mid;
			if (median) {
				const suggested = Math.round(median * 1.1 * 100) / 100;
				price = suggested.toFixed(2);
			} else {
				price = '';
			}
		} catch {
			price = '';
		}
		priceLoading = false;
	}

	let ebayUrl = $derived(buildEbaySearchUrl({
		card_number: cardNumber || null,
		hero_name: heroName || null,
		athlete_name: athleteName || null,
		parallel: parallel || null,
		weapon_type: weaponType || null,
		name: heroName || null
	}));

	async function createEbayDraft() {
		const numPrice = parseFloat(price);
		if (isNaN(numPrice) || numPrice <= 0) {
			showToast('Enter a valid price', 'x');
			return;
		}

		creating = true;
		error = null;

		// Upload local image to Supabase Storage to get a public URL for eBay
		let ebayImageUrl: string | null = null;
		if (imageUrl && card.id) {
			try {
				ebayImageUrl = await uploadScanImageForListing(card.id, imageUrl);
			} catch (err) {
				console.warn('[ListingView] Image upload failed, listing without image:', err);
			}
		}

		try {
			const res = await fetch('/api/ebay/create-draft', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cardId: card.id,
					heroName,
					cardNumber,
					setCode,
					parallel: parallel || null,
					weaponType: weaponType || null,
					power: power ? parseInt(power) : null,
					athleteName: athleteName || null,
					condition,
					price: numPrice,
					quantity,
					notes: notes || null,
					scanImageUrl: ebayImageUrl,
					title,
					description
				})
			});

			if (!res.ok) {
				const errData = await res.json().catch(() => ({ message: 'Failed to create draft' }));
				throw new Error(errData.message || errData.error || `Failed: ${res.status}`);
			}

			const result = await res.json().catch(() => ({ success: true }));
			created = true;
			sellerHubUrl = result.sellerHubUrl || null;

			if (result.partial) {
				showToast('Card added to eBay inventory', 'check');
			} else {
				showToast('Draft created in eBay Seller Hub', 'check');
				if (!backLabel) {
					setTimeout(() => {
						if (created) onScanNext();
					}, 2500);
				}
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create draft';
		}
		creating = false;
	}
</script>

<div class="stl-listing-view">
	<div class="stl-header">
		<button class="stl-back" onclick={onScanNext}>← {backLabel || 'Scan Next'}</button>
		<h1 class="stl-title">List Card</h1>
	</div>

	<!-- Card preview -->
	<div class="stl-card-info">
		{#if imageUrl}
			<img src={imageUrl} alt={heroName || 'Card'} class="stl-card-image" />
		{:else}
			<div class="stl-card-placeholder">🎴</div>
		{/if}
		<div class="stl-card-details">
			<span class="stl-card-name">{heroName || 'Unknown'}</span>
			<span class="stl-card-meta">{cardNumber || ''}</span>
			<span class="stl-card-meta">{setCode || ''}{parallel ? ` · ${parallel}` : ''}</span>
		</div>
	</div>

	<!-- eBay Title -->
	<div class="stl-field">
		<label class="stl-label" for="stl-title">
			eBay Title
			<span class="stl-char-count" class:over={title.length > 80}>{title.length}/80</span>
		</label>
		<input
			id="stl-title"
			type="text"
			class="stl-text-input"
			bind:value={title}
			maxlength="80"
			oninput={() => { titleManuallyEdited = true; }}
		/>
	</div>

	<!-- Card Details (editable fields that feed aspects + description) -->
	<div class="stl-section">
		<span class="stl-section-label">Card Details</span>
		<div class="stl-field-grid">
			<div class="stl-field stl-field-half">
				<label class="stl-label" for="stl-hero">Hero Name</label>
				<input id="stl-hero" type="text" class="stl-text-input" bind:value={heroName} />
			</div>
			<div class="stl-field stl-field-half">
				<label class="stl-label" for="stl-athlete">Athlete</label>
				<input id="stl-athlete" type="text" class="stl-text-input" bind:value={athleteName} />
			</div>
			<div class="stl-field stl-field-half">
				<label class="stl-label" for="stl-cardnum">Card Number</label>
				<input id="stl-cardnum" type="text" class="stl-text-input" bind:value={cardNumber} />
			</div>
			<div class="stl-field stl-field-half">
				<label class="stl-label" for="stl-set">Set</label>
				<input id="stl-set" type="text" class="stl-text-input" bind:value={setCode} />
			</div>
			<div class="stl-field stl-field-half">
				<label class="stl-label" for="stl-parallel">Parallel / Variant</label>
				<input id="stl-parallel" type="text" class="stl-text-input" bind:value={parallel} />
			</div>
			<div class="stl-field stl-field-half">
				<label class="stl-label" for="stl-weapon">Weapon Type</label>
				<input id="stl-weapon" type="text" class="stl-text-input" bind:value={weaponType} />
			</div>
			<div class="stl-field stl-field-half">
				<label class="stl-label" for="stl-power">Power</label>
				<input id="stl-power" type="number" class="stl-text-input" bind:value={power} min="0" max="500" />
			</div>
		</div>
	</div>

	<!-- Condition picker -->
	<div class="stl-field">
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="stl-label">Condition</label>
		<div class="stl-condition-chips">
			{#each CONDITIONS as cond}
				<button
					class="stl-condition-chip"
					class:selected={condition === cond}
					onclick={() => { condition = cond; }}
				>
					{cond}
				</button>
			{/each}
		</div>
		<span class="stl-field-hint">eBay mapping: {CONDITION_MAP[condition] || condition}</span>
	</div>

	<!-- Condition Notes -->
	<div class="stl-field">
		<label class="stl-label" for="stl-notes">Condition Notes</label>
		<input
			id="stl-notes"
			type="text"
			class="stl-text-input"
			bind:value={notes}
			placeholder="e.g. Light corner wear, pack fresh"
		/>
		<span class="stl-field-hint">Shown as condition description on eBay</span>
	</div>

	<!-- Price -->
	<div class="stl-field">
		<label class="stl-label" for="stl-price">Price</label>
		<div class="stl-price-row">
			<span class="stl-dollar">$</span>
			<input
				id="stl-price"
				type="number"
				class="stl-price-input"
				bind:value={price}
				step="0.01"
				min="0.01"
				inputmode="decimal"
			/>
		</div>
		{#if priceLoading}
			<span class="stl-field-hint">Loading market data...</span>
		{:else if priceData && (priceData.buy_now_mid || priceData.price_mid)}
			<div class="stl-ebay-details">
				<div class="stl-ebay-detail-row">
					<span class="stl-ebay-detail-label">BIN Median</span>
					<span class="stl-ebay-detail-value">{priceData.buy_now_mid != null ? `$${priceData.buy_now_mid.toFixed(2)}` : '—'}</span>
				</div>
				<div class="stl-ebay-detail-row">
					<span class="stl-ebay-detail-label">BIN Low</span>
					<span class="stl-ebay-detail-value">{priceData.buy_now_low != null ? `$${priceData.buy_now_low.toFixed(2)}` : '—'}</span>
				</div>
				<div class="stl-ebay-detail-row">
					<span class="stl-ebay-detail-label">BIN Listings</span>
					<span class="stl-ebay-detail-value">{priceData.buy_now_count ?? 0}</span>
				</div>
				<a href={ebayUrl} target="_blank" rel="noopener noreferrer" class="stl-ebay-link">
					View on eBay →
				</a>
			</div>
		{:else}
			<span class="stl-field-hint">No market data available</span>
		{/if}
	</div>

	<!-- Quantity -->
	<div class="stl-field">
		<label class="stl-label" for="stl-qty">Quantity</label>
		<input
			id="stl-qty"
			type="number"
			class="stl-text-input stl-qty-input"
			bind:value={quantity}
			min="1"
			max="99"
		/>
	</div>

	<!-- Description -->
	<div class="stl-field">
		<label class="stl-label" for="stl-desc">Listing Description</label>
		<textarea
			id="stl-desc"
			class="stl-textarea"
			bind:value={description}
			rows="8"
			oninput={() => { descManuallyEdited = true; }}
		></textarea>
	</div>

	<!-- eBay Item Specifics (aspects) — read-only preview -->
	<details class="stl-aspects-details">
		<summary class="stl-section-label stl-summary">eBay Item Specifics</summary>
		<div class="stl-aspects">
			{#each aspects() as aspect}
				<div class="stl-aspect-row">
					<span class="stl-aspect-key">{aspect.label}</span>
					<span class="stl-aspect-val">{aspect.value}</span>
				</div>
			{/each}
		</div>
		<span class="stl-field-hint">Auto-generated from card details above. Category: Trading Cards (261328)</span>
	</details>

	<!-- Actions -->
	{#if created && sellerHubUrl}
		<div class="stl-success">
			<span class="stl-success-icon">✓</span>
			<span>Card added to eBay inventory</span>
		</div>
		<a href={sellerHubUrl} target="_blank" rel="noopener" class="stl-btn stl-btn-create">
			Finish in Seller Hub ↗
		</a>
	{:else if created}
		<div class="stl-success">
			<span class="stl-success-icon">✓</span>
			<span>Draft created — opening scanner...</span>
		</div>
	{:else if !ebayConnected}
		<a href="/settings?ebay=setup" class="stl-btn stl-btn-connect">Connect eBay Account</a>
	{:else}
		<button
			class="stl-btn stl-btn-create"
			onclick={createEbayDraft}
			disabled={creating || !price}
		>
			{creating ? 'Creating Draft...' : 'Create eBay Draft'}
		</button>
	{/if}

	{#if error}
		<p class="stl-error">{error}</p>
	{/if}

	<div class="stl-secondary-actions">
		<button class="stl-text-btn" onclick={onScanNext}>{backLabel ? `Cancel — ${backLabel}` : 'Skip — Scan Next'}</button>
		<button class="stl-text-btn" onclick={onDone}>Done</button>
	</div>
</div>

<style>
	.stl-listing-view {
		max-width: 600px;
		margin: 0 auto;
		padding: 1rem;
		padding-bottom: 6rem;
	}

	.stl-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border, rgba(148,163,184,0.10));
	}

	.stl-back {
		background: none;
		border: none;
		color: var(--text-secondary, #94a3b8);
		font-size: 0.9rem;
		cursor: pointer;
		padding: 0.25rem;
	}

	.stl-title {
		font-size: 1.1rem;
		font-weight: 700;
	}

	.stl-card-info {
		display: flex;
		gap: 1rem;
		padding: 1rem;
		background: var(--bg-elevated, #121d34);
		border-radius: 12px;
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		margin-bottom: 1.25rem;
	}

	.stl-card-image {
		width: 64px;
		height: 88px;
		object-fit: cover;
		border-radius: 8px;
		flex-shrink: 0;
	}

	.stl-card-placeholder {
		width: 64px;
		height: 88px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2rem;
		background: var(--bg-surface, #0d1524);
		border-radius: 8px;
		flex-shrink: 0;
	}

	.stl-card-details {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.25rem;
		min-width: 0;
	}

	.stl-card-name {
		font-size: 1rem;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.stl-card-meta {
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
	}

	/* Section labels */
	.stl-section {
		margin-bottom: 1.25rem;
	}

	.stl-section-label {
		display: block;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--accent-primary, #3b82f6);
		margin-bottom: 0.625rem;
	}

	/* Field grid for card details */
	.stl-field-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.stl-field-half {
		flex: 1 1 calc(50% - 0.375rem);
		min-width: 140px;
	}

	.stl-field {
		margin-bottom: 1rem;
	}

	.stl-label {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #475569);
		margin-bottom: 0.375rem;
	}

	.stl-char-count {
		font-size: 0.7rem;
		font-weight: 500;
		color: var(--text-muted, #475569);
	}

	.stl-char-count.over {
		color: #ef4444;
	}

	.stl-text-input {
		width: 100%;
		padding: 0.5rem 0.625rem;
		border-radius: 8px;
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		background: var(--bg-elevated, #121d34);
		color: var(--text-primary, #e2e8f0);
		font-size: 0.875rem;
		box-sizing: border-box;
	}

	.stl-text-input:focus {
		outline: none;
		border-color: var(--accent-primary, #3b82f6);
	}

	.stl-qty-input {
		width: 80px;
	}

	.stl-textarea {
		width: 100%;
		padding: 0.5rem 0.625rem;
		border-radius: 8px;
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		background: var(--bg-elevated, #121d34);
		color: var(--text-primary, #e2e8f0);
		font-size: 0.8rem;
		font-family: inherit;
		resize: vertical;
		box-sizing: border-box;
		line-height: 1.5;
	}

	.stl-textarea:focus {
		outline: none;
		border-color: var(--accent-primary, #3b82f6);
	}

	.stl-field-hint {
		display: block;
		font-size: 0.7rem;
		color: var(--text-muted, #475569);
		margin-top: 0.25rem;
	}

	.stl-condition-chips {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.stl-condition-chip {
		padding: 0.375rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		background: var(--bg-elevated, #121d34);
		color: var(--text-secondary, #94a3b8);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}

	.stl-condition-chip.selected {
		border-color: var(--accent-primary, #3b82f6);
		background: rgba(59, 130, 246, 0.12);
		color: var(--accent-primary, #3b82f6);
	}

	.stl-price-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.stl-dollar {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text-secondary, #94a3b8);
	}

	.stl-price-input {
		flex: 1;
		padding: 0.5rem 0.625rem;
		border-radius: 8px;
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		background: var(--bg-elevated, #121d34);
		color: var(--text-primary, #e2e8f0);
		font-size: 1.1rem;
		font-weight: 700;
		-moz-appearance: textfield;
		appearance: textfield;
	}

	.stl-price-input::-webkit-inner-spin-button { appearance: none; -webkit-appearance: none; }

	.stl-ebay-details {
		margin-top: 0.5rem;
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
	}

	.stl-ebay-detail-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.2rem 0;
	}

	.stl-ebay-detail-label {
		font-size: 0.75rem;
		color: var(--text-muted, #475569);
	}

	.stl-ebay-detail-value {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary, #94a3b8);
	}

	.stl-ebay-link {
		display: block;
		margin-top: 0.375rem;
		padding-top: 0.375rem;
		border-top: 1px solid var(--border, rgba(148,163,184,0.08));
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--accent-primary, #3b82f6);
		text-decoration: none;
		text-align: right;
	}

	.stl-ebay-link:hover {
		text-decoration: underline;
	}

	/* Aspects collapsible */
	.stl-aspects-details {
		margin-bottom: 1.25rem;
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		border-radius: 10px;
		padding: 0.75rem;
		background: var(--bg-elevated, #121d34);
	}

	.stl-summary {
		cursor: pointer;
		margin-bottom: 0;
		user-select: none;
	}

	.stl-aspects-details[open] .stl-summary {
		margin-bottom: 0.5rem;
	}

	.stl-aspects {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.stl-aspect-row {
		display: flex;
		justify-content: space-between;
		padding: 0.25rem 0;
		border-bottom: 1px solid rgba(148,163,184,0.06);
		font-size: 0.8rem;
	}

	.stl-aspect-key {
		color: var(--text-muted, #475569);
	}

	.stl-aspect-val {
		color: var(--text-secondary, #94a3b8);
		font-weight: 600;
		text-align: right;
	}

	.stl-btn {
		display: block;
		width: 100%;
		padding: 0.875rem;
		border-radius: 10px;
		border: none;
		font-size: 0.95rem;
		font-weight: 700;
		cursor: pointer;
		text-align: center;
		text-decoration: none;
	}

	.stl-btn-create {
		background: var(--accent-primary, #3b82f6);
		color: white;
	}

	.stl-btn-create:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.stl-btn-connect {
		background: var(--bg-elevated, #121d34);
		color: var(--accent-primary, #3b82f6);
		border: 1px solid var(--accent-primary, #3b82f6);
	}

	.stl-success {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.875rem;
		border-radius: 10px;
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.2);
		color: var(--success, #22c55e);
		font-weight: 600;
	}

	.stl-success-icon { font-size: 1.25rem; }

	.stl-error {
		margin-top: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		background: rgba(239, 68, 68, 0.08);
		color: #ef4444;
		font-size: 0.8rem;
	}

	.stl-secondary-actions {
		display: flex;
		justify-content: center;
		gap: 1.5rem;
		margin-top: 1rem;
	}

	.stl-text-btn {
		background: none;
		border: none;
		color: var(--text-muted, #475569);
		font-size: 0.85rem;
		cursor: pointer;
		padding: 0.5rem;
	}

	.stl-text-btn:hover { color: var(--text-secondary, #94a3b8); }
</style>
