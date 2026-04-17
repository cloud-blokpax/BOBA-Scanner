<script lang="ts">
	import ScanHeroCard from '$lib/components/home/ScanHeroCard.svelte';
	import RecentScansStrip from '$lib/components/home/RecentScansStrip.svelte';
	import TournamentCodeEntry from '$lib/components/home/TournamentCodeEntry.svelte';
	import QuickActionsGrid from '$lib/components/home/QuickActionsGrid.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>BoBA | Card Scanner</title>
</svelte:head>

<div class="dashboard">
	{#if data.user}
		<div class="game-header">
			<a href="/" class="back-link" aria-label="Back to home">← Home</a>
			<h1 class="game-title">BoBA</h1>
			<span class="game-sub">Bo Jackson Battle Arena</span>
		</div>
		<div class="block-entrance" style="animation-delay: 0ms"><ScanHeroCard gameId="boba" /></div>
		<div class="block-entrance" style="animation-delay: 60ms"><RecentScansStrip userId={data.user.id} gameId="boba" /></div>
		<div class="block-entrance" style="animation-delay: 120ms"><TournamentCodeEntry /></div>
		<div class="block-entrance" style="animation-delay: 180ms"><QuickActionsGrid gameId="boba" /></div>
	{:else}
		<div class="landing-hero">
			<h1 class="landing-title">BoBA</h1>
			<p class="landing-subtitle">Bo Jackson Battle Arena — scan, price, and build tournament decks</p>
			<a href="/auth/login?redirectTo=/boba" class="landing-cta">Sign in to continue</a>
		</div>
	{/if}
</div>

<style>
	.dashboard { max-width: 600px; margin: 0 auto; padding: 0.5rem 1rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
	.block-entrance { animation: slideUpFade 0.4s ease-out both; }
	@keyframes slideUpFade { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }

	.game-header { display: flex; flex-direction: column; gap: 4px; padding: 0.5rem 0.25rem 0; position: relative; }
	.back-link { font-size: 0.82rem; color: var(--text-secondary, #94a3b8); text-decoration: none; align-self: flex-start; }
	.back-link:hover { color: var(--text-primary, #e2e8f0); }
	.game-title { font-family: var(--font-display, 'Syne', sans-serif); font-size: 1.8rem; font-weight: 800; margin: 0; color: #f59e0b; }
	.game-sub { font-size: 0.82rem; color: var(--text-secondary, #94a3b8); }

	.landing-hero { text-align: center; padding: 2rem 0 1rem; }
	.landing-title { font-family: var(--font-display, 'Syne', sans-serif); font-size: 2.25rem; font-weight: 800; margin-bottom: 0.5rem; color: #f59e0b; }
	.landing-subtitle { color: var(--text-secondary, #94a3b8); font-size: 1rem; margin-bottom: 1.5rem; }
	.landing-cta { display: block; width: 100%; max-width: 280px; margin: 0 auto; padding: 0.875rem 2rem; border-radius: var(--radius-lg, 12px); background: linear-gradient(135deg, var(--gold, #f59e0b), var(--gold-dark, #d97706)); color: #0d1524; font-size: 1.1rem; font-weight: 800; text-align: center; text-decoration: none; }
</style>
