<script lang="ts">
	import { featureEnabled } from '$lib/stores/feature-flags.svelte';
	import { ALL_GAMES } from '$lib/games/all-games';

	const multiGameEnabled = featureEnabled('multi_game_ui');
</script>

{#if multiGameEnabled()}
	<section class="games-strip">
		<h2 class="games-heading">GAMES</h2>
		<div class="games-grid">
			{#each ALL_GAMES as game}
				<a href={`/${game.id}/collection`} class="game-card" data-game={game.id}>
					<span class="game-icon">{game.icon}</span>
					<div class="game-text">
						<div class="game-name">{game.shortName}</div>
						<div class="game-sub">{game.name}</div>
					</div>
					<span class="game-chevron" aria-hidden="true">→</span>
				</a>
			{/each}
		</div>
	</section>
{/if}

<style>
	.games-strip { display: flex; flex-direction: column; gap: 0.5rem; }
	.games-heading {
		font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em;
		color: var(--text-muted, #64748b); margin: 0 0 0.25rem 0.25rem;
		text-transform: uppercase;
	}
	.games-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem; }
	.game-card {
		display: flex; align-items: center; gap: 10px;
		padding: 0.85rem 0.9rem;
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		border-radius: var(--radius-lg, 14px);
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #e2e8f0);
		text-decoration: none;
		transition: transform 0.15s, border-color 0.15s;
	}
	.game-card:hover { transform: translateY(-1px); }
	.game-card[data-game="boba"]:hover { border-color: #f59e0b; }
	.game-card[data-game="wonders"]:hover { border-color: #3B82F6; }
	.game-icon { font-size: 1.6rem; line-height: 1; }
	.game-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
	.game-name { font-size: 0.95rem; font-weight: 700; line-height: 1.2; }
	.game-sub {
		font-size: 0.7rem; color: var(--text-secondary, #94a3b8);
		line-height: 1.2; margin-top: 2px;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.game-chevron { color: var(--text-secondary, #94a3b8); font-size: 1rem; }
</style>
