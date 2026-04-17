<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import { getPriceWithReason } from '$lib/stores/prices.svelte';
	import { buildEbayListingTitle } from '$lib/utils/ebay-title';
	import { buildEbaySearchUrl } from '$lib/services/ebay';
	import { uploadScanImageForListing } from '$lib/stores/collection.svelte';
	import { triggerHaptic } from '$lib/utils/haptics';
	// Whatnot single-card export removed — batch flow lives in WhatnotPendingView
	import type { Card, PriceData, ScrapingTestData } from '$lib/types';
	import { user } from '$lib/stores/auth.svelte';
	import { isPro, setShowGoProModal } from '$lib/stores/pro.svelte';
	import { uiPref } from '$lib/stores/ui-prefs.svelte';
	import { getUserProfile, ensureProfileLoaded } from '$lib/stores/feature-flags.svelte';

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

	// ── Admin-only scraping test data ────────────────────────
	const currentUser = $derived(user());
	const isAdmin = $derived(
		getUserProfile()?.is_admin === true ||
		currentUser?.app_metadata?.is_admin === true
	);
	let stData = $state<ScrapingTestData | null>(null);
	let stLoading = $state(false);
	let stExpanded = $state(false);

	// svelte-ignore state_referenced_locally
	const _init = {
		condition: initialCondition || 'Near Mint',
		heroName: card.hero_name || card.name || '',
		cardNumber: card.card_number || '',
		setCode: card.set_code || '',
		parallel: card.parallel || '',
		weaponType: card.weapon_type || '',
		athleteName: card.athlete_name || '',
		power: card.power ? String(card.power) : ''
	};

	// ── Listing state ───────────────────────────────────────
	let priceData = $state<PriceData | null>(null);
	let priceLoading = $state(true);
	let condition = $state(_init.condition);
	let price = $state('');
	let quantity = $state(1);
	let notes = $state('');
	let creating = $state(false);
	let created = $state(false);
	let sellerHubUrl = $state<string | null>(null);
	let listingUrl = $state<string | null>(null);
	let error = $state<string | null>(null);
	let showAdvanced = $state(false);
	let showListingOptions = $state(false);
	const editDetailsPref = uiPref('listing-edit-details', true);
	let showEditDetails = $derived(editDetailsPref.value);

	// ── Weekly listing limit ─────────────────────────────────
	let weeklyCount = $state(0);
	let weeklyLimit = $state<number | null>(null);
	let weeklyRemaining = $state<number | null>(null);
	let limitLoading = $state(true);

	async function loadWeeklyCount() {
		try {
			const res = await fetch('/api/listings/weekly-count');
			if (res.ok) {
				const data = await res.json();
				weeklyCount = data.weekly_count;
				weeklyLimit = data.weekly_limit;
				weeklyRemaining = data.remaining ?? null;
			}
		} catch { /* ignore */ }
		limitLoading = false;
	}

	$effect(() => { loadWeeklyCount(); });

	const atWeeklyLimit = $derived(!isPro() && weeklyLimit !== null && weeklyCount >= weeklyLimit);

	// ── Listing options ──────────────────────────────────────
	let bestOffer = $state(true);
	let autoAcceptPrice = $state('');
	let autoDeclinePrice = $state('');
	let packageWeightOz = $state('');
	let listingDuration = $state('GTC');

	// Auto-calculate suggested thresholds when price changes
	let suggestedAutoAccept = $derived(
		price ? (parseFloat(price) * 0.9).toFixed(2) : ''
	);
	let suggestedAutoDecline = $derived(
		price ? (parseFloat(price) * 0.6).toFixed(2) : ''
	);
	let autoWeight = $derived(
		price && parseFloat(price) >= 20 ? 4 : 1
	);
	let shippingMethod = $derived(
		price && parseFloat(price) >= 20 ? 'USPS First Class' : 'eBay Standard Envelope'
	);
	let forceNew = $state(false);
	let existingListings = $state<Array<{
		id: string;
		sku: string;
		price: number;
		ebay_listing_id: string | null;
		ebay_listing_url: string | null;
		status: string;
		created_at: string;
	}> | null>(null);
	let showExistingDialog = $state(false);

	const CONDITIONS = ['Mint', 'Near Mint', 'Excellent', 'Good', 'Fair'] as const;

	// ── Editable card fields that feed into eBay listing ────
	let heroName = $state(_init.heroName);
	let cardNumber = $state(_init.cardNumber);
	let setCode = $state(_init.setCode);
	let parallel = $state(_init.parallel);
	let weaponType = $state(_init.weaponType);
	let athleteName = $state(_init.athleteName);
	let power = $state(_init.power);

	// ── Generated title & description (editable) ────────────
	// game_id determines how the title and description get assembled.
	// Wonders cards use their own field set (card name, variant, collector number)
	// instead of BoBA's hero/athlete/weapon fields.
	const cardGameId = $derived(card.game_id || 'boba');
	const isWondersListing = $derived(cardGameId === 'wonders');

	// Variant isn't a field on Card — it's on CollectionItem and ScanResult.
	// The caller may attach it informally; read defensively and default to 'paper'.
	const cardVariant = $derived(
		(card as Card & { variant?: string | null }).variant || 'paper'
	);

	function generateTitle(): string {
		return buildEbayListingTitle({
			hero_name: heroName,
			name: heroName,
			athlete_name: athleteName,
			parallel: parallel || null,
			weapon_type: weaponType || null,
			card_number: cardNumber || null,
			game_id: cardGameId,
			variant: cardVariant,
			metadata: card.metadata ?? null,
		});
	}

	function generateDescription(): string {
		if (isWondersListing) {
			const meta = (card.metadata ?? {}) as Record<string, unknown>;
			const setDisplay = (typeof meta.set_name_display === 'string' && meta.set_name_display)
				|| (typeof meta.set_name === 'string' && meta.set_name)
				|| setCode;
			const typeLine = typeof meta.type_line === 'string' ? meta.type_line : '';
			const variantName = cardVariant !== 'paper' ? cardVariant.toUpperCase() : '';
			const lines = [
				`Wonders of The First - ${heroName || 'Card'}`,
				'',
			];
			if (cardNumber) lines.push(`Collector Number: ${cardNumber}`);
			if (setDisplay) lines.push(`Set: ${setDisplay}`);
			if (typeLine) lines.push(`Type: ${typeLine}`);
			if (variantName) lines.push(`Variant: ${variantName}`);
			if (power) lines.push(`Power: ${power}`);
			lines.push(`Condition: ${condition}`);
			if (notes) lines.push(`Notes: ${notes}`);
			lines.push('');
			lines.push('Listed with Card Scanner - boba.cards');
			return lines.filter(l => l !== undefined).join('\n');
		}

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
		lines.push('Listed with Card Scanner - boba.cards');
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

	// Fetch price data on mount
	$effect(() => {
		loadPrice();
	});

	// Ensure user profile (is_admin) is loaded — needed because the sell flow
	// doesn't check feature flags, which is the normal trigger for profile loading.
	$effect(() => {
		ensureProfileLoaded();
	});

	// Fetch scraping test data for admin only — server-side protected
	$effect(() => {
		if (isAdmin && card.id) {
			loadStData();
		}
	});

	async function loadStData() {
		stLoading = true;
		try {
			const res = await fetch(`/api/admin/st-data?card_id=${encodeURIComponent(card.id)}`);
			if (res.ok) {
				const json = await res.json();
				stData = json.data;
			}
		} catch {
			// Silent fail — non-critical admin feature
		}
		stLoading = false;
	}

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
					description,
					forceNew,
					gameId: card.game_id || 'boba',
					variant: (card as unknown as { variant?: string }).variant || 'paper',
					metadata: card.metadata ?? null,
					bestOffer,
					autoAcceptPrice: autoAcceptPrice ? parseFloat(autoAcceptPrice) : null,
					autoDeclinePrice: autoDeclinePrice ? parseFloat(autoDeclinePrice) : null,
					packageWeightOz: packageWeightOz ? parseFloat(packageWeightOz) : null,
					listingDuration: listingDuration !== 'GTC' ? listingDuration : null
				})
			});

			if (res.status === 409) {
				// Card already has active listing(s)
				const data = await res.json();
				existingListings = data.existingListings || [];
				showExistingDialog = true;
				creating = false;
				return;
			}

			if (!res.ok) {
				const errData = await res.json().catch(() => ({ message: 'Failed to create draft' }));
				throw new Error(errData.message || errData.error || `Failed: ${res.status}`);
			}

			const result = await res.json().catch(() => ({ success: true }));
			created = true;
			sellerHubUrl = result.sellerHubUrl || null;
			listingUrl = result.listingUrl || null;

			if (result.listingUrl) {
				showToast('Listed on eBay!', 'check');
			} else if (result.partial) {
				showToast('Card added to eBay inventory', 'check');
			} else {
				showToast('Listing published on eBay', 'check');
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
	function createNewListing() {
		showExistingDialog = false;
		existingListings = null;
		forceNew = true;
		createEbayDraft();
	}
</script>

<div class="stl-listing-view">
	<div class="stl-header">
		{#if backLabel}
			<button class="stl-back" onclick={onDone}>&larr; {backLabel}</button>
		{:else}
			<button class="stl-back" onclick={onScanNext}>&larr; Scan Next</button>
		{/if}
		<h1 class="stl-title">List on eBay</h1>
	</div>

	<!-- Card preview — prominent, confidence-building -->
	<div class="stl-card-hero">
		{#if imageUrl}
			<img src={imageUrl} alt={heroName || 'Card'} class="stl-card-hero-img" />
		{:else}
			<div class="stl-card-hero-placeholder">🎴</div>
		{/if}
		<div class="stl-card-hero-details">
			<span class="stl-card-hero-name">{heroName || 'Unknown'}</span>
			<span class="stl-card-hero-meta">
				{cardNumber || ''}{setCode ? ` · ${setCode}` : ''}{parallel ? ` · ${parallel}` : ''}
			</span>
			{#if weaponType}
				<span class="stl-card-hero-weapon">{weaponType}{power ? ` · ${power} Power` : ''}</span>
			{/if}
		</div>
	</div>

	<!-- ── LISTING TITLE ── -->
	<div class="stl-field">
		<label class="stl-label" for="stl-title">
			Listing Title
			<span class="stl-char-count" class:over={title.length > 80}>{title.length}/80</span>
		</label>
		<input id="stl-title" type="text" class="stl-text-input" bind:value={title}
			maxlength="80" placeholder="Auto-generated from card data"
			oninput={() => { titleManuallyEdited = true; }} />
	</div>

	<!-- ── CONDITION ── -->
	<div class="stl-field">
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="stl-label">Condition</label>
		<div class="stl-condition-chips">
			{#each CONDITIONS as cond}
				<button class="stl-condition-chip" class:selected={condition === cond}
					onclick={() => { condition = cond; }}>{cond}</button>
			{/each}
		</div>
	</div>

	<!-- ── PRICE & QUANTITY ── -->
	<div class="stl-field-row">
		<div class="stl-field" style="flex:2">
			<label class="stl-label" for="stl-price">Price</label>
			<div class="stl-price-row">
				<span class="stl-dollar">$</span>
				<input id="stl-price" type="number" class="stl-price-input" bind:value={price}
					step="0.01" min="0.01" inputmode="decimal" />
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
						View on eBay &rarr;
					</a>
				</div>
			{:else}
				<span class="stl-field-hint">No market data available</span>
			{/if}

			<!-- Admin-only: ST price comparison (never rendered for non-admin) -->
			{#if isAdmin}
				<div class="stl-st-price-row">
					{#if stLoading}
						<span class="stl-st-label">ST</span>
						<span class="stl-st-value stl-st-loading">loading...</span>
					{:else if stData?.st_price != null}
						<span class="stl-st-label">ST</span>
						<span class="stl-st-value">${stData.st_price.toFixed(2)}</span>
						{#if priceData?.buy_now_mid != null}
							{@const diff = ((priceData.buy_now_mid - stData.st_price) / stData.st_price * 100)}
							<span class="stl-st-diff" class:positive={diff > 0} class:negative={diff < 0}>
								{diff > 0 ? '+' : ''}{diff.toFixed(0)}% vs eBay
							</span>
						{/if}
					{:else}
						<span class="stl-st-label">ST</span>
						<span class="stl-st-value stl-st-na">N/A</span>
					{/if}
				</div>
			{/if}
		</div>
		<div class="stl-field" style="flex:1">
			<label class="stl-label" for="stl-qty">Qty</label>
			<input id="stl-qty" type="number" class="stl-text-input stl-qty-input" bind:value={quantity}
				min="1" max="99" inputmode="numeric" />
		</div>
	</div>

	<!-- Admin-only: Scraping Test expandable detail panel (in Price section, not Edit Details) -->
	{#if isAdmin}
		<details class="stl-st-details" bind:open={stExpanded}>
			<summary class="stl-section-label stl-summary">Scraping Test</summary>
			<div class="stl-st-grid">
				{#if stLoading}
					<div class="stl-st-row">
						<span class="stl-st-key">Status</span>
						<span class="stl-st-val stl-st-loading">Loading...</span>
					</div>
				{:else if !stData}
					<div class="stl-st-row">
						<span class="stl-st-key">Status</span>
						<span class="stl-st-val stl-st-na">No scrape data for this card</span>
					</div>
				{/if}
				{#if stData}
				<div class="stl-st-row">
					<span class="stl-st-key">ST Price</span>
					<span class="stl-st-val">{stData.st_price != null ? `$${stData.st_price.toFixed(2)}` : '—'}</span>
				</div>
				<div class="stl-st-row">
					<span class="stl-st-key">ST Low</span>
					<span class="stl-st-val">{stData.st_low != null ? `$${stData.st_low.toFixed(2)}` : '—'}</span>
				</div>
				<div class="stl-st-row">
					<span class="stl-st-key">ST High</span>
					<span class="stl-st-val">{stData.st_high != null ? `$${stData.st_high.toFixed(2)}` : '—'}</span>
				</div>
				<div class="stl-st-row">
					<span class="stl-st-key">Source Card Name</span>
					<span class="stl-st-val">{stData.st_card_name || '—'}</span>
				</div>
				<div class="stl-st-row">
					<span class="stl-st-key">Source Set</span>
					<span class="stl-st-val">{stData.st_set_name || '—'}</span>
				</div>
				<div class="stl-st-row">
					<span class="stl-st-key">Source Variant</span>
					<span class="stl-st-val">{stData.st_variant || '—'}</span>
				</div>
				<div class="stl-st-row">
					<span class="stl-st-key">Source Rarity</span>
					<span class="stl-st-val">{stData.st_rarity || '—'}</span>
				</div>
				<div class="stl-st-row">
					<span class="stl-st-key">Last Updated</span>
					<span class="stl-st-val">{stData.st_updated ? new Date(stData.st_updated).toLocaleDateString() : '—'}</span>
				</div>
				{#if stData.st_image_url}
					<div class="stl-st-row stl-st-image-row">
						<span class="stl-st-key">Source Image</span>
						<img src={stData.st_image_url} alt="Source card" class="stl-st-image" />
					</div>
				{/if}
				{#if stData.st_raw_data}
					<details class="stl-st-raw">
						<summary class="stl-st-raw-summary">Raw Data</summary>
						<pre class="stl-st-raw-pre">{JSON.stringify(stData.st_raw_data, null, 2)}</pre>
					</details>
				{/if}
				{/if}
			</div>
		</details>
	{/if}

	<!-- ── PRIMARY ACTION (visible without scrolling) ── -->
	{#if !created}
		{#if !ebayConnected}
			<a href="/settings?ebay=setup" class="stl-btn stl-btn-connect">Connect eBay to List</a>
		{:else if atWeeklyLimit}
			<div class="stl-limit-block">
				<span class="stl-limit-text">Weekly listing limit reached (3/3)</span>
				<button class="stl-btn stl-btn-upgrade" onclick={() => setShowGoProModal(true)}>Go Pro for Unlimited</button>
			</div>
		{:else}
			<button
				class="stl-btn stl-btn-create stl-btn-primary"
				onclick={createEbayDraft}
				disabled={creating || !price}
			>
				{creating ? 'Creating...' : `List for $${price || '0.00'} on eBay`}
			</button>
		{/if}
	{/if}

	<!-- ── EDIT DETAILS (collapsible — for power sellers) ── -->
	<button class="stl-toggle-advanced stl-toggle-edit" onclick={() => editDetailsPref.value = !editDetailsPref.value}>
		{editDetailsPref.value ? '▾' : '▸'} Edit Listing Details
	</button>

	{#if editDetailsPref.value}
	<div class="stl-edit-panel">

	<!-- ── EBAY ITEM SPECIFICS (all editable) ── -->
	<div class="stl-section">
		<h2 class="stl-section-title">eBay Item Specifics</h2>

		<div class="stl-specifics-grid">
			<div class="stl-spec-field">
				<label class="stl-spec-label" for="spec-card-name">Card Name</label>
				<input id="spec-card-name" type="text" class="stl-text-input" bind:value={heroName} />
			</div>

			<div class="stl-spec-field">
				<label class="stl-spec-label" for="spec-card-number">Card Number</label>
				<input id="spec-card-number" type="text" class="stl-text-input" bind:value={cardNumber} />
			</div>

			<div class="stl-spec-field">
				<label class="stl-spec-label" for="spec-set">Set</label>
				<input id="spec-set" type="text" class="stl-text-input" bind:value={setCode} />
			</div>

			<div class="stl-spec-field">
				<label class="stl-spec-label" for="spec-parallel">Parallel/Variety</label>
				<input id="spec-parallel" type="text" class="stl-text-input" bind:value={parallel}
					placeholder="None" />
			</div>

			{#if !isWondersListing}
				<div class="stl-spec-field">
					<label class="stl-spec-label" for="spec-athlete">Player/Athlete</label>
					<input id="spec-athlete" type="text" class="stl-text-input" bind:value={athleteName}
						placeholder="None" />
				</div>

				<div class="stl-spec-field">
					<label class="stl-spec-label" for="spec-weapon">Weapon Type</label>
					<input id="spec-weapon" type="text" class="stl-text-input" bind:value={weaponType}
						placeholder="None" />
				</div>
			{/if}

			<div class="stl-spec-field">
				<label class="stl-spec-label" for="spec-power">Power</label>
				<input id="spec-power" type="text" class="stl-text-input" bind:value={power}
					placeholder="None" inputmode="numeric" />
			</div>

			<!-- Read-only system fields -->
			{#if !isWondersListing}
				<div class="stl-spec-field stl-spec-readonly">
					<span class="stl-spec-label">Sport</span>
					<span class="stl-spec-value">Multi-Sport</span>
				</div>
			{/if}

			<div class="stl-spec-field stl-spec-readonly">
				<span class="stl-spec-label">Card Manufacturer</span>
				<span class="stl-spec-value">{isWondersListing ? 'Wonders of The First' : 'Bo Jackson Battle Arena'}</span>
			</div>
		</div>
	</div>

	<!-- ── NOTES / CONDITION DESCRIPTION ── -->
	<div class="stl-field">
		<label class="stl-label" for="stl-notes">Condition Notes</label>
		<textarea id="stl-notes" class="stl-textarea" bind:value={notes}
			rows="2" placeholder="Optional — visible to buyers as condition description"></textarea>
	</div>

	<!-- ── LISTING DESCRIPTION ── -->
	<div class="stl-field">
		<label class="stl-label" for="stl-desc">Listing Description</label>
		<textarea id="stl-desc" class="stl-textarea" bind:value={description}
			rows="4" oninput={() => { descManuallyEdited = true; }}></textarea>
	</div>

	</div>
	{/if}
	<!-- end of .stl-edit-panel / showEditDetails -->

	<!-- ── LISTING OPTIONS (expandable) ── -->
	<button class="stl-toggle-advanced stl-toggle-options" onclick={() => showListingOptions = !showListingOptions}>
		{showListingOptions ? '▾' : '▸'} Listing Options
	</button>

	{#if showListingOptions}
		<div class="stl-options-panel">
			<!-- Best Offer -->
			<div class="stl-option-row">
				<div class="stl-option-label-row">
					<span class="stl-option-label">Best Offer</span>
					<button
						class="stl-toggle-pill"
						class:active={bestOffer}
						onclick={() => { bestOffer = !bestOffer; }}
						role="switch"
						aria-checked={bestOffer}
					>
						<span class="stl-toggle-knob"></span>
					</button>
				</div>
				{#if bestOffer}
					<div class="stl-option-subfields">
						<div class="stl-option-subfield">
							<label class="stl-spec-label" for="auto-accept">Auto-accept above</label>
							<div class="stl-price-row">
								<span class="stl-dollar">$</span>
								<input id="auto-accept" type="number" class="stl-price-input stl-option-input"
									bind:value={autoAcceptPrice} step="0.01" min="0"
									placeholder={suggestedAutoAccept} inputmode="decimal" />
							</div>
						</div>
						<div class="stl-option-subfield">
							<label class="stl-spec-label" for="auto-decline">Auto-decline below</label>
							<div class="stl-price-row">
								<span class="stl-dollar">$</span>
								<input id="auto-decline" type="number" class="stl-price-input stl-option-input"
									bind:value={autoDeclinePrice} step="0.01" min="0"
									placeholder={suggestedAutoDecline} inputmode="decimal" />
							</div>
						</div>
					</div>
				{/if}
			</div>

			<!-- Shipping -->
			<div class="stl-option-row">
				<span class="stl-option-label">Shipping Method</span>
				<span class="stl-option-value">{shippingMethod}</span>
			</div>

			<!-- Package Weight -->
			<div class="stl-option-row">
				<div class="stl-option-label-row">
					<span class="stl-option-label">Package Weight</span>
				</div>
				<div class="stl-weight-row">
					<input type="number" class="stl-text-input stl-weight-input"
						bind:value={packageWeightOz} step="1" min="1" max="16"
						placeholder={String(autoWeight)} inputmode="numeric" />
					<span class="stl-weight-unit">oz</span>
					<span class="stl-weight-hint">
						{#if !packageWeightOz}
							Auto: {autoWeight}oz ({parseFloat(price || '0') >= 20 ? '≥$20 → padded mailer' : '<$20 → toploader'})
						{/if}
					</span>
				</div>
			</div>

			<!-- Listing Duration -->
			<div class="stl-option-row">
				<span class="stl-option-label">Duration</span>
				<div class="stl-duration-chips">
					{#each [['GTC', 'Good \'Til Cancelled'], ['DAYS_30', '30 Days'], ['DAYS_60', '60 Days']] as [val, label]}
						<button class="stl-condition-chip" class:selected={listingDuration === val}
							onclick={() => { listingDuration = val; }}>{label}</button>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<!-- ── ADVANCED DETAILS (collapsible — for power sellers) ── -->
	<button class="stl-toggle-advanced" onclick={() => showAdvanced = !showAdvanced}>
		{showAdvanced ? '▾' : '▸'} Advanced Details
	</button>

	{#if showAdvanced}
		<div class="stl-system-fields">
			<div class="stl-system-row">
				<span class="stl-system-label">SKU</span>
				<span class="stl-system-value">BOBA-{card.id || '...'}-{'{timestamp}'}</span>
			</div>
			<div class="stl-system-row">
				<span class="stl-system-label">Category</span>
				<span class="stl-system-value">Trading Card Singles (183454)</span>
			</div>
			<div class="stl-system-row">
				<span class="stl-system-label">Marketplace</span>
				<span class="stl-system-value">EBAY_US</span>
			</div>
			<div class="stl-system-row">
				<span class="stl-system-label">Format</span>
				<span class="stl-system-value">Fixed Price</span>
			</div>
			<div class="stl-system-row">
				<span class="stl-system-label">Currency</span>
				<span class="stl-system-value">USD</span>
			</div>
			<div class="stl-system-row">
				<span class="stl-system-label">Location</span>
				<span class="stl-system-value">Default (US)</span>
			</div>
			<div class="stl-system-row">
				<span class="stl-system-label">Policies</span>
				<span class="stl-system-value">Auto-fetched from your eBay account</span>
			</div>
		</div>
	{/if}

	<!-- Existing listing dialog -->
	{#if showExistingDialog && existingListings && existingListings.length > 0}
		<div class="stl-existing-dialog">
			<div class="stl-existing-header">
				<span class="stl-existing-icon">⚠️</span>
				<span class="stl-existing-title">Already Listed</span>
			</div>
			<p class="stl-existing-desc">
				This card has {existingListings.length} active listing{existingListings.length > 1 ? 's' : ''}:
			</p>
			<div class="stl-existing-list">
				{#each existingListings as listing}
					<div class="stl-existing-row">
						<span class="stl-existing-price">${listing.price?.toFixed(2) ?? '—'}</span>
						<span class="stl-existing-status">{listing.status}</span>
						{#if listing.ebay_listing_url}
							<a href={listing.ebay_listing_url} target="_blank" rel="noopener" class="stl-existing-link">View ↗</a>
						{/if}
					</div>
				{/each}
			</div>
			<div class="stl-existing-actions">
				<button class="stl-btn stl-btn-create" onclick={createNewListing}>
					Create New Listing Anyway
				</button>
				<button class="stl-text-btn" onclick={() => { showExistingDialog = false; }}>
					Cancel
				</button>
			</div>
		</div>
	{/if}

	<!-- Success / Action States -->
	{#if created && listingUrl}
		<div class="stl-success-card">
			<div class="stl-success-check">✓</div>
			<div class="stl-success-title">Listed on eBay!</div>
			<div class="stl-success-subtitle">{heroName} · ${price}</div>
			<a href={listingUrl} target="_blank" rel="noopener" class="stl-btn stl-btn-create stl-btn-primary">
				View Listing ↗
			</a>
			<button class="stl-btn stl-btn-scan-next" onclick={onScanNext}>
				Scan Next Card →
			</button>
		</div>
	{:else if created && sellerHubUrl}
		<div class="stl-success-card">
			<div class="stl-success-check">✓</div>
			<div class="stl-success-title">Added to eBay Inventory</div>
			<div class="stl-success-subtitle">Complete listing in Seller Hub</div>
			<a href={sellerHubUrl} target="_blank" rel="noopener" class="stl-btn stl-btn-create stl-btn-primary">
				Open Seller Hub ↗
			</a>
			<button class="stl-btn stl-btn-scan-next" onclick={onScanNext}>
				Scan Next Card →
			</button>
		</div>
	{:else if created}
		<div class="stl-success-card">
			<div class="stl-success-check">✓</div>
			<div class="stl-success-title">Draft Created</div>
			<button class="stl-btn stl-btn-scan-next" onclick={onScanNext}>
				Scan Next Card →
			</button>
		</div>
	{:else if !ebayConnected}
		<!-- handled by primary action button above -->
	{:else}
		<!-- handled by primary action button above -->
	{/if}

	<!-- Weekly limit now shown inline above the primary action button -->

	<!-- Single-card Whatnot export removed — use the dedicated Whatnot batch flow in the sell tab -->

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

	/* Hero card preview — larger, more confident */
	.stl-card-hero {
		display: flex;
		gap: 1rem;
		padding: 1rem;
		background: var(--bg-elevated, #121d34);
		border-radius: 12px;
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		margin-bottom: 1.25rem;
	}

	.stl-card-hero-img {
		width: 80px;
		height: 112px;
		object-fit: cover;
		border-radius: 8px;
		flex-shrink: 0;
	}

	.stl-card-hero-placeholder {
		width: 80px;
		height: 112px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2.5rem;
		background: var(--bg-surface, #0d1524);
		border-radius: 8px;
		flex-shrink: 0;
	}

	.stl-card-hero-details {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.25rem;
		min-width: 0;
	}

	.stl-card-hero-name {
		font-size: 1.15rem;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.stl-card-hero-meta {
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
	}

	.stl-card-hero-weapon {
		font-size: 0.75rem;
		color: var(--text-muted, #475569);
	}

	/* Section labels */
	.stl-section {
		margin-bottom: 1.25rem;
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

	/* Primary action button — prominent, above the fold */
	.stl-btn-primary {
		width: 100%;
		padding: 1rem;
		font-size: 1rem;
		font-weight: 700;
		border-radius: 12px;
		background: var(--accent-primary, #3b82f6);
		color: white;
		margin-bottom: 1rem;
	}

	.stl-btn-primary:hover:not(:disabled) {
		opacity: 0.9;
	}

	.stl-limit-block {
		text-align: center;
		padding: 0.75rem;
		border-radius: 12px;
		background: rgba(245, 158, 11, 0.08);
		border: 1px solid rgba(245, 158, 11, 0.2);
		margin-bottom: 1rem;
	}

	.stl-limit-text {
		display: block;
		font-size: 0.85rem;
		color: var(--warning, #f59e0b);
		margin-bottom: 0.5rem;
	}

	.stl-btn-upgrade {
		padding: 0.5rem 1.25rem;
		border-radius: 8px;
		background: var(--gold, #f59e0b);
		color: #000;
		border: none;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
	}

	/* Edit Details toggle */
	.stl-toggle-edit {
		margin-bottom: 0.5rem;
		color: var(--text-secondary, #94a3b8);
	}

	.stl-edit-panel {
		border-left: 2px solid var(--border, rgba(148,163,184,0.10));
		padding-left: 0.75rem;
		margin-bottom: 1rem;
	}

	.stl-btn-connect {
		background: var(--bg-elevated, #121d34);
		color: var(--accent-primary, #3b82f6);
		border: 1px solid var(--accent-primary, #3b82f6);
	}

	.stl-success-card {
		text-align: center;
		padding: 2rem 1.5rem;
		border-radius: 16px;
		background: rgba(16, 185, 129, 0.06);
		border: 1px solid rgba(16, 185, 129, 0.15);
		margin: 1rem 0;
	}

	.stl-success-check {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: var(--success, #10b981);
		color: white;
		font-size: 1.5rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 0.75rem;
	}

	.stl-success-title {
		font-size: 1.15rem;
		font-weight: 700;
		color: var(--success, #10b981);
		margin-bottom: 0.25rem;
	}

	.stl-success-subtitle {
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
		margin-bottom: 1rem;
	}

	.stl-btn-scan-next {
		display: block;
		width: 100%;
		padding: 0.75rem;
		margin-top: 0.5rem;
		border-radius: 10px;
		border: 1px solid var(--border-strong, rgba(148,163,184,0.2));
		background: transparent;
		color: var(--text-primary, #e2e8f0);
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}

	.stl-btn-scan-next:hover {
		border-color: var(--gold, #f59e0b);
		color: var(--gold, #f59e0b);
	}

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

	/* ── Price + Quantity side-by-side row ── */
	.stl-field-row {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		margin-bottom: 1rem;
	}
	.stl-field-row > .stl-field {
		margin-bottom: 0;
	}

	/* ── Item Specifics section ── */
	.stl-section-title {
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--accent-primary, #3b82f6);
		margin-bottom: 12px;
	}

	.stl-specifics-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	.stl-spec-field {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.stl-spec-field .stl-text-input {
		font-size: 0.8rem;
		padding: 6px 10px;
	}

	.stl-spec-label {
		font-size: 0.7rem;
		color: var(--text-muted, #475569);
		font-weight: 500;
	}

	.stl-spec-readonly {
		opacity: 0.6;
	}
	.stl-spec-value {
		font-size: 0.8rem;
		color: var(--text-primary, #e2e8f0);
		padding: 6px 10px;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 8px;
		border: 1px solid rgba(148, 163, 184, 0.08);
	}

	/* ── System Fields (collapsible) ── */
	.stl-toggle-advanced {
		width: 100%;
		padding: 8px 0;
		background: none;
		border: none;
		color: var(--text-muted, #475569);
		font-size: 0.75rem;
		cursor: pointer;
		text-align: left;
	}
	.stl-toggle-advanced:hover {
		color: var(--text-secondary, #94a3b8);
	}

	.stl-system-fields {
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid var(--border, rgba(148, 163, 184, 0.10));
		border-radius: 10px;
		padding: 10px 14px;
		margin-bottom: 12px;
	}
	.stl-system-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 4px 0;
	}
	.stl-system-row + .stl-system-row {
		border-top: 1px solid rgba(148, 163, 184, 0.06);
	}
	.stl-system-label {
		font-size: 0.7rem;
		color: var(--text-muted, #475569);
	}
	.stl-system-value {
		font-size: 0.75rem;
		color: var(--text-secondary, #94a3b8);
		text-align: right;
	}

	/* ── Existing listing dialog ── */
	.stl-existing-dialog {
		padding: 1rem;
		border-radius: 12px;
		background: var(--bg-elevated, #121d34);
		border: 1px solid rgba(245, 158, 11, 0.25);
		margin-bottom: 1rem;
	}

	.stl-existing-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.stl-existing-icon { font-size: 1.1rem; }

	.stl-existing-title {
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--gold, #f59e0b);
	}

	.stl-existing-desc {
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
		margin: 0 0 0.75rem;
	}

	.stl-existing-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-bottom: 1rem;
	}

	.stl-existing-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.625rem;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--border, rgba(148,163,184,0.08));
	}

	.stl-existing-price {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-primary, #e2e8f0);
	}

	.stl-existing-status {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
		background: rgba(34, 197, 94, 0.12);
		color: #22c55e;
	}

	.stl-existing-link {
		margin-left: auto;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--accent-primary, #3b82f6);
		text-decoration: none;
	}

	.stl-existing-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* ── Listing Options panel ── */
	.stl-toggle-options {
		color: var(--accent-primary, #3b82f6) !important;
		font-weight: 600;
	}

	.stl-options-panel {
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		border-radius: 10px;
		padding: 0.75rem;
		margin-bottom: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.stl-option-row {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid rgba(148,163,184,0.06);
	}

	.stl-option-row:last-child {
		padding-bottom: 0;
		border-bottom: none;
	}

	.stl-option-label-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.stl-option-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-primary, #e2e8f0);
	}

	.stl-option-value {
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
		text-align: right;
	}

	/* Toggle pill */
	.stl-toggle-pill {
		position: relative;
		width: 40px;
		height: 22px;
		border-radius: 11px;
		border: none;
		background: rgba(148,163,184,0.2);
		cursor: pointer;
		transition: background 0.2s;
		padding: 0;
	}

	.stl-toggle-pill.active {
		background: var(--accent-primary, #3b82f6);
	}

	.stl-toggle-knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: white;
		transition: transform 0.2s;
	}

	.stl-toggle-pill.active .stl-toggle-knob {
		transform: translateX(18px);
	}

	/* Best Offer subfields */
	.stl-option-subfields {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.25rem;
	}

	.stl-option-subfield {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.stl-option-input {
		font-size: 0.85rem !important;
		padding: 0.375rem 0.5rem !important;
	}

	/* Weight row */
	.stl-weight-row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.stl-weight-input {
		width: 60px;
		text-align: center;
		-moz-appearance: textfield;
		appearance: textfield;
	}

	.stl-weight-input::-webkit-inner-spin-button { appearance: none; -webkit-appearance: none; }

	.stl-weight-unit {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-muted, #475569);
	}

	.stl-weight-hint {
		font-size: 0.7rem;
		color: var(--text-muted, #475569);
		margin-left: 0.25rem;
	}

	/* Duration chips */
	.stl-duration-chips {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	/* ── Scraping Test: admin-only styles ─────────────────── */
	.stl-st-price-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
		padding: 0.375rem 0.625rem;
		border-radius: 6px;
		background: rgba(168, 85, 247, 0.08);
		border: 1px solid rgba(168, 85, 247, 0.15);
	}

	.stl-st-label {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: rgba(168, 85, 247, 0.7);
	}

	.stl-st-value {
		font-size: 0.875rem;
		font-weight: 700;
		color: #a855f7;
	}

	.stl-st-loading { opacity: 0.5; font-weight: 400; font-style: italic; }
	.stl-st-na { opacity: 0.4; }

	.stl-st-diff {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		margin-left: auto;
	}

	.stl-st-diff.positive {
		color: #22c55e;
		background: rgba(34, 197, 94, 0.1);
	}

	.stl-st-diff.negative {
		color: #ef4444;
		background: rgba(239, 68, 68, 0.1);
	}

	.stl-st-details {
		margin-bottom: 1.25rem;
		border: 1px solid rgba(168, 85, 247, 0.15);
		border-radius: 10px;
		padding: 0.75rem;
		background: rgba(168, 85, 247, 0.04);
	}

	.stl-st-grid {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.stl-st-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.3rem 0;
		border-bottom: 1px solid rgba(168, 85, 247, 0.06);
		font-size: 0.8rem;
	}

	.stl-st-key {
		color: var(--text-muted, #475569);
	}

	.stl-st-val {
		color: #a855f7;
		font-weight: 600;
		text-align: right;
		max-width: 60%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.stl-st-image-row {
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.stl-st-image {
		width: 100px;
		height: 140px;
		object-fit: cover;
		border-radius: 6px;
		border: 1px solid rgba(168, 85, 247, 0.2);
	}

	.stl-st-raw {
		margin-top: 0.5rem;
	}

	.stl-st-raw-summary {
		font-size: 0.7rem;
		color: var(--text-muted, #475569);
		cursor: pointer;
	}

	.stl-st-raw-pre {
		font-size: 0.65rem;
		color: var(--text-muted, #475569);
		background: var(--bg-surface, #0d1524);
		border-radius: 6px;
		padding: 0.5rem;
		overflow-x: auto;
		max-height: 200px;
		overflow-y: auto;
		margin-top: 0.375rem;
	}
</style>
