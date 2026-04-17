<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { collectionItems, loadCollection } from '$lib/stores/collection.svelte';
	import { isAuthenticated } from '$lib/stores/auth.svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import { analyzeDeckGaps, selectCardsForPriceRefresh, type GapAnalysis, type GapCandidate } from '$lib/services/deck-gap-finder';
	import { fetchDeck, fetchUserDecks, type UserDeck } from '$lib/services/deck-service';
	import { loadCardDatabase, getCardById } from '$lib/services/card-db';
	import { getFormatOptions } from '$lib/data/tournament-formats';
	import { getAllWeaponKeys } from '$lib/data/boba-weapons';
	import type { Card, CollectionItem } from '$lib/types';
	import BoBAOnlyBanner from '$lib/components/BoBAOnlyBanner.svelte';

	const formats = getFormatOptions();
	const weaponKeys = getAllWeaponKeys();

	// ── State ───────────────────────────────────────────────
	let availableDecks = $state<UserDeck[]>([]);
	let selectedDeckId = $state<string | null>($page.url.searchParams.get('deck') || null);
	let selectedFormatId = $derived(
		availableDecks.find(d => d.id === selectedDeckId)?.format_id || 'spec_playmaker'
	);
	let gapAnalysis = $state<GapAnalysis | null>(null);
	let loading = $state(true);
	let refreshing = $state(false);
	let refreshesRemaining = $state<number | null>(null);
	let refreshLimit = $state<number | null>(null);

	// Filters
	let filterPower = $state<number | null>(null);
	let filterWeapon = $state<string | null>(null);
	let sortMode = $state<'cheapest' | 'common' | 'power'>('cheapest');
	let displayLimit = $state(50);

	// Load deck hero cards from Supabase via deck service
	async function loadDeckHeroes(): Promise<Card[]> {
		if (!selectedDeckId) return [];
		const deck = await fetchDeck(selectedDeckId);
		if (!deck || !deck.hero_card_ids?.length) return [];

		await loadCardDatabase();
		return deck.hero_card_ids
			.map((id: string) => getCardById(id))
			.filter((c): c is Card => c !== undefined && c !== null);
	}

	async function computeGaps() {
		loading = true;
		const heroes = await loadDeckHeroes();
		if (heroes.length === 0) {
			gapAnalysis = null;
			loading = false;
			return;
		}

		const ownedIds = new Set<string>();
		for (const item of collectionItems()) {
			ownedIds.add(item.card_id);
		}

		const priceCache = new Map<string, { price_mid: number | null; fetched_at: string | null }>();
		gapAnalysis = analyzeDeckGaps(heroes, selectedFormatId, ownedIds, priceCache);
		loading = false;
	}

	// Recompute when deck or collection changes
	$effect(() => {
		const _deck = selectedDeckId;
		const _items = collectionItems();
		if (_items.length > 0 && _deck) {
			computeGaps();
		}
	});

	onMount(async () => {
		availableDecks = await fetchUserDecks();
		if (!selectedDeckId && availableDecks.length > 0) {
			selectedDeckId = availableDecks[0].id;
		}
		await loadCollection();
	});

	function formatName(formatId: string): string {
		const fmt = formats.find(f => f.id === formatId);
		return fmt?.name || formatId;
	}

	// ── Filtered & sorted candidates ────────────────────────
	const filteredCandidates = $derived.by(() => {
		if (!gapAnalysis) return [];
		let list = gapAnalysis.candidates;

		if (filterPower !== null) {
			list = list.filter(c => c.powerLevel === filterPower);
		}
		if (filterWeapon) {
			list = list.filter(c => (c.card.weapon_type || '').toLowerCase() === filterWeapon!.toLowerCase());
		}

		// Sort
		if (sortMode === 'common') {
			list = [...list].sort((a, b) => a.commonalityScore - b.commonalityScore);
		} else if (sortMode === 'power') {
			list = [...list].sort((a, b) => (a.card.power || 0) - (b.card.power || 0));
		}
		// 'cheapest' is the default sort from analyzeDeckGaps

		return list;
	});

	// ── Power levels with gaps (for filter bar) ─────────────
	const gapPowerLevels = $derived(
		(gapAnalysis?.gaps || []).map(g => ({ power: g.powerLevel, slots: g.slotsAvailable }))
	);

	async function handleRefreshPrices() {
		if (!gapAnalysis || refreshing) return;

		const toRefresh = selectCardsForPriceRefresh(filteredCandidates, 10);
		if (toRefresh.length === 0) return;

		refreshing = true;
		try {
			const res = await fetch('/api/deck/refresh-prices', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ card_ids: toRefresh.map(c => c.card.id) })
			});

			if (res.ok) {
				const data = await res.json();
				refreshesRemaining = data.refreshes_remaining;
				refreshLimit = data.limit;

				for (const result of data.results || []) {
					const candidate = gapAnalysis.candidates.find(c => c.card.id === result.card_id);
					if (candidate) {
						candidate.priceMid = result.price_mid;
						candidate.priceSearched = true;
						candidate.priceLastUpdated = new Date().toISOString();
					}
				}
				gapAnalysis.candidates.sort((a, b) => {
					if (a.priceMid !== null && b.priceMid !== null) return a.priceMid - b.priceMid;
					if (a.priceMid !== null) return -1;
					if (b.priceMid !== null) return 1;
					if (!a.priceSearched && b.priceSearched) return -1;
					if (a.priceSearched && !b.priceSearched) return 1;
					return a.commonalityScore - b.commonalityScore;
				});
				gapAnalysis = gapAnalysis;
			} else if (res.status === 429) {
				const data = await res.json();
				refreshesRemaining = 0;
				refreshLimit = data.limit;
				showToast(data.is_pro
					? 'Daily refresh limit reached — resets at midnight UTC'
					: 'Daily refresh limit reached — Go Pro for more refreshes', 'info');
			}
		} catch (err) {
			console.warn('[deck-shop] Price refresh failed:', err);
		}
		refreshing = false;
	}
</script>

<svelte:head>
	<title>Deck Shop — Card Scanner</title>
</svelte:head>

<div class="shop-page">
	<BoBAOnlyBanner message="Deck Shop is currently BoBA-only. Wonders support coming soon." />
	<header class="shop-header">
		<h1>Deck Shop</h1>
		<p class="shop-subtitle">Find cards to fill your deck gaps — sorted by cheapest first</p>
	</header>

	{#if !isAuthenticated}
		<div class="shop-auth-prompt">
			<p>Sign in to see personalized card recommendations based on your collection and deck.</p>
			<a href="/auth/login?redirectTo=/deck/shop" class="btn-primary">Sign In</a>
		</div>
	{:else if loading && availableDecks.length === 0}
		<div class="shop-loading">Loading decks and collection...</div>
	{:else if availableDecks.length === 0}
		<div class="shop-empty">
			<p>Create a deck first to see gap analysis.</p>
			<a href="/deck" class="btn-primary">Create Deck</a>
		</div>
	{:else if !gapAnalysis && !loading}
		<div class="shop-empty">
			<p>Select a deck with hero cards to see gap analysis.</p>
		</div>
	{:else if loading}
		<div class="shop-loading">Analyzing deck gaps...</div>
	{:else if gapAnalysis}
		<!-- Controls bar -->
		<div class="controls-bar">
			<select bind:value={selectedDeckId} class="format-select" onchange={() => computeGaps()}>
				{#each availableDecks as deck}
					<option value={deck.id}>{deck.name} ({formatName(deck.format_id)})</option>
				{/each}
			</select>

			<select bind:value={filterWeapon} class="filter-select">
				<option value={null}>All Weapons</option>
				{#each weaponKeys as wk}
					<option value={wk}>{wk}</option>
				{/each}
			</select>

			<select bind:value={sortMode} class="filter-select">
				<option value="cheapest">Cheapest First</option>
				<option value="common">Most Common</option>
				<option value="power">By Power</option>
			</select>
		</div>

		<!-- Gap summary -->
		<div class="gap-summary">
			<div class="gap-stat">
				<span class="gap-stat-value">{gapAnalysis.cardsNeeded}</span>
				<span class="gap-stat-label">Cards Needed</span>
			</div>
			<div class="gap-stat">
				<span class="gap-stat-value">{gapAnalysis.gaps.length}</span>
				<span class="gap-stat-label">Open Power Levels</span>
			</div>
			<div class="gap-stat">
				<span class="gap-stat-value">{gapAnalysis.totalCandidates.toLocaleString()}</span>
				<span class="gap-stat-label">Available Cards</span>
			</div>
		</div>

		<!-- Power level filter chips -->
		{#if gapPowerLevels.length > 0}
			<div class="power-chips">
				<button class="power-chip" class:active={filterPower === null} onclick={() => filterPower = null}>
					All
				</button>
				{#each gapPowerLevels as gap}
					<button
						class="power-chip"
						class:active={filterPower === gap.power}
						onclick={() => filterPower = filterPower === gap.power ? null : gap.power}
					>
						{gap.power} <span class="chip-count">({gap.slots})</span>
					</button>
				{/each}
			</div>
		{/if}

		<!-- Price refresh button -->
		<div class="refresh-bar">
			<button
				class="btn-refresh"
				onclick={handleRefreshPrices}
				disabled={refreshing || refreshesRemaining === 0}
			>
				{refreshing ? 'Refreshing...' : 'Update 10 Prices'}
			</button>
			{#if refreshesRemaining !== null}
				<span class="refresh-budget">{refreshesRemaining}/{refreshLimit} refreshes today</span>
			{/if}
		</div>

		<!-- Candidate list -->
		<div class="candidate-list">
			{#each filteredCandidates.slice(0, displayLimit) as candidate (candidate.card.id)}
				<a href={candidate.ebayUrl} target="_blank" rel="noopener noreferrer" class="candidate-card">
					<div class="cc-power">
						<span class="power-badge" style="background: var(--weapon-{candidate.card.weapon_type?.toLowerCase() || 'steel'})">{candidate.card.power}</span>
					</div>
					<div class="cc-info">
						<div class="cc-name">{candidate.card.hero_name || candidate.card.name}</div>
						<div class="cc-meta">
							{candidate.card.card_number}
							{#if candidate.card.parallel && candidate.card.parallel !== 'Paper'}
								· {candidate.card.parallel}
							{/if}
							· {candidate.card.weapon_type}
						</div>
					</div>
					<div class="cc-price">
						{#if candidate.priceMid !== null}
							<span class="price-value">${candidate.priceMid.toFixed(2)}</span>
							{#if candidate.priceLastUpdated}
								<span class="price-date">{new Date(candidate.priceLastUpdated).toLocaleDateString()}</span>
							{/if}
						{:else if candidate.priceSearched}
							<span class="price-none">No listings</span>
						{:else}
							<span class="price-unknown">—</span>
						{/if}
					</div>
				</a>
			{/each}
		</div>

		{#if filteredCandidates.length > displayLimit}
			<button class="load-more-btn" onclick={() => displayLimit += 50}>
				Show more ({filteredCandidates.length - displayLimit} remaining)
			</button>
		{/if}
	{/if}
</div>

<style>
	.shop-page { max-width: 800px; margin: 0 auto; padding: 1rem; }
	.shop-header { margin-bottom: 1.25rem; }
	.shop-header h1 { font-size: 1.5rem; font-weight: 700; }
	.shop-subtitle { font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem; }

	.shop-auth-prompt, .shop-loading, .shop-empty {
		text-align: center; padding: 3rem 1rem; color: var(--text-secondary);
	}
	.shop-empty a { color: var(--accent-primary); text-decoration: underline; }

	.controls-bar {
		display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap;
	}
	.format-select, .filter-select {
		padding: 0.5rem 0.75rem; border-radius: 8px;
		border: 1px solid var(--border-color); background: var(--bg-surface);
		color: var(--text-primary); font-size: 0.85rem;
	}

	.gap-summary {
		display: flex; gap: 1rem; justify-content: center; margin-bottom: 1rem;
	}
	.gap-stat { text-align: center; }
	.gap-stat-value { display: block; font-size: 1.3rem; font-weight: 700; color: var(--accent-gold, #f59e0b); }
	.gap-stat-label { font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }

	.power-chips {
		display: flex; gap: 0.375rem; flex-wrap: wrap; margin-bottom: 1rem;
		overflow-x: auto; padding-bottom: 0.25rem;
	}
	.power-chip {
		padding: 0.3rem 0.75rem; border-radius: 16px; border: 1px solid var(--border-color);
		background: transparent; color: var(--text-secondary); font-size: 0.8rem;
		cursor: pointer; white-space: nowrap;
	}
	.power-chip.active {
		background: rgba(59, 130, 246, 0.15); border-color: rgba(59, 130, 246, 0.4);
		color: var(--accent-primary); font-weight: 600;
	}
	.chip-count { font-size: 0.7rem; color: var(--text-tertiary); }

	.refresh-bar {
		display: flex; align-items: center; gap: 1rem;
		margin-bottom: 1rem; padding: 0.75rem;
		background: var(--bg-elevated); border-radius: 10px;
	}
	.btn-refresh {
		padding: 0.5rem 1rem; border-radius: 8px; border: none;
		background: var(--accent-primary); color: white;
		font-size: 0.85rem; font-weight: 600; cursor: pointer;
	}
	.btn-refresh:disabled { opacity: 0.5; cursor: not-allowed; }
	.refresh-budget { font-size: 0.8rem; color: var(--text-secondary); }

	.candidate-list { display: flex; flex-direction: column; gap: 2px; }
	.candidate-card {
		display: grid; grid-template-columns: 50px 1fr 70px;
		align-items: center; gap: 0.5rem;
		padding: 0.6rem 0.5rem; border-radius: 8px;
		background: var(--bg-elevated); text-decoration: none; color: inherit;
	}
	.candidate-card:hover { background: var(--bg-hover); }
	.cc-power { text-align: center; }
	.power-badge {
		display: inline-block; padding: 2px 8px; border-radius: 6px;
		font-size: 0.8rem; font-weight: 700; color: white;
	}
	.cc-info { overflow: hidden; }
	.cc-name { font-weight: 600; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.cc-meta { font-size: 0.75rem; color: var(--text-secondary); }
	.cc-price { text-align: right; }
	.price-value { display: block; font-weight: 700; color: var(--color-success, #22c55e); font-size: 0.9rem; }
	.price-date { display: block; font-size: 0.65rem; color: var(--text-tertiary); }
	.price-none { font-size: 0.8rem; color: var(--text-tertiary); }
	.price-unknown { font-size: 0.8rem; color: var(--text-tertiary); }

	.load-more-btn {
		display: block; width: 100%; padding: 0.75rem; margin-top: 0.5rem;
		border-radius: 8px; border: 1px solid var(--border-color);
		background: transparent; color: var(--accent-primary);
		font-size: 0.85rem; font-weight: 600; cursor: pointer;
		text-align: center;
	}
	.load-more-btn:hover { background: var(--bg-hover); }
	.btn-primary {
		display: inline-block; padding: 0.5rem 1rem; border-radius: 8px;
		background: var(--accent-primary); color: white;
		text-decoration: none; font-weight: 600; font-size: 0.9rem;
	}
</style>
