<script lang="ts">
	import type { TournamentInfo, PlayerInfo, DeckData, SubmissionResult } from './types';
	import { showToast } from '$lib/stores/toast.svelte';
	import { validateDeck } from '$lib/services/deck-validator';

	interface Props {
		tournament: TournamentInfo;
		player: PlayerInfo;
		deck: DeckData;
		existingSubmission: boolean;
		onBack: () => void;
		onDone: (result: SubmissionResult) => void;
	}

	let { tournament, player, deck, existingSubmission, onBack, onDone }: Props = $props();

	let submitting = $state(false);

	const isSealed = $derived(tournament.deck_type === 'sealed');
	const dbsTotal = $derived(deck.playCards.reduce((sum, p) => sum + (p.dbs_score || 0), 0));

	const validationResult = $derived.by(() => {
		if (!tournament.format_id || deck.heroCards.length === 0) return null;
		const heroCardsAsCards = deck.heroCards.map(c => ({
			id: c.card_id, card_number: c.card_number, hero_name: c.hero_name, name: c.hero_name,
			power: c.power, weapon_type: c.weapon_type, parallel: c.parallel, set_code: c.set_code,
			rarity: null, athlete_name: null, battle_zone: null, image_url: null, created_at: ''
		}));
		const playCardsAsCards = deck.playCards.map(p => ({
			id: '', card_number: p.card_number, hero_name: null, name: p.name, power: null,
			weapon_type: null, parallel: null, set_code: p.set_code, rarity: null,
			athlete_name: null, battle_zone: null, image_url: null, created_at: ''
		}));
		return validateDeck(heroCardsAsCards, tournament.format_id, playCardsAsCards);
	});

	async function submitDeck() {
		submitting = true;
		try {
			const res = await fetch('/api/tournament/submit-deck', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tournament_id: tournament.id,
					player_name: player.name,
					player_email: player.email,
					player_discord: player.discord || null,
					hero_cards: deck.heroCards,
					play_entries: deck.playCards,
					hot_dog_count: deck.hotDogCount,
					foil_hot_dog_count: deck.foilHotDogCount,
					source_deck_id: deck.sourceDeckId
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message || 'Submission failed');
			}
			const result = await res.json();
			showToast('Deck submitted!', 'check');
			onDone(result);
		} catch (err) {
			showToast(err instanceof Error ? err.message : 'Submission failed', 'x');
		}
		submitting = false;
	}
</script>

<div class="step-card">
	<h2>Confirm Submission</h2>

	<div class="confirm-section">
		<h3>Player</h3>
		<p>{player.name} &mdash; {player.email}</p>
	</div>

	<div class="confirm-section">
		<h3>Deck Summary</h3>
		<div class="val-stats">
			<div class="val-stat"><span class="val-num">{deck.heroCards.length}</span><span class="val-label">Heroes</span></div>
			<div class="val-stat"><span class="val-num">{deck.playCards.length}</span><span class="val-label">Plays</span></div>
			<div class="val-stat"><span class="val-num">{deck.hotDogCount}</span><span class="val-label">Hot Dogs</span></div>
			<div class="val-stat"><span class="val-num">{validationResult?.stats.dbsTotal ?? dbsTotal}</span><span class="val-label">DBS</span></div>
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
		<button class="secondary-btn" onclick={onBack}>Back</button>
		<button class="primary-btn" onclick={submitDeck} disabled={submitting}>
			{submitting ? 'Submitting...' : existingSubmission ? 'Update Submission' : 'Submit Deck'}
		</button>
	</div>
</div>
