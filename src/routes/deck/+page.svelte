<script lang="ts">
	import { onMount } from 'svelte';
	import { collectionItems, loadCollection } from '$lib/stores/collection';
	import type { CollectionItem, Card } from '$lib/types';
	import type { PlayCardData } from '$lib/data/boba-dbs-scores';
	import type { DeckValidationResult } from '$lib/services/deck-validator';

	let { data } = $props();

	// ── Deck state ─────────────────────────────────────────
	let deckName = $state('My Deck');
	let selectedFormatId = $state('spec_playmaker');
	let heroCards = $state<CollectionItem[]>([]);
	let playEntries = $state<Array<{ cardNumber: string; setCode: string; name: string; dbs: number }>>([]);
	let hotDogCount = $state(10);

	// ── UI state ───────────────────────────────────────────
	let activeTab = $state<'heroes' | 'plays' | 'stats'>('heroes');
	let heroSearch = $state('');
	let playSearch = $state('');
	let selectedPlaySet = $state('all');
	let showAffordableOnly = $state(false);
	let savedMessage = $state<string | null>(null);
	let _pendingHeroIds = $state<string[] | null>(null);

	// ── Derived: DBS calculations ──────────────────────────
	const totalDbs = $derived(playEntries.reduce((sum, p) => sum + p.dbs, 0));
	const dbsBudgetPercent = $derived(Math.min(100, (totalDbs / 1000) * 100));
	const dbsBudgetColor = $derived(
		totalDbs <= 700 ? 'var(--color-success, #22C55E)' :
		totalDbs <= 900 ? 'var(--color-warning, #F59E0B)' :
		'var(--color-error, #EF4444)'
	);

	// ── Derived: hero stats ────────────────────────────────
	const totalPower = $derived(
		heroCards.reduce((sum, item) => sum + (item.card?.power || 0), 0)
	);

	const weaponCounts = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const item of heroCards) {
			const weapon = item.card?.weapon_type || 'None';
			counts[weapon] = (counts[weapon] || 0) + 1;
		}
		return counts;
	});

	const powerLevelCounts = $derived.by(() => {
		const counts: Record<number, number> = {};
		for (const item of heroCards) {
			const p = item.card?.power || 0;
			counts[p] = (counts[p] || 0) + 1;
		}
		return counts;
	});

	// ── Reactive: server-side validation ────────────────────
	let validationResult = $state<DeckValidationResult>({
		isValid: true,
		formatId: selectedFormatId,
		formatName: '',
		violations: [],
		warnings: [],
		stats: {
			totalHeroes: 0, totalPower: 0, averagePower: 0,
			maxPower: 0, minPower: 0, uniqueVariations: 0,
			powerLevelCounts: {}, weaponCounts: {}, parallelCounts: {},
			madnessUnlockedInserts: [], madnessTotalApexAllowed: 0, dbsTotal: null
		}
	});

	// Debounced server-side validation — fires when deck contents or format change
	let _validateTimer: ReturnType<typeof setTimeout> | null = null;

	// Reactive trigger: recompute when inputs change
	$effect(() => {
		// Touch reactive dependencies so Svelte tracks them
		const _heroes = heroCards;
		const _plays = playEntries;
		const _format = selectedFormatId;

		// Debounce to avoid spamming the server on rapid card additions
		if (_validateTimer) clearTimeout(_validateTimer);
		_validateTimer = setTimeout(() => {
			validateOnServer();
		}, 300);
	});

	let validating = $state(false);

	async function validateOnServer() {
		validating = true;
		const cards = heroCards
			.map(item => item.card)
			.filter((c): c is Card => c !== null && c !== undefined);

		const sortedCards = [...cards].sort((a, b) => (a.power || 0) - (b.power || 0));

		const playCards = playEntries.map(p => ({
			id: `play-${p.cardNumber}`,
			name: p.name,
			hero_name: null,
			athlete_name: null,
			set_code: p.setCode,
			card_number: p.cardNumber,
			parallel: null,
			power: null,
			rarity: null,
			weapon_type: null,
			battle_zone: null,
			image_url: null,
			created_at: ''
		} satisfies Card));

		// Try server-side validation first
		if (navigator.onLine) {
			try {
				const res = await fetch('/api/deck/validate', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						heroCards: sortedCards,
						formatId: selectedFormatId,
						playCards,
						hotDogCards: []
					})
				});

				if (res.ok) {
					validationResult = await res.json();
					validating = false;
					return;
				}
			} catch (err) {
				console.warn('[deck] Server validation failed, trying local fallback:', err);
			}
		}

		// Offline fallback: dynamically import the validator
		try {
			const { validateDeck } = await import('$lib/services/deck-validator');
			validationResult = validateDeck(sortedCards, selectedFormatId, playCards, []);
		} catch (err) {
			console.warn('[deck] Local validation also failed:', err);
		}
		validating = false;
	}

	// ── Derived: filtered play cards ───────────────────────
	const allPlayCards = $derived.by(() => {
		const cards: PlayCardData[] = [];
		for (const [setCode, setCards] of Object.entries(data.playCardsBySet)) {
			for (const card of setCards) {
				cards.push({ ...card, release: setCode });
			}
		}
		return cards;
	});

	const filteredPlayCards = $derived.by(() => {
		let cards = allPlayCards;
		if (selectedPlaySet !== 'all') {
			cards = cards.filter(c => c.release === selectedPlaySet);
		}
		if (playSearch) {
			const q = playSearch.toLowerCase();
			cards = cards.filter(c =>
				c.name.toLowerCase().includes(q) ||
				c.card_number.toLowerCase().includes(q)
			);
		}
		if (showAffordableOnly) {
			const remaining = 1000 - totalDbs;
			cards = cards.filter(c => c.dbs <= remaining);
		}
		// Exclude already-added plays
		const addedKeys = new Set(playEntries.map(p => `${p.setCode}:${p.cardNumber}`));
		cards = cards.filter(c => !addedKeys.has(`${c.release}:${c.card_number}`));
		return cards;
	});

	// ── Filtered heroes from collection ────────────────────
	const filteredCollectionHeroes = $derived.by(() => {
		const items = $collectionItems;
		if (!heroSearch) return items;
		const q = heroSearch.toLowerCase();
		return items.filter(item =>
			(item.card?.name || '').toLowerCase().includes(q) ||
			(item.card?.hero_name || '').toLowerCase().includes(q) ||
			(item.card?.card_number || '').toLowerCase().includes(q)
		);
	});

	onMount(() => {
		loadCollection();
		loadDeckFromStorage();
	});

	// Resolve pending hero card IDs when collection finishes loading
	$effect(() => {
		if (!_pendingHeroIds) return;
		const items = $collectionItems;
		if (items.length === 0) return;
		const idSet = new Set(_pendingHeroIds);
		heroCards = items.filter(item => idSet.has(item.id));
		_pendingHeroIds = null;
	});

	// ── Hero deck operations ───────────────────────────────
	function addHeroToDeck(item: CollectionItem) {
		if (heroCards.length >= 70) return;
		if (heroCards.some(d => d.id === item.id)) return;
		heroCards = [...heroCards, item];
		saveDeckToStorage();
	}

	function removeHero(itemId: string) {
		heroCards = heroCards.filter(d => d.id !== itemId);
		saveDeckToStorage();
	}

	// ── Play deck operations ───────────────────────────────
	function addPlay(card: PlayCardData) {
		const key = `${card.release}:${card.card_number}`;
		if (playEntries.some(p => `${p.setCode}:${p.cardNumber}` === key)) return;
		if (playEntries.length >= 55) return; // 30 + 25 bonus max
		playEntries = [...playEntries, {
			cardNumber: card.card_number,
			setCode: card.release,
			name: card.name,
			dbs: card.dbs
		}];
		saveDeckToStorage();
	}

	function removePlay(index: number) {
		playEntries = playEntries.filter((_, i) => i !== index);
		saveDeckToStorage();
	}

	// ── DBS badge color ────────────────────────────────────
	function dbsBadgeColor(dbs: number): string {
		if (dbs <= 20) return '#22C55E';
		if (dbs <= 40) return '#F59E0B';
		if (dbs <= 60) return '#F97316';
		return '#EF4444';
	}

	// ── Persistence (localStorage) ─────────────────────────
	function saveDeckToStorage() {
		try {
			const deck = {
				name: deckName,
				formatId: selectedFormatId,
				heroCardIds: heroCards.map(h => h.id),
				playEntries,
				hotDogCount
			};
			localStorage.setItem('boba-deck-draft', JSON.stringify(deck));
		} catch { /* ignore */ }
	}

	function loadDeckFromStorage() {
		try {
			const raw = localStorage.getItem('boba-deck-draft');
			if (!raw) return;
			const deck = JSON.parse(raw);
			deckName = deck.name || 'My Deck';
			selectedFormatId = deck.formatId || 'spec_playmaker';
			hotDogCount = deck.hotDogCount ?? 10;
			playEntries = deck.playEntries || [];
			// Hero cards will be resolved reactively when collection loads
			if (deck.heroCardIds?.length) {
				_pendingHeroIds = deck.heroCardIds as string[];
				const items = $collectionItems;
				if (items.length > 0) {
					const idSet = new Set(_pendingHeroIds);
					heroCards = items.filter(item => idSet.has(item.id));
					_pendingHeroIds = null;
				}
			}
		} catch { /* ignore */ }
	}

	function clearDeck() {
		heroCards = [];
		playEntries = [];
		hotDogCount = 10;
		localStorage.removeItem('boba-deck-draft');
	}
</script>

<svelte:head>
	<title>{deckName} | Deck Builder | BOBA Scanner</title>
</svelte:head>

<div class="deck-page">
	<!-- Header -->
	<div class="deck-header">
		<input
			type="text"
			bind:value={deckName}
			class="deck-name-input"
			placeholder="Deck name..."
			oninput={saveDeckToStorage}
		/>
		<div class="header-actions">
			<select bind:value={selectedFormatId} class="format-select" onchange={saveDeckToStorage}>
				{#each data.formats as fmt}
					<option value={fmt.id}>{fmt.name}</option>
				{/each}
			</select>
			<button class="clear-btn" onclick={clearDeck}>Clear</button>
		</div>
	</div>

	<!-- Tab navigation (mobile) -->
	<div class="tab-nav">
		<button class="tab-btn" class:active={activeTab === 'heroes'} onclick={() => activeTab = 'heroes'}>
			Heroes ({heroCards.length})
		</button>
		<button class="tab-btn" class:active={activeTab === 'plays'} onclick={() => activeTab = 'plays'}>
			Plays ({playEntries.length})
		</button>
		<button class="tab-btn" class:active={activeTab === 'stats'} onclick={() => activeTab = 'stats'}>
			Stats
		</button>
	</div>

	<div class="deck-layout">
		<!-- Hero Deck Panel -->
		<div class="panel" class:panel-hidden={activeTab !== 'heroes'}>
			<h2>Hero Deck <span class="panel-count">{heroCards.length}/60{heroCards.length > 60 ? '+' : ''}</span></h2>

			<!-- Hero search -->
			<input
				type="text"
				bind:value={heroSearch}
				class="search-input"
				placeholder="Search collection..."
			/>

			<!-- Current heroes in deck -->
			<div class="card-list">
				{#each heroCards as item, i (item.id)}
					<div class="deck-card" class:deck-card-over={i >= 60}>
						<span class="deck-card-name">{item.card?.hero_name || item.card?.name}</span>
						<span class="deck-card-number">{item.card?.card_number}</span>
						{#if item.card?.power}
							<span class="deck-card-power">PWR {item.card.power}</span>
						{/if}
						{#if item.card?.weapon_type}
							<span class="deck-card-weapon">{item.card.weapon_type}</span>
						{/if}
						<button class="remove-btn" onclick={() => removeHero(item.id)}>x</button>
					</div>
				{:else}
					<p class="empty-msg">Add heroes from your collection below</p>
				{/each}
			</div>

			<!-- Available heroes -->
			<h3 class="sub-heading">Collection</h3>
			<div class="card-list available-list">
				{#each filteredCollectionHeroes as item (item.id)}
					{@const inDeck = heroCards.some(d => d.id === item.id)}
					<button
						class="available-card"
						class:in-deck={inDeck}
						onclick={() => addHeroToDeck(item)}
						disabled={inDeck || heroCards.length >= 70}
					>
						<span class="avail-name">{item.card?.hero_name || item.card?.name}</span>
						<span class="avail-number">{item.card?.card_number}</span>
						{#if item.card?.power}
							<span class="avail-power">PWR {item.card.power}</span>
						{/if}
					</button>
				{:else}
					<p class="empty-msg">No cards in collection</p>
				{/each}
			</div>
		</div>

		<!-- Playbook Panel -->
		<div class="panel" class:panel-hidden={activeTab !== 'plays'}>
			<h2>Playbook <span class="panel-count">{playEntries.length}/30{playEntries.length > 30 ? ' (+bonus)' : ''}</span></h2>

			<!-- DBS Budget Bar -->
			<div class="dbs-bar" role="progressbar" aria-valuenow={totalDbs} aria-valuemax={1000}>
				<div class="dbs-bar-label">DBS: {totalDbs} / 1,000</div>
				<div class="dbs-bar-track">
					<div class="dbs-bar-fill" style:width="{dbsBudgetPercent}%" style:background={dbsBudgetColor}></div>
				</div>
				{#if totalDbs > 1000}
					<div class="dbs-bar-over">Over budget by {totalDbs - 1000}</div>
				{/if}
			</div>

			<!-- Current plays -->
			<div class="card-list">
				{#each playEntries as play, i}
					<div class="deck-card play-card">
						<span class="play-name">{play.name}</span>
						<span class="play-number">{play.cardNumber}</span>
						<span class="dbs-badge" style:background={dbsBadgeColor(play.dbs)}>{play.dbs}</span>
						<button class="remove-btn" onclick={() => removePlay(i)}>x</button>
					</div>
				{:else}
					<p class="empty-msg">Add plays from the catalog below</p>
				{/each}
			</div>

			<!-- Play search & filters -->
			<h3 class="sub-heading">Play Catalog</h3>
			<div class="play-filters">
				<input
					type="text"
					bind:value={playSearch}
					class="search-input"
					placeholder="Search plays..."
				/>
				<select bind:value={selectedPlaySet} class="set-filter">
					<option value="all">All Sets</option>
					{#each Object.keys(data.playCardsBySet) as setCode}
						<option value={setCode}>{setCode}</option>
					{/each}
				</select>
				<button
					class="affordable-toggle"
					class:active={showAffordableOnly}
					onclick={() => showAffordableOnly = !showAffordableOnly}
				>
					Affordable ({1000 - totalDbs} left)
				</button>
			</div>

			<div class="card-list available-list">
				{#each filteredPlayCards as card}
					<button class="available-card play-available" onclick={() => addPlay(card)}>
						<span class="avail-name">{card.name}</span>
						<span class="avail-number">{card.card_number}</span>
						<span class="dbs-badge" style:background={dbsBadgeColor(card.dbs)}>{card.dbs}</span>
					</button>
				{:else}
					<p class="empty-msg">{showAffordableOnly ? 'No affordable plays remaining' : 'No plays match your search'}</p>
				{/each}
			</div>
		</div>

		<!-- Stats & Validation Panel -->
		<div class="panel" class:panel-hidden={activeTab !== 'stats'}>
			<h2>Deck Stats</h2>

			<!-- Validation status -->
			<div class="validation-section">
				{#if validating}
					<div class="validation-header" style="background: rgba(59,130,246,0.1); color: #3b82f6; border: 1px solid rgba(59,130,246,0.2);">
						Validating...
					</div>
				{:else}
				<div class="validation-header" class:valid={validationResult.isValid} class:invalid={!validationResult.isValid}>
					{validationResult.isValid ? 'Deck is Valid' : `${validationResult.violations.filter(v => v.severity === 'error').length} Violation(s)`}
				</div>
				{/if}

				{#each validationResult.violations as violation}
					<div class="violation" class:violation-error={violation.severity === 'error'} class:violation-warning={violation.severity === 'warning'}>
						<span class="violation-icon">{violation.severity === 'error' ? 'x' : '!'}</span>
						<span>{violation.message}</span>
					</div>
				{/each}

				{#each validationResult.warnings as warning}
					<div class="violation violation-warning">
						<span class="violation-icon">!</span>
						<span>{warning}</span>
					</div>
				{/each}
			</div>

			<!-- Stats -->
			<div class="stats-grid">
				<div class="stat-card">
					<div class="stat-value">{heroCards.length}</div>
					<div class="stat-label">Heroes</div>
				</div>
				<div class="stat-card">
					<div class="stat-value">{totalPower.toLocaleString()}</div>
					<div class="stat-label">Total Power</div>
				</div>
				<div class="stat-card">
					<div class="stat-value">{heroCards.length > 0 ? Math.round(totalPower / heroCards.length) : 0}</div>
					<div class="stat-label">Avg Power</div>
				</div>
				<div class="stat-card">
					<div class="stat-value">{playEntries.length}</div>
					<div class="stat-label">Plays</div>
				</div>
				<div class="stat-card">
					<div class="stat-value">{totalDbs}</div>
					<div class="stat-label">DBS Total</div>
				</div>
				<div class="stat-card">
					<div class="stat-value">{hotDogCount}</div>
					<div class="stat-label">Hot Dogs</div>
				</div>
			</div>

			<!-- Weapon distribution -->
			{#if Object.keys(weaponCounts).length > 0}
				<h3 class="sub-heading">Weapon Distribution</h3>
				<div class="distribution-list">
					{#each Object.entries(weaponCounts).sort((a, b) => b[1] - a[1]) as [weapon, count]}
						<div class="dist-item">
							<span class="dist-label">{weapon}</span>
							<div class="dist-bar-track">
								<div class="dist-bar-fill" style:width="{(count / heroCards.length) * 100}%"></div>
							</div>
							<span class="dist-count">{count}</span>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Power curve -->
			{#if Object.keys(powerLevelCounts).length > 0}
				<h3 class="sub-heading">Power Curve</h3>
				<div class="distribution-list">
					{#each Object.entries(powerLevelCounts).sort((a, b) => Number(a[0]) - Number(b[0])) as [power, count]}
						<div class="dist-item">
							<span class="dist-label">{power}</span>
							<div class="dist-bar-track">
								<div class="dist-bar-fill" style:width="{(count / Math.max(...Object.values(powerLevelCounts))) * 100}%"></div>
							</div>
							<span class="dist-count">{count}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	{#if savedMessage}
		<div class="save-toast">{savedMessage}</div>
	{/if}
</div>

<style>
	.deck-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1rem;
	}

	.deck-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.deck-name-input {
		font-family: 'Syne', sans-serif;
		font-size: 1.25rem;
		font-weight: 700;
		background: transparent;
		border: none;
		color: var(--text-primary, #f1f5f9);
		padding: 0.25rem 0;
		border-bottom: 2px solid transparent;
		min-width: 0;
		flex: 1;
	}

	.deck-name-input:focus {
		outline: none;
		border-bottom-color: var(--accent-primary, #3b82f6);
	}

	.header-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.format-select {
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #f1f5f9);
		font-size: 0.85rem;
	}

	.clear-btn {
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--border-color, #1e293b);
		background: transparent;
		color: var(--text-secondary, #94a3b8);
		font-size: 0.85rem;
		cursor: pointer;
	}

	.clear-btn:hover { border-color: var(--color-error, #ef4444); color: var(--color-error, #ef4444); }

	/* Tab navigation */
	.tab-nav {
		display: flex;
		gap: 0;
		margin-bottom: 1rem;
		border-bottom: 1px solid var(--border-color, #1e293b);
	}

	.tab-btn {
		flex: 1;
		padding: 0.625rem 0.5rem;
		border: none;
		background: transparent;
		color: var(--text-secondary, #94a3b8);
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		transition: color 0.15s, border-color 0.15s;
	}

	.tab-btn.active {
		color: var(--text-primary, #f1f5f9);
		border-bottom-color: var(--accent-primary, #3b82f6);
	}

	/* Layout */
	.deck-layout {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.5rem;
	}

	.panel { display: block; }
	.panel-hidden { display: none; }

	@media (min-width: 768px) {
		.tab-nav { display: none; }
		.deck-layout { grid-template-columns: 1fr 1fr 1fr; }
		.panel { display: block !important; }
		.panel-hidden { display: block !important; }
	}

	.panel h2 {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 0.75rem;
		color: var(--text-secondary, #94a3b8);
	}

	.panel-count {
		color: var(--text-tertiary, #64748b);
		font-weight: 400;
	}

	.sub-heading {
		font-size: 0.85rem;
		font-weight: 600;
		margin: 1rem 0 0.5rem;
		color: var(--text-secondary, #94a3b8);
	}

	/* Search */
	.search-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #f1f5f9);
		font-size: 0.85rem;
		margin-bottom: 0.75rem;
	}

	.search-input:focus { outline: none; border-color: var(--accent-primary, #3b82f6); }

	/* Card lists */
	.card-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		max-height: 300px;
		overflow-y: auto;
	}

	.available-list { max-height: 250px; }

	.deck-card {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		border-radius: 6px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		font-size: 0.85rem;
	}

	.deck-card-over {
		border-color: rgba(168, 85, 247, 0.3);
		background: rgba(168, 85, 247, 0.05);
	}

	.deck-card-name, .play-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.deck-card-number, .play-number { color: var(--text-tertiary, #64748b); font-size: 0.75rem; }
	.deck-card-power { color: var(--accent-gold, #f59e0b); font-weight: 600; font-size: 0.8rem; }
	.deck-card-weapon { color: var(--text-secondary, #94a3b8); font-size: 0.75rem; }

	.remove-btn {
		background: none;
		border: none;
		color: var(--text-secondary, #94a3b8);
		cursor: pointer;
		padding: 0.125rem 0.375rem;
		font-size: 0.8rem;
		border-radius: 4px;
		flex-shrink: 0;
	}

	.remove-btn:hover { color: var(--color-error, #ef4444); background: rgba(239, 68, 68, 0.1); }

	.available-card {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		border-radius: 6px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #f1f5f9);
		cursor: pointer;
		font-size: 0.85rem;
		text-align: left;
		width: 100%;
	}

	.available-card:hover:not(:disabled) { border-color: var(--accent-primary, #3b82f6); }
	.available-card.in-deck { opacity: 0.35; }
	.available-card:disabled { cursor: not-allowed; }

	.avail-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.avail-number { color: var(--text-tertiary, #64748b); font-size: 0.75rem; }
	.avail-power { color: var(--accent-gold, #f59e0b); font-size: 0.8rem; font-weight: 600; flex-shrink: 0; }

	.empty-msg {
		text-align: center;
		color: var(--text-secondary, #94a3b8);
		padding: 1.5rem;
		font-size: 0.85rem;
	}

	/* DBS Budget Bar */
	.dbs-bar {
		margin-bottom: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
	}

	.dbs-bar-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-primary, #f1f5f9);
		margin-bottom: 0.375rem;
	}

	.dbs-bar-track {
		height: 6px;
		border-radius: 3px;
		background: var(--bg-elevated, #1e293b);
		overflow: hidden;
	}

	.dbs-bar-fill {
		height: 100%;
		border-radius: 3px;
		transition: width 0.3s ease, background 0.3s ease;
	}

	.dbs-bar-over {
		font-size: 0.75rem;
		color: var(--color-error, #ef4444);
		font-weight: 600;
		margin-top: 0.25rem;
	}

	/* DBS Badge */
	.dbs-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 28px;
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 700;
		color: white;
		flex-shrink: 0;
	}

	/* Play filters */
	.play-filters {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}

	.play-filters .search-input { flex: 1; min-width: 120px; margin-bottom: 0; }

	.set-filter {
		padding: 0.375rem 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #f1f5f9);
		font-size: 0.8rem;
	}

	.affordable-toggle {
		padding: 0.375rem 0.625rem;
		border-radius: 6px;
		border: 1px solid var(--border-color, #1e293b);
		background: transparent;
		color: var(--text-secondary, #94a3b8);
		font-size: 0.8rem;
		cursor: pointer;
		white-space: nowrap;
	}

	.affordable-toggle.active {
		background: rgba(34, 197, 94, 0.1);
		border-color: rgba(34, 197, 94, 0.3);
		color: #22C55E;
	}

	/* Validation */
	.validation-section { margin-bottom: 1rem; }

	.validation-header {
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		font-size: 0.85rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}

	.validation-header.valid {
		background: rgba(34, 197, 94, 0.1);
		color: #22C55E;
		border: 1px solid rgba(34, 197, 94, 0.2);
	}

	.validation-header.invalid {
		background: rgba(239, 68, 68, 0.1);
		color: #EF4444;
		border: 1px solid rgba(239, 68, 68, 0.2);
	}

	.violation {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		border-radius: 4px;
		font-size: 0.8rem;
		margin-bottom: 0.25rem;
	}

	.violation-error { background: rgba(239, 68, 68, 0.05); color: #fca5a5; }
	.violation-warning { background: rgba(245, 158, 11, 0.05); color: #fcd34d; }

	.violation-icon { font-weight: 700; flex-shrink: 0; }
	.violation-error .violation-icon { color: #EF4444; }
	.violation-warning .violation-icon { color: #F59E0B; }

	/* Stats grid */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.stat-card {
		padding: 0.625rem;
		border-radius: 8px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		text-align: center;
	}

	.stat-value { font-size: 1.1rem; font-weight: 700; color: var(--text-primary, #f1f5f9); }
	.stat-label { font-size: 0.7rem; color: var(--text-secondary, #94a3b8); margin-top: 0.125rem; }

	/* Distribution bars */
	.distribution-list { display: flex; flex-direction: column; gap: 0.375rem; }

	.dist-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
	}

	.dist-label { width: 60px; color: var(--text-secondary, #94a3b8); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }

	.dist-bar-track {
		flex: 1;
		height: 8px;
		border-radius: 4px;
		background: var(--bg-elevated, #1e293b);
		overflow: hidden;
	}

	.dist-bar-fill {
		height: 100%;
		border-radius: 4px;
		background: var(--accent-primary, #3b82f6);
		transition: width 0.3s ease;
	}

	.dist-count { width: 24px; text-align: right; color: var(--text-tertiary, #64748b); font-size: 0.75rem; }

	/* Save toast */
	.save-toast {
		position: fixed;
		bottom: 5rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.5rem 1rem;
		border-radius: 8px;
		background: rgba(34, 197, 94, 0.15);
		border: 1px solid rgba(34, 197, 94, 0.3);
		color: #22C55E;
		font-size: 0.85rem;
		z-index: 100;
	}
</style>
