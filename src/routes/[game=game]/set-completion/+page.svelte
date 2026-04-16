<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>{data.gameConfig.shortName} Sets | Card Scanner</title>
</svelte:head>

<div class="game-stub">
	<h1 class="stub-title">{data.gameConfig.icon} {data.gameConfig.shortName} — Set Completion</h1>
	<p class="stub-body">
		Set completion tracking for <strong>{data.gameConfig.name}</strong> is coming soon.
	</p>
	<a href="/collection" class="stub-link">View your collection →</a>
</div>

<style>
	.game-stub {
		max-width: 600px;
		margin: 0 auto;
		padding: 2rem 1rem;
		text-align: center;
	}
	.stub-title {
		font-family: var(--font-display, 'Syne', sans-serif);
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--game-text-accent, var(--text-primary, #e2e8f0));
		margin-bottom: 0.5rem;
	}
	.stub-body {
		color: var(--text-secondary, #94a3b8);
		margin-bottom: 1.5rem;
	}
	.stub-link {
		display: inline-block;
		padding: 0.75rem 1.25rem;
		border-radius: 8px;
		background: var(--game-accent-primary, var(--gold, #f59e0b));
		color: #0d1524;
		font-weight: 700;
		text-decoration: none;
	}
</style>
