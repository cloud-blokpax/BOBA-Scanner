<script lang="ts">
	import type { PlayCard } from '$lib/services/playbook-engine';
	import { categorizePlay, PLAY_CATEGORIES } from '$lib/data/play-categories';

	let {
		allPlays,
		selectedNames,
		onadd,
		onremove
	}: {
		allPlays: PlayCard[];
		selectedNames: Set<string>;
		onadd: (play: PlayCard) => void;
		onremove: (name: string) => void;
	} = $props();

	let search = $state('');
	let filterCategory = $state('all');
	let filterRelease = $state('all');
	let filterCost = $state('all');
	let sortBy = $state<'name' | 'dbs' | 'cost'>('dbs');

	const releases = $derived([...new Set(allPlays.map((p) => p.release))].sort());

	const filtered = $derived(() => {
		let result = allPlays;

		if (search.trim()) {
			const q = search.trim().toLowerCase();
			result = result.filter(
				(p) =>
					p.name.toLowerCase().includes(q) ||
					p.card_number.toLowerCase().includes(q)
			);
		}

		if (filterCategory !== 'all') {
			result = result.filter((p) => categorizePlay(p).includes(filterCategory));
		}

		if (filterRelease !== 'all') {
			result = result.filter((p) => p.release === filterRelease);
		}

		if (filterCost !== 'all') {
			const cost = parseInt(filterCost);
			result = result.filter((p) => p.hot_dog_cost === cost);
		}

		if (sortBy === 'dbs') result = [...result].sort((a, b) => a.dbs - b.dbs);
		else if (sortBy === 'cost') result = [...result].sort((a, b) => a.hot_dog_cost - b.hot_dog_cost);
		else result = [...result].sort((a, b) => a.name.localeCompare(b.name));

		return result;
	});

	function togglePlay(play: PlayCard) {
		if (selectedNames.has(play.name)) {
			onremove(play.name);
		} else {
			onadd(play);
		}
	}
</script>

<div class="browser">
	<div class="filters">
		<input
			type="search"
			class="search-input"
			placeholder="Search plays..."
			bind:value={search}
		/>
		<div class="filter-row">
			<select class="filter-select" bind:value={filterCategory}>
				<option value="all">All Categories</option>
				{#each PLAY_CATEGORIES as cat}
					<option value={cat.id}>{cat.name}</option>
				{/each}
			</select>
			<select class="filter-select" bind:value={filterRelease}>
				<option value="all">All Sets</option>
				{#each releases as rel}
					<option value={rel}>{rel}</option>
				{/each}
			</select>
			<select class="filter-select" bind:value={filterCost}>
				<option value="all">Any Cost</option>
				{#each [0, 1, 2, 3, 4, 5, 6] as cost}
					<option value={String(cost)}>{cost} HD</option>
				{/each}
			</select>
			<select class="filter-select" bind:value={sortBy}>
				<option value="dbs">Sort: DBS</option>
				<option value="cost">Sort: Cost</option>
				<option value="name">Sort: Name</option>
			</select>
		</div>
	</div>

	<div class="play-count">{filtered().length} plays</div>

	<div class="play-list">
		{#each filtered() as play (play.id)}
			{@const isSelected = selectedNames.has(play.name)}
			<button
				class="play-item"
				class:selected={isSelected}
				onclick={() => togglePlay(play)}
			>
				<div class="play-main">
					<span class="play-name">{play.name}</span>
					<span class="play-number">{play.card_number}</span>
				</div>
				<div class="play-stats">
					<span class="stat dbs-stat">{play.dbs} DBS</span>
					<span class="stat hd-stat">{play.hot_dog_cost} HD</span>
					{#if play.type === 'BPL'}
						<span class="stat bpl-tag">BPL</span>
					{/if}
				</div>
				{#if play.ability}
					<p class="play-ability">{play.ability}</p>
				{/if}
				{#if isSelected}
					<span class="check-icon">&#10003;</span>
				{/if}
			</button>
		{/each}
	</div>
</div>

<style>
	.browser {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.filters {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.search-input {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-input);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: var(--text-sm);
		font-family: var(--font-sans);
	}
	.search-input::placeholder {
		color: var(--text-muted);
	}
	.search-input:focus {
		outline: none;
		border-color: var(--border-focus);
	}
	.filter-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.filter-select {
		flex: 1;
		min-width: 100px;
		padding: var(--space-1) var(--space-2);
		background: var(--bg-input);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-xs);
		font-family: var(--font-sans);
	}
	.play-count {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.play-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-height: 500px;
		overflow-y: auto;
	}
	.play-item {
		position: relative;
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		text-align: left;
		cursor: pointer;
		transition: border-color var(--transition-fast);
		width: 100%;
		font-family: inherit;
		color: inherit;
	}
	.play-item:hover {
		border-color: var(--border-strong);
	}
	.play-item.selected {
		border-color: var(--success);
		background: var(--success-light);
	}
	.play-main {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.play-name {
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--text-primary);
	}
	.play-number {
		font-size: var(--text-xs);
		color: var(--text-muted);
		font-family: var(--font-mono);
	}
	.play-stats {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}
	.stat {
		font-size: 10px;
		color: var(--text-muted);
	}
	.bpl-tag {
		color: var(--gold);
		font-weight: var(--font-semibold);
	}
	.play-ability {
		font-size: var(--text-xs);
		color: var(--text-muted);
		margin: var(--space-1) 0 0;
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.check-icon {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		color: var(--success);
		font-size: var(--text-sm);
		font-weight: var(--font-bold);
	}
</style>
