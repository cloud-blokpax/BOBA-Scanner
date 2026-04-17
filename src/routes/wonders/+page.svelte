<script lang="ts">
	import ScanHeroCard from '$lib/components/home/ScanHeroCard.svelte';
	import RecentScansStrip from '$lib/components/home/RecentScansStrip.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Wonders | Card Scanner</title>
</svelte:head>

<div class="dashboard">
	{#if data.user}
		<div class="game-header">
			<a href="/" class="back-link" aria-label="Back to home">← Home</a>
			<h1 class="game-title">Wonders</h1>
			<span class="game-sub">Wonders of The First</span>
		</div>
		<div class="block-entrance" style="animation-delay: 0ms"><ScanHeroCard gameId="wonders" /></div>
		<div class="block-entrance" style="animation-delay: 60ms"><RecentScansStrip userId={data.user.id} gameId="wonders" /></div>

		<div class="block-entrance" style="animation-delay: 120ms">
			<section class="wonders-actions">
				<h2 class="actions-heading">QUICK ACTIONS</h2>
				<div class="actions-grid">
					<a href="/wonders/collection" class="wonders-action">
						<span class="wonders-icon">📚</span>
						<div class="wonders-text">
							<div class="wonders-name">Collection</div>
							<div class="wonders-desc">Your Wonders cards · set progress</div>
						</div>
					</a>
					<a href="/wonders/set-completion" class="wonders-action">
						<span class="wonders-icon">🎯</span>
						<div class="wonders-text">
							<div class="wonders-name">Set Completion</div>
							<div class="wonders-desc">Track your progress · missing cards</div>
						</div>
					</a>
					<a href="/sell" class="wonders-action">
						<span class="wonders-icon">💰</span>
						<div class="wonders-text">
							<div class="wonders-name">Sell</div>
							<div class="wonders-desc">Manage eBay listings</div>
						</div>
					</a>
				</div>
				<p class="coming-soon">More Wonders-specific tools coming soon — deck builder, tournament tracker, and more.</p>
			</section>
		</div>
	{:else}
		<div class="landing-hero">
			<h1 class="landing-title">Wonders</h1>
			<p class="landing-subtitle">Wonders of The First — scan, price, and track your collection</p>
			<a href="/auth/login?redirectTo=/wonders" class="landing-cta">Sign in to continue</a>
		</div>
	{/if}
</div>

<style>
	.dashboard { max-width: 600px; margin: 0 auto; padding: 0.5rem 1rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
	.block-entrance { animation: slideUpFade 0.4s ease-out both; }
	@keyframes slideUpFade { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }

	.game-header { display: flex; flex-direction: column; gap: 4px; padding: 0.5rem 0.25rem 0; }
	.back-link { font-size: 0.82rem; color: var(--text-secondary, #94a3b8); text-decoration: none; align-self: flex-start; }
	.back-link:hover { color: var(--text-primary, #e2e8f0); }
	.game-title { font-family: var(--font-display, 'Syne', sans-serif); font-size: 1.8rem; font-weight: 800; margin: 0; color: #3B82F6; }
	.game-sub { font-size: 0.82rem; color: var(--text-secondary, #94a3b8); }

	.wonders-actions { display: flex; flex-direction: column; gap: 0.5rem; }
	.actions-heading {
		font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em;
		color: var(--text-muted, #64748b); margin: 0 0 0.25rem 0.25rem;
		text-transform: uppercase;
	}
	.actions-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem; }
	.wonders-action {
		display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
		padding: 0.85rem 0.95rem;
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		border-radius: var(--radius-lg, 14px);
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #e2e8f0);
		text-decoration: none;
		transition: transform 0.15s, border-color 0.15s;
	}
	.wonders-action:hover { transform: translateY(-1px); border-color: #3B82F6; }
	.wonders-icon { font-size: 1.5rem; line-height: 1; }
	.wonders-text { display: flex; flex-direction: column; min-width: 0; }
	.wonders-name { font-size: 0.95rem; font-weight: 700; line-height: 1.2; }
	.wonders-desc {
		font-size: 0.72rem; color: var(--text-secondary, #94a3b8);
		line-height: 1.2; margin-top: 2px;
	}
	.coming-soon {
		font-size: 0.78rem; color: var(--text-muted, #64748b);
		padding: 0.6rem 0.75rem; margin: 0.25rem 0 0;
		border: 1px dashed var(--border, rgba(148,163,184,0.2));
		border-radius: var(--radius-md, 10px);
		text-align: center;
	}

	.landing-hero { text-align: center; padding: 2rem 0 1rem; }
	.landing-title { font-family: var(--font-display, 'Syne', sans-serif); font-size: 2.25rem; font-weight: 800; margin-bottom: 0.5rem; color: #3B82F6; }
	.landing-subtitle { color: var(--text-secondary, #94a3b8); font-size: 1rem; margin-bottom: 1.5rem; }
	.landing-cta { display: block; width: 100%; max-width: 280px; margin: 0 auto; padding: 0.875rem 2rem; border-radius: var(--radius-lg, 12px); background: linear-gradient(135deg, #3B82F6, #2563EB); color: #fff; font-size: 1.1rem; font-weight: 800; text-align: center; text-decoration: none; }
</style>
