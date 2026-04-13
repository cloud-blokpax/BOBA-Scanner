<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { getSupabase } from '$lib/services/supabase';
	import { showToast } from '$lib/stores/toast.svelte';
	import { getFormat } from '$lib/data/tournament-formats';
	import { validateDeck } from '$lib/services/deck-validator';
	import { fetchUserDecks, type UserDeck } from '$lib/services/deck-service';
	import { getDbs } from '$lib/data/boba-dbs-scores';
	import SealedDeckEntry from '$lib/components/tournament/SealedDeckEntry.svelte';
	import InfoStep from '$lib/components/tournament-entry/InfoStep.svelte';
	import ConfirmStep from '$lib/components/tournament-entry/ConfirmStep.svelte';
	import DoneStep from '$lib/components/tournament-entry/DoneStep.svelte';
	import type { TournamentInfo, HeroCardEntry, PlayCardEntry, PlayerInfo, DeckData, SubmissionResult } from '$lib/components/tournament-entry/types';
	import type { Card } from '$lib/types';

	// ── Wizard state ────────────────────────────────────────
	let step = $state<'code' | 'info' | 'deck' | 'confirm' | 'done'>('code');
	let tournament = $state<TournamentInfo | null>(null);
	let loading = $state(true);
	let fetchError = $state<string | null>(null);
	let codeInput = $state('');

	// ── Shared data flowing between steps ───────────────────
	let player = $state<PlayerInfo>({ name: '', email: '', discord: '' });
	let heroCards = $state<HeroCardEntry[]>([]);
	let playCards = $state<PlayCardEntry[]>([]);
	let hotDogCount = $state(10);
	let foilHotDogCount = $state(0);
	let sourceDeckId = $state<string | null>(null);
	let existingSubmission = $state(false);
	let submissionResult = $state<SubmissionResult | null>(null);

	// ── Deck step state ─────────────────────────────────────
	let deckSource = $state<'existing' | 'csv' | null>(null);
	let userDecks = $state<UserDeck[]>([]);
	let selectedDeckId = $state<string | null>(null);
	let csvInput = $state('');
	let validationResult = $state<ReturnType<typeof validateDeck> | null>(null);

	const formatInfo = $derived(tournament?.format_id ? getFormat(tournament.format_id) : null);
	const isSealed = $derived(tournament?.deck_type === 'sealed');
	const dbsTotal = $derived(playCards.reduce((sum, p) => sum + (p.dbs_score || 0), 0));
	const isRegistrationOpen = $derived(() => {
		if (!tournament) return false;
		if (tournament.registration_closed) return false;
		if (tournament.submission_deadline && new Date(tournament.submission_deadline) < new Date()) return false;
		return true;
	});
	const deadlineCountdown = $derived(() => {
		if (!tournament?.submission_deadline) return null;
		const diff = new Date(tournament.submission_deadline).getTime() - Date.now();
		if (diff <= 0) return 'Deadline passed';
		const days = Math.floor(diff / 86400000);
		const hours = Math.floor((diff % 86400000) / 3600000);
		if (days > 0) return `${days}d ${hours}h remaining`;
		const mins = Math.floor((diff % 3600000) / 60000);
		return `${hours}h ${mins}m remaining`;
	});

	// ── Lifecycle ────────────────────────────────────────────
	onMount(async () => {
		const code = $page.url.searchParams.get('code');
		if (code) {
			codeInput = code.toUpperCase();
			await loadTournament(codeInput);
		} else {
			loading = false;
		}
	});

	async function loadTournament(code: string) {
		loading = true;
		fetchError = null;
		try {
			const res = await fetch(`/api/tournament/${encodeURIComponent(code.toUpperCase())}`);
			if (!res.ok) {
				if (res.status === 404) fetchError = 'Tournament not found';
				else if (res.status === 410) fetchError = 'This tournament is no longer active';
				else if (res.status === 403) fetchError = 'Registration for this tournament is closed';
				else fetchError = 'Failed to load tournament';
				loading = false;
				return;
			}
			tournament = await res.json();
			step = 'info';

			// Pre-fill user info
			const currentUser = $page.data.user;
			if (currentUser) {
				player.email = currentUser.email || '';
				const client = getSupabase();
				if (client) {
					const { data: profile } = await client
						.from('users')
						.select('name, discord_id')
						.eq('auth_user_id', currentUser.id)
						.single();
					if (profile) {
						player.name = profile.name || '';
						player.discord = profile.discord_id || '';
					}

					// Check for existing submission
					const { data: existing } = await client
						.from('deck_submissions')
						.select('*')
						.eq('tournament_id', tournament!.id)
						.eq('user_id', currentUser.id)
						.maybeSingle();
					if (existing) {
						existingSubmission = true;
						heroCards = (existing.hero_cards || []) as HeroCardEntry[];
						playCards = (existing.play_entries || []) as PlayCardEntry[];
						hotDogCount = existing.hot_dog_count || 10;
						foilHotDogCount = existing.foil_hot_dog_count || 0;
						player.name = existing.player_name || player.name;
						player.email = existing.player_email || player.email;
						player.discord = existing.player_discord || player.discord;
						runValidation();
					}
				}
			}
		} catch {
			fetchError = 'Network error';
		}
		loading = false;
	}

	function proceedToCode() {
		if (!codeInput.trim()) {
			showToast('Enter a tournament code', 'x');
			return;
		}
		loadTournament(codeInput.trim().toUpperCase());
	}

	// ── Deck step functions ─────────────────────────────────

	async function loadUserDecks() {
		if (!tournament?.format_id) return;
		userDecks = await fetchUserDecks(tournament.format_id);
	}

	async function selectExistingDeck(deck: UserDeck) {
		selectedDeckId = deck.id;
		sourceDeckId = deck.id;
		deckSource = 'existing';

		const client = getSupabase();
		if (!client) return;

		if (deck.hero_card_ids?.length > 0) {
			const { data: cards } = await client
				.from('cards')
				.select('*')
				.in('id', deck.hero_card_ids);

			if (cards) {
				heroCards = cards.map((c) => ({
					card_id: c.id,
					card_number: c.card_number || '',
					hero_name: c.hero_name || c.name || '',
					power: c.power || 0,
					weapon_type: c.weapon_type || '',
					parallel: c.parallel || 'base',
					set_code: c.set_code || ''
				}));
			}
		}

		if (deck.play_entries?.length > 0) {
			playCards = deck.play_entries.map((p) => ({
				card_number: p.cardNumber,
				name: p.name,
				set_code: p.setCode,
				dbs_score: p.dbs || 0
			}));
		}

		hotDogCount = deck.hot_dog_count || 10;
		runValidation();
	}

	function parseCsvInput() {
		deckSource = 'csv';
		const lines = csvInput
			.split(/[\n,]/)
			.map((l) => l.trim())
			.filter(Boolean);

		if (lines.length === 0) {
			showToast('No card numbers found', 'x');
			return;
		}
		resolveCardNumbers(lines);
	}

	async function resolveCardNumbers(numbers: string[]) {
		const client = getSupabase();
		if (!client) {
			showToast('Database not available', 'x');
			return;
		}

		const { data: cards } = await client
			.from('cards')
			.select('*')
			.in('card_number', numbers);

		if (!cards || cards.length === 0) {
			showToast('No matching cards found', 'x');
			return;
		}

		const heroes: HeroCardEntry[] = [];
		const plays: PlayCardEntry[] = [];

		for (const card of cards as Card[]) {
			if (!card.power) {
				plays.push({
					card_number: card.card_number || '',
					name: card.hero_name || card.name || '',
					set_code: card.set_code || '',
					dbs_score: getDbs(card.card_number || '', card.set_code || '') ?? 0
				});
			} else {
				heroes.push({
					card_id: card.id,
					card_number: card.card_number || '',
					hero_name: card.hero_name || card.name || '',
					power: card.power,
					weapon_type: card.weapon_type || '',
					parallel: card.parallel || 'base',
					set_code: card.set_code || ''
				});
			}
		}

		heroCards = heroes;
		playCards = plays;
		runValidation();
		showToast(`Loaded ${heroes.length} heroes, ${plays.length} plays`, 'check');
	}

	function runValidation() {
		if (!tournament?.format_id || heroCards.length === 0) {
			validationResult = null;
			return;
		}

		const heroCardsAsCards = heroCards.map((c) => ({
			id: c.card_id, card_number: c.card_number, hero_name: c.hero_name, name: c.hero_name,
			power: c.power, weapon_type: c.weapon_type, parallel: c.parallel, set_code: c.set_code,
			rarity: null, athlete_name: null, battle_zone: null, image_url: null, created_at: ''
		}));

		const playCardsAsCards = playCards.map((p) => ({
			id: '', card_number: p.card_number, hero_name: null, name: p.name, power: null,
			weapon_type: null, parallel: null, set_code: p.set_code, rarity: null,
			athlete_name: null, battle_zone: null, image_url: null, created_at: ''
		}));

		validationResult = validateDeck(heroCardsAsCards, tournament.format_id, playCardsAsCards);
	}

	function proceedToConfirm() {
		if (heroCards.length === 0 && playCards.length === 0) {
			showToast('Add cards first', 'x');
			return;
		}
		if (!isSealed) runValidation();
		step = 'confirm';
	}

	const currentDeck = $derived<DeckData>({
		heroCards, playCards, hotDogCount, foilHotDogCount, sourceDeckId
	});
</script>

<svelte:head>
	<title>{tournament ? `Enter: ${tournament.name}` : 'Enter Tournament'} - BOBA Scanner</title>
</svelte:head>

<div class="enter-page">
	{#if loading}
		<div class="loading">Loading tournament...</div>
	{:else if fetchError}
		<div class="error-state">
			<p>{fetchError}</p>
			<a href="/tournaments" class="back-link">Back to Tournaments</a>
		</div>

	{:else if step === 'code'}
		<div class="step-card">
			<h1>Enter Tournament</h1>
			<p class="step-desc">Enter the tournament code to register your deck.</p>
			<div class="form-group">
				<label for="code-input">Tournament Code</label>
				<input
					id="code-input"
					type="text"
					bind:value={codeInput}
					placeholder="e.g. ABCD1234"
					maxlength="8"
					class="code-input"
					onkeydown={(e) => e.key === 'Enter' && proceedToCode()}
				/>
			</div>
			<button class="primary-btn" onclick={proceedToCode}>Look Up Tournament</button>
		</div>

	{:else if tournament && step === 'info'}
		<header class="page-header">
			<h1>{tournament.name}</h1>
			<span class="tournament-code-badge">{tournament.code}</span>
		</header>

		<!-- Tournament info display -->
		<div class="tournament-info-card">
			{#if isSealed}
				<div class="info-row">
					<span class="info-label">Deck Type</span>
					<span class="info-value">Sealed</span>
				</div>
			{/if}
			{#if formatInfo}
				<div class="info-row">
					<span class="info-label">Format</span>
					<span class="info-value">{formatInfo.name}</span>
				</div>
				<div class="info-row">
					<span class="info-label">Rules</span>
					<span class="info-value">{formatInfo.description}</span>
				</div>
			{/if}
			{#if tournament.event_date}
				<div class="info-row">
					<span class="info-label">Date</span>
					<span class="info-value">{new Date(tournament.event_date).toLocaleDateString()}</span>
				</div>
			{/if}
			{#if tournament.venue}
				<div class="info-row">
					<span class="info-label">Venue</span>
					<span class="info-value">{tournament.venue}</span>
				</div>
			{/if}
			{#if tournament.entry_fee}
				<div class="info-row">
					<span class="info-label">Entry Fee</span>
					<span class="info-value">{tournament.entry_fee}</span>
				</div>
			{/if}
			{#if tournament.submission_deadline}
				<div class="info-row deadline">
					<span class="info-label">Deadline</span>
					<span class="info-value">
						{new Date(tournament.submission_deadline).toLocaleString()}
						{#if deadlineCountdown()}
							<span class="countdown">({deadlineCountdown()})</span>
						{/if}
					</span>
				</div>
			{/if}
		</div>

		{#if !isRegistrationOpen()}
			<div class="closed-banner">Registration is closed for this tournament.</div>
		{:else}
			<InfoStep
				{tournament}
				initial={player}
				{existingSubmission}
				onProceed={(info) => { player = info; step = 'deck'; if (!isSealed) loadUserDecks(); }}
			/>
		{/if}

	{:else if tournament && step === 'deck'}
		<header class="page-header">
			<h1>{tournament.name}</h1>
			<span class="tournament-code-badge">{tournament.code}</span>
		</header>

		{#if isSealed}
			<SealedDeckEntry
				bind:heroCards
				bind:playCards
				maxHeroes={tournament.max_heroes}
				maxPlays={tournament.max_plays}
				maxBonus={tournament.max_bonus}
				onProceed={proceedToConfirm}
				onBack={() => (step = 'info')}
			/>
		{:else}
			<div class="step-card">
				<h2>Select Your Deck</h2>

				<div class="deck-options">
					<button
						class="option-btn"
						class:active={deckSource === 'existing'}
						onclick={() => { deckSource = 'existing'; loadUserDecks(); }}
					>
						Select Existing Deck
					</button>
					<a
						href="/deck/new?format={tournament.format_id || ''}&tournament={tournament.code}"
						class="option-btn"
					>
						Build New Deck
					</a>
					<button
						class="option-btn"
						class:active={deckSource === 'csv'}
						onclick={() => (deckSource = 'csv')}
					>
						Import from CSV
					</button>
				</div>

				{#if deckSource === 'existing'}
					<div class="deck-list">
						{#if userDecks.length === 0}
							<p class="empty-deck">No saved decks found for this format.</p>
						{:else}
							{#each userDecks as deck}
								<button
									class="deck-option"
									class:selected={selectedDeckId === deck.id}
									onclick={() => selectExistingDeck(deck)}
								>
									<span class="deck-name">{deck.name}</span>
									<span class="deck-meta">
										{deck.hero_card_ids?.length || 0} heroes,
										{deck.play_entries?.length || 0} plays
									</span>
								</button>
							{/each}
						{/if}
					</div>
				{:else if deckSource === 'csv'}
					<div class="csv-section">
						<textarea
							bind:value={csvInput}
							placeholder="Paste card numbers, one per line or comma-separated"
							rows="8"
							class="csv-input"
						></textarea>
						<button class="secondary-btn" onclick={parseCsvInput}>Resolve Cards</button>
					</div>
				{/if}

				{#if heroCards.length > 0}
					<div class="validation-panel" class:valid={validationResult?.isValid} class:invalid={validationResult && !validationResult.isValid}>
						<div class="val-header">
							{#if validationResult?.isValid}
								<span class="val-badge valid">VALID</span>
							{:else if validationResult}
								<span class="val-badge invalid">INVALID</span>
							{/if}
							<span class="val-format">{formatInfo?.name || 'Custom'}</span>
						</div>

						<div class="val-stats">
							<div class="val-stat">
								<span class="val-num">{heroCards.length}</span>
								<span class="val-label">Heroes</span>
							</div>
							<div class="val-stat">
								<span class="val-num">{validationResult?.stats.totalPower.toLocaleString() || 0}</span>
								<span class="val-label">Total PWR</span>
							</div>
							<div class="val-stat">
								<span class="val-num">{validationResult?.stats.averagePower || 0}</span>
								<span class="val-label">Avg PWR</span>
							</div>
							<div class="val-stat">
								<span class="val-num">{validationResult?.stats.dbsTotal ?? dbsTotal}</span>
								<span class="val-label">DBS</span>
							</div>
						</div>

						{#if validationResult?.violations.length}
							<div class="val-violations">
								{#each validationResult.violations as v}
									<p class="violation">{v.message}</p>
								{/each}
							</div>
						{/if}

						{#if validationResult?.warnings.length}
							<div class="val-warnings">
								{#each validationResult.warnings as w}
									<p class="warning">{w}</p>
								{/each}
							</div>
						{/if}
					</div>

					<div class="form-group hot-dog-row">
						<label for="hot-dogs">Hot Dog Cards</label>
						<input id="hot-dogs" type="number" bind:value={hotDogCount} min="0" max="20" class="narrow-input" />
						{#if formatInfo?.requiresFoilHotDogs}
							<label for="foil-hd" class="foil-label">Foil Hot Dogs</label>
							<input id="foil-hd" type="number" bind:value={foilHotDogCount} min="0" max="10" class="narrow-input" />
						{/if}
					</div>
				{/if}

				<div class="deck-actions">
					<button class="secondary-btn" onclick={() => (step = 'info')}>Back</button>
					<button
						class="primary-btn"
						onclick={proceedToConfirm}
						disabled={heroCards.length === 0}
					>
						Review & Submit
					</button>
				</div>
			</div>
		{/if}

	{:else if tournament && step === 'confirm'}
		<header class="page-header">
			<h1>{tournament.name}</h1>
		</header>

		<ConfirmStep
			{tournament}
			{player}
			deck={currentDeck}
			{existingSubmission}
			onBack={() => (step = 'deck')}
			onDone={(result) => { submissionResult = result; step = 'done'; }}
		/>

	{:else if step === 'done' && submissionResult}
		<DoneStep
			tournamentName={tournament?.name || ''}
			result={submissionResult}
			canModify={isRegistrationOpen()}
			onModify={() => { step = 'deck'; existingSubmission = true; }}
		/>
	{/if}
</div>

<style>
	.enter-page {
		max-width: 600px;
		margin: 0 auto;
		padding: 1rem;
	}
	.loading, .error-state {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}
	.back-link {
		display: inline-block;
		margin-top: 1rem;
		color: var(--accent-primary);
		text-decoration: none;
	}
	.page-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.page-header h1 {
		font-size: 1.4rem;
		font-weight: 700;
	}
	.tournament-code-badge {
		font-family: monospace;
		font-size: 0.8rem;
		padding: 2px 8px;
		border-radius: 4px;
		background: var(--bg-elevated);
		color: var(--accent-primary);
		letter-spacing: 0.05em;
	}

	/* Tournament info */
	.tournament-info-card {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
		margin-bottom: 1rem;
	}
	.info-row {
		display: flex;
		gap: 0.75rem;
		padding: 0.375rem 0;
		font-size: 0.85rem;
	}
	.info-label {
		font-weight: 600;
		color: var(--text-secondary);
		min-width: 80px;
		flex-shrink: 0;
	}
	.info-value { color: var(--text-primary); }
	.countdown {
		font-size: 0.8rem;
		color: var(--accent-primary);
		font-weight: 600;
	}
	.closed-banner {
		background: #ef444420;
		color: #ef4444;
		border-radius: 8px;
		padding: 0.75rem;
		text-align: center;
		font-weight: 600;
		margin-bottom: 1rem;
	}

	/* Step cards */
	:global(.step-card) {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1.25rem;
	}
	:global(.step-card) h1, :global(.step-card) h2 {
		font-size: 1.1rem;
		font-weight: 700;
		margin-bottom: 0.25rem;
	}
	.step-desc {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 1rem;
	}
	:global(.form-group) {
		margin-bottom: 0.75rem;
	}
	:global(.form-group) label {
		display: block;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 4px;
	}
	:global(.required) { color: #ef4444; }
	:global(.optional) { font-weight: 400; color: var(--text-tertiary); }
	:global(.form-group) input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.9rem;
	}
	.code-input {
		font-family: monospace;
		font-size: 1.2rem;
		text-align: center;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	:global(.primary-btn) {
		width: 100%;
		padding: 0.75rem;
		border-radius: 10px;
		border: none;
		background: var(--accent-primary);
		color: #fff;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		margin-top: 0.5rem;
		text-align: center;
		text-decoration: none;
		display: block;
	}
	:global(.primary-btn):disabled { opacity: 0.6; cursor: not-allowed; }
	:global(.secondary-btn) {
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

	/* Deck selection */
	.deck-options {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}
	.option-btn {
		flex: 1;
		min-width: 120px;
		padding: 0.6rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		text-align: center;
		text-decoration: none;
	}
	.option-btn.active, .option-btn:hover {
		border-color: var(--accent-primary);
		color: var(--accent-primary);
	}

	.deck-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.deck-option {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.6rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		cursor: pointer;
		text-align: left;
	}
	.deck-option.selected {
		border-color: var(--accent-primary);
		background: var(--accent-primary);
		background: color-mix(in srgb, var(--accent-primary) 10%, var(--bg-base));
	}
	.deck-name { font-weight: 600; font-size: 0.9rem; }
	.deck-meta { font-size: 0.75rem; color: var(--text-tertiary); }
	.empty-deck {
		text-align: center;
		color: var(--text-tertiary);
		font-size: 0.85rem;
		padding: 1rem;
	}

	.csv-section { margin-bottom: 1rem; }
	.csv-input {
		width: 100%;
		font-family: monospace;
		font-size: 0.85rem;
		margin-bottom: 0.5rem;
	}

	/* Validation panel */
	.validation-panel {
		background: var(--bg-base);
		border-radius: 10px;
		padding: 1rem;
		margin: 1rem 0;
		border: 1px solid var(--border-color);
	}
	.validation-panel.valid { border-color: #16a34a40; }
	.validation-panel.invalid { border-color: #ef444440; }
	.val-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.val-badge {
		padding: 2px 10px;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.val-badge.valid { background: #16a34a20; color: #16a34a; }
	.val-badge.invalid { background: #ef444420; color: #ef4444; }
	.val-format { font-size: 0.85rem; color: var(--text-secondary); }
	:global(.val-stats) {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	:global(.val-stat) { text-align: center; }
	:global(.val-num) {
		display: block;
		font-size: 1.1rem;
		font-weight: 700;
	}
	:global(.val-label) {
		font-size: 0.7rem;
		color: var(--text-tertiary);
	}
	.val-violations { margin-top: 0.5rem; }
	.violation {
		font-size: 0.8rem;
		color: #ef4444;
		padding: 2px 0;
	}
	.val-warnings { margin-top: 0.25rem; }
	.warning {
		font-size: 0.8rem;
		color: #f59e0b;
		padding: 2px 0;
	}

	.hot-dog-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.narrow-input { width: 70px !important; }
	.foil-label {
		margin-left: 0.5rem;
	}

	:global(.deck-actions) {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}
	:global(.deck-actions) :global(.primary-btn) {
		flex: 2;
		margin-top: 0;
	}

	/* Confirm */
	:global(.confirm-section) {
		margin-bottom: 1rem;
	}
	:global(.confirm-section h3) {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-secondary);
		margin-bottom: 0.25rem;
	}
	:global(.confirm-section) p {
		font-size: 0.9rem;
	}
	:global(.confirm-validation) {
		padding: 0.625rem;
		border-radius: 8px;
		text-align: center;
		font-weight: 600;
		font-size: 0.9rem;
		margin-bottom: 0.75rem;
	}
	:global(.confirm-validation.valid) { background: #16a34a20; color: #16a34a; }
	:global(.confirm-validation.invalid) { background: #ef444420; color: #ef4444; }

	/* Done */
	:global(.done-card) {
		text-align: center;
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 2rem 1.25rem;
	}
	:global(.done-card) h2 {
		font-size: 1.3rem;
		font-weight: 700;
		margin-bottom: 0.5rem;
	}
	:global(.done-card) p {
		color: var(--text-secondary);
		font-size: 0.9rem;
		margin-bottom: 1rem;
	}
	:global(.verify-section) {
		background: var(--bg-base);
		border-radius: 10px;
		padding: 1rem;
		margin-bottom: 1rem;
	}
	:global(.verify-label) {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-bottom: 0.25rem;
	}
	:global(.verify-code) {
		font-family: monospace;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--accent-primary);
		margin-bottom: 0.5rem;
	}
	:global(.verify-link) {
		font-size: 0.85rem;
		color: var(--accent-primary);
	}
	:global(.warn-text) {
		color: #f59e0b;
		font-size: 0.85rem;
	}
	:global(.done-actions) {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 300px;
		margin: 1rem auto 0;
	}
	:global(.done-link) { text-align: center; }
	:global(.existing-banner) {
		background: #2563eb20;
		color: #2563eb;
		border-radius: 8px;
		padding: 0.75rem;
		text-align: center;
		font-size: 0.85rem;
		margin-bottom: 1rem;
	}
</style>
