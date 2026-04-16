<script lang="ts">
	import { onMount } from 'svelte';
	import ScanHeroCard from '$lib/components/home/ScanHeroCard.svelte';
	import RecentScansStrip from '$lib/components/home/RecentScansStrip.svelte';
	import TournamentCodeEntry from '$lib/components/home/TournamentCodeEntry.svelte';
	import QuickActionsGrid from '$lib/components/home/QuickActionsGrid.svelte';
	import { featureEnabled } from '$lib/stores/feature-flags.svelte';
	import { fetchUserGamePrefs } from '$lib/services/user-game-prefs';
	import { ALL_GAMES } from '$lib/games/all-games';

	let { data } = $props();
	const multiGameEnabled = featureEnabled('multi_game_ui');

	// User's default game preference (if set, skip the hub and show that game's dashboard).
	// `undefined` = not yet fetched, `null` = explicitly no default (show hub).
	let defaultGame = $state<string | null | undefined>(undefined);

	onMount(async () => {
		if (!data.user) {
			defaultGame = null;
			return;
		}
		const prefs = await fetchUserGamePrefs(data.user.id);
		defaultGame = prefs?.default_game ?? null;
	});

	// Show hub only when: flag ON + authenticated + prefs loaded + no default_game set
	const showHub = $derived(
		multiGameEnabled() && !!data.user && defaultGame === null
	);
</script>

<svelte:head>
	<title>Card Scanner | AI-Powered Card Recognition</title>
</svelte:head>

<div class="dashboard">
	{#if data.user && showHub}
		<!-- Multi-game hub: game selector + quick actions -->
		<div class="hub">
			<div class="hub-header">
				<h1 class="hub-title">Card Scanner</h1>
				<p class="hub-subtitle">Pick a game, or scan any card to auto-detect</p>
			</div>

			<a href="/scan" class="hub-scan-cta">
				<span class="hub-scan-icon">📸</span>
				<span class="hub-scan-label">Scan a Card</span>
				<span class="hub-scan-note">Auto-detects any game</span>
			</a>

			<div class="hub-games">
				{#each ALL_GAMES as game}
					<a
						href={`/${game.id}/collection`}
						class="hub-game-card"
						data-game={game.id}
					>
						<span class="hub-game-icon">{game.icon}</span>
						<span class="hub-game-name">{game.shortName}</span>
						<span class="hub-game-cta">Open →</span>
					</a>
				{/each}
			</div>

			<div class="hub-misc">
				<a href="/collection" class="hub-misc-card">
					<span class="hub-misc-icon">📚</span>
					<span class="hub-misc-label">All Cards</span>
				</a>
				<a href="/sell" class="hub-misc-card">
					<span class="hub-misc-icon">💰</span>
					<span class="hub-misc-label">Sell</span>
				</a>
			</div>

			<TournamentCodeEntry />
		</div>
	{:else if data.user}
		<!-- Single-game / default: BoBA dashboard (existing behavior) -->
		<div class="block-entrance" style="animation-delay: 0ms"><ScanHeroCard /></div>
		<div class="block-entrance" style="animation-delay: 60ms"><RecentScansStrip userId={data.user.id} /></div>
		<div class="block-entrance" style="animation-delay: 120ms"><TournamentCodeEntry /></div>
		<div class="block-entrance" style="animation-delay: 180ms"><QuickActionsGrid /></div>
	{:else}
		<div class="landing-hero">
			<h1 class="landing-title">Card Scanner</h1>
			<p class="landing-subtitle">Scan any BoBA or Wonders card. See what it's worth instantly.</p>
			<a href="/scan" class="landing-cta">Scan a Card</a>
			<p class="landing-note">No sign-in required — try it free.</p>
		</div>
		<TournamentCodeEntry redirectToLogin />
	{/if}
</div>

<style>
	.dashboard { max-width: 600px; margin: 0 auto; padding: 0.5rem 1rem 1.5rem; }
	.block-entrance { animation: slideUpFade 0.4s ease-out both; }
	@keyframes slideUpFade { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }

	.landing-hero { text-align: center; padding: 2rem 0 1rem; }
	.landing-title { font-family: var(--font-display, 'Syne', sans-serif); font-size: 2.25rem; font-weight: 800; margin-bottom: 0.5rem; }
	.landing-subtitle { color: var(--text-secondary, #94a3b8); font-size: 1rem; margin-bottom: 1.5rem; }
	.landing-cta { display: block; width: 100%; max-width: 280px; margin: 0 auto; padding: 0.875rem 2rem; border-radius: var(--radius-lg, 12px); background: linear-gradient(135deg, var(--gold, #f59e0b), var(--gold-dark, #d97706)); color: #0d1524; font-size: 1.1rem; font-weight: 800; text-align: center; text-decoration: none; box-shadow: var(--shadow-gold, 0 4px 20px rgba(245,158,11,0.35)); }
	.landing-note { font-size: 0.8rem; color: var(--text-muted, #475569); margin-top: 0.75rem; text-align: center; }

	/* ── Multi-game hub ─────────────────────────────────── */
	.hub { display: flex; flex-direction: column; gap: 1.25rem; }
	.hub-header { text-align: center; padding: 1rem 0 0.5rem; }
	.hub-title { font-family: var(--font-display, 'Syne', sans-serif); font-size: 1.85rem; font-weight: 800; margin-bottom: 0.25rem; }
	.hub-subtitle { color: var(--text-secondary, #94a3b8); font-size: 0.95rem; }

	.hub-scan-cta {
		display: flex; flex-direction: column; align-items: center; gap: 4px;
		padding: 1.25rem 1rem;
		border-radius: var(--radius-lg, 14px);
		background: linear-gradient(135deg, var(--gold, #f59e0b), var(--gold-dark, #d97706));
		color: #0d1524;
		text-decoration: none;
		box-shadow: var(--shadow-gold, 0 4px 20px rgba(245,158,11,0.35));
	}
	.hub-scan-icon { font-size: 1.75rem; }
	.hub-scan-label { font-size: 1.15rem; font-weight: 800; }
	.hub-scan-note { font-size: 0.8rem; font-weight: 600; opacity: 0.8; }

	.hub-games { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem; }
	.hub-game-card {
		display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
		padding: 1rem;
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		border-radius: var(--radius-lg, 14px);
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #e2e8f0);
		text-decoration: none;
		transition: transform 0.15s, border-color 0.15s;
	}
	.hub-game-card:hover { transform: translateY(-1px); border-color: var(--border-strong, rgba(148,163,184,0.3)); }
	.hub-game-card[data-game="boba"]:hover { border-color: #f59e0b; }
	.hub-game-card[data-game="wonders"]:hover { border-color: #3B82F6; }
	.hub-game-icon { font-size: 1.75rem; line-height: 1; }
	.hub-game-name { font-size: 1rem; font-weight: 700; }
	.hub-game-cta { font-size: 0.75rem; color: var(--text-secondary, #94a3b8); margin-top: auto; }

	.hub-misc { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem; }
	.hub-misc-card {
		display: flex; align-items: center; justify-content: center; gap: 8px;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		border-radius: var(--radius-md, 10px);
		background: var(--bg-elevated, #121d34);
		color: var(--text-primary, #e2e8f0);
		text-decoration: none;
		font-size: 0.9rem;
		font-weight: 600;
	}
	.hub-misc-icon { font-size: 1.1rem; }
</style>
