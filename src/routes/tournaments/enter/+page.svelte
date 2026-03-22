<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { supabase } from '$lib/services/supabase';
	import { collectionItems, loadCollection } from '$lib/stores/collection';
	import { showToast } from '$lib/stores/toast';
	import type { CollectionItem } from '$lib/types';

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
	}

	let tournament = $state<TournamentInfo | null>(null);
	let loading = $state(true);
	let fetchError = $state<string | null>(null);

	// Registration fields
	let regEmail = $state('');
	let regName = $state('');
	let regDiscord = $state('');

	// Deck building
	let step = $state<'info' | 'deck' | 'done'>('info');
	let deckCards = $state<CollectionItem[]>([]);
	let submitting = $state(false);
	let collectionLoading = $state(false);

	const maxDeckSize = $derived(tournament ? tournament.max_heroes : 30);

	onMount(async () => {
		const code = $page.url.searchParams.get('code');
		if (!code) {
			fetchError = 'No tournament code provided';
			loading = false;
			return;
		}

		try {
			const res = await fetch(`/api/tournament/${encodeURIComponent(code.toUpperCase())}`);
			if (!res.ok) {
				fetchError = res.status === 404 ? 'Tournament not found or inactive' : 'Failed to load tournament';
				loading = false;
				return;
			}
			tournament = await res.json();
		} catch (err) {
			console.debug('[tournament-enter] Tournament fetch failed:', err);
			fetchError = 'Network error';
			loading = false;
			return;
		}

		// Pre-fill from user profile if logged in
		const currentUser = $page.data.user;
		if (currentUser) {
			regEmail = currentUser.email || '';
			const { data: profile } = await supabase
				.from('users')
				.select('name, discord_id')
				.eq('auth_user_id', currentUser.id)
				.single();
			if (profile) {
				regName = profile.name || '';
				regDiscord = profile.discord_id || '';
			}
		}

		await loadCollection();
		loading = false;
	});

	function validateInfo(): string | null {
		if (!tournament) return 'No tournament loaded';
		if (!regEmail.trim()) return 'Email is required';
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail.trim())) return 'Invalid email format';
		if (tournament.require_name && !regName.trim()) return 'Name is required for this tournament';
		if (tournament.require_discord && !regDiscord.trim()) return 'Discord ID is required for this tournament';
		return null;
	}

	function proceedToDeck() {
		const err = validateInfo();
		if (err) {
			showToast(err, 'x');
			return;
		}
		step = 'deck';
	}

	async function reloadCollection() {
		collectionLoading = true;
		try {
			await loadCollection();
			if ($collectionItems.length === 0) {
				showToast('No cards found in collection', 'x');
			}
		} catch (err) {
			console.debug('[tournament-enter] Collection load failed:', err);
			showToast('Failed to load collection', 'x');
		}
		collectionLoading = false;
	}

	function addToDeck(item: CollectionItem) {
		if (deckCards.length >= maxDeckSize) return;
		if (deckCards.some((d) => d.id === item.id)) return;
		deckCards = [...deckCards, item];
	}

	function removeFromDeck(itemId: string) {
		deckCards = deckCards.filter((d) => d.id !== itemId);
	}

	function generateDeckCsv(): string {
		const headers = ['Slot', 'Card #', 'Name', 'Cost', 'Ability', 'DBS'];
		const rows: string[][] = [];
		let slot = 1;

		for (const item of deckCards) {
			const card = item.card;
			if (!card) continue;
			const label = slot <= (tournament?.max_plays ?? 30) ? String(slot) : `B${slot - (tournament?.max_plays ?? 30)}`;
			rows.push([label, card.card_number || '', card.hero_name || card.name, String(card.power ?? ''), '', '']);
			slot++;
		}

		return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
	}

	async function submitRegistration() {
		if (!tournament) return;
		submitting = true;

		try {
			const deckCsv = generateDeckCsv();
			const res = await fetch('/api/tournament/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tournament_id: tournament.id,
					email: regEmail.trim(),
					name: regName.trim() || null,
					discord_id: regDiscord.trim() || null,
					deck_csv: deckCsv
				})
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.message || 'Registration failed');
			}

			step = 'done';
			showToast('Registered successfully!', 'check');
		} catch (err) {
			showToast(err instanceof Error ? err.message : 'Registration failed', 'x');
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
	{:else if tournament}
		<header class="page-header">
			<h1>{tournament.name}</h1>
			<span class="tournament-code-badge">{tournament.code}</span>
		</header>

		<div class="tournament-params">
			<span>Heroes: {tournament.max_heroes}</span>
			<span>Plays: {tournament.max_plays}</span>
			<span>Bonus: {tournament.max_bonus}</span>
		</div>

		{#if step === 'info'}
			<div class="step-card">
				<h2>Your Information</h2>
				<p class="step-desc">Enter your details to register for this tournament.</p>

				<div class="form-group">
					<label for="reg-email">
						Email <span class="required">*</span>
					</label>
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

				<button class="primary-btn" onclick={proceedToDeck}>Next: Build Deck</button>
			</div>
		{:else if step === 'deck'}
			<div class="step-card">
				<h2>Build Your Deck ({deckCards.length}/{maxDeckSize})</h2>
				<p class="step-desc">Select cards from your collection for this tournament.</p>

				{#if deckCards.length > 0}
					<div class="deck-list">
						{#each deckCards as item, i (item.id)}
							<div class="deck-item">
								<span class="deck-slot">{i + 1}</span>
								<span class="deck-card-name">{item.card?.hero_name || item.card?.name}</span>
								{#if item.card?.card_number}
									<span class="deck-card-num">#{item.card.card_number}</span>
								{/if}
								{#if item.card?.power}
									<span class="deck-card-power">PWR {item.card.power}</span>
								{/if}
								<button class="remove-btn" onclick={() => removeFromDeck(item.id)}>x</button>
							</div>
						{/each}
					</div>
				{:else}
					<p class="empty-deck">No cards added yet. Select from your collection below.</p>
				{/if}

				<h3 class="collection-heading">Your Collection</h3>
				<div class="available-list">
					{#each $collectionItems as item (item.id)}
						{@const inDeck = deckCards.some((d) => d.id === item.id)}
						<button
							class="available-card"
							class:in-deck={inDeck}
							onclick={() => addToDeck(item)}
							disabled={inDeck || deckCards.length >= maxDeckSize}
						>
							<span>{item.card?.hero_name || item.card?.name}</span>
							{#if item.card?.card_number}
								<span class="avail-num">#{item.card.card_number}</span>
							{/if}
							{#if item.card?.power}
								<span class="avail-power">{item.card.power}</span>
							{/if}
						</button>
					{:else}
						<div class="empty-collection-actions">
							<p class="empty-collection-text">No cards in your collection yet.</p>
							<a href="/scan" class="scan-cards-btn">Scan Cards</a>
							<button class="load-collection-btn" onclick={reloadCollection} disabled={collectionLoading}>
								{collectionLoading ? 'Loading...' : 'Load from Collection'}
							</button>
						</div>
					{/each}
				</div>

				<div class="deck-actions">
					<button class="secondary-btn" onclick={() => (step = 'info')}>Back</button>
					<button
						class="primary-btn"
						onclick={submitRegistration}
						disabled={submitting || deckCards.length === 0}
					>
						{submitting ? 'Submitting...' : 'Submit Registration'}
					</button>
				</div>
			</div>
		{:else if step === 'done'}
			<div class="done-card">
				<h2>You're Registered!</h2>
				<p>You've been registered for <strong>{tournament.name}</strong> with {deckCards.length} cards in your deck.</p>
				<a href="/tournaments" class="primary-btn done-link">Back to Tournaments</a>
			</div>
		{/if}
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
		margin-bottom: 0.5rem;
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
	.tournament-params {
		display: flex;
		gap: 1rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-bottom: 1.5rem;
	}

	/* Step cards */
	.step-card {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1.25rem;
	}
	.step-card h2 {
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
	.optional {
		font-weight: 400;
		color: var(--text-tertiary);
	}
	.form-group input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.9rem;
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
		margin-top: 0.75rem;
		text-align: center;
		text-decoration: none;
		display: block;
	}
	.primary-btn:disabled { opacity: 0.6; }
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
	}

	/* Deck */
	.deck-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-bottom: 1rem;
	}
	.deck-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		border-radius: 8px;
		background: var(--bg-base);
		font-size: 0.85rem;
	}
	.deck-slot {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-tertiary);
		min-width: 1.5rem;
	}
	.deck-card-name { flex: 1; }
	.deck-card-num {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}
	.deck-card-power {
		font-size: 0.75rem;
		color: var(--accent-gold, #f59e0b);
		font-weight: 600;
	}
	.remove-btn {
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 0.125rem 0.375rem;
		font-size: 0.85rem;
	}
	.empty-deck {
		text-align: center;
		color: var(--text-tertiary);
		font-size: 0.85rem;
		padding: 1rem;
	}
	.collection-heading {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}
	.available-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		max-height: 300px;
		overflow-y: auto;
		margin-bottom: 1rem;
	}
	.available-card {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		cursor: pointer;
		font-size: 0.85rem;
		text-align: left;
	}
	.available-card:hover:not(:disabled) {
		border-color: var(--accent-primary);
	}
	.available-card.in-deck { opacity: 0.4; }
	.available-card:disabled { cursor: not-allowed; }
	.avail-num {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}
	.avail-power {
		font-size: 0.75rem;
		color: var(--accent-gold, #f59e0b);
	}
	.empty-collection-actions {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 1.5rem 1rem;
	}
	.empty-collection-text {
		text-align: center;
		color: var(--text-tertiary);
		font-size: 0.85rem;
	}
	.scan-cards-btn {
		display: block;
		width: 100%;
		padding: 0.75rem;
		border-radius: 10px;
		border: none;
		background: var(--accent-primary);
		color: #fff;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		text-align: center;
		text-decoration: none;
	}
	.load-collection-btn {
		width: 100%;
		padding: 0.6rem;
		border-radius: 10px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.85rem;
		cursor: pointer;
	}
	.load-collection-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.deck-actions {
		display: flex;
		gap: 0.75rem;
	}
	.deck-actions .primary-btn {
		flex: 2;
		margin-top: 0;
	}

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
	.done-link {
		max-width: 250px;
		margin: 0 auto;
	}
</style>
