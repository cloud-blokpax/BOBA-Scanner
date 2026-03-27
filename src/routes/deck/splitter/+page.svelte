<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { getFormatOptions, getFormat } from '$lib/data/tournament-formats';
	import { PLAYBOOK_ARCHETYPES } from '$lib/data/playbook-archetypes';
	import {
		allocateForMultipleTournaments,
		type TournamentEntry,
		type MultiDeckAllocation,
		type PlayCard,
		type ContestedPlay
	} from '$lib/services/playbook-engine';
	import { showToast } from '$lib/stores/toast.svelte';

	const formatOptions = getFormatOptions();
	const playmakerFormats = $derived(
		formatOptions.filter((f) => {
			const fmt = getFormat(f.id);
			return fmt && fmt.playDeckSize > 0;
		})
	);

	// Entry configuration (2-3 entries)
	let entryCount = $state(2);
	let entryFormats = $state<string[]>(['apex_playmaker', 'spec_playmaker', 'elite_playmaker']);
	let entryArchetypes = $state<string[]>(['mono_steel_fortress', 'free_play_engine', 'dice_aggro']);

	// Owned plays (loaded from collection)
	let ownedPlays = $state<PlayCard[]>([]);
	let loading = $state(true);

	// Allocation result
	let allocation = $state<MultiDeckAllocation | null>(null);

	// Active tab for mobile deck switching
	let activeDeckTab = $state(0);

	const isAuthenticated = $derived(!!$page.data.user);

	async function loadOwnedPlays() {
		loading = true;
		try {
			// Load play cards from the static JSON database
			const mod = await import('$lib/data/play-cards.json');
			ownedPlays = mod.default as PlayCard[];
		} catch {
			showToast('Failed to load play cards', 'error');
		}
		loading = false;
	}

	function runAllocation() {
		const entries: TournamentEntry[] = [];
		for (let i = 0; i < entryCount; i++) {
			const fmt = getFormat(entryFormats[i]);
			if (!fmt) {
				showToast(`Invalid format: ${entryFormats[i]}`, 'error');
				return;
			}
			entries.push({
				formatId: entryFormats[i],
				archetypeId: entryArchetypes[i],
				format: fmt
			});
		}

		allocation = allocateForMultipleTournaments(ownedPlays, entries);
	}

	function swapContestedPlay(contested: ContestedPlay, newDeckIdx: number) {
		if (!allocation) return;

		// Find current deck and remove
		const currentDeck = allocation.decks[contested.assignedTo];
		const newDeck = allocation.decks[newDeckIdx];
		if (!currentDeck || !newDeck) return;

		currentDeck.plays = currentDeck.plays.filter((p) => p.id !== contested.play.id);
		currentDeck.dbsTotal -= contested.play.dbs;

		newDeck.plays = [...newDeck.plays, contested.play];
		newDeck.dbsTotal += contested.play.dbs;

		contested.assignedTo = newDeckIdx;

		// Trigger reactivity
		allocation = { ...allocation };
	}

	function formatName(formatId: string): string {
		const fmt = formatOptions.find((f) => f.id === formatId);
		return fmt?.name || formatId;
	}

	function archetypeName(archId: string): string {
		const a = PLAYBOOK_ARCHETYPES.find((a) => a.id === archId);
		return a?.name || archId;
	}

	onMount(loadOwnedPlays);
</script>

<svelte:head>
	<title>Deck Splitter | BOBA Scanner</title>
</svelte:head>

<div class="splitter-page">
	<div class="page-header">
		<a href="/deck" class="back-link">&larr; Decks</a>
		<h1>Multi-Tournament Deck Splitter</h1>
		<p class="subtitle">Optimally distribute your plays across tournament entries.</p>
	</div>

	{#if !isAuthenticated}
		<div class="auth-prompt">
			<p>Sign in to use the deck splitter with your collection.</p>
			<a href="/auth/login?redirectTo=/deck/splitter" class="btn-primary">Sign In</a>
		</div>
	{:else}
		<!-- Entry Configuration -->
		<section class="config-section">
			<div class="entry-count-row">
				<span>Tournament entries:</span>
				<div class="count-btns">
					{#each [2, 3] as count}
						<button
							class="count-btn"
							class:active={entryCount === count}
							onclick={() => (entryCount = count)}
						>
							{count}
						</button>
					{/each}
				</div>
			</div>

			<div class="entries-config">
				{#each Array(entryCount) as _, i}
					<div class="entry-config">
						<span class="entry-label">Entry {i + 1}</span>
						<select
							bind:value={entryFormats[i]}
							class="entry-select"
						>
							{#each playmakerFormats as fmt}
								<option value={fmt.id}>{fmt.name}</option>
							{/each}
						</select>
						<select
							bind:value={entryArchetypes[i]}
							class="entry-select"
						>
							{#each PLAYBOOK_ARCHETYPES as arch}
								<option value={arch.id}>{arch.name}</option>
							{/each}
						</select>
					</div>
				{/each}
			</div>

			<button
				class="btn-primary"
				onclick={runAllocation}
				disabled={loading || ownedPlays.length === 0}
			>
				{loading ? 'Loading plays...' : 'Run Auto-Allocation'}
			</button>

			{#if ownedPlays.length > 0}
				<span class="play-count">{ownedPlays.length} plays available</span>
			{/if}
		</section>

		{#if allocation}
			<!-- Utilization bar -->
			<div class="utilization">
				<span>{allocation.utilization.used} / {allocation.utilization.total} plays assigned</span>
				<div class="util-bar">
					<div
						class="util-fill"
						style:width="{Math.round((allocation.utilization.used / Math.max(1, allocation.utilization.total)) * 100)}%"
					></div>
				</div>
			</div>

			<!-- Deck tabs (mobile) -->
			<div class="deck-tabs">
				{#each allocation.decks as deck, i}
					<button
						class="deck-tab"
						class:active={activeDeckTab === i}
						onclick={() => (activeDeckTab = i)}
					>
						Entry {i + 1}
						<span class="tab-score">{deck.archetypeMatchScore}%</span>
					</button>
				{/each}
				<button
					class="deck-tab"
					class:active={activeDeckTab === -1}
					onclick={() => (activeDeckTab = -1)}
				>
					Contested
					<span class="tab-count">{allocation.contested.length}</span>
				</button>
			</div>

			<!-- Deck panels -->
			{#each allocation.decks as deck, i}
				<div class="deck-panel" class:visible={activeDeckTab === i}>
					<div class="deck-panel-header">
						<h2>{formatName(deck.formatId)}</h2>
						<span class="arch-badge">{archetypeName(deck.archetypeId)}</span>
					</div>

					<div class="deck-stats-row">
						<div class="deck-stat">
							<span class="stat-value">{deck.plays.length}/{getFormat(deck.formatId)?.playDeckSize || 30}</span>
							<span class="stat-label">Plays</span>
						</div>
						<div class="deck-stat">
							<span class="stat-value">{deck.dbsTotal}</span>
							<span class="stat-label">DBS</span>
						</div>
						<div class="deck-stat">
							<span class="stat-value" class:over={deck.dbsRemaining < 0}>
								{deck.dbsRemaining === Infinity ? 'N/A' : deck.dbsRemaining}
							</span>
							<span class="stat-label">DBS Left</span>
						</div>
						<div class="deck-stat">
							<span class="stat-value">{deck.archetypeMatchScore}%</span>
							<span class="stat-label">Match</span>
						</div>
					</div>

					{#if deck.weakCategories.length > 0}
						<div class="weak-cats">
							<span class="weak-label">Under-filled:</span>
							{#each deck.weakCategories as wc}
								<span class="weak-chip">{wc.categoryId}: {wc.have}/{wc.recommended}</span>
							{/each}
						</div>
					{/if}

					<div class="play-list">
						{#each deck.plays.sort((a, b) => b.dbs - a.dbs) as play (play.id)}
							<div class="play-item">
								<span class="play-name">{play.name}</span>
								<span class="play-meta">{play.dbs} DBS &middot; {play.hot_dog_cost} HD</span>
							</div>
						{/each}
					</div>
				</div>
			{/each}

			<!-- Contested plays panel -->
			<div class="deck-panel contested-panel" class:visible={activeDeckTab === -1}>
				<h2>Contested Plays</h2>
				<p class="contested-desc">These plays were wanted by multiple decks. Tap a deck number to reassign.</p>

				{#if allocation.contested.length === 0}
					<p class="empty-contested">No contested plays — all plays had a clear best deck.</p>
				{:else}
					{#each allocation.contested as cp (cp.play.id)}
						<div class="contested-row">
							<div class="contested-play-info">
								<span class="play-name">{cp.play.name}</span>
								<span class="play-meta">{cp.play.dbs} DBS</span>
							</div>
							<div class="contested-actions">
								{#each cp.wantedBy as wb}
									<button
										class="assign-btn"
										class:current={cp.assignedTo === wb.entryIndex}
										onclick={() => swapContestedPlay(cp, wb.entryIndex)}
										title="Pain: {Math.round(cp.painCost[wb.entryIndex] || 0)}"
									>
										{wb.entryIndex + 1}
									</button>
								{/each}
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<!-- Unallocated -->
			{#if allocation.unallocated.length > 0}
				<details class="unallocated-section">
					<summary>{allocation.unallocated.length} unallocated plays</summary>
					<div class="play-list">
						{#each allocation.unallocated as play (play.id)}
							<div class="play-item muted">
								<span class="play-name">{play.name}</span>
								<span class="play-meta">{play.dbs} DBS</span>
							</div>
						{/each}
					</div>
				</details>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.splitter-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 1rem;
	}

	.page-header {
		margin-bottom: 1.25rem;
	}

	.back-link {
		font-size: 0.85rem;
		color: var(--accent-primary, #3b82f6);
		text-decoration: none;
	}

	.page-header h1 {
		font-size: 1.4rem;
		font-weight: 700;
		color: var(--text-primary, #f1f5f9);
		margin: 0.25rem 0 0.125rem;
	}

	.subtitle {
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
	}

	.auth-prompt {
		text-align: center;
		padding: 3rem 1rem;
		color: var(--text-secondary);
	}

	.btn-primary {
		padding: 0.5rem 1.25rem;
		border-radius: 8px;
		background: var(--accent-primary, #3b82f6);
		color: white;
		border: none;
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
		text-decoration: none;
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.config-section {
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		border-radius: 12px;
		padding: 1rem;
		margin-bottom: 1rem;
	}

	.entry-count-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
		font-size: 0.9rem;
		color: var(--text-primary);
	}

	.count-btns {
		display: flex;
		gap: 4px;
	}

	.count-btn {
		width: 2rem;
		height: 2rem;
		border-radius: 6px;
		border: 1px solid var(--border-color, #1e293b);
		background: transparent;
		color: var(--text-secondary);
		font-weight: 600;
		cursor: pointer;
	}

	.count-btn.active {
		background: rgba(59, 130, 246, 0.15);
		border-color: rgba(59, 130, 246, 0.4);
		color: #60a5fa;
	}

	.entries-config {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.entry-config {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.entry-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		min-width: 4rem;
	}

	.entry-select {
		flex: 1;
		min-width: 120px;
		padding: 0.375rem 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--bg-elevated, #1e293b);
		color: var(--text-primary, #f1f5f9);
		font-size: 0.8rem;
	}

	.play-count {
		font-size: 0.8rem;
		color: var(--text-tertiary, #64748b);
		margin-left: 0.75rem;
	}

	.utilization {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}

	.util-bar {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: var(--bg-elevated, #1e293b);
		overflow: hidden;
	}

	.util-fill {
		height: 100%;
		border-radius: 3px;
		background: var(--accent-primary, #3b82f6);
		transition: width 0.3s;
	}

	.deck-tabs {
		display: flex;
		gap: 2px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 10px;
		padding: 3px;
		margin-bottom: 0.75rem;
	}

	.deck-tab {
		flex: 1;
		padding: 0.5rem;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--text-muted, #475569);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.deck-tab.active {
		background: rgba(59, 130, 246, 0.15);
		color: #60a5fa;
	}

	.tab-score, .tab-count {
		font-size: 0.7rem;
		opacity: 0.7;
	}

	.deck-panel {
		display: none;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		border-radius: 12px;
		padding: 1rem;
		margin-bottom: 0.75rem;
	}

	.deck-panel.visible {
		display: block;
	}

	.deck-panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.deck-panel-header h2 {
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.arch-badge {
		padding: 0.2rem 0.5rem;
		border-radius: 10px;
		background: rgba(245, 158, 11, 0.12);
		color: var(--gold, #f59e0b);
		font-size: 0.7rem;
		font-weight: 600;
	}

	.deck-stats-row {
		display: flex;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	.deck-stat {
		display: flex;
		flex-direction: column;
	}

	.stat-value {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.stat-value.over {
		color: var(--danger, #ef4444);
	}

	.stat-label {
		font-size: 0.7rem;
		color: var(--text-tertiary, #64748b);
	}

	.weak-cats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.weak-label {
		font-size: 0.75rem;
		color: var(--warning, #f59e0b);
	}

	.weak-chip {
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
		background: rgba(245, 158, 11, 0.1);
		color: var(--text-secondary);
		font-size: 0.7rem;
	}

	.play-list {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.play-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.375rem 0.5rem;
		border-radius: 4px;
		font-size: 0.8rem;
	}

	.play-item:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.play-item.muted {
		opacity: 0.5;
	}

	.play-name {
		color: var(--text-primary, #f1f5f9);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.play-meta {
		color: var(--text-tertiary, #64748b);
		font-size: 0.75rem;
		flex-shrink: 0;
		margin-left: 0.5rem;
	}

	.contested-panel h2 {
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 0.25rem;
	}

	.contested-desc {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}

	.empty-contested {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		text-align: center;
		padding: 1rem;
	}

	.contested-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.375rem 0.5rem;
		border-radius: 6px;
	}

	.contested-row:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.contested-play-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
	}

	.contested-actions {
		display: flex;
		gap: 4px;
	}

	.assign-btn {
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 6px;
		border: 1px solid var(--border-color, #1e293b);
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.75rem;
		font-weight: 700;
		cursor: pointer;
	}

	.assign-btn.current {
		background: rgba(59, 130, 246, 0.2);
		border-color: rgba(59, 130, 246, 0.4);
		color: #60a5fa;
	}

	.unallocated-section {
		margin-top: 0.75rem;
	}

	.unallocated-section summary {
		font-size: 0.85rem;
		color: var(--text-secondary);
		cursor: pointer;
		padding: 0.5rem;
	}
</style>
