<!--
	Market Explorer Filter Panel

	Renders the filter toggle bar, expanded filter panel, and active filter chips.
-->
<script lang="ts">
	import type { ExplorerFilters } from './use-explorer-filters.svelte';
	import type { Facets } from './explorer-types';

	let {
		filters,
		facets,
		gameId = 'boba',
	}: {
		filters: ExplorerFilters;
		facets: Facets | null;
		gameId?: string;
	} = $props();

	const SORT_OPTIONS = [
		{ value: 'price_asc', label: 'Cheapest First' },
		{ value: 'price_desc', label: 'Most Expensive' },
		{ value: 'power_desc', label: 'Highest Power' },
		{ value: 'power_per_dollar', label: 'Best $/Power' },
		{ value: 'listings', label: 'Most Listed' },
		{ value: 'confidence', label: 'Highest Confidence' },
	];
</script>

<!-- Card Type Toggle -->
<div class="type-toggle">
	<button class="type-btn" class:active={filters.cardType === 'hero'} onclick={() => filters.setCardType('hero')}>
		Heroes
	</button>
	<button class="type-btn" class:active={filters.cardType === 'play'} onclick={() => filters.setCardType('play')}>
		Plays
	</button>
</div>

<!-- Filter Bar -->
<div class="filter-bar">
	<button class="filter-toggle" onclick={() => filters.setFiltersExpanded(!filters.filtersExpanded)}>
		Filters
		{#if filters.activeFilterCount > 0}
			<span class="filter-badge">{filters.activeFilterCount}</span>
		{/if}
		<span class="filter-arrow" class:open={filters.filtersExpanded}>{'\u25BE'}</span>
	</button>

	<label class="priced-toggle">
		<input type="checkbox" checked={filters.pricedOnly} onchange={() => filters.setPricedOnly(!filters.pricedOnly)} />
		Priced
	</label>

	<select class="sort-select" value={filters.sort} onchange={(e) => filters.setSort((e.target as HTMLSelectElement).value)}>
		{#each SORT_OPTIONS as opt}
			<option value={opt.value}>{opt.label}</option>
		{/each}
	</select>
</div>

{#if filters.filtersExpanded}
	<div class="filters-panel">
		{#if filters.cardType === 'hero'}
			{#if gameId !== 'wonders'}
				<div class="filter-row">
					<label class="filter-label">
						Parallel
						<select class="filter-select" value={filters.parallel} onchange={(e) => filters.setParallel((e.target as HTMLSelectElement).value)}>
							<option value="">All</option>
							{#if facets?.parallel}
								{#each facets.parallel as f}
									<option value={f.value}>{f.value} ({f.count})</option>
								{/each}
							{/if}
						</select>
					</label>

					<label class="filter-label">
						Weapon
						<select class="filter-select" value={filters.weapon} onchange={(e) => filters.setWeapon((e.target as HTMLSelectElement).value)}>
							<option value="">All</option>
							{#if facets?.weapon}
								{#each facets.weapon as f}
									<option value={f.value}>{f.value} ({f.count})</option>
								{/each}
							{/if}
						</select>
					</label>
				</div>
			{/if}

			<div class="filter-row">
				<label class="filter-label">
					Set
					<select class="filter-select" value={filters.set} onchange={(e) => filters.setSet((e.target as HTMLSelectElement).value)}>
						<option value="">All</option>
						{#if facets?.set}
							{#each facets.set as f}
								<option value={f.value}>{f.value} ({f.count})</option>
							{/each}
						{/if}
					</select>
				</label>

				<label class="filter-label">
					Rarity
					<select class="filter-select" value={filters.rarity} onchange={(e) => filters.setRarity((e.target as HTMLSelectElement).value)}>
						<option value="">All</option>
						{#if facets?.rarity}
							{#each facets.rarity as f}
								<option value={f.value}>{f.value} ({f.count})</option>
							{/each}
						{/if}
					</select>
				</label>
			</div>

			{#if gameId !== 'wonders'}
				<div class="filter-row">
					<label class="filter-label">
						Hero
						<select class="filter-select" value={filters.hero} onchange={(e) => filters.setHero((e.target as HTMLSelectElement).value)}>
							<option value="">All Heroes</option>
							{#if facets?.hero}
								{#each facets.hero as f}
									<option value={f.value}>{f.value} ({f.count})</option>
								{/each}
							{/if}
						</select>
					</label>
				</div>

				<div class="filter-row">
					<label class="filter-label">
						Power Min
						<input class="filter-input" type="number" placeholder="e.g. 100" value={filters.powerMin} oninput={(e) => filters.setPowerMin((e.target as HTMLInputElement).value)} />
					</label>
					<label class="filter-label">
						Power Max
						<input class="filter-input" type="number" placeholder="e.g. 170" value={filters.powerMax} oninput={(e) => filters.setPowerMax((e.target as HTMLInputElement).value)} />
					</label>
				</div>
			{/if}
		{/if}

		<div class="filter-row">
			<label class="filter-label">
				Price Min ($)
				<input class="filter-input" type="number" step="0.01" placeholder="e.g. 5" value={filters.priceMin} oninput={(e) => filters.setPriceMin((e.target as HTMLInputElement).value)} />
			</label>
			<label class="filter-label">
				Price Max ($)
				<input class="filter-input" type="number" step="0.01" placeholder="e.g. 100" value={filters.priceMax} oninput={(e) => filters.setPriceMax((e.target as HTMLInputElement).value)} />
			</label>
		</div>

		{#if filters.activeFilterCount > 0}
			<button class="clear-btn" onclick={() => filters.clearFilters()}>Clear All Filters</button>
		{/if}
	</div>
{/if}

<!-- Active Filter Chips -->
{#if filters.activeFilterCount > 0}
	<div class="active-chips">
		{#if filters.parallel}
			<button class="chip" onclick={() => filters.setParallel('')}>
				{filters.parallel} &times;
			</button>
		{/if}
		{#if filters.weapon}
			<button class="chip" onclick={() => filters.setWeapon('')}>
				{filters.weapon} &times;
			</button>
		{/if}
		{#if filters.set}
			<button class="chip" onclick={() => filters.setSet('')}>
				Set: {filters.set} &times;
			</button>
		{/if}
		{#if filters.hero}
			<button class="chip" onclick={() => filters.setHero('')}>
				{filters.hero} &times;
			</button>
		{/if}
		{#if filters.rarity}
			<button class="chip" onclick={() => filters.setRarity('')}>
				{filters.rarity} &times;
			</button>
		{/if}
		{#if filters.powerMin}
			<button class="chip" onclick={() => filters.setPowerMin('')}>
				Power &ge; {filters.powerMin} &times;
			</button>
		{/if}
		{#if filters.powerMax}
			<button class="chip" onclick={() => filters.setPowerMax('')}>
				Power &le; {filters.powerMax} &times;
			</button>
		{/if}
		{#if filters.priceMin}
			<button class="chip" onclick={() => filters.setPriceMin('')}>
				${filters.priceMin}+ &times;
			</button>
		{/if}
		{#if filters.priceMax}
			<button class="chip" onclick={() => filters.setPriceMax('')}>
				&le; ${filters.priceMax} &times;
			</button>
		{/if}
	</div>
{/if}

<style>
	/* ── Card Type Toggle ─────────────────────────── */
	.type-toggle {
		display: flex;
		gap: 2px;
		background: var(--bg-surface);
		border-radius: var(--radius-lg);
		padding: 2px;
		margin-bottom: var(--space-3);
	}
	.type-btn {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--text-secondary);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}
	.type-btn.active {
		background: var(--bg-elevated);
		color: var(--gold);
	}

	/* ── Filter Bar ────────────────────────────────── */
	.filter-bar {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}
	.filter-toggle {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		transition: border-color var(--transition-fast);
	}
	.filter-toggle:hover {
		border-color: var(--border-strong);
	}
	.filter-badge {
		background: var(--gold);
		color: #000;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 1px 6px;
		border-radius: var(--radius-full);
	}
	.filter-arrow {
		margin-left: auto;
		transition: transform var(--transition-fast);
	}
	.filter-arrow.open {
		transform: rotate(180deg);
	}
	.priced-toggle {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-2);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text-secondary);
		white-space: nowrap;
		cursor: pointer;
		user-select: none;
	}
	.priced-toggle input {
		accent-color: var(--gold);
	}
	.sort-select {
		padding: var(--space-2) var(--space-3);
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		cursor: pointer;
	}

	/* ── Filters Panel ─────────────────────────────── */
	.filters-panel {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--space-3);
		margin-bottom: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.filter-row {
		display: flex;
		gap: var(--space-3);
	}
	.filter-label {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--text-xs);
		color: var(--text-muted);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.filter-select, .filter-input {
		width: 100%;
		padding: var(--space-2);
		background: var(--bg-input);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
	}
	.filter-select:focus, .filter-input:focus {
		outline: none;
		border-color: var(--border-focus);
	}
	.clear-btn {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		cursor: pointer;
		align-self: flex-start;
	}
	.clear-btn:hover {
		border-color: var(--danger);
		color: var(--danger);
	}

	/* ── Active Chips ──────────────────────────────── */
	.active-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		background: var(--gold-light);
		border: 1px solid rgba(245,158,11,0.3);
		border-radius: var(--radius-full);
		color: var(--gold);
		font-family: var(--font-sans);
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}
	.chip:hover {
		background: var(--danger-light);
		border-color: var(--danger);
		color: var(--danger);
	}
</style>
