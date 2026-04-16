<script lang="ts">
	let { data, children } = $props();

	// Build CSS custom property string from theme accents so child routes
	// can use var(--game-accent-primary) etc. regardless of game.
	const themeStyle = $derived(
		[
			`--game-accent-primary: ${data.gameConfig.theme.accentPrimary}`,
			`--game-accent-secondary: ${data.gameConfig.theme.accentSecondary}`,
			`--game-card-bg: ${data.gameConfig.theme.cardBg}`,
			`--game-text-accent: ${data.gameConfig.theme.textAccent}`,
		].join('; ')
	);
</script>

<div class="game-scope" data-game={data.gameConfig.id} style={themeStyle}>
	{@render children()}
</div>

<style>
	.game-scope {
		display: contents;
	}
</style>
