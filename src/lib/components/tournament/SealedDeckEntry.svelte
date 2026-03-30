<script lang="ts">
	import Scanner from '$components/Scanner.svelte';
	import { searchCards } from '$lib/services/card-db';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { Card, ScanResult } from '$lib/types';

	interface HeroCardEntry {
		card_id: string;
		card_number: string;
		hero_name: string;
		power: number;
		weapon_type: string;
		parallel: string;
		set_code: string;
	}

	interface PlayCardEntry {
		card_number: string;
		name: string;
		set_code: string;
		dbs_score: number;
	}

	let {
		heroCards = $bindable<HeroCardEntry[]>([]),
		playCards = $bindable<PlayCardEntry[]>([]),
		onProceed,
		onBack
	}: {
		heroCards: HeroCardEntry[];
		playCards: PlayCardEntry[];
		onProceed: () => void;
		onBack: () => void;
	} = $props();

	let scannerActive = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<Card[]>([]);
	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	const totalCards = $derived(heroCards.length + playCards.length);

	function addCard(card: Card) {
		if (card.power) {
			heroCards = [...heroCards, {
				card_id: card.id,
				card_number: card.card_number || '',
				hero_name: card.hero_name || card.name || '',
				power: card.power,
				weapon_type: card.weapon_type || '',
				parallel: card.parallel || 'base',
				set_code: card.set_code || ''
			}];
		} else {
			playCards = [...playCards, {
				card_number: card.card_number || '',
				name: card.hero_name || card.name || '',
				set_code: card.set_code || '',
				dbs_score: 0
			}];
		}
	}

	function removeHero(index: number) {
		heroCards = heroCards.filter((_, i) => i !== index);
	}

	function removePlay(index: number) {
		playCards = playCards.filter((_, i) => i !== index);
	}

	function handleScanResult(result: ScanResult) {
		if (result.card) {
			addCard(result.card);
			showToast(`Added: ${result.card.hero_name || result.card.name || result.card.card_number}`, 'check');
		}
	}

	function handleSearch() {
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		const q = searchQuery.trim();
		if (q.length < 2) {
			searchResults = [];
			return;
		}
		searchDebounceTimer = setTimeout(() => {
			searchResults = searchCards(q, 10);
		}, 300);
	}

	function selectSearchResult(card: Card) {
		addCard(card);
		showToast(`Added: ${card.hero_name || card.name || card.card_number}`, 'check');
		searchQuery = '';
		searchResults = [];
	}
</script>

<div class="sealed-entry">
	<div class="sealed-header">
		<h2>Scan Your Sealed Pool</h2>
		<span class="card-count-badge">{totalCards} cards</span>
	</div>

	<p class="sealed-desc">Open your sealed product and scan or look up each card below.</p>

	<!-- Scanner toggle -->
	<button
		class="scan-toggle-btn"
		class:active={scannerActive}
		onclick={() => (scannerActive = !scannerActive)}
	>
		{scannerActive ? 'Close Scanner' : 'Scan Cards'}
	</button>

	{#if scannerActive}
		<div class="scanner-embed">
			<Scanner
				onResult={handleScanResult}
				scanMode="batch"
				paused={false}
			/>
		</div>
	{/if}

	<!-- Manual card lookup -->
	<div class="search-section">
		<label for="card-search">Look Up Card</label>
		<input
			id="card-search"
			type="text"
			bind:value={searchQuery}
			oninput={handleSearch}
			placeholder="Search by card number or name"
			autocomplete="off"
		/>
		{#if searchResults.length > 0}
			<div class="search-results">
				{#each searchResults as card}
					<button class="search-result" onclick={() => selectSearchResult(card)}>
						<span class="sr-number">{card.card_number}</span>
						<span class="sr-name">{card.hero_name || card.name}</span>
						{#if card.power}
							<span class="sr-power">{card.power} PWR</span>
						{:else}
							<span class="sr-type">Play</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Card list -->
	{#if totalCards > 0}
		<div class="card-list-section">
			{#if heroCards.length > 0}
				<h3>Heroes ({heroCards.length})</h3>
				<div class="card-list">
					{#each heroCards as card, i}
						<div class="card-row">
							<span class="cr-number">{card.card_number}</span>
							<span class="cr-name">{card.hero_name}</span>
							<span class="cr-detail">{card.power} PWR / {card.weapon_type}</span>
							<button class="remove-btn" onclick={() => removeHero(i)} aria-label="Remove card">X</button>
						</div>
					{/each}
				</div>
			{/if}

			{#if playCards.length > 0}
				<h3>Plays ({playCards.length})</h3>
				<div class="card-list">
					{#each playCards as card, i}
						<div class="card-row">
							<span class="cr-number">{card.card_number}</span>
							<span class="cr-name">{card.name}</span>
							<span class="cr-detail">Play</span>
							<button class="remove-btn" onclick={() => removePlay(i)} aria-label="Remove card">X</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Navigation -->
	<div class="sealed-actions">
		<button class="secondary-btn" onclick={onBack}>Back</button>
		<button
			class="primary-btn"
			onclick={onProceed}
			disabled={totalCards === 0}
		>
			Review & Submit
		</button>
	</div>
</div>

<style>
	.sealed-entry {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1.25rem;
	}
	.sealed-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.25rem;
	}
	.sealed-header h2 {
		font-size: 1.1rem;
		font-weight: 700;
		margin: 0;
	}
	.card-count-badge {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 2px 10px;
		border-radius: 12px;
		background: var(--accent-primary);
		color: #fff;
	}
	.sealed-desc {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 1rem;
	}

	/* Scanner toggle */
	.scan-toggle-btn {
		width: 100%;
		padding: 0.75rem;
		border-radius: 10px;
		border: 2px solid var(--accent-primary);
		background: transparent;
		color: var(--accent-primary);
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		margin-bottom: 0.75rem;
	}
	.scan-toggle-btn.active {
		background: var(--accent-primary);
		color: #fff;
	}

	.scanner-embed {
		border-radius: 10px;
		overflow: hidden;
		margin-bottom: 1rem;
		max-height: 50vh;
	}

	/* Search */
	.search-section {
		margin-bottom: 1rem;
	}
	.search-section label {
		display: block;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 4px;
	}
	.search-section input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.9rem;
	}
	.search-results {
		border: 1px solid var(--border-color);
		border-top: none;
		border-radius: 0 0 8px 8px;
		max-height: 240px;
		overflow-y: auto;
		background: var(--bg-base);
	}
	.search-result {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border: none;
		border-bottom: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-primary);
		cursor: pointer;
		text-align: left;
		font-size: 0.85rem;
	}
	.search-result:last-child {
		border-bottom: none;
	}
	.search-result:hover {
		background: var(--bg-hover, rgba(255,255,255,0.05));
	}
	.sr-number {
		font-family: monospace;
		font-size: 0.8rem;
		color: var(--text-tertiary);
		min-width: 60px;
	}
	.sr-name {
		flex: 1;
		font-weight: 500;
	}
	.sr-power {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--accent-primary);
	}
	.sr-type {
		font-size: 0.75rem;
		padding: 1px 6px;
		border-radius: 4px;
		background: #7c3aed20;
		color: #7c3aed;
		font-weight: 600;
	}

	/* Card list */
	.card-list-section {
		margin-bottom: 1rem;
	}
	.card-list-section h3 {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-secondary);
		margin: 0.75rem 0 0.375rem;
	}
	.card-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.card-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		background: var(--bg-base);
		border-radius: 6px;
		font-size: 0.82rem;
	}
	.cr-number {
		font-family: monospace;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		min-width: 50px;
	}
	.cr-name {
		flex: 1;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cr-detail {
		font-size: 0.75rem;
		color: var(--text-secondary);
		flex-shrink: 0;
	}
	.remove-btn {
		background: none;
		border: none;
		color: #ef4444;
		font-size: 0.75rem;
		font-weight: 700;
		cursor: pointer;
		padding: 2px 6px;
		border-radius: 4px;
		flex-shrink: 0;
	}
	.remove-btn:hover {
		background: #ef444420;
	}

	/* Navigation */
	.sealed-actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}
	.secondary-btn {
		flex: 1;
		padding: 0.75rem;
		border-radius: 10px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-primary);
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		text-align: center;
	}
	.primary-btn {
		flex: 2;
		padding: 0.75rem;
		border-radius: 10px;
		border: none;
		background: var(--accent-primary);
		color: #fff;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		text-align: center;
	}
	.primary-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
