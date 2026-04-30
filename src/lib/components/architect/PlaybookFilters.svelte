<script lang="ts">
	import {
		isOwnedFilterEnabled,
		setOwnedFilterEnabled,
		getAllowedReleases,
		setAllowedReleases,
		getBonusPlayMode,
		setBonusPlayMode,
		getExcludedPlayNames,
		removeExcludedPlayName,
		clearExcludedPlayNames,
		getUniverse
	} from '$lib/stores/playbook-architect.svelte';

	const universe = $derived(getUniverse());
	const releases = $derived([...new Set(universe.map((p) => p.release))].sort());
	const allowedReleases = $derived(getAllowedReleases());
	const bonusMode = $derived(getBonusPlayMode());
	const excluded = $derived([...getExcludedPlayNames()].sort());
	const useOwned = $derived(isOwnedFilterEnabled());

	const RELEASE_LABELS: Record<string, string> = {
		A: 'Alpha',
		U: 'Update',
		LA: 'Limited Alpha',
		G: 'Griffey 2026',
		HTD: 'Home Team Discount'
	};

	let expanded = $state(false);

	function toggleRelease(rel: string) {
		const next = new Set(allowedReleases);
		if (next.has(rel)) next.delete(rel);
		else next.add(rel);
		setAllowedReleases(next);
	}

	function clearReleaseFilter() {
		setAllowedReleases(new Set());
	}

	function setBonus(mode: 'off' | 'limited' | 'unlimited') {
		setBonusPlayMode(mode);
	}

	function toggleOwned() {
		setOwnedFilterEnabled(!useOwned);
	}

	const filterCount = $derived(
		(useOwned ? 1 : 0) +
			(allowedReleases.size > 0 ? 1 : 0) +
			(bonusMode !== 'unlimited' ? 1 : 0) +
			(excluded.length > 0 ? 1 : 0)
	);
</script>

<div class="filter-card" class:expanded>
	<button class="filter-header" onclick={() => (expanded = !expanded)}>
		<span class="filter-title">Filters</span>
		{#if filterCount > 0}
			<span class="filter-count">{filterCount} active</span>
		{:else}
			<span class="filter-empty">All plays available</span>
		{/if}
		<span class="chevron" class:open={expanded}>▾</span>
	</button>

	{#if expanded}
		<div class="filter-body">
			<!-- Set / Series -->
			<section class="filter-section">
				<header class="section-header">
					<h4 class="section-title">Set</h4>
					{#if allowedReleases.size > 0}
						<button class="link-btn" onclick={clearReleaseFilter}>Clear</button>
					{/if}
				</header>
				<p class="section-hint">
					{allowedReleases.size === 0
						? 'All sets allowed'
						: `Limited to ${allowedReleases.size} set${allowedReleases.size > 1 ? 's' : ''}`}
				</p>
				<div class="chip-row">
					{#each releases as rel}
						<button
							class="chip"
							class:active={allowedReleases.has(rel)}
							onclick={() => toggleRelease(rel)}
						>
							{RELEASE_LABELS[rel] ?? rel}
						</button>
					{/each}
				</div>
			</section>

			<!-- Bonus Plays -->
			<section class="filter-section">
				<header class="section-header">
					<h4 class="section-title">Bonus Plays</h4>
				</header>
				<div class="chip-row">
					<button
						class="chip"
						class:active={bonusMode === 'unlimited'}
						onclick={() => setBonus('unlimited')}
					>
						Unlimited
					</button>
					<button
						class="chip"
						class:active={bonusMode === 'limited'}
						onclick={() => setBonus('limited')}
					>
						Up to 5
					</button>
					<button
						class="chip"
						class:active={bonusMode === 'off'}
						onclick={() => setBonus('off')}
					>
						None
					</button>
				</div>
			</section>

			<!-- Owned filter (opt-in) -->
			<section class="filter-section">
				<header class="section-header">
					<h4 class="section-title">My Collection</h4>
				</header>
				<label class="toggle-row">
					<input type="checkbox" checked={useOwned} onchange={toggleOwned} />
					<span>Only suggest plays I own</span>
				</label>
				<p class="section-hint">
					Off by default. Turn on to see archetype match scores against your scanned collection.
				</p>
			</section>

			<!-- Excluded plays -->
			{#if excluded.length > 0}
				<section class="filter-section">
					<header class="section-header">
						<h4 class="section-title">Excluded Plays</h4>
						<button class="link-btn" onclick={clearExcludedPlayNames}>Clear all</button>
					</header>
					<p class="section-hint">
						Plays you don't want to buy. The engine will work around these.
					</p>
					<div class="chip-row">
						{#each excluded as name}
							<button class="chip excluded" onclick={() => removeExcludedPlayName(name)}>
								{name} ✕
							</button>
						{/each}
					</div>
				</section>
			{:else}
				<section class="filter-section">
					<header class="section-header">
						<h4 class="section-title">Excluded Plays</h4>
					</header>
					<p class="section-hint">
						No exclusions. Right-click any play in the browse tab to exclude it from
						strategy recommendations.
					</p>
				</section>
			{/if}
		</div>
	{/if}
</div>

<style>
	.filter-card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-3);
		overflow: hidden;
	}
	.filter-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-3);
		background: none;
		border: none;
		cursor: pointer;
		font-family: inherit;
		color: inherit;
		text-align: left;
	}
	.filter-title {
		font-family: var(--font-display);
		font-size: var(--text-sm);
		font-weight: var(--font-semibold);
		color: var(--text-primary);
		flex: 1;
	}
	.filter-count {
		font-size: var(--text-xs);
		color: var(--gold);
		font-weight: var(--font-medium);
	}
	.filter-empty {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.chevron {
		font-size: var(--text-base);
		color: var(--text-muted);
		transition: transform var(--transition-fast);
	}
	.chevron.open {
		transform: rotate(180deg);
	}
	.filter-body {
		padding: 0 var(--space-3) var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.filter-section {
		border-top: 1px solid var(--border);
		padding-top: var(--space-3);
	}
	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-1);
	}
	.section-title {
		font-family: var(--font-display);
		font-size: var(--text-xs);
		font-weight: var(--font-semibold);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0;
	}
	.section-hint {
		font-size: var(--text-xs);
		color: var(--text-muted);
		margin: 0 0 var(--space-2);
	}
	.chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.chip {
		font-size: var(--text-xs);
		padding: var(--space-1) var(--space-2);
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		color: var(--text-secondary);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-family: inherit;
		transition:
			background var(--transition-fast),
			border-color var(--transition-fast);
	}
	.chip:hover {
		border-color: var(--border-strong);
	}
	.chip.active {
		background: var(--gold);
		border-color: var(--gold);
		color: var(--bg-base);
		font-weight: var(--font-medium);
	}
	.chip.excluded {
		background: var(--danger-light);
		border-color: rgba(239, 68, 68, 0.3);
		color: var(--danger);
	}
	.toggle-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-secondary);
		cursor: pointer;
		margin-bottom: var(--space-1);
	}
	.toggle-row input {
		cursor: pointer;
	}
	.link-btn {
		font-size: var(--text-xs);
		color: var(--text-muted);
		background: none;
		border: none;
		cursor: pointer;
		font-family: inherit;
		padding: 0;
	}
	.link-btn:hover {
		color: var(--text-primary);
	}
</style>
