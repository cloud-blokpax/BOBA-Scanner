<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { showToast } from '$lib/stores/toast.svelte';
	import {
		selectedPlays,
		setFormat,
		setOwnedPlays,
		addPlay,
		removePlay,
		clearPlaybook,
		buildFromArchetype,
		currentFormatId,
		currentArchetypeId,
		setArchetype,
		getDBSAnalysis,
		getHDFlow,
		getDrawProbability,
		getCombos,
		getHeroRecommendation,
		getArchetypeMatches,
		getStandardPlays,
		getBonusPlays
	} from '$lib/stores/playbook-architect.svelte';
	import type { PlayCard } from '$lib/services/playbook-engine';
	import { getFormatOptions } from '$lib/data/tournament-formats';
	import { getPlayCards } from '$lib/data/play-cards';

	import DBSBudgetCard from '$lib/components/architect/DBSBudgetCard.svelte';
	import HDFlowCard from '$lib/components/architect/HDFlowCard.svelte';
	import DrawConsistencyCard from '$lib/components/architect/DrawConsistencyCard.svelte';
	import ComboStatusCard from '$lib/components/architect/ComboStatusCard.svelte';
	import ArchetypeSelector from '$lib/components/architect/ArchetypeSelector.svelte';
	import PlayBrowser from '$lib/components/architect/PlayBrowser.svelte';

	const formatOptions = getFormatOptions();
	const allPlays = getPlayCards().filter(
		(p) => p.type === 'PL' || p.type === 'BPL'
	);

	let activeTab = $state<'browse' | 'strategy' | 'selected'>('strategy');

	const selected = $derived(selectedPlays());
	const selectedNameSet = $derived(new Set(selected.map((p) => p.name)));
	const dbsAnalysis = $derived(getDBSAnalysis());
	const hdFlow = $derived(getHDFlow());
	const drawProb = $derived(getDrawProbability());
	const combos = $derived(getCombos());
	const heroRec = $derived(getHeroRecommendation());
	const archetypeMatches = $derived(getArchetypeMatches());
	const archId = $derived(currentArchetypeId());
	const fmtId = $derived(currentFormatId());
	const standardPlays = $derived(getStandardPlays());
	const bonusPlays = $derived(getBonusPlays());

	// Playmaker formats only (those with playDeckSize > 0)
	const playmakerFormats = $derived(
		formatOptions.filter((f) => f.id !== 'apex_madness')
	);

	function handleFormatChange(e: Event) {
		const val = (e.target as HTMLSelectElement).value;
		setFormat(val);
	}

	function handleArchetypeSelect(id: string) {
		const result = buildFromArchetype(id);
		if (result.missing.length > 0) {
			showToast(`Strategy loaded. Missing ${result.missing.length} combo pieces.`, 'info');
		} else if (result.selected.length > 0) {
			showToast('Strategy loaded with all combo pieces!', 'check');
		}
	}

	function handleAddPlay(play: PlayCard) {
		addPlay(play);
	}

	function handleRemovePlay(name: string) {
		removePlay(name);
	}

	function handleClear() {
		clearPlaybook();
		setArchetype(null);
	}

	onMount(() => {
		// Initialize with all plays as "owned" for now
		// In full implementation, this would load from user's scanned collection
		setOwnedPlays(allPlays);
	});
</script>

<svelte:head>
	<title>Playbook Architect | Card Scanner</title>
</svelte:head>

<div class="architect-page">
	<header class="page-header">
		<div class="header-top">
			<h1 class="page-title">Playbook Architect</h1>
			<button class="btn-clear" onclick={handleClear} disabled={selected.length === 0}>
				Clear
			</button>
		</div>
		<p class="page-subtitle">Build your competitive playbook with real-time analytics</p>

		<div class="format-row">
			<label class="format-label" for="format-select">Format</label>
			<select
				id="format-select"
				class="format-select"
				value={fmtId}
				onchange={handleFormatChange}
			>
				{#each playmakerFormats as fmt}
					<option value={fmt.id}>{fmt.name}</option>
				{/each}
			</select>
		</div>
	</header>

	<div class="layout">
		<!-- Selection Panel -->
		<section class="selection-panel">
			<div class="tabs">
				<button
					class="tab"
					class:active={activeTab === 'strategy'}
					onclick={() => (activeTab = 'strategy')}
				>
					Pick a Strategy
				</button>
				<button
					class="tab"
					class:active={activeTab === 'browse'}
					onclick={() => (activeTab = 'browse')}
				>
					Add Plays
				</button>
				<button
					class="tab"
					class:active={activeTab === 'selected'}
					onclick={() => (activeTab = 'selected')}
				>
					Selected ({selected.length})
				</button>
			</div>

			<div class="tab-content">
				{#if activeTab === 'strategy'}
					<ArchetypeSelector
						matches={archetypeMatches}
						selectedId={archId}
						onselect={handleArchetypeSelect}
					/>
				{:else if activeTab === 'browse'}
					<PlayBrowser
						{allPlays}
						selectedNames={selectedNameSet}
						onadd={handleAddPlay}
						onremove={handleRemovePlay}
					/>
				{:else}
					<!-- Selected plays list -->
					<div class="selected-list">
						{#if selected.length === 0}
							<p class="empty-state">
								No plays selected yet. Pick a strategy or browse plays to get started.
							</p>
						{:else}
							<div class="selected-section">
								{#if standardPlays.length > 0}
									<h4 class="section-label">
										Standard Plays ({standardPlays.length}/30)
									</h4>
									{#each standardPlays as play (play.id)}
										<div class="selected-item">
											<div class="selected-info">
												<span class="selected-name">{play.name}</span>
												<span class="selected-meta">
													{play.dbs} DBS / {play.hot_dog_cost} HD
												</span>
											</div>
											<button
												class="btn-remove"
												onclick={() => handleRemovePlay(play.name)}
											>
												&times;
											</button>
										</div>
									{/each}
								{/if}

								{#if bonusPlays.length > 0}
									<h4 class="section-label">
										Bonus Plays ({bonusPlays.length})
									</h4>
									{#each bonusPlays as play (play.id)}
										<div class="selected-item bpl">
											<div class="selected-info">
												<span class="selected-name">{play.name}</span>
												<span class="selected-meta">
													{play.dbs} DBS / {play.hot_dog_cost} HD
													<span class="bpl-label">BPL</span>
												</span>
											</div>
											<button
												class="btn-remove"
												onclick={() => handleRemovePlay(play.name)}
											>
												&times;
											</button>
										</div>
									{/each}
								{/if}
							</div>

							<div class="total-row">
								<span>Total DBS: {selected.reduce((s, p) => s + p.dbs, 0)}</span>
								<span>Total HD: {selected.reduce((s, p) => s + p.hot_dog_cost, 0)}</span>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</section>

		<!-- Analytics Dashboard -->
		<section class="analytics-panel">
			<h2 class="panel-title">Analytics</h2>
			<div class="analytics-stack">
				<DBSBudgetCard analysis={dbsAnalysis} />
				<HDFlowCard flow={hdFlow} />
				<DrawConsistencyCard analysis={drawProb} />
				<ComboStatusCard {combos} {heroRec} />
			</div>
		</section>
	</div>
</div>

<style>
	.architect-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: var(--space-4);
		padding-bottom: 100px;
	}

	/* Header */
	.page-header {
		margin-bottom: var(--space-6);
	}
	.header-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.page-title {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: var(--font-bold);
		color: var(--text-primary);
		margin: 0;
	}
	.page-subtitle {
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin: var(--space-1) 0 var(--space-4);
	}
	.btn-clear {
		font-size: var(--text-xs);
		color: var(--text-muted);
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-3);
		cursor: pointer;
		font-family: var(--font-sans);
		transition: color var(--transition-fast);
	}
	.btn-clear:hover:not(:disabled) {
		color: var(--danger);
	}
	.btn-clear:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.format-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.format-label {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		font-weight: var(--font-medium);
	}
	.format-select {
		flex: 1;
		max-width: 280px;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-input);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: var(--text-sm);
		font-family: var(--font-sans);
	}

	/* Layout */
	.layout {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	@media (min-width: 768px) {
		.layout {
			flex-direction: row;
		}
		.selection-panel {
			flex: 1;
			min-width: 0;
		}
		.analytics-panel {
			width: 360px;
			flex-shrink: 0;
		}
	}

	/* Tabs */
	.tabs {
		display: flex;
		gap: var(--space-1);
		margin-bottom: var(--space-3);
		border-bottom: 1px solid var(--border);
		padding-bottom: var(--space-1);
	}
	.tab {
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--text-muted);
		background: none;
		border: none;
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
		border-bottom: 2px solid transparent;
		font-family: var(--font-sans);
		transition: color var(--transition-fast), border-color var(--transition-fast);
	}
	.tab:hover {
		color: var(--text-secondary);
	}
	.tab.active {
		color: var(--gold);
		border-bottom-color: var(--gold);
	}
	.tab-content {
		min-height: 300px;
	}

	/* Selected list */
	.selected-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.empty-state {
		font-size: var(--text-sm);
		color: var(--text-muted);
		text-align: center;
		padding: var(--space-8) var(--space-4);
	}
	.section-label {
		font-family: var(--font-display);
		font-size: var(--text-xs);
		font-weight: var(--font-semibold);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: var(--space-3) 0 var(--space-1);
	}
	.selected-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.selected-item.bpl {
		border-left: 3px solid var(--gold);
	}
	.selected-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.selected-name {
		font-size: var(--text-sm);
		color: var(--text-primary);
		font-weight: var(--font-medium);
	}
	.selected-meta {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.bpl-label {
		color: var(--gold);
		font-weight: var(--font-semibold);
		margin-left: var(--space-1);
	}
	.btn-remove {
		font-size: var(--text-lg);
		color: var(--text-muted);
		background: none;
		border: none;
		cursor: pointer;
		padding: 0 var(--space-2);
		line-height: 1;
		transition: color var(--transition-fast);
	}
	.btn-remove:hover {
		color: var(--danger);
	}
	.total-row {
		display: flex;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-sm);
		color: var(--text-secondary);
		border-top: 1px solid var(--border);
		margin-top: var(--space-2);
	}

	/* Analytics panel */
	.panel-title {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: var(--font-bold);
		color: var(--text-primary);
		margin: 0 0 var(--space-3);
	}
	.analytics-stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
</style>
