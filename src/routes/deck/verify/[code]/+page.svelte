<script lang="ts">
	let { data } = $props();

	interface HeroCard {
		card_number: string;
		hero_name: string;
		power: number;
		weapon_type: string;
		parallel?: string;
	}

	interface PlayCard {
		card_number: string;
		name: string;
	}

	interface Violation {
		rule: string;
		message: string;
	}

	interface DeckSnapshot {
		code: string;
		player_name: string;
		deck_name: string;
		format_name: string;
		is_valid: boolean;
		locked_at: string;
		violations: Violation[];
		stats: {
			totalHeroes?: number;
			totalPower?: number;
			averagePower?: number;
			dbsTotal?: number | null;
		};
		hero_cards: HeroCard[];
		play_cards: PlayCard[];
	}

	const snap = $derived(data.snapshot as DeckSnapshot | null);
</script>

<svelte:head>
	<title>{snap ? `${snap.player_name}'s Deck` : 'Deck Verification'} | BOBA Scanner</title>
</svelte:head>

<div class="verify-page">
	{#if snap}
		<div class="verify-header">
			<div class="verify-status" class:valid={snap.is_valid} class:invalid={!snap.is_valid}>
				{snap.is_valid ? 'LEGAL' : 'ILLEGAL'}
			</div>
			<h1 class="verify-player">{snap.player_name}</h1>
			<p class="verify-deck-name">{snap.deck_name}</p>
			<p class="verify-format">{snap.format_name}</p>
			<p class="verify-timestamp">
				Locked {new Date(snap.locked_at).toLocaleDateString()} at {new Date(snap.locked_at).toLocaleTimeString()}
			</p>
		</div>

		{#if !snap.is_valid && snap.violations?.length > 0}
			<div class="verify-violations">
				<h2>Violations</h2>
				{#each snap.violations as v}
					<div class="violation-item">
						<span class="violation-rule">{v.rule}</span>
						<span class="violation-msg">{v.message}</span>
					</div>
				{/each}
			</div>
		{/if}

		<div class="verify-stats">
			{#if snap.stats.totalHeroes != null}
				<div class="stat-pill">{snap.stats.totalHeroes} Heroes</div>
			{/if}
			{#if snap.stats.totalPower != null}
				<div class="stat-pill">{snap.stats.totalPower.toLocaleString()} Power</div>
			{/if}
			{#if snap.stats.dbsTotal != null}
				<div class="stat-pill">DBS: {snap.stats.dbsTotal}</div>
			{/if}
			{#if snap.stats.averagePower != null}
				<div class="stat-pill">Avg: {snap.stats.averagePower}</div>
			{/if}
		</div>

		<div class="verify-card-list">
			<h2>Hero Deck ({snap.hero_cards.length})</h2>
			<table class="card-table">
				<thead>
					<tr><th>#</th><th>Hero</th><th>Power</th><th>Weapon</th></tr>
				</thead>
				<tbody>
					{#each snap.hero_cards as card}
						<tr>
							<td class="card-num">{card.card_number}</td>
							<td>{card.hero_name}</td>
							<td class="card-power">{card.power}</td>
							<td>{card.weapon_type || '\u2014'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if snap.play_cards?.length > 0}
			<div class="verify-card-list">
				<h2>Play Deck ({snap.play_cards.length})</h2>
				{#each snap.play_cards as card}
					<div class="play-card-row">{card.card_number} — {card.name}</div>
				{/each}
			</div>
		{/if}

		<footer class="verify-footer">
			<p>Verified by BOBA Scanner</p>
			<p class="verify-code">Code: {snap.code}</p>
		</footer>
	{:else}
		<div class="verify-not-found">
			<h1>Deck Not Found</h1>
			<p>This verification code is invalid or has expired.</p>
		</div>
	{/if}
</div>

<style>
	.verify-page {
		max-width: 600px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
		color: var(--text-primary, #e2e8f0);
	}

	.verify-header {
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.verify-status {
		display: inline-block;
		padding: 0.5rem 1.5rem;
		border-radius: 20px;
		font-weight: 800;
		font-size: 1.25rem;
		letter-spacing: 0.05em;
		margin-bottom: 0.75rem;
	}

	.verify-status.valid {
		background: rgba(16, 185, 129, 0.15);
		color: #10b981;
		border: 2px solid rgba(16, 185, 129, 0.4);
	}

	.verify-status.invalid {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
		border: 2px solid rgba(239, 68, 68, 0.4);
	}

	.verify-player {
		font-size: 1.5rem;
		font-weight: 800;
		margin: 0.5rem 0 0.25rem;
	}

	.verify-deck-name {
		font-size: 1rem;
		color: var(--text-secondary, #94a3b8);
		margin: 0;
	}

	.verify-format {
		font-size: 0.9rem;
		color: var(--gold, #f59e0b);
		font-weight: 600;
		margin: 0.25rem 0;
	}

	.verify-timestamp {
		font-size: 0.8rem;
		color: var(--text-muted, #475569);
		margin: 0;
	}

	.verify-violations {
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: 12px;
		padding: 1rem;
		margin-bottom: 1rem;
	}

	.verify-violations h2 {
		font-size: 0.9rem;
		color: #ef4444;
		margin: 0 0 0.5rem;
	}

	.violation-item {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid rgba(239, 68, 68, 0.1);
	}

	.violation-item:last-child { border-bottom: none; }

	.violation-rule {
		font-size: 0.75rem;
		font-weight: 700;
		color: #ef4444;
		text-transform: uppercase;
	}

	.violation-msg {
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
	}

	.verify-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
		margin-bottom: 1.5rem;
	}

	.stat-pill {
		padding: 0.375rem 0.75rem;
		border-radius: 8px;
		background: var(--bg-elevated, #121d34);
		font-size: 0.85rem;
		font-weight: 600;
	}

	.verify-card-list {
		margin-bottom: 1.5rem;
	}

	.verify-card-list h2 {
		font-size: 1rem;
		font-weight: 700;
		margin-bottom: 0.5rem;
	}

	.card-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	.card-table th {
		text-align: left;
		padding: 0.5rem 0.25rem;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		color: var(--text-muted, #475569);
		border-bottom: 1px solid var(--border, rgba(148,163,184,0.1));
	}

	.card-table td {
		padding: 0.375rem 0.25rem;
		border-bottom: 1px solid var(--border, rgba(148,163,184,0.05));
	}

	.card-num {
		font-family: monospace;
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
	}

	.card-power {
		font-weight: 700;
		color: var(--gold, #f59e0b);
	}

	.play-card-row {
		padding: 0.375rem 0;
		font-size: 0.85rem;
		border-bottom: 1px solid var(--border, rgba(148,163,184,0.05));
	}

	.verify-footer {
		text-align: center;
		margin-top: 2rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border, rgba(148,163,184,0.1));
	}

	.verify-footer p {
		margin: 0.25rem 0;
		font-size: 0.8rem;
		color: var(--text-muted, #475569);
	}

	.verify-code {
		font-family: monospace;
		letter-spacing: 0.1em;
	}

	.verify-not-found {
		text-align: center;
		padding: 4rem 1rem;
	}

	.verify-not-found h1 {
		font-size: 1.5rem;
		margin-bottom: 0.5rem;
	}

	.verify-not-found p {
		color: var(--text-secondary, #94a3b8);
	}
</style>
