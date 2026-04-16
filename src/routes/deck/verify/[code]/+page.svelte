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
		dbs_score?: number;
	}

	interface Violation {
		rule: string;
		message: string;
	}

	// Unified shape that works for both deck_submissions and legacy deck_snapshots
	const submission = $derived(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const raw = data.submission as Record<string, any> | null;
		if (!raw) return null;

		if (data.source === 'deck_submission') {
			return {
				code: raw.verification_code,
				player_name: raw.player_name,
				deck_name: raw.format_name || 'Tournament Deck',
				format_name: raw.format_name,
				is_valid: raw.is_valid,
				violations: raw.validation_violations || [],
				warnings: raw.validation_warnings || [],
				stats: {
					totalHeroes: raw.hero_count,
					totalPower: raw.total_power,
					averagePower: raw.avg_power,
					dbsTotal: raw.dbs_total
				},
				hero_cards: (raw.hero_cards || []) as HeroCard[],
				play_cards: (raw.play_entries || []) as PlayCard[],
				hot_dog_count: raw.hot_dog_count,
				submitted_at: raw.submitted_at,
				last_updated_at: raw.last_updated_at,
				tournament_name: raw.tournament?.name,
				tournament_code: raw.tournament?.code,
				tournament_date: raw.tournament?.event_date,
				tournament_venue: raw.tournament?.venue
			};
		}

		// Legacy deck_snapshot format
		return {
			code: raw.code,
			player_name: raw.player_name,
			deck_name: raw.deck_name,
			format_name: raw.format_name,
			is_valid: raw.is_valid,
			violations: raw.violations || [],
			warnings: [],
			stats: raw.stats || {},
			hero_cards: raw.hero_cards || [],
			play_cards: raw.play_cards || [],
			hot_dog_count: null,
			submitted_at: raw.locked_at,
			last_updated_at: null,
			tournament_name: null,
			tournament_code: null,
			tournament_date: null,
			tournament_venue: null
		};
	});

	// Sort heroes by power descending
	const sortedHeroes = $derived(() => {
		const snap = submission();
		if (!snap) return [];
		return [...snap.hero_cards].sort((a, b) => (b.power || 0) - (a.power || 0));
	});

	let showPlays = $state(false);
</script>

<svelte:head>
	<title>{submission() ? `${submission()!.player_name}'s Deck` : 'Deck Verification'} | Card Scanner</title>
</svelte:head>

<div class="verify-page">
	{#if submission()}
		{@const snap = submission()!}
		<!-- Header bar -->
		<div class="verify-header">
			<div class="verify-status" class:valid={snap.is_valid} class:invalid={!snap.is_valid}>
				{snap.is_valid ? 'VALID' : 'INVALID'}
			</div>
			<h1 class="verify-player">{snap.player_name}</h1>
			{#if snap.tournament_name}
				<p class="verify-tournament">{snap.tournament_name}</p>
			{/if}
			<p class="verify-format">{snap.format_name}</p>
		</div>

		<!-- Quick stats -->
		<div class="verify-stats">
			{#if snap.stats.totalHeroes != null}
				<div class="stat-pill">{snap.stats.totalHeroes} Heroes</div>
			{/if}
			{#if snap.stats.totalPower != null}
				<div class="stat-pill">{snap.stats.totalPower.toLocaleString()} Power</div>
			{/if}
			{#if snap.stats.averagePower != null}
				<div class="stat-pill">Avg: {snap.stats.averagePower}</div>
			{/if}
			{#if snap.stats.dbsTotal != null}
				<div class="stat-pill">DBS: {snap.stats.dbsTotal}</div>
			{/if}
			{#if snap.hot_dog_count != null}
				<div class="stat-pill">{snap.hot_dog_count} Hot Dogs</div>
			{/if}
		</div>

		<!-- Format compliance -->
		{#if snap.is_valid}
			<div class="compliance-strip valid">All format rules passed</div>
		{:else}
			<div class="compliance-strip invalid">
				{snap.violations.length} violation{snap.violations.length !== 1 ? 's' : ''}
			</div>
		{/if}

		<!-- Violations -->
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

		<!-- Hero deck list (expanded by default, sorted by power) -->
		<div class="verify-card-list">
			<h2>Hero Deck ({snap.hero_cards.length})</h2>
			<table class="card-table">
				<thead>
					<tr><th>#</th><th>Hero</th><th>Power</th><th>Weapon</th></tr>
				</thead>
				<tbody>
					{#each sortedHeroes() as card}
						<tr>
							<td class="card-num">{card.card_number}</td>
							<td>{card.hero_name}</td>
							<td class="card-power">{card.power}</td>
							<td class="card-weapon">{card.weapon_type || '\u2014'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Play deck list (collapsed by default) -->
		{#if snap.play_cards?.length > 0}
			<div class="verify-card-list">
				<button class="section-toggle" onclick={() => (showPlays = !showPlays)}>
					<h2>Play Deck ({snap.play_cards.length})</h2>
					<span>{showPlays ? 'Hide' : 'Show'}</span>
				</button>
				{#if showPlays}
					<table class="card-table">
						<thead>
							<tr><th>#</th><th>Name</th><th>DBS</th></tr>
						</thead>
						<tbody>
							{#each snap.play_cards as card}
								<tr>
									<td class="card-num">{card.card_number}</td>
									<td>{card.name}</td>
									<td class="card-dbs">{card.dbs_score ?? '\u2014'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		{/if}

		<!-- Submission metadata -->
		<footer class="verify-footer">
			{#if snap.submitted_at}
				<p>Submitted: {new Date(snap.submitted_at).toLocaleString()}</p>
			{/if}
			{#if snap.last_updated_at && snap.last_updated_at !== snap.submitted_at}
				<p>Last updated: {new Date(snap.last_updated_at).toLocaleString()}</p>
			{/if}
			<p class="verify-code">Code: {snap.code}</p>
			<p class="verify-branding">Verified by Card Scanner</p>
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
		margin-bottom: 1.25rem;
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
	.verify-tournament {
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

	.verify-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
		margin-bottom: 1rem;
	}
	.stat-pill {
		padding: 0.375rem 0.75rem;
		border-radius: 8px;
		background: var(--bg-elevated, #121d34);
		font-size: 0.85rem;
		font-weight: 600;
	}

	.compliance-strip {
		text-align: center;
		padding: 0.5rem;
		border-radius: 8px;
		font-weight: 700;
		font-size: 0.85rem;
		margin-bottom: 1rem;
	}
	.compliance-strip.valid {
		background: rgba(16, 185, 129, 0.1);
		color: #10b981;
	}
	.compliance-strip.invalid {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
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

	.verify-card-list { margin-bottom: 1.5rem; }
	.verify-card-list h2 {
		font-size: 1rem;
		font-weight: 700;
		margin-bottom: 0.5rem;
	}

	.section-toggle {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
		background: none;
		border: none;
		color: var(--text-primary, #e2e8f0);
		cursor: pointer;
		padding: 0;
		margin-bottom: 0.5rem;
	}
	.section-toggle h2 { margin: 0; }
	.section-toggle span {
		font-size: 0.8rem;
		color: var(--accent-primary, #3b82f6);
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
	.card-weapon {
		text-transform: capitalize;
		color: var(--text-secondary, #94a3b8);
	}
	.card-dbs {
		font-weight: 600;
		color: var(--accent-primary, #3b82f6);
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
	.verify-branding {
		margin-top: 0.5rem !important;
		font-weight: 600;
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
