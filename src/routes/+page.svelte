<script lang="ts">
	import ScanHeroCard from '$lib/components/home/ScanHeroCard.svelte';
	import TournamentCodeEntry from '$lib/components/home/TournamentCodeEntry.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Card Scanner | AI-Powered Card Recognition</title>
</svelte:head>

<div class="dashboard">
	{#if data.user}
		<!-- Scan is always first — scan-first philosophy -->
		<div class="block-entrance" style="animation-delay: 0ms"><ScanHeroCard /></div>

		<!-- 3-card action row: BoBA / Wonders / Sell -->
		<div class="block-entrance" style="animation-delay: 60ms">
			<section class="actions-strip">
				<h2 class="actions-heading">GO TO</h2>
				<div class="actions-grid">
					<a href="/boba" class="action-card" data-action="boba">
						<span class="action-icon">⚔️</span>
						<div class="action-text">
							<div class="action-name">BoBA</div>
							<div class="action-sub">Bo Jackson Battle Arena</div>
						</div>
						<span class="action-chevron" aria-hidden="true">→</span>
					</a>
					<a href="/wonders" class="action-card" data-action="wonders">
						<span class="action-icon">🌌</span>
						<div class="action-text">
							<div class="action-name">Wonders</div>
							<div class="action-sub">Wonders of The First</div>
						</div>
						<span class="action-chevron" aria-hidden="true">→</span>
					</a>
					<a href="/sell" class="action-card" data-action="sell">
						<span class="action-icon">💰</span>
						<div class="action-text">
							<div class="action-name">Sell</div>
							<div class="action-sub">Manage eBay listings</div>
						</div>
						<span class="action-chevron" aria-hidden="true">→</span>
					</a>
				</div>
			</section>
		</div>

		<!-- Tournament code entry stays on root landing -->
		<div class="block-entrance" style="animation-delay: 120ms"><TournamentCodeEntry /></div>
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
	.dashboard { max-width: 600px; margin: 0 auto; padding: 0.5rem 1rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
	.block-entrance { animation: slideUpFade 0.4s ease-out both; }
	@keyframes slideUpFade { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }

	.actions-strip { display: flex; flex-direction: column; gap: 0.5rem; }
	.actions-heading {
		font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em;
		color: var(--text-muted, #64748b); margin: 0 0 0.25rem 0.25rem;
		text-transform: uppercase;
	}
	.actions-grid { display: flex; flex-direction: column; gap: 0.6rem; }
	.action-card {
		display: flex; align-items: center; gap: 12px;
		padding: 0.95rem 1rem;
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		border-radius: var(--radius-lg, 14px);
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #e2e8f0);
		text-decoration: none;
		transition: transform 0.15s, border-color 0.15s;
	}
	.action-card:hover { transform: translateY(-1px); }
	.action-card[data-action="boba"]:hover { border-color: #f59e0b; }
	.action-card[data-action="wonders"]:hover { border-color: #3B82F6; }
	.action-card[data-action="sell"]:hover { border-color: #10b981; }
	.action-icon { font-size: 1.85rem; line-height: 1; flex-shrink: 0; }
	.action-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
	.action-name { font-size: 1.05rem; font-weight: 700; line-height: 1.2; }
	.action-sub {
		font-size: 0.78rem; color: var(--text-secondary, #94a3b8);
		line-height: 1.2; margin-top: 3px;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.action-chevron { color: var(--text-secondary, #94a3b8); font-size: 1.1rem; flex-shrink: 0; }

	.landing-hero { text-align: center; padding: 2rem 0 1rem; }
	.landing-title { font-family: var(--font-display, 'Syne', sans-serif); font-size: 2.25rem; font-weight: 800; margin-bottom: 0.5rem; }
	.landing-subtitle { color: var(--text-secondary, #94a3b8); font-size: 1rem; margin-bottom: 1.5rem; }
	.landing-cta { display: block; width: 100%; max-width: 280px; margin: 0 auto; padding: 0.875rem 2rem; border-radius: var(--radius-lg, 12px); background: linear-gradient(135deg, var(--gold, #f59e0b), var(--gold-dark, #d97706)); color: #0d1524; font-size: 1.1rem; font-weight: 800; text-align: center; text-decoration: none; box-shadow: var(--shadow-gold, 0 4px 20px rgba(245,158,11,0.35)); }
	.landing-note { font-size: 0.8rem; color: var(--text-muted, #475569); margin-top: 0.75rem; text-align: center; }
</style>
