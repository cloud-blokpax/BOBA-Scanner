<script lang="ts">
	import { onMount } from 'svelte';
	import { getFormatOptions, getFormat } from '$lib/data/tournament-formats';
	import {
		buildMetaSnapshot,
		generateCounterRecommendations,
		type DeckSubmissionData,
		type MetaSnapshot,
		type CounterRecommendation
	} from '$lib/services/meta-analyzer';
	import { showToast } from '$lib/stores/toast.svelte';

	const formatOptions = getFormatOptions().filter((f) => {
		const fmt = getFormat(f.id);
		return fmt && fmt.playDeckSize > 0;
	});

	let selectedFormat = $state('apex_playmaker');
	let days = $state(90);
	let loading = $state(false);
	let meta = $state<MetaSnapshot | null>(null);
	let counters = $state<CounterRecommendation[]>([]);

	// Active section tab
	let activeSection = $state<'overview' | 'cards' | 'combos' | 'counters'>('overview');

	async function loadMeta() {
		loading = true;
		try {
			const res = await fetch(`/api/meta/${encodeURIComponent(selectedFormat)}?days=${days}`);
			if (!res.ok) {
				showToast('Failed to load meta data', 'error');
				return;
			}
			const data = await res.json();
			const submissions: DeckSubmissionData[] = data.submissions || [];
			meta = buildMetaSnapshot(submissions, selectedFormat);
			counters = generateCounterRecommendations(meta);
		} catch {
			showToast('Network error loading meta data', 'error');
		} finally {
			loading = false;
		}
	}

	function pct(value: number): string {
		return `${Math.round(value * 100)}%`;
	}

	function confidenceColor(c: 'low' | 'medium' | 'high'): string {
		if (c === 'high') return 'var(--success, #22c55e)';
		if (c === 'medium') return 'var(--warning, #f59e0b)';
		return 'var(--text-tertiary, #64748b)';
	}

	onMount(loadMeta);
</script>

<svelte:head>
	<title>Meta Analysis | BOBA Scanner</title>
</svelte:head>

<div class="meta-page">
	<div class="page-header">
		<a href="/deck" class="back-link">&larr; Decks</a>
		<h1>Meta Analysis</h1>
		<p class="subtitle">Tournament meta trends and counter-build recommendations.</p>
	</div>

	<!-- Format & time selector -->
	<div class="controls">
		<select bind:value={selectedFormat} class="format-select" onchange={loadMeta}>
			{#each formatOptions as fmt}
				<option value={fmt.id}>{fmt.name} ({fmt.division})</option>
			{/each}
		</select>
		<select bind:value={days} class="days-select" onchange={loadMeta}>
			<option value={30}>Last 30 days</option>
			<option value={90}>Last 90 days</option>
			<option value={180}>Last 6 months</option>
			<option value={365}>Last year</option>
		</select>
	</div>

	{#if loading}
		<div class="loading">Loading meta data...</div>
	{:else if meta && meta.sampleSize === 0}
		<div class="empty-state">
			<p>Not enough data for this format yet.</p>
			<p class="hint">Meta analysis requires deck submissions from completed tournaments.</p>
		</div>
	{:else if meta}
		<!-- Sample size badge -->
		<div class="sample-badge">
			{meta.sampleSize} deck{meta.sampleSize !== 1 ? 's' : ''} analyzed
			{#if meta.dateRange.from}
				&middot; {meta.dateRange.from.slice(0, 10)} to {meta.dateRange.to.slice(0, 10)}
			{/if}
		</div>

		{#if meta.sampleSize < 5}
			<div class="low-data-banner">
				Low sample size — trends may not be representative.
			</div>
		{/if}

		<!-- Section tabs -->
		<div class="section-tabs">
			<button class="section-tab" class:active={activeSection === 'overview'} onclick={() => (activeSection = 'overview')}>Overview</button>
			<button class="section-tab" class:active={activeSection === 'cards'} onclick={() => (activeSection = 'cards')}>Card Heatmap</button>
			<button class="section-tab" class:active={activeSection === 'combos'} onclick={() => (activeSection = 'combos')}>Combo Engines</button>
			<button class="section-tab" class:active={activeSection === 'counters'} onclick={() => (activeSection = 'counters')}>
				Counters
				{#if counters.length > 0}
					<span class="counter-count">{counters.length}</span>
				{/if}
			</button>
		</div>

		<!-- Overview Tab -->
		{#if activeSection === 'overview'}
			<section class="section-panel">
				<h2>Archetype Prevalence</h2>
				{#each meta.archetypeBreakdown as arch}
					<div class="arch-row">
						<span class="arch-name">{arch.name}</span>
						<div class="arch-bar-wrap">
							<div class="arch-bar" style:width="{Math.round(arch.prevalence * 100)}%"></div>
						</div>
						<span class="arch-pct">{pct(arch.prevalence)}</span>
						{#if arch.avgWinRate !== null}
							<span class="arch-wr" class:good={arch.avgWinRate > 0.55} class:bad={arch.avgWinRate < 0.45}>
								{pct(arch.avgWinRate)} WR
							</span>
						{/if}
					</div>
				{/each}

				<h2 class="mt">Weapon Distribution</h2>
				{#each Object.entries(meta.weaponDistribution).sort((a, b) => b[1].percent - a[1].percent) as [weapon, stats]}
					<div class="weapon-row">
						<span class="weapon-name">{weapon}</span>
						<div class="arch-bar-wrap">
							<div class="weapon-bar" style:width="{Math.round(stats.percent * 100)}%"></div>
						</div>
						<span class="arch-pct">{pct(stats.percent)}</span>
					</div>
				{/each}

				<h2 class="mt">DBS Usage</h2>
				<div class="stats-grid">
					<div class="stat-box">
						<span class="stat-val">{Math.round(meta.dbsStats.avg)}</span>
						<span class="stat-lbl">Avg DBS</span>
					</div>
					<div class="stat-box">
						<span class="stat-val">{meta.dbsStats.median}</span>
						<span class="stat-lbl">Median</span>
					</div>
					<div class="stat-box">
						<span class="stat-val">{meta.dbsStats.min}-{meta.dbsStats.max}</span>
						<span class="stat-lbl">Range</span>
					</div>
				</div>

				<h2 class="mt">Power Stats</h2>
				<div class="stats-grid">
					<div class="stat-box">
						<span class="stat-val">{Math.round(meta.powerStats.avgTotal)}</span>
						<span class="stat-lbl">Avg Total</span>
					</div>
					<div class="stat-box">
						<span class="stat-val">{Math.round(meta.powerStats.avgPerHero)}</span>
						<span class="stat-lbl">Avg/Hero</span>
					</div>
					<div class="stat-box">
						<span class="stat-val">{Math.round(meta.powerStats.avgMax)}</span>
						<span class="stat-lbl">Avg Max</span>
					</div>
				</div>
			</section>
		{/if}

		<!-- Card Heatmap Tab -->
		{#if activeSection === 'cards'}
			<section class="section-panel">
				<h2>Most Included Plays</h2>
				<div class="card-table">
					<div class="table-header">
						<span class="col-name">Card</span>
						<span class="col-num">Incl %</span>
						<span class="col-num">DBS</span>
						<span class="col-num">WR Delta</span>
					</div>
					{#each meta.cardInclusionRates.slice(0, 30) as card}
						{@const performer = meta.topPerformers.find((t) => t.cardNumber === card.cardNumber)}
						<div class="table-row" class:staple={card.inclusionRate > 0.5} class:gem={performer && performer.winRateDelta > 0.05 && card.inclusionRate < 0.3}>
							<span class="col-name">{card.name}</span>
							<span class="col-num">{pct(card.inclusionRate)}</span>
							<span class="col-num">{card.dbs}</span>
							<span class="col-num" class:positive={performer && performer.winRateDelta > 0} class:negative={performer && performer.winRateDelta < 0}>
								{performer ? (performer.winRateDelta > 0 ? '+' : '') + Math.round(performer.winRateDelta * 100) + '%' : '—'}
							</span>
						</div>
					{/each}
				</div>

				{#if meta.topPerformers.length > 0}
					<h2 class="mt">Hidden Gems</h2>
					<p class="hint">High win rate delta, low inclusion — underexploited cards.</p>
					{#each meta.topPerformers.filter((t) => t.inclusionRate < 0.3 && t.winRateDelta > 0).slice(0, 10) as gem}
						<div class="gem-row">
							<span class="play-name">{gem.name}</span>
							<span class="gem-stat">{pct(gem.inclusionRate)} incl</span>
							<span class="gem-stat positive">+{Math.round(gem.winRateDelta * 100)}% WR</span>
						</div>
					{/each}
				{/if}
			</section>
		{/if}

		<!-- Combo Engines Tab -->
		{#if activeSection === 'combos'}
			<section class="section-panel">
				<h2>Combo Engine Popularity</h2>
				{#if meta.comboFrequency.length === 0}
					<p class="empty-msg">No combo engines detected in submissions.</p>
				{:else}
					{#each meta.comboFrequency as combo}
						<div class="combo-row">
							<span class="combo-name">{combo.name}</span>
							<div class="combo-bars">
								<div class="combo-bar-label">Complete</div>
								<div class="combo-bar-wrap">
									<div class="combo-bar complete-bar" style:width="{Math.round(combo.completeRate * 100)}%"></div>
								</div>
								<span class="combo-pct">{pct(combo.completeRate)}</span>
							</div>
							<div class="combo-bars">
								<div class="combo-bar-label">Partial</div>
								<div class="combo-bar-wrap">
									<div class="combo-bar partial-bar" style:width="{Math.round(combo.partialRate * 100)}%"></div>
								</div>
								<span class="combo-pct">{pct(combo.partialRate)}</span>
							</div>
						</div>
					{/each}
				{/if}
			</section>
		{/if}

		<!-- Counter Recommendations Tab -->
		{#if activeSection === 'counters'}
			<section class="section-panel">
				<h2>Counter Recommendations</h2>
				{#if counters.length === 0}
					<p class="empty-msg">No strong meta trends to counter — the field is diverse.</p>
				{:else}
					{#each counters as rec, i}
						<div class="counter-card">
							<div class="counter-header">
								<span class="counter-trend">{rec.metaTrend}</span>
								<span class="confidence-badge" style="color: {confidenceColor(rec.confidence)}">{rec.confidence}</span>
							</div>
							<p class="counter-strategy">{rec.counterStrategy}</p>
							{#if rec.recommendedCards.length > 0}
								<div class="counter-cards">
									<span class="counter-label">Include:</span>
									{#each rec.recommendedCards as card}
										<span class="rec-chip include">{card}</span>
									{/each}
								</div>
							{/if}
							{#if rec.cardsToAvoid.length > 0}
								<div class="counter-cards">
									<span class="counter-label">Avoid:</span>
									{#each rec.cardsToAvoid as card}
										<span class="rec-chip avoid">{card}</span>
									{/each}
								</div>
							{/if}
							{#if rec.suggestedArchetype}
								<div class="suggested-arch">
									Try: <a href="/deck/architect?archetype={rec.suggestedArchetype}">{rec.suggestedArchetype.replace(/_/g, ' ')}</a>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</section>
		{/if}
	{/if}
</div>

<style>
	.meta-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 1rem;
	}

	.page-header { margin-bottom: 1rem; }

	.back-link {
		font-size: 0.85rem;
		color: var(--accent-primary, #3b82f6);
		text-decoration: none;
	}

	.page-header h1 { font-size: 1.4rem; font-weight: 700; color: var(--text-primary); margin: 0.25rem 0 0.125rem; }
	.subtitle { font-size: 0.85rem; color: var(--text-secondary); }

	.controls { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
	.format-select, .days-select {
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--bg-elevated, #1e293b);
		color: var(--text-primary);
		font-size: 0.85rem;
	}
	.format-select { flex: 1; min-width: 180px; }

	.loading, .empty-state { text-align: center; padding: 3rem 1rem; color: var(--text-secondary); }
	.hint { font-size: 0.8rem; color: var(--text-tertiary); margin-top: 0.25rem; }

	.sample-badge {
		font-size: 0.8rem;
		color: var(--text-secondary);
		padding: 0.375rem 0.75rem;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 6px;
		display: inline-block;
		margin-bottom: 0.75rem;
	}

	.low-data-banner {
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.3);
		font-size: 0.8rem;
		color: var(--warning, #f59e0b);
		margin-bottom: 0.75rem;
	}

	.section-tabs {
		display: flex;
		gap: 2px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 10px;
		padding: 3px;
		margin-bottom: 1rem;
	}

	.section-tab {
		flex: 1;
		padding: 0.5rem 0.5rem;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--text-muted, #475569);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		position: relative;
	}

	.section-tab.active { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }

	.counter-count {
		display: inline-block;
		background: rgba(239, 68, 68, 0.2);
		color: #ef4444;
		font-size: 0.65rem;
		padding: 0 0.3rem;
		border-radius: 8px;
		margin-left: 0.25rem;
	}

	.section-panel {
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		border-radius: 12px;
		padding: 1rem;
	}

	.section-panel h2 { font-size: 0.95rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.625rem; }
	.mt { margin-top: 1.25rem; }

	/* Archetype bars */
	.arch-row, .weapon-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; font-size: 0.8rem; }
	.arch-name, .weapon-name { min-width: 6rem; color: var(--text-primary); text-transform: capitalize; }
	.arch-bar-wrap { flex: 1; height: 6px; border-radius: 3px; background: var(--bg-elevated, #1e293b); overflow: hidden; }
	.arch-bar { height: 100%; border-radius: 3px; background: #3b82f6; }
	.weapon-bar { height: 100%; border-radius: 3px; background: #f59e0b; }
	.arch-pct { min-width: 2.5rem; text-align: right; color: var(--text-secondary); font-size: 0.8rem; }
	.arch-wr { min-width: 3.5rem; text-align: right; font-size: 0.75rem; color: var(--text-tertiary); }
	.arch-wr.good { color: var(--success, #22c55e); }
	.arch-wr.bad { color: var(--danger, #ef4444); }

	/* Stats grid */
	.stats-grid { display: flex; gap: 0.75rem; flex-wrap: wrap; }
	.stat-box { background: rgba(255, 255, 255, 0.04); border-radius: 8px; padding: 0.625rem 0.875rem; display: flex; flex-direction: column; min-width: 5rem; }
	.stat-val { font-size: 1rem; font-weight: 700; color: var(--text-primary); }
	.stat-lbl { font-size: 0.7rem; color: var(--text-tertiary); }

	/* Card table */
	.card-table { display: flex; flex-direction: column; gap: 1px; }
	.table-header { display: flex; gap: 0.5rem; padding: 0.375rem 0.5rem; font-size: 0.7rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; border-bottom: 1px solid var(--border-color); }
	.table-row { display: flex; gap: 0.5rem; padding: 0.375rem 0.5rem; font-size: 0.8rem; align-items: center; }
	.table-row:hover { background: rgba(255, 255, 255, 0.03); }
	.table-row.staple { background: rgba(59, 130, 246, 0.06); }
	.table-row.gem { background: rgba(34, 197, 94, 0.06); }
	.col-name { flex: 1; color: var(--text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.col-num { min-width: 3rem; text-align: right; color: var(--text-secondary); font-size: 0.8rem; }
	.positive { color: var(--success, #22c55e); }
	.negative { color: var(--danger, #ef4444); }

	.gem-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.5rem; font-size: 0.8rem; }
	.gem-stat { font-size: 0.75rem; color: var(--text-secondary); }

	.play-name { flex: 1; color: var(--text-primary); }

	/* Combo rows */
	.combo-row { margin-bottom: 0.75rem; }
	.combo-name { font-weight: 600; font-size: 0.85rem; color: var(--text-primary); display: block; margin-bottom: 0.25rem; }
	.combo-bars { display: flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; }
	.combo-bar-label { min-width: 4rem; color: var(--text-tertiary); font-size: 0.7rem; }
	.combo-bar-wrap { flex: 1; height: 5px; border-radius: 3px; background: var(--bg-elevated); overflow: hidden; }
	.combo-bar { height: 100%; border-radius: 3px; }
	.complete-bar { background: var(--success, #22c55e); }
	.partial-bar { background: var(--warning, #f59e0b); }
	.combo-pct { min-width: 2.5rem; text-align: right; color: var(--text-secondary); }
	.empty-msg { font-size: 0.85rem; color: var(--text-tertiary); text-align: center; padding: 1rem; }

	/* Counter cards */
	.counter-card {
		background: rgba(255, 255, 255, 0.03);
		border-radius: 10px;
		padding: 0.875rem;
		margin-bottom: 0.75rem;
	}

	.counter-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.375rem; }
	.counter-trend { font-size: 0.85rem; font-weight: 600; color: var(--text-primary); }
	.confidence-badge { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; flex-shrink: 0; }
	.counter-strategy { font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4; margin-bottom: 0.5rem; }
	.counter-cards { display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; margin-bottom: 0.375rem; }
	.counter-label { font-size: 0.7rem; font-weight: 600; color: var(--text-tertiary); }
	.rec-chip { padding: 0.125rem 0.375rem; border-radius: 4px; font-size: 0.75rem; }
	.rec-chip.include { background: rgba(34, 197, 94, 0.12); color: #22c55e; }
	.rec-chip.avoid { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
	.suggested-arch { font-size: 0.8rem; color: var(--text-tertiary); }
	.suggested-arch a { color: var(--accent-primary, #3b82f6); text-decoration: none; text-transform: capitalize; }
</style>
