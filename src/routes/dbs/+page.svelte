<script lang="ts">
	let { data } = $props();

	const SETS = [
		{ code: 'Alpha Edition', label: 'Alpha (A)' },
		{ code: 'Griffey Edition', label: 'Griffey (G)' },
		{ code: 'Alpha Update', label: 'Unlimited (U)' },
		{ code: 'Alpha Blast', label: 'Hot Dog (HTD)' }
	];

	let selectedSet = $state('Alpha Edition');
	let playEntries = $state<Array<{ cardNumber: string; setCode: string; name?: string }>>([]);
	let inputValue = $state('');

	/** Look up a DBS score using the server-provided scores map */
	function getDbs(cardNumber: string, setCode?: string): number | null {
		const num = cardNumber.trim().toUpperCase();
		let key: string;
		if (setCode) {
			key = setCode + ':' + num;
		} else if (num.startsWith('HTD-')) {
			key = 'Alpha Blast:' + num;
		} else {
			key = num;
		}
		return data.dbsScores[key] ?? null;
	}

	/** Calculate total DBS for the current play entries */
	function calculateTotalDbs(cards: Array<{ cardNumber: string; setCode: string }>) {
		if (Object.keys(data.dbsScores).length < 20) return null;
		let total = 0;
		const missing: string[] = [];
		for (const { cardNumber, setCode } of cards) {
			const score = getDbs(cardNumber, setCode);
			if (score !== null) {
				total += score;
			} else {
				missing.push(setCode ? setCode + ':' + cardNumber : cardNumber);
			}
		}
		if (missing.length > cards.length * 0.25) return null;
		return { total, missing };
	}

	let dbsResult = $derived(calculateTotalDbs(playEntries));

	/** Available play cards for the selected set (from server-loaded data) */
	let availablePlays = $derived(data.playCardsBySet[selectedSet] ?? []);

	function addPlay() {
		const cleaned = inputValue.trim().toUpperCase();
		if (!cleaned) return;
		const entries = cleaned.split(/[,\s]+/).filter(Boolean);
		const newEntries = entries.map(num => {
			const setCode = num.startsWith('HTD-') ? 'Alpha Blast' : selectedSet;
			const playCard = availablePlays.find(p => p.card_number.toUpperCase() === num);
			return { cardNumber: num, setCode, name: playCard?.name };
		});
		playEntries = [...playEntries, ...newEntries];
		inputValue = '';
	}

	function removePlay(index: number) {
		playEntries = playEntries.filter((_, i) => i !== index);
	}

	function clearAll() {
		playEntries = [];
	}

	const DBS_CAP = 1000;
	let isOverCap = $derived((dbsResult?.total ?? 0) > DBS_CAP);
	let remaining = $derived(DBS_CAP - (dbsResult?.total ?? 0));
</script>

<svelte:head>
	<title>DBS Calculator — BOBA Scanner</title>
</svelte:head>

<div class="dbs-page">
	<h1>DBS Calculator</h1>
	<p class="subtitle">Check your Playbook's Deck Balancing Score before tournament registration.</p>

	<div class="set-selector">
		{#each SETS as set}
			<button
				class="set-btn"
				class:active={selectedSet === set.code}
				onclick={() => selectedSet = set.code}
			>{set.label}</button>
		{/each}
	</div>

	<div class="score-display" class:over-cap={isOverCap}>
		<div class="score-label">Total DBS</div>
		{#if dbsResult === null && playEntries.length > 0}
			<div class="score-value score-unavailable">—</div>
			<div class="score-cap">
				<span class="missing-data">DBS score data not yet available</span>
			</div>
		{:else}
			<div class="score-value">{dbsResult?.total ?? 0}</div>
			<div class="score-cap">
				{#if isOverCap}
					<span class="over">Over cap by {Math.abs(remaining)}</span>
				{:else}
					<span class="under">{remaining} remaining of {DBS_CAP}</span>
				{/if}
			</div>
		{/if}
		<div class="score-bar-track">
			<div
				class="score-bar-fill"
				class:over-cap={isOverCap}
				style="width: {Math.min(((dbsResult?.total ?? 0) / DBS_CAP) * 100, 100)}%"
			></div>
		</div>
	</div>

	<form class="add-form" onsubmit={(e) => { e.preventDefault(); addPlay(); }}>
		<input
			type="text"
			bind:value={inputValue}
			placeholder="Enter Play card number (e.g. PL-12, BPL-7)"
			class="play-input"
		/>
		<button type="submit" class="btn-primary">Add</button>
	</form>

	{#if playEntries.length > 0}
		<div class="play-list">
			<div class="play-list-header">
				<span>Playbook ({playEntries.length} card{playEntries.length !== 1 ? 's' : ''})</span>
				<button class="btn-text" onclick={clearAll}>Clear All</button>
			</div>
			{#each playEntries as entry, i}
				{@const score = getDbs(entry.cardNumber, entry.setCode)}
				<div class="play-item">
					<span class="play-number">{entry.cardNumber}</span>
					{#if entry.name}
						<span class="play-name">{entry.name}</span>
					{/if}
					<span class="play-dbs" class:missing={score === null}>
						{score !== null ? `${score} DBS` : 'No score found'}
					</span>
					<button class="play-remove" onclick={() => removePlay(i)}>x</button>
				</div>
			{/each}
		</div>

		{#if dbsResult?.missing && dbsResult.missing.length > 0}
			<p class="warning">
				Missing DBS scores for: {dbsResult.missing.join(', ')}. These cards aren't counted in the total.
			</p>
		{/if}
	{/if}
</div>

<style>
	.dbs-page {
		max-width: 480px;
		margin: 0 auto;
		padding: 1rem;
	}
	h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
	.subtitle { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.25rem; }

	.set-selector {
		display: flex;
		gap: 0.375rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}
	.set-btn {
		padding: 0.375rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-secondary);
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.15s;
	}
	.set-btn.active {
		background: var(--accent-primary, #3b82f6);
		color: white;
		border-color: var(--accent-primary, #3b82f6);
	}

	.score-display {
		text-align: center;
		padding: 1.25rem;
		border-radius: 16px;
		background: var(--bg-elevated);
		margin-bottom: 1.25rem;
	}
	.score-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); }
	.score-value { font-size: 2.5rem; font-weight: 700; line-height: 1.1; }
	.score-display.over-cap .score-value { color: #ef4444; }
	.score-cap { font-size: 0.8rem; margin-top: 0.25rem; }
	.over { color: #ef4444; font-weight: 600; }
	.under { color: var(--text-secondary); }
	.score-unavailable { color: var(--text-tertiary); }
	.missing-data { color: #f59e0b; font-size: 0.8rem; }

	.score-bar-track {
		height: 6px;
		background: var(--border-color);
		border-radius: 3px;
		margin-top: 0.75rem;
		overflow: hidden;
	}
	.score-bar-fill {
		height: 100%;
		border-radius: 3px;
		background: var(--accent-primary, #22c55e);
		transition: width 0.3s ease;
	}
	.score-bar-fill.over-cap { background: #ef4444; }

	.add-form {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.play-input {
		flex: 1;
		padding: 0.625rem 0.75rem;
		border-radius: 10px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.9rem;
	}

	.play-list-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.85rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}
	.btn-text {
		background: none;
		border: none;
		color: var(--text-tertiary);
		font-size: 0.8rem;
		cursor: pointer;
		text-decoration: underline;
	}
	.play-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		border-radius: 8px;
		background: var(--bg-elevated);
		margin-bottom: 0.25rem;
	}
	.play-number { font-weight: 600; font-size: 0.9rem; min-width: 4rem; }
	.play-name { font-size: 0.8rem; color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.play-dbs { font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap; }
	.play-dbs.missing { color: #f59e0b; }
	.play-remove {
		background: none;
		border: none;
		color: var(--text-tertiary);
		font-size: 1.1rem;
		cursor: pointer;
		padding: 0 0.25rem;
	}

	.warning {
		font-size: 0.8rem;
		color: #f59e0b;
		margin-top: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		background: rgba(245, 158, 11, 0.1);
	}
</style>
