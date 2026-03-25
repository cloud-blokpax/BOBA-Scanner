<script lang="ts">
	import { PLAYBOOK_ARCHETYPES } from '$lib/data/playbook-archetypes';
	import type { ArchetypeMatchResult } from '$lib/services/playbook-engine';

	let {
		matches,
		selectedId,
		onselect
	}: {
		matches: ArchetypeMatchResult[];
		selectedId: string | null;
		onselect: (id: string) => void;
	} = $props();

	/** Map match results by archetype id for quick lookup */
	const matchMap = $derived(
		new Map(matches.map((m) => [m.archetype.id, m]))
	);

	function diffBadge(d: 'beginner' | 'intermediate' | 'advanced') {
		if (d === 'beginner') return { label: 'Beginner', cls: 'diff-beginner' };
		if (d === 'intermediate') return { label: 'Intermediate', cls: 'diff-intermediate' };
		return { label: 'Advanced', cls: 'diff-advanced' };
	}
</script>

<div class="archetypes">
	{#each PLAYBOOK_ARCHETYPES as arch}
		{@const match = matchMap.get(arch.id)}
		{@const diff = diffBadge(arch.difficulty)}
		<button
			class="arch-card"
			class:selected={selectedId === arch.id}
			onclick={() => onselect(arch.id)}
		>
			<div class="arch-header">
				<h4 class="arch-name">{arch.name}</h4>
				<span class="diff-badge {diff.cls}">{diff.label}</span>
			</div>
			<p class="arch-tagline">{arch.tagline}</p>

			{#if match}
				<div class="match-bar-track">
					<div class="match-bar-fill" style="width: {match.matchScore}%"></div>
				</div>
				<span class="match-score">{match.matchScore}% match</span>
			{/if}

			<div class="arch-engines">
				{#each arch.comboEngines as engineId}
					<span class="engine-tag">{engineId.replace(/_/g, ' ')}</span>
				{/each}
			</div>

			<p class="arch-desc">{arch.description}</p>

			<div class="arch-footer">
				<span class="arch-metric">~{arch.projectedMetrics.playsActivated} plays/game</span>
				<span class="arch-metric">~{arch.projectedMetrics.subsNeeded} subs</span>
			</div>
		</button>
	{/each}
</div>

<style>
	.archetypes {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.arch-card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		text-align: left;
		cursor: pointer;
		transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
		width: 100%;
		font-family: inherit;
		color: inherit;
	}
	.arch-card:hover {
		border-color: var(--border-strong);
	}
	.arch-card.selected {
		border-color: var(--gold);
		box-shadow: var(--shadow-gold);
	}
	.arch-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-1);
	}
	.arch-name {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: var(--font-bold);
		color: var(--text-primary);
		margin: 0;
	}
	.diff-badge {
		font-size: 10px;
		font-weight: var(--font-semibold);
		padding: 2px 8px;
		border-radius: var(--radius-full);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.diff-beginner {
		background: var(--success-light);
		color: var(--success);
	}
	.diff-intermediate {
		background: var(--warning-light);
		color: var(--warning);
	}
	.diff-advanced {
		background: var(--danger-light);
		color: var(--danger);
	}
	.arch-tagline {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		margin: 0 0 var(--space-2);
		font-style: italic;
	}
	.match-bar-track {
		height: 4px;
		background: var(--bg-elevated);
		border-radius: var(--radius-full);
		overflow: hidden;
		margin-bottom: var(--space-1);
	}
	.match-bar-fill {
		height: 100%;
		background: var(--gold);
		border-radius: var(--radius-full);
		transition: width var(--transition-base);
	}
	.match-score {
		font-size: var(--text-xs);
		color: var(--gold);
		font-weight: var(--font-medium);
	}
	.arch-engines {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin: var(--space-2) 0;
	}
	.engine-tag {
		font-size: 10px;
		color: var(--text-muted);
		background: var(--bg-elevated);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		text-transform: capitalize;
	}
	.arch-desc {
		font-size: var(--text-xs);
		color: var(--text-muted);
		margin: 0 0 var(--space-2);
		line-height: 1.5;
	}
	.arch-footer {
		display: flex;
		gap: var(--space-3);
	}
	.arch-metric {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
</style>
