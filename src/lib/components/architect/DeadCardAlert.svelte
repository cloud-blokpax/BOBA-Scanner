<script lang="ts">
	import type { DeadCardReport, WeaponAlignmentSummary } from '$lib/services/dead-card-detector';
	import { generateFixSuggestions } from '$lib/services/dead-card-detector';

	let {
		report,
		totalHeroes
	}: {
		report: DeadCardReport;
		totalHeroes: number;
	} = $props();

	let expandedWeapon = $state<string | null>(null);
	let showAllPlays = $state(false);

	const suggestions = $derived(generateFixSuggestions(report, totalHeroes));
	const redPlays = $derived(report.plays.filter((p) => p.rating === 'red'));
	const yellowPlays = $derived(report.plays.filter((p) => p.rating === 'yellow'));
	const hasIssues = $derived(redPlays.length > 0 || yellowPlays.length > 0);

	function toggleWeapon(weapon: string) {
		expandedWeapon = expandedWeapon === weapon ? null : weapon;
	}

	function ratingColor(rating: 'green' | 'yellow' | 'red'): string {
		if (rating === 'green') return 'var(--success, #22c55e)';
		if (rating === 'yellow') return 'var(--warning, #f59e0b)';
		return 'var(--danger, #ef4444)';
	}

	function ratingDot(rating: 'green' | 'yellow' | 'red'): string {
		if (rating === 'green') return '\u25CF';
		if (rating === 'yellow') return '\u25CF';
		return '\u25CF';
	}
</script>

<div class="card">
	<h3 class="card-title">Dead Card Detector</h3>

	{#if !hasIssues}
		<div class="status-ok">
			<span class="ok-icon">&#10003;</span>
			<span>All plays are well-aligned with your hero deck.</span>
		</div>
	{:else}
		<!-- Alert banner -->
		<div class="alert-banner" class:alert-red={redPlays.length > 0} class:alert-yellow={redPlays.length === 0}>
			<div class="alert-text">
				{#if redPlays.length > 0}
					<strong>{redPlays.length} play{redPlays.length > 1 ? 's' : ''}</strong> ({report.wastedDBS} DBS) with &lt;40% activation rate
				{/if}
				{#if yellowPlays.length > 0}
					{#if redPlays.length > 0}&nbsp;&middot;&nbsp;{/if}
					<strong>{yellowPlays.length}</strong> marginal play{yellowPlays.length > 1 ? 's' : ''} (40-69%)
				{/if}
			</div>
		</div>

		<!-- Per-weapon breakdown -->
		{#if report.weaponSummary.length > 0}
			<div class="weapon-list">
				{#each report.weaponSummary as ws (ws.weapon)}
					<button
						class="weapon-row"
						onclick={() => toggleWeapon(ws.weapon)}
						aria-expanded={expandedWeapon === ws.weapon}
					>
						<span class="weapon-dot" style="color: {ratingColor(ws.rating)}">{ratingDot(ws.rating)}</span>
						<span class="weapon-name">{ws.weapon}</span>
						<span class="weapon-stats">
							{ws.playCount} play{ws.playCount > 1 ? 's' : ''}, {ws.heroCount} heroes ({Math.round(ws.heroPercent * 100)}%)
						</span>
						<span class="weapon-rate" style="color: {ratingColor(ws.rating)}">
							{Math.round(ws.avgActivationRate * 100)}%
						</span>
						<span class="expand-icon">{expandedWeapon === ws.weapon ? '\u25B2' : '\u25BC'}</span>
					</button>

					{#if expandedWeapon === ws.weapon}
						<div class="weapon-detail">
							{#each report.plays.filter((p) => p.requiredWeapon === ws.weapon) as pa (pa.play.id)}
								<div class="play-row">
									<span class="play-dot" style="color: {ratingColor(pa.rating)}">{ratingDot(pa.rating)}</span>
									<span class="play-name">{pa.play.name}</span>
									<span class="play-dbs">{pa.play.dbs} DBS</span>
									<span class="play-rate" style="color: {ratingColor(pa.rating)}">
										{Math.round(pa.activationRate * 100)}%
									</span>
								</div>
								<p class="play-explanation">{pa.explanation}</p>
							{/each}
						</div>
					{/if}
				{/each}
			</div>
		{/if}

		<!-- Fix suggestions -->
		{#if suggestions.length > 0}
			<div class="suggestions">
				<h4>Suggestions</h4>
				{#each suggestions as suggestion}
					<p class="suggestion-text">{suggestion}</p>
				{/each}
			</div>
		{/if}

		<!-- Per-play list (collapsible) -->
		{#if report.plays.some((p) => p.requiredWeapon !== null)}
			<button class="toggle-all" onclick={() => (showAllPlays = !showAllPlays)}>
				{showAllPlays ? 'Hide' : 'Show'} all play ratings
			</button>

			{#if showAllPlays}
				<div class="all-plays">
					{#each report.plays.filter((p) => p.requiredWeapon !== null) as pa (pa.play.id)}
						<div class="play-row compact">
							<span class="play-dot" style="color: {ratingColor(pa.rating)}">{ratingDot(pa.rating)}</span>
							<span class="play-name">{pa.play.name}</span>
							<span class="play-weapon">{pa.requiredWeapon}</span>
							<span class="play-rate" style="color: {ratingColor(pa.rating)}">
								{Math.round(pa.activationRate * 100)}%
							</span>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.card {
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		border-radius: 12px;
		padding: 1rem;
	}

	.card-title {
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--text-primary, #f1f5f9);
		margin-bottom: 0.75rem;
	}

	.status-ok {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--success, #22c55e);
		font-size: 0.85rem;
	}

	.ok-icon {
		font-size: 1rem;
		font-weight: 700;
	}

	.alert-banner {
		padding: 0.625rem 0.875rem;
		border-radius: 8px;
		margin-bottom: 0.75rem;
		font-size: 0.85rem;
		color: var(--text-primary, #f1f5f9);
	}

	.alert-red {
		background: rgba(239, 68, 68, 0.12);
		border: 1px solid rgba(239, 68, 68, 0.3);
	}

	.alert-yellow {
		background: rgba(245, 158, 11, 0.12);
		border: 1px solid rgba(245, 158, 11, 0.3);
	}

	.weapon-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 0.75rem;
	}

	.weapon-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		border-radius: 6px;
		border: none;
		background: rgba(255, 255, 255, 0.03);
		color: var(--text-primary);
		cursor: pointer;
		font-size: 0.85rem;
		text-align: left;
		width: 100%;
	}

	.weapon-row:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	.weapon-dot,
	.play-dot {
		font-size: 0.65rem;
		flex-shrink: 0;
	}

	.weapon-name {
		font-weight: 600;
		text-transform: capitalize;
		min-width: 4rem;
	}

	.weapon-stats {
		flex: 1;
		color: var(--text-secondary, #94a3b8);
		font-size: 0.8rem;
	}

	.weapon-rate {
		font-weight: 600;
		font-size: 0.85rem;
		min-width: 3rem;
		text-align: right;
	}

	.expand-icon {
		font-size: 0.6rem;
		color: var(--text-tertiary, #64748b);
	}

	.weapon-detail {
		padding: 0.25rem 0.5rem 0.5rem 1.5rem;
	}

	.play-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0;
		font-size: 0.8rem;
	}

	.play-row.compact {
		padding: 0.2rem 0.5rem;
	}

	.play-name {
		flex: 1;
		color: var(--text-primary);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.play-dbs {
		color: var(--text-tertiary, #64748b);
		font-size: 0.75rem;
		flex-shrink: 0;
	}

	.play-weapon {
		color: var(--text-tertiary, #64748b);
		font-size: 0.75rem;
		text-transform: capitalize;
		flex-shrink: 0;
	}

	.play-rate {
		font-weight: 600;
		font-size: 0.8rem;
		flex-shrink: 0;
		min-width: 2.5rem;
		text-align: right;
	}

	.play-explanation {
		font-size: 0.75rem;
		color: var(--text-tertiary, #64748b);
		padding-left: 1.15rem;
		margin: 0 0 0.375rem;
	}

	.suggestions {
		padding: 0.75rem;
		border-radius: 8px;
		background: rgba(59, 130, 246, 0.08);
		border: 1px solid rgba(59, 130, 246, 0.2);
		margin-bottom: 0.75rem;
	}

	.suggestions h4 {
		font-size: 0.8rem;
		font-weight: 600;
		color: #60a5fa;
		margin-bottom: 0.375rem;
	}

	.suggestion-text {
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
		line-height: 1.4;
	}

	.toggle-all {
		display: block;
		width: 100%;
		padding: 0.375rem;
		border: none;
		background: none;
		color: var(--accent-primary, #3b82f6);
		font-size: 0.8rem;
		cursor: pointer;
		text-align: center;
	}

	.toggle-all:hover {
		text-decoration: underline;
	}

	.all-plays {
		display: flex;
		flex-direction: column;
		gap: 1px;
		margin-top: 0.375rem;
	}
</style>
