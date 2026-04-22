<script lang="ts">
	import { PARALLEL_CODES, PARALLEL_ABBREV, PARALLEL_FULL_NAME, PARALLEL_COLOR, normalizeParallel, type ParallelCode } from '$lib/data/parallels';

	let {
		value,
		onSelect,
		helperText = 'Wonders cards come in multiple physical treatments that affect price. Confirm the treatment of the card you scanned.',
		size = 'md',
		showHelper = true,
	}: {
		value: string | null | undefined;
		onSelect: (parallel: ParallelCode) => void;
		helperText?: string;
		size?: 'sm' | 'md' | 'lg';
		showHelper?: boolean;
	} = $props();

	const current = $derived(normalizeParallel(value));
</script>

<div class="parallel-selector parallel-selector-{size}" role="radiogroup" aria-label="Card parallel">
	<div class="parallel-options">
		{#each PARALLEL_CODES as code}
			<button
				type="button"
				role="radio"
				aria-checked={current === code}
				class="parallel-option"
				class:parallel-option-active={current === code}
				data-parallel={code}
				style={`--parallel-color: ${PARALLEL_COLOR[code]}`}
				onclick={() => onSelect(code)}
			>
				<span class="parallel-option-abbrev">{PARALLEL_ABBREV[code]}</span>
				<span class="parallel-option-name">{PARALLEL_FULL_NAME[code]}</span>
			</button>
		{/each}
	</div>
	{#if showHelper}
		<p class="parallel-helper">{helperText}</p>
	{/if}
</div>

<style>
	.parallel-selector { display: flex; flex-direction: column; gap: 8px; }

	.parallel-options {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
		gap: 6px;
	}

	.parallel-option {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 8px 6px;
		border: 1px solid var(--border, rgba(148,163,184,0.2));
		border-radius: 8px;
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #e2e8f0);
		font-family: var(--font-sans);
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}
	.parallel-option:hover { border-color: var(--parallel-color); }
	.parallel-option:active { transform: scale(0.97); }
	.parallel-option-active {
		border-color: var(--parallel-color);
		background: color-mix(in srgb, var(--parallel-color) 12%, var(--bg-surface, #0d1524));
	}

	.parallel-option-abbrev {
		font-size: 0.85rem;
		font-weight: 800;
		color: var(--parallel-color);
		letter-spacing: 0.03em;
	}
	.parallel-option-name {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--text-secondary, #94a3b8);
		text-align: center;
		line-height: 1.15;
	}
	.parallel-option-active .parallel-option-name {
		color: var(--text-primary, #e2e8f0);
	}

	.parallel-helper {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-secondary, #94a3b8);
		line-height: 1.3;
	}

	/* Size variants */
	.parallel-selector-sm .parallel-option { padding: 6px 4px; }
	.parallel-selector-sm .parallel-option-abbrev { font-size: 0.75rem; }
	.parallel-selector-sm .parallel-option-name { font-size: 0.6rem; }
</style>
