<script lang="ts">
	import { calculateTotalDbs, getDbs } from '$lib/data/boba-dbs-scores';

	let playNumbers = $state<string[]>([]);
	let inputValue = $state('');
	let dbsResult = $derived(calculateTotalDbs(playNumbers));

	function addPlay() {
		const cleaned = inputValue.trim().toUpperCase();
		if (!cleaned) return;
		// Accept multiple comma/space separated entries
		const entries = cleaned.split(/[,\s]+/).filter(Boolean);
		playNumbers = [...playNumbers, ...entries];
		inputValue = '';
	}

	function removePlay(index: number) {
		playNumbers = playNumbers.filter((_, i) => i !== index);
	}

	function clearAll() {
		playNumbers = [];
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

	<div class="score-display" class:over-cap={isOverCap}>
		<div class="score-label">Total DBS</div>
		<div class="score-value">{dbsResult?.total ?? 0}</div>
		<div class="score-cap">
			{#if isOverCap}
				<span class="over">Over cap by {Math.abs(remaining)}</span>
			{:else}
				<span class="under">{remaining} remaining of {DBS_CAP}</span>
			{/if}
		</div>
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

	{#if playNumbers.length > 0}
		<div class="play-list">
			<div class="play-list-header">
				<span>Playbook ({playNumbers.length} card{playNumbers.length !== 1 ? 's' : ''})</span>
				<button class="btn-text" onclick={clearAll}>Clear All</button>
			</div>
			{#each playNumbers as num, i}
				{@const score = getDbs(num)}
				<div class="play-item">
					<span class="play-number">{num}</span>
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
	.play-number { font-weight: 600; font-size: 0.9rem; flex: 1; }
	.play-dbs { font-size: 0.8rem; color: var(--text-secondary); }
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
