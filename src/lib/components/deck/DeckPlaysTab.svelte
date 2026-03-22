<script lang="ts">
	import type { PlayCardData } from '$lib/data/boba-dbs-scores';

	let {
		playEntries,
		playCardsBySet,
		dbsScores,
		dbsCap = 1000,
		playDeckSize = 30,
		bonusPlaysMax = 25,
		onAddPlay,
		onRemovePlay
	}: {
		playEntries: Array<{ cardNumber: string; setCode: string; name: string; dbs: number }>;
		playCardsBySet: Record<string, PlayCardData[]>;
		dbsScores: Record<string, number>;
		dbsCap?: number;
		playDeckSize?: number;
		bonusPlaysMax?: number;
		onAddPlay: (card: PlayCardData) => void;
		onRemovePlay: (index: number) => void;
	} = $props();

	let playSearch = $state('');
	let selectedPlaySet = $state('all');
	let showAffordableOnly = $state(false);

	const totalDbs = $derived(playEntries.reduce((sum, p) => sum + (p.dbs || 0), 0));
	const dbsBudgetPercent = $derived(Math.min(100, dbsCap > 0 ? (totalDbs / dbsCap) * 100 : 0));
	const dbsBudgetColor = $derived(
		dbsBudgetPercent <= 70 ? 'var(--color-success, #22c55e)' :
		dbsBudgetPercent <= 90 ? 'var(--accent-gold, #f59e0b)' :
		'var(--color-error, #ef4444)'
	);
	const maxPlays = $derived(playDeckSize + bonusPlaysMax);
	const atMaxPlays = $derived(playEntries.length >= maxPlays);

	const setNames = $derived(Object.keys(playCardsBySet));

	const playEntryKeys = $derived(new Set(playEntries.map(p => `${p.setCode}:${p.cardNumber}`)));

	const allPlayCards = $derived.by(() => {
		const cards: (PlayCardData & { setCode: string })[] = [];
		for (const [setCode, list] of Object.entries(playCardsBySet)) {
			for (const card of list) {
				cards.push({ ...card, setCode });
			}
		}
		return cards;
	});

	const filteredPlays = $derived.by(() => {
		const query = playSearch.toLowerCase();
		const remainingBudget = dbsCap - totalDbs;
		return allPlayCards.filter(card => {
			if (selectedPlaySet !== 'all' && card.setCode !== selectedPlaySet) return false;
			if (playEntryKeys.has(`${card.setCode}:${card.card_number}`)) return false;
			if (query && !card.name.toLowerCase().includes(query) && !card.card_number.toLowerCase().includes(query)) return false;
			if (showAffordableOnly && card.dbs > remainingBudget) return false;
			return true;
		});
	});

	function dbsColor(dbs: number): string {
		if (dbs <= 20) return 'var(--color-success, #22c55e)';
		if (dbs <= 40) return 'var(--accent-gold, #f59e0b)';
		if (dbs <= 60) return 'var(--color-warning, #f97316)';
		return 'var(--color-error, #ef4444)';
	}
</script>

<div class="plays-tab">
	<div class="dbs-budget">
		<div class="dbs-label">
			<span>DBS Budget</span>
			<span class="dbs-value" style:color={dbsBudgetColor}>{totalDbs} / {dbsCap}</span>
		</div>
		<div class="dbs-track">
			<div class="dbs-fill" style:width="{dbsBudgetPercent}%" style:background={dbsBudgetColor}></div>
		</div>
	</div>

	<section class="current-plays">
		<h3>Playbook ({playEntries.length}/{playDeckSize}{playEntries.length > playDeckSize ? ` + ${playEntries.length - playDeckSize} bonus` : ''})</h3>
		{#if playEntries.length === 0}
			<p class="empty-hint">Add plays from the catalog below</p>
		{:else}
			<div class="play-list">
				{#each playEntries as entry, i (entry.cardNumber + entry.setCode)}
					<div class="play-row">
						<span class="play-name">{entry.name || entry.cardNumber}</span>
						<span class="play-number">{entry.cardNumber}</span>
						<span class="dbs-badge" style:background="color-mix(in srgb, {dbsColor(entry.dbs)} 20%, transparent)"
							style:color={dbsColor(entry.dbs)}>{entry.dbs}</span>
						<button class="remove-btn" onclick={() => onRemovePlay(i)} aria-label="Remove {entry.name}">x</button>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<hr class="divider" />

	<section class="play-catalog">
		<h3>Play Catalog</h3>
		<div class="filter-row">
			<button class="set-btn" class:active={selectedPlaySet === 'all'} onclick={() => selectedPlaySet = 'all'}>All</button>
			{#each setNames as setName}
				<button class="set-btn" class:active={selectedPlaySet === setName} onclick={() => selectedPlaySet = setName}>{setName}</button>
			{/each}
		</div>
		<div class="search-row">
			<input
				class="search-input"
				type="text"
				placeholder="Search plays..."
				bind:value={playSearch}
			/>
			<label class="affordable-toggle">
				<input type="checkbox" bind:checked={showAffordableOnly} />
				<span>Affordable only</span>
			</label>
		</div>
		{#if filteredPlays.length === 0}
			<p class="empty-hint">No matching plays</p>
		{:else}
			<div class="catalog-list">
				{#each filteredPlays as card (card.id)}
					<button class="catalog-row" onclick={() => onAddPlay(card)} disabled={atMaxPlays}>
						<span class="play-name">{card.name}</span>
						<span class="play-number">{card.card_number}</span>
						<span class="dbs-badge" style:background="color-mix(in srgb, {dbsColor(card.dbs)} 20%, transparent)"
							style:color={dbsColor(card.dbs)}>{card.dbs}</span>
					</button>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.plays-tab { padding: 0.75rem 1rem; }
	.dbs-budget { margin-bottom: 1rem; }
	.dbs-label {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
		margin-bottom: 0.25rem;
	}
	.dbs-value { font-weight: 700; }
	.dbs-track {
		height: 6px;
		background: var(--border-color, #334155);
		border-radius: 3px;
		overflow: hidden;
	}
	.dbs-fill {
		height: 100%;
		border-radius: 3px;
		transition: width 0.3s ease, background 0.3s ease;
	}
	h3 {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-secondary, #94a3b8);
		margin: 0 0 0.5rem;
	}
	.empty-hint {
		color: var(--text-tertiary, #64748b);
		font-size: 0.85rem;
		padding: 1rem 0;
		text-align: center;
	}
	.play-list, .catalog-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.play-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		border-radius: 8px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
	}
	.play-name {
		flex: 1;
		min-width: 0;
		color: var(--text-primary, #f1f5f9);
		font-size: 0.85rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.play-number {
		color: var(--text-tertiary, #64748b);
		font-size: 0.75rem;
		font-family: monospace;
		flex-shrink: 0;
	}
	.dbs-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 28px;
		padding: 0.125rem 0.375rem;
		border-radius: 8px;
		font-size: 0.7rem;
		font-weight: 700;
		flex-shrink: 0;
	}
	.remove-btn {
		width: 28px;
		height: 28px;
		border: none;
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 700;
		flex-shrink: 0;
	}
	.remove-btn:hover { background: rgba(239, 68, 68, 0.2); }
	.divider {
		border: none;
		border-top: 1px solid var(--border-color, #334155);
		margin: 1rem 0;
	}
	.filter-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-bottom: 0.5rem;
	}
	.set-btn {
		padding: 0.3rem 0.625rem;
		border: 1px solid var(--border-color, #334155);
		border-radius: 6px;
		background: var(--bg-elevated, #1e293b);
		color: var(--text-secondary, #94a3b8);
		font-size: 0.75rem;
		cursor: pointer;
	}
	.set-btn.active {
		background: rgba(59, 130, 246, 0.15);
		color: #60a5fa;
		border-color: rgba(59, 130, 246, 0.3);
	}
	.search-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.search-input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border-color, #334155);
		border-radius: 8px;
		background: var(--bg-base, #0f172a);
		color: var(--text-primary, #f1f5f9);
		font-size: 0.85rem;
	}
	.search-input::placeholder { color: var(--text-tertiary, #64748b); }
	.affordable-toggle {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--text-secondary, #94a3b8);
		white-space: nowrap;
		cursor: pointer;
	}
	.catalog-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--border-color, #1e293b);
		border-radius: 8px;
		background: var(--bg-elevated, #1e293b);
		color: inherit;
		cursor: pointer;
		text-align: left;
	}
	.catalog-row:hover:not(:disabled) { background: var(--bg-hover, rgba(255,255,255,0.05)); }
	.catalog-row:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
