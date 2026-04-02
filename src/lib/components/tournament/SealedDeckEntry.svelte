<script lang="ts">
	import Scanner from '$components/Scanner.svelte';
	import { searchCards } from '$lib/services/card-db';
	import { getDbs } from '$lib/data/boba-dbs-scores';
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
		maxHeroes = 60,
		maxPlays = 30,
		maxBonus = 25,
		onProceed,
		onBack
	}: {
		heroCards: HeroCardEntry[];
		playCards: PlayCardEntry[];
		maxHeroes: number;
		maxPlays: number;
		maxBonus: number;
		onProceed: () => void;
		onBack: () => void;
	} = $props();

	let scannerActive = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<Card[]>([]);
	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	const totalCards = $derived(heroCards.length + playCards.length);
	const maxTotalPlays = $derived(maxPlays + maxBonus);

	// Validation
	const violations = $derived(() => {
		const v: string[] = [];
		if (heroCards.length > maxHeroes) {
			v.push(`Too many heroes: ${heroCards.length}/${maxHeroes}`);
		}
		if (playCards.length > maxTotalPlays) {
			v.push(`Too many plays: ${playCards.length}/${maxTotalPlays}`);
		}
		// Check for duplicate heroes (same card_id)
		const heroIds = heroCards.map(c => c.card_id);
		const dupeHeroes = heroIds.filter((id, i) => id && heroIds.indexOf(id) !== i);
		if (dupeHeroes.length > 0) {
			const uniqueDupes = [...new Set(dupeHeroes)];
			const dupeNames = uniqueDupes.map(id => heroCards.find(c => c.card_id === id)?.hero_name || id);
			v.push(`Duplicate heroes: ${dupeNames.join(', ')}`);
		}
		// Check for duplicate plays (same card_number)
		const playNums = playCards.map(c => c.card_number);
		const dupePlays = playNums.filter((num, i) => num && playNums.indexOf(num) !== i);
		if (dupePlays.length > 0) {
			const uniqueDupes = [...new Set(dupePlays)];
			const dupeNames = uniqueDupes.map(num => playCards.find(c => c.card_number === num)?.name || num);
			v.push(`Duplicate plays: ${dupeNames.join(', ')}`);
		}
		return v;
	});

	const isValid = $derived(violations().length === 0 && totalCards > 0);

	function addCard(card: Card) {
		if (card.power) {
			// Check for duplicate hero (same card ID)
			if (heroCards.some(c => c.card_id === card.id)) {
				showToast(`Already added: ${card.hero_name || card.name}`, 'x');
				return;
			}
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
			// Check for duplicate play (same card number)
			if (playCards.some(c => c.card_number === card.card_number)) {
				showToast(`Already added: ${card.hero_name || card.name}`, 'x');
				return;
			}
			playCards = [...playCards, {
				card_number: card.card_number || '',
				name: card.hero_name || card.name || '',
				set_code: card.set_code || '',
				dbs_score: getDbs(card.card_number || '', card.set_code || '') ?? 0
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

	<!-- Requirements -->
	<div class="requirements">
		<div class="req" class:met={heroCards.length > 0 && heroCards.length <= maxHeroes}>
			Heroes: {heroCards.length}/{maxHeroes}
		</div>
		<div class="req" class:met={playCards.length > 0 && playCards.length <= maxTotalPlays}>
			Plays: {playCards.length}/{maxPlays}{#if maxBonus > 0} (+{maxBonus} bonus){/if}
		</div>
	</div>

	<!-- Validation warnings -->
	{#if violations().length > 0}
		<div class="validation-errors">
			{#each violations() as v}
				<p class="violation">{v}</p>
			{/each}
		</div>
	{/if}

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
				embedded={true}
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
			disabled={!isValid}
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

	/* Requirements */
	.requirements {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.req {
		flex: 1;
		text-align: center;
		padding: 0.5rem;
		border-radius: 8px;
		background: var(--bg-base);
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-secondary);
		border: 1px solid var(--border-color);
	}
	.req.met {
		border-color: #16a34a40;
		color: #16a34a;
	}
	.validation-errors {
		background: #ef444410;
		border: 1px solid #ef444440;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		margin-bottom: 0.75rem;
	}
	.violation {
		font-size: 0.82rem;
		color: #ef4444;
		margin: 0;
		padding: 2px 0;
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
		height: 50vh;
		min-height: 280px;
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
