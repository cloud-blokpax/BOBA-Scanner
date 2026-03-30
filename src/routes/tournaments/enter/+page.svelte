<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { getSupabase } from '$lib/services/supabase';
	import { showToast } from '$lib/stores/toast.svelte';
	import { getFormat, getFormatOptions } from '$lib/data/tournament-formats';
	import { validateDeck } from '$lib/services/deck-validator';
	import { fetchUserDecks, type UserDeck } from '$lib/services/deck-service';
	import SealedDeckEntry from '$lib/components/tournament/SealedDeckEntry.svelte';
	import type { Card } from '$lib/types';

	interface TournamentInfo {
		id: string;
		code: string;
		name: string;
		max_heroes: number;
		max_plays: number;
		max_bonus: number;
		require_email: boolean;
		require_name: boolean;
		require_discord: boolean;
		format_id: string | null;
		deck_type: 'constructed' | 'sealed';
		description: string | null;
		venue: string | null;
		event_date: string | null;
		entry_fee: string | null;
		prize_pool: string | null;
		max_players: number | null;
		submission_deadline: string | null;
		registration_closed: boolean;
	}

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

	let tournament = $state<TournamentInfo | null>(null);
	let loading = $state(true);
	let fetchError = $state<string | null>(null);

	// Step navigation
	let step = $state<'code' | 'info' | 'deck' | 'confirm' | 'done'>('code');
	let codeInput = $state('');

	// Player info
	let regName = $state('');
	let regEmail = $state('');
	let regDiscord = $state('');

	// Deck selection
	let deckSource = $state<'existing' | 'csv' | null>(null);
	let userDecks = $state<UserDeck[]>([]);
	let selectedDeckId = $state<string | null>(null);
	let csvInput = $state('');
	let heroCards = $state<HeroCardEntry[]>([]);
	let playCards = $state<PlayCardEntry[]>([]);
	let hotDogCount = $state(10);
	let foilHotDogCount = $state(0);
	let sourceDeckId = $state<string | null>(null);

	// Validation
	let validationResult = $state<ReturnType<typeof validateDeck> | null>(null);

	// Submission
	let submitting = $state(false);
	let submissionResult = $state<{
		verification_code: string;
		verify_url: string;
		is_valid: boolean;
	} | null>(null);

	// Existing submission
	let existingSubmission = $state<Record<string, unknown> | null>(null);

	const formatInfo = $derived(tournament?.format_id ? getFormat(tournament.format_id) : null);
	const isSealed = $derived(tournament?.deck_type === 'sealed');
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
				fetchError = res.status === 404 ? 'Tournament not found or inactive' : 'Failed to load tournament';
				loading = false;
				return;
			}
			tournament = await res.json();
			step = 'info';

			// Pre-fill user info
			const currentUser = $page.data.user;
			if (currentUser) {
				regEmail = currentUser.email || '';
				const client = getSupabase();
				if (client) {
					const { data: profile } = await client
						.from('users')
						.select('name, discord_id')
						.eq('auth_user_id', currentUser.id)
						.single();
					if (profile) {
						regName = profile.name || '';
						regDiscord = profile.discord_id || '';
					}

					// Check for existing submission
					const { data: existing } = await client
						.from('deck_submissions')
						.select('*')
						.eq('tournament_id', tournament!.id)
						.eq('user_id', currentUser.id)
						.maybeSingle();
					if (existing) {
						existingSubmission = existing;
						heroCards = (existing.hero_cards || []) as HeroCardEntry[];
						playCards = (existing.play_entries || []) as PlayCardEntry[];
						hotDogCount = existing.hot_dog_count || 10;
						foilHotDogCount = existing.foil_hot_dog_count || 0;
						regName = existing.player_name || regName;
						regEmail = existing.player_email || regEmail;
						regDiscord = existing.player_discord || regDiscord;
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

	function proceedToInfo() {
		step = 'info';
	}

	function proceedToDeck() {
		if (!regEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail.trim())) {
			showToast('Valid email is required', 'x');
			return;
		}
		if (tournament?.require_name && !regName.trim()) {
			showToast('Name is required', 'x');
			return;
		}
		if (tournament?.require_discord && !regDiscord.trim()) {
			showToast('Discord ID is required', 'x');
			return;
		}
		step = 'deck';
		if (!isSealed) loadUserDecks();
	}

	async function loadUserDecks() {
		if (!tournament?.format_id) return;
		userDecks = await fetchUserDecks(tournament.format_id);
	}

	async function selectExistingDeck(deck: UserDeck) {
		selectedDeckId = deck.id;
		sourceDeckId = deck.id;
		deckSource = 'existing';

		// Load the full card data for this deck
		const client = getSupabase();
		if (!client) return;

		// Fetch hero card details
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

		// Map play entries
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

		// Resolve card numbers against the database
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

		// Separate hero vs play cards based on card type
		const heroes: HeroCardEntry[] = [];
		const plays: PlayCardEntry[] = [];

		for (const card of cards as Card[]) {
			// Check if it's a play card (has no power or power is 0)
			if (!card.power) {
				plays.push({
					card_number: card.card_number || '',
					name: card.hero_name || card.name || '',
					set_code: card.set_code || '',
					dbs_score: 0
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
			id: c.card_id,
			card_number: c.card_number,
			hero_name: c.hero_name,
			name: c.hero_name,
			power: c.power,
			weapon_type: c.weapon_type,
			parallel: c.parallel,
			set_code: c.set_code,
			rarity: null,
			athlete_name: null,
			battle_zone: null,
			image_url: null,
			created_at: ''
		}));

		const playCardsAsCards = playCards.map((p) => ({
			id: '',
			card_number: p.card_number,
			hero_name: null,
			name: p.name,
			power: null,
			weapon_type: null,
			parallel: null,
			set_code: p.set_code,
			rarity: null,
			athlete_name: null,
			battle_zone: null,
			image_url: null,
			created_at: ''
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

	async function submitDeck() {
		if (!tournament) return;
		submitting = true;
		try {
			const res = await fetch('/api/tournament/submit-deck', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tournament_id: tournament.id,
					player_name: regName.trim(),
					player_email: regEmail.trim(),
					player_discord: regDiscord.trim() || null,
					hero_cards: heroCards,
					play_entries: playCards,
					hot_dog_count: hotDogCount,
					foil_hot_dog_count: foilHotDogCount,
					source_deck_id: sourceDeckId
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message || 'Submission failed');
			}
			const result = await res.json();
			submissionResult = result;
			step = 'done';
			showToast('Deck submitted!', 'check');
		} catch (err) {
			showToast(err instanceof Error ? err.message : 'Submission failed', 'x');
		}
		submitting = false;
	}
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
			{#if existingSubmission}
				<div class="existing-banner">
					You already have a submission for this tournament. You can update it below.
				</div>
			{/if}

			<div class="step-card">
				<h2>Your Information</h2>
				<div class="form-group">
					<label for="reg-email">Email <span class="required">*</span></label>
					<input id="reg-email" type="email" bind:value={regEmail} placeholder="you@example.com" />
				</div>
				<div class="form-group">
					<label for="reg-name">
						Name
						{#if tournament.require_name}<span class="required">*</span>{:else}<span class="optional">(optional)</span>{/if}
					</label>
					<input id="reg-name" type="text" bind:value={regName} placeholder="Your name" />
				</div>
				<div class="form-group">
					<label for="reg-discord">
						Discord ID
						{#if tournament.require_discord}<span class="required">*</span>{:else}<span class="optional">(optional)</span>{/if}
					</label>
					<input id="reg-discord" type="text" bind:value={regDiscord} placeholder="username#1234" />
				</div>
				<button class="primary-btn" onclick={proceedToDeck}>Next: Select Deck</button>
			</div>
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
				onProceed={proceedToConfirm}
				onBack={proceedToInfo}
			/>
		{:else}
			<div class="step-card">
				<h2>Select Your Deck</h2>

				<!-- Deck source options -->
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

				<!-- Validation Panel -->
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
								<span class="val-num">{validationResult?.stats.dbsTotal ?? '—'}</span>
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

					<!-- Hot dog count -->
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
					<button class="secondary-btn" onclick={proceedToInfo}>Back</button>
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

		<div class="step-card">
			<h2>Confirm Submission</h2>

			<div class="confirm-section">
				<h3>Player</h3>
				<p>{regName} &mdash; {regEmail}</p>
			</div>

			<div class="confirm-section">
				<h3>Deck Summary</h3>
				<div class="val-stats">
					<div class="val-stat">
						<span class="val-num">{heroCards.length}</span>
						<span class="val-label">Heroes</span>
					</div>
					<div class="val-stat">
						<span class="val-num">{playCards.length}</span>
						<span class="val-label">Plays</span>
					</div>
					<div class="val-stat">
						<span class="val-num">{hotDogCount}</span>
						<span class="val-label">Hot Dogs</span>
					</div>
					<div class="val-stat">
						<span class="val-num">{validationResult?.stats.dbsTotal ?? '—'}</span>
						<span class="val-label">DBS</span>
					</div>
				</div>
			</div>

			{#if isSealed}
				<div class="confirm-validation valid">Sealed Pool</div>
			{:else if validationResult}
				<div class="confirm-validation" class:valid={validationResult.isValid} class:invalid={!validationResult.isValid}>
					{validationResult.isValid ? 'Deck is valid for ' + validationResult.formatName : 'Deck has validation errors'}
				</div>
			{/if}

			<div class="deck-actions">
				<button class="secondary-btn" onclick={() => (step = 'deck')}>Back</button>
				<button
					class="primary-btn"
					onclick={submitDeck}
					disabled={submitting}
				>
					{submitting ? 'Submitting...' : existingSubmission ? 'Update Submission' : 'Submit Deck'}
				</button>
			</div>
		</div>

	{:else if step === 'done' && submissionResult}
		<div class="done-card">
			<h2>Deck Submitted!</h2>
			<p>Your deck has been submitted for <strong>{tournament?.name}</strong>.</p>

			<div class="verify-section">
				<p class="verify-label">Verification Code</p>
				<p class="verify-code">{submissionResult.verification_code}</p>
				<a href={submissionResult.verify_url} class="verify-link">View Verification Page</a>
			</div>

			{#if !submissionResult.is_valid}
				<p class="warn-text">Note: Your deck has validation issues. You may want to resubmit with a valid deck.</p>
			{/if}

			<div class="done-actions">
				<a href="/tournaments" class="primary-btn done-link">Back to Tournaments</a>
				{#if isRegistrationOpen()}
					<button class="secondary-btn" onclick={() => { step = 'deck'; existingSubmission = {}; }}>
						Modify Deck
					</button>
				{/if}
			</div>
		</div>
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
	.existing-banner {
		background: #2563eb20;
		color: #2563eb;
		border-radius: 8px;
		padding: 0.75rem;
		text-align: center;
		font-size: 0.85rem;
		margin-bottom: 1rem;
	}

	/* Step cards */
	.step-card {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1.25rem;
	}
	.step-card h1, .step-card h2 {
		font-size: 1.1rem;
		font-weight: 700;
		margin-bottom: 0.25rem;
	}
	.step-desc {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 1rem;
	}
	.form-group {
		margin-bottom: 0.75rem;
	}
	.form-group label {
		display: block;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 4px;
	}
	.required { color: #ef4444; }
	.optional { font-weight: 400; color: var(--text-tertiary); }
	.form-group input, .form-group textarea {
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
	.primary-btn {
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
	.primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }
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
	.val-stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	.val-stat { text-align: center; }
	.val-num {
		display: block;
		font-size: 1.1rem;
		font-weight: 700;
	}
	.val-label {
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

	.deck-actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}
	.deck-actions .primary-btn {
		flex: 2;
		margin-top: 0;
	}

	/* Confirm */
	.confirm-section {
		margin-bottom: 1rem;
	}
	.confirm-section h3 {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-secondary);
		margin-bottom: 0.25rem;
	}
	.confirm-section p {
		font-size: 0.9rem;
	}
	.confirm-validation {
		padding: 0.625rem;
		border-radius: 8px;
		text-align: center;
		font-weight: 600;
		font-size: 0.9rem;
		margin-bottom: 0.75rem;
	}
	.confirm-validation.valid { background: #16a34a20; color: #16a34a; }
	.confirm-validation.invalid { background: #ef444420; color: #ef4444; }

	/* Done */
	.done-card {
		text-align: center;
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 2rem 1.25rem;
	}
	.done-card h2 {
		font-size: 1.3rem;
		font-weight: 700;
		margin-bottom: 0.5rem;
	}
	.done-card p {
		color: var(--text-secondary);
		font-size: 0.9rem;
		margin-bottom: 1rem;
	}
	.verify-section {
		background: var(--bg-base);
		border-radius: 10px;
		padding: 1rem;
		margin-bottom: 1rem;
	}
	.verify-label {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-bottom: 0.25rem;
	}
	.verify-code {
		font-family: monospace;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--accent-primary);
		margin-bottom: 0.5rem;
	}
	.verify-link {
		font-size: 0.85rem;
		color: var(--accent-primary);
	}
	.warn-text {
		color: #f59e0b;
		font-size: 0.85rem;
	}
	.done-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 300px;
		margin: 1rem auto 0;
	}
	.done-link { text-align: center; }
</style>
