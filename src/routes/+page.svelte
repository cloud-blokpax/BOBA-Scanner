<script lang="ts">
	import ScanHeroCard from '$lib/components/home/ScanHeroCard.svelte';
	import RecentScansStrip from '$lib/components/home/RecentScansStrip.svelte';
	import TournamentCodeEntry from '$lib/components/home/TournamentCodeEntry.svelte';
	import QuickActionsGrid from '$lib/components/home/QuickActionsGrid.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>BOBA Scanner | AI-Powered Card Recognition</title>
</svelte:head>

<div class="dashboard">
	{#if data.user}
		<div class="block-entrance" style="animation-delay: 0ms"><ScanHeroCard /></div>
		<div class="block-entrance" style="animation-delay: 60ms"><RecentScansStrip userId={data.user.id} /></div>
		<div class="block-entrance" style="animation-delay: 120ms"><TournamentCodeEntry /></div>
		<div class="block-entrance" style="animation-delay: 180ms"><QuickActionsGrid /></div>
	{:else}
		<div class="landing-hero">
			<h1 class="landing-title">BOBA Scanner</h1>
			<p class="landing-subtitle">Scan any BoBA card. See what it's worth instantly.</p>
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
</style>
