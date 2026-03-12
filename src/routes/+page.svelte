<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>BOBA Scanner | AI-Powered Card Recognition</title>
</svelte:head>

<div class="dashboard">
	<section class="hero-section">
		<h1>BOBA Scanner</h1>
		<p class="hero-subtitle">AI-Powered Bo Jackson Trading Card Recognition</p>

		{#if data.user}
			<div class="quick-actions">
				<a href="/scan" class="action-card primary">
					<span class="action-icon">📷</span>
					<span class="action-label">Scan Cards</span>
					<span class="action-desc">Identify cards instantly with AI</span>
				</a>
				<a href="/collection" class="action-card">
					<span class="action-icon">📚</span>
					<span class="action-label">My Collection</span>
					<span class="action-desc">View and manage your cards</span>
				</a>
				<a href="/deck" class="action-card">
					<span class="action-icon">🃏</span>
					<span class="action-label">Deck Builder</span>
					<span class="action-desc">Build competitive decks</span>
				</a>
			</div>
		{:else}
			<div class="cta-section">
				<p>Sign in to start scanning and collecting Bo Jackson Battle Arena cards.</p>
				<a href="/auth/login" class="btn-primary btn-large">Get Started</a>
			</div>
		{/if}
	</section>

	<section class="features-section">
		<h2>Three-Tier Recognition</h2>
		<div class="feature-grid">
			<div class="feature-card">
				<span class="feature-icon">⚡</span>
				<h3>Hash Cache</h3>
				<p>Instant recognition for previously scanned cards. Free.</p>
			</div>
			<div class="feature-card">
				<span class="feature-icon">🔍</span>
				<h3>OCR Engine</h3>
				<p>Client-side text recognition with fuzzy matching. Free.</p>
			</div>
			<div class="feature-card">
				<span class="feature-icon">🤖</span>
				<h3>Claude AI</h3>
				<p>Advanced AI identification for ambiguous cards. ~$0.002/scan.</p>
			</div>
		</div>
	</section>
</div>

<style>
	.dashboard {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

	.hero-section {
		text-align: center;
		margin-bottom: 3rem;
	}

	.hero-section h1 {
		font-family: 'Syne', sans-serif;
		font-size: 2.5rem;
		font-weight: 800;
		margin-bottom: 0.5rem;
	}

	.hero-subtitle {
		color: var(--text-secondary, #94a3b8);
		font-size: 1.1rem;
		margin-bottom: 2rem;
	}

	.quick-actions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-top: 2rem;
	}

	.action-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 1.5rem;
		border-radius: 12px;
		background: var(--surface-secondary, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		text-decoration: none;
		color: inherit;
		transition: transform 0.2s, border-color 0.2s;
	}

	.action-card:hover {
		transform: translateY(-2px);
		border-color: var(--accent-primary, #3b82f6);
	}

	.action-card.primary {
		border-color: var(--accent-primary, #3b82f6);
		background: var(--accent-primary-dim, rgba(59, 130, 246, 0.1));
	}

	.action-icon {
		font-size: 2rem;
		margin-bottom: 0.5rem;
	}

	.action-label {
		font-weight: 600;
		font-size: 1rem;
	}

	.action-desc {
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
		margin-top: 0.25rem;
	}

	.cta-section {
		margin-top: 2rem;
	}

	.cta-section p {
		color: var(--text-secondary, #94a3b8);
		margin-bottom: 1rem;
	}

	.btn-large {
		padding: 0.75rem 2rem;
		font-size: 1.1rem;
	}

	.features-section {
		margin-top: 3rem;
	}

	.features-section h2 {
		font-family: 'Syne', sans-serif;
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.feature-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
	}

	.feature-card {
		text-align: center;
		padding: 1.25rem;
		border-radius: 12px;
		background: var(--surface-secondary, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
	}

	.feature-icon {
		font-size: 1.5rem;
		display: block;
		margin-bottom: 0.5rem;
	}

	.feature-card h3 {
		font-size: 0.95rem;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.feature-card p {
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
		line-height: 1.4;
	}

	@media (max-width: 600px) {
		.feature-grid {
			grid-template-columns: 1fr;
		}

		.hero-section h1 {
			font-size: 2rem;
		}
	}
</style>
