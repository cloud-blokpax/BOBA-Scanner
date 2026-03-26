<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import DeckHeader from '$lib/components/deck/DeckHeader.svelte';
	import DeckHeroesTab from '$lib/components/deck/DeckHeroesTab.svelte';
	import DeckPlaysTab from '$lib/components/deck/DeckPlaysTab.svelte';
	import DeckStatsTab from '$lib/components/deck/DeckStatsTab.svelte';
	import DeckShopTab from '$lib/components/deck/DeckShopTab.svelte';
	import DeckSettingsModal from '$lib/components/deck/DeckSettingsModal.svelte';
	import Scanner from '$lib/components/Scanner.svelte';
	import { updateDeckContents, updateDeckSettings, type PlayEntry } from '$lib/services/deck-service';
	import { loadCardDatabase, getCardById } from '$lib/services/card-db';
	import { collectionItems, loadCollection } from '$lib/stores/collection.svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import { validateDeck } from '$lib/services/deck-validator';
	import { recognizeCard } from '$lib/services/recognition';
	import type { Card, ScanResult } from '$lib/types';
	import type { DeckValidationResult } from '$lib/services/deck-validator';
	import type { PlayCardData } from '$lib/data/boba-dbs-scores';

	let { data } = $props();

	// ── State ─────────────────────────────────────────────────
	// Initialized from page data and reset when navigating to a different deck
	let deckName = $state('');
	let notes = $state('');
	let heroCardIds = $state<string[]>([]);
	let playEntries = $state<PlayEntry[]>([]);
	let hotDogCount = $state(10);

	// Tournament lock state
	let showQrModal = $state(false);
	let qrImageSrc = $state<string | null>(null);
	let verifyCode = $state<string | null>(null);
	let verifyUrl = $state<string | null>(null);
	let lockIsValid = $state(false);
	let locking = $state(false);
	let lockError = $state<string | null>(null);

	// Reset editable state when the deck changes (e.g. navigating to a different [id])
	let _lastDeckId = '';
	$effect(() => {
		const deck = data.deck;
		if (deck.id === _lastDeckId) return;
		_lastDeckId = deck.id;
		deckName = deck.name;
		notes = deck.notes || '';
		heroCardIds = [...(deck.hero_card_ids || [])];
		playEntries = [...(deck.play_entries || [])];
		hotDogCount = deck.hot_dog_count || 10;
		_skipNextSave = true;
	});
	let activeTab = $state<'heroes' | 'plays' | 'stats' | 'shop'>('heroes');
	let showScanner = $state(false);
	let showSettings = $state(false);
	let saveState = $state<'saved' | 'saving' | 'unsaved'>('saved');
	let validationResult = $state<DeckValidationResult | null>(null);
	let validating = $state(false);
	let cardDbLoaded = $state(false);
	let fileInputEl: HTMLInputElement | undefined = $state();

	// ── Derived ───────────────────────────────────────────────
	const heroCards: Card[] = $derived.by(() => {
		if (!cardDbLoaded) return [];
		return heroCardIds.map(id => getCardById(id)).filter(Boolean) as Card[];
	});

	// ── Lifecycle ─────────────────────────────────────────────
	onMount(async () => {
		await loadCardDatabase();
		cardDbLoaded = true;
		loadCollection();
	});

	// ── Auto-save ─────────────────────────────────────────────
	let _saveTimer: ReturnType<typeof setTimeout> | undefined;
	let _skipNextSave = true;

	$effect(() => {
		// Read tracked values
		void heroCardIds;
		void playEntries;
		void hotDogCount;
		void deckName;
		void notes;

		if (_skipNextSave) {
			_skipNextSave = false;
			return;
		}

		saveState = 'unsaved';
		clearTimeout(_saveTimer);
		_saveTimer = setTimeout(async () => {
			saveState = 'saving';
			const ok = await updateDeckContents(data.deck.id, {
				hero_card_ids: heroCardIds,
				play_entries: playEntries,
				hot_dog_count: hotDogCount,
				name: deckName,
				notes
			});
			saveState = ok ? 'saved' : 'unsaved';
		}, 1000);

		return () => clearTimeout(_saveTimer);
	});

	// ── Validation ────────────────────────────────────────────
	let _validateTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		void heroCardIds;
		void data.deck.format_id;

		if (!cardDbLoaded) return;

		clearTimeout(_validateTimer);
		_validateTimer = setTimeout(() => {
			validating = true;
			try {
				validationResult = validateDeck(heroCards, data.deck.format_id);
			} catch {
				// validation failed silently
			}
			validating = false;
		}, 300);

		return () => clearTimeout(_validateTimer);
	});

	// ── Hero Operations ───────────────────────────────────────
	function addHeroById(cardId: string) {
		const max = data.deck.hero_deck_max ?? 999;
		if (heroCardIds.length >= max) {
			showToast(`Hero deck is full (${max} max)`, 'error');
			return;
		}
		if (heroCardIds.includes(cardId)) {
			showToast('Card already in deck', 'error');
			return;
		}
		if (data.deck.spec_power_cap !== null && cardDbLoaded) {
			const card = getCardById(cardId);
			if (card?.power && card.power > data.deck.spec_power_cap) {
				showToast(`Card power ${card.power} exceeds SPEC cap ${data.deck.spec_power_cap}`, 'error');
				return;
			}
		}
		heroCardIds = [...heroCardIds, cardId];
		showToast('Hero added', 'check');
	}

	function removeHero(cardId: string) {
		heroCardIds = heroCardIds.filter(id => id !== cardId);
	}

	function handleScanResult(result: ScanResult) {
		showScanner = false;
		if (result.card_id) {
			addHeroById(result.card_id);
		} else {
			showToast('Could not identify card', 'error');
		}
	}

	async function handleUpload() {
		const file = fileInputEl?.files?.[0];
		if (!file) return;
		try {
			const result = await recognizeCard(file);
			if (result?.card_id) {
				addHeroById(result.card_id);
			} else {
				showToast('Could not identify card from image', 'error');
			}
		} catch {
			showToast('Image recognition failed', 'error');
		}
		// Reset file input
		if (fileInputEl) fileInputEl.value = '';
	}

	// ── Play Operations ───────────────────────────────────────
	function addPlay(card: PlayCardData) {
		const setCode = card.release === 'A' ? 'Alpha Edition' :
			card.release === 'G' ? 'Griffey Edition' :
			card.release === 'U' ? 'Alpha Update' :
			card.release === 'HTD' ? 'Alpha Blast' : card.release;
		playEntries = [...playEntries, {
			cardNumber: card.card_number,
			setCode,
			name: card.name,
			dbs: card.dbs
		}];
	}

	function removePlay(index: number) {
		playEntries = playEntries.filter((_, i) => i !== index);
	}

	// ── Tournament Lock ──────────────────────────────────────
	async function lockDeck() {
		locking = true;
		lockError = null;
		try {
			const res = await fetch('/api/deck/lock', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ deck_id: data.deck.id, format_id: data.deck.format_id })
			});
			const result = await res.json();
			if (!res.ok) {
				lockError = result.message || 'Failed to lock deck';
				return;
			}

			const QRCode = (await import('qrcode')).default;
			const qrDataUrl = await QRCode.toDataURL(result.verify_url, {
				width: 280,
				margin: 2,
				color: { dark: '#e2e8f0', light: '#070b14' }
			});

			// Store for offline display
			const { idb } = await import('$lib/services/idb');
			await idb.setMeta(`deck-qr-${data.deck.id}`, {
				qrDataUrl,
				verifyUrl: result.verify_url,
				code: result.code,
				lockedAt: new Date().toISOString(),
				isValid: result.is_valid
			});

			qrImageSrc = qrDataUrl;
			verifyCode = result.code;
			verifyUrl = result.verify_url;
			lockIsValid = result.is_valid;
			showQrModal = true;
		} catch (err) {
			lockError = err instanceof Error ? err.message : 'Lock failed';
		} finally {
			locking = false;
		}
	}

	async function loadCachedQr() {
		try {
			const { idb } = await import('$lib/services/idb');
			const cached = await idb.getMeta<{
				qrDataUrl: string;
				verifyUrl: string;
				code: string;
				lockedAt: string;
				isValid: boolean;
			}>(`deck-qr-${data.deck.id}`);
			if (cached) {
				qrImageSrc = cached.qrDataUrl;
				verifyCode = cached.code;
				verifyUrl = cached.verifyUrl;
				lockIsValid = cached.isValid;
				showQrModal = true;
			}
		} catch {
			// No cached QR
		}
	}

	async function shareVerifyUrl() {
		if (!verifyUrl) return;
		try {
			if ('share' in navigator) {
				await navigator.share({ text: verifyUrl });
			}
		} catch {
			// User cancelled
		}
	}

	// ── Settings ──────────────────────────────────────────────
	async function handleSettingsSave(settings: Parameters<typeof updateDeckSettings>[1] & { name: string; notes: string }) {
		const { name, notes: newNotes, ...rest } = settings;
		deckName = name;
		notes = newNotes;
		await updateDeckSettings(data.deck.id, rest);
		showSettings = false;
		showToast('Settings saved', 'check');
	}
</script>

<svelte:head>
	<title>{deckName} | Deck Editor</title>
</svelte:head>

<DeckHeader
	{deckName}
	formatName={data.deck.format_id}
	{saveState}
	heroCount={heroCardIds.length}
	heroTarget={data.deck.hero_deck_min}
	onBack={() => goto('/deck')}
	onSettings={() => showSettings = true}
	onNameChange={(name) => deckName = name}
/>

<!-- Tournament Lock -->
<div class="tournament-lock-section">
	<button
		class="btn-lock"
		onclick={lockDeck}
		disabled={locking || heroCardIds.length === 0}
	>
		{locking ? 'Locking...' : 'Lock for Tournament'}
	</button>
	{#if verifyCode}
		<button class="btn-show-qr" onclick={loadCachedQr}>Show QR Code</button>
	{/if}
	{#if lockError}
		<p class="lock-error">{lockError}</p>
	{/if}
</div>

<div class="tab-nav">
	<button class:active={activeTab === 'heroes'} onclick={() => activeTab = 'heroes'}>Heroes ({heroCardIds.length})</button>
	<button class:active={activeTab === 'plays'} onclick={() => activeTab = 'plays'}>Plays ({playEntries.length})</button>
	<button class:active={activeTab === 'stats'} onclick={() => activeTab = 'stats'}>Stats</button>
	<button class:active={activeTab === 'shop'} onclick={() => activeTab = 'shop'}>Shop</button>
</div>

{#if activeTab === 'heroes'}
	<DeckHeroesTab
		{heroCards}
		collectionItems={collectionItems()}
		specPowerCap={data.deck.spec_power_cap}
		heroDeckMax={data.deck.hero_deck_max}
		onAddHero={addHeroById}
		onRemoveHero={removeHero}
		onScanCard={() => showScanner = true}
		onUploadImage={() => fileInputEl?.click()}
	/>
{:else if activeTab === 'plays'}
	<DeckPlaysTab
		{playEntries}
		playCardsBySet={data.playCardsBySet}
		dbsScores={data.dbsScores}
		dbsCap={data.deck.dbs_cap}
		playDeckSize={data.deck.play_deck_size}
		bonusPlaysMax={data.deck.bonus_plays_max}
		onAddPlay={addPlay}
		onRemovePlay={removePlay}
	/>
{:else if activeTab === 'stats'}
	<DeckStatsTab {heroCards} {validationResult} {validating} />
{:else if activeTab === 'shop'}
	<DeckShopTab gapAnalysis={null} refreshing={false} refreshesRemaining={null} refreshLimit={null} onRefreshPrices={() => {}} />
{/if}

<input type="file" accept="image/*" bind:this={fileInputEl} onchange={handleUpload} style="display:none" />

{#if showScanner}
	<div class="scanner-overlay">
		<button class="scanner-close" onclick={() => showScanner = false}>Close</button>
		<Scanner onResult={handleScanResult} isAuthenticated={true} paused={false} />
	</div>
{/if}

{#if showQrModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="qr-modal-backdrop" onclick={() => showQrModal = false}>
		<div class="qr-modal" onclick={(e) => e.stopPropagation()}>
			<div class="qr-modal-status" class:qr-valid={lockIsValid} class:qr-invalid={!lockIsValid}>
				{lockIsValid ? 'LEGAL' : 'ILLEGAL'}
			</div>
			<h2 class="qr-modal-title">{deckName}</h2>
			{#if qrImageSrc}
				<img src={qrImageSrc} alt="Tournament QR Code" class="qr-image" />
			{/if}
			{#if verifyUrl}
				<p class="qr-url">{verifyUrl}</p>
			{/if}
			<p class="qr-code-label">Code: <strong>{verifyCode}</strong></p>
			<div class="qr-modal-actions">
				{#if 'share' in globalThis.navigator}
					<button class="btn-share-code" onclick={shareVerifyUrl}>Share Code</button>
				{/if}
				<button class="btn-close-qr" onclick={() => showQrModal = false}>Close</button>
			</div>
		</div>
	</div>
{/if}

<DeckSettingsModal
	visible={showSettings}
	{deckName}
	{notes}
	heroDeckMin={data.deck.hero_deck_min}
	heroDeckMax={data.deck.hero_deck_max}
	playDeckSize={data.deck.play_deck_size}
	bonusPlaysMax={data.deck.bonus_plays_max}
	hotDogDeckSize={data.deck.hot_dog_deck_size}
	dbsCap={data.deck.dbs_cap}
	specPowerCap={data.deck.spec_power_cap}
	combinedPowerCap={data.deck.combined_power_cap}
	onSave={handleSettingsSave}
	onClose={() => showSettings = false}
/>

<style>
	.tab-nav {
		display: flex;
		gap: 2px;
		padding: 0 1rem;
	}
	.tab-nav button {
		flex: 1;
		padding: 0.6rem;
		border: none;
		background: var(--bg-elevated, #1e293b);
		color: var(--text-secondary, #94a3b8);
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
		border-radius: 8px 8px 0 0;
	}
	.tab-nav button.active {
		background: var(--bg-base, #0f172a);
		color: var(--text-primary, #f1f5f9);
	}
	.scanner-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: #000;
	}
	.scanner-close {
		position: absolute;
		top: 1rem;
		right: 1rem;
		z-index: 201;
		background: rgba(0, 0, 0, 0.6);
		color: white;
		border: none;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.tournament-lock-section {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
	}

	.btn-lock {
		flex: 1;
		padding: 0.6rem;
		border-radius: 8px;
		border: 1px solid rgba(168, 85, 247, 0.3);
		background: var(--bg-elevated, #1e293b);
		color: #a855f7;
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.btn-lock:disabled { opacity: 0.5; cursor: not-allowed; }

	.btn-show-qr {
		padding: 0.6rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border, rgba(148,163,184,0.1));
		background: transparent;
		color: var(--text-secondary, #94a3b8);
		font-size: 0.85rem;
		cursor: pointer;
	}

	.lock-error {
		font-size: 0.8rem;
		color: #ef4444;
		margin: 0;
	}

	.qr-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 300;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.qr-modal {
		background: var(--bg-base, #070b14);
		border-radius: 16px;
		padding: 1.5rem;
		max-width: 340px;
		width: 90%;
		text-align: center;
		border: 1px solid var(--border, rgba(148,163,184,0.1));
	}

	.qr-modal-status {
		display: inline-block;
		padding: 0.25rem 1rem;
		border-radius: 12px;
		font-weight: 800;
		font-size: 0.85rem;
		letter-spacing: 0.05em;
		margin-bottom: 0.5rem;
	}

	.qr-valid {
		background: rgba(16, 185, 129, 0.15);
		color: #10b981;
	}

	.qr-invalid {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}

	.qr-modal-title {
		font-size: 1rem;
		font-weight: 700;
		margin: 0 0 0.75rem;
	}

	.qr-image {
		width: 200px;
		height: 200px;
		margin: 0 auto 0.75rem;
		border-radius: 8px;
	}

	.qr-url {
		font-size: 0.7rem;
		color: var(--text-muted, #475569);
		word-break: break-all;
		margin: 0 0 0.25rem;
	}

	.qr-code-label {
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
		margin: 0 0 1rem;
		font-family: monospace;
		letter-spacing: 0.1em;
	}

	.qr-modal-actions {
		display: flex;
		gap: 0.5rem;
	}

	.btn-share-code {
		flex: 1;
		padding: 0.6rem;
		border-radius: 8px;
		border: none;
		background: var(--primary, #3b82f6);
		color: white;
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.btn-close-qr {
		flex: 1;
		padding: 0.6rem;
		border-radius: 8px;
		border: 1px solid var(--border-strong, rgba(148,163,184,0.2));
		background: transparent;
		color: var(--text-primary, #e2e8f0);
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
	}
</style>
