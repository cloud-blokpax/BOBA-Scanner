<script lang="ts">
	import type { DBSAnalysis } from '$lib/services/playbook-engine';

	let { analysis }: { analysis: DBSAnalysis | null } = $props();

	const barColor = $derived(() => {
		if (!analysis) return 'var(--text-muted)';
		if (analysis.percentUsed > 90) return 'var(--danger)';
		if (analysis.percentUsed > 70) return 'var(--warning)';
		return 'var(--success)';
	});
</script>

<div class="card">
	<h3 class="card-title">DBS Budget</h3>
	{#if analysis}
		<div class="dbs-display">
			<span class="dbs-total">{analysis.total}</span>
			{#if analysis.cap !== null}
				<span class="dbs-sep">/</span>
				<span class="dbs-cap">{analysis.cap}</span>
				<span class="dbs-label">DBS</span>
			{:else}
				<span class="dbs-label">DBS (no cap)</span>
			{/if}
		</div>

		{#if analysis.cap !== null}
			<div class="bar-track">
				<div
					class="bar-fill"
					style="width: {analysis.percentUsed}%; background: {barColor()}"
				></div>
			</div>

			<div class="meta-row">
				<span class="meta">
					{analysis.remaining === Infinity ? '--' : analysis.remaining} remaining
				</span>
				<span class="meta">
					{analysis.filledSlots}/{analysis.totalSlots} slots
				</span>
			</div>

			{#if analysis.remaining !== Infinity && analysis.avgPerSlot > 0}
				<p class="avg-hint">
					Avg {analysis.avgPerSlot} DBS per remaining slot
				</p>
			{/if}

			{#if analysis.isOverCap}
				<p class="over-cap">Over DBS cap! Remove plays to continue.</p>
			{/if}
		{/if}
	{:else}
		<p class="empty">Select a format to see DBS budget</p>
	{/if}
</div>

<style>
	.card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
	}
	.card-title {
		font-family: var(--font-display);
		font-size: var(--text-sm);
		font-weight: var(--font-semibold);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--space-3);
	}
	.dbs-display {
		display: flex;
		align-items: baseline;
		gap: var(--space-1);
		margin-bottom: var(--space-3);
	}
	.dbs-total {
		font-family: var(--font-display);
		font-size: var(--text-3xl);
		font-weight: var(--font-bold);
		color: var(--text-primary);
	}
	.dbs-sep {
		font-size: var(--text-xl);
		color: var(--text-muted);
	}
	.dbs-cap {
		font-size: var(--text-xl);
		color: var(--text-secondary);
	}
	.dbs-label {
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin-left: var(--space-1);
	}
	.bar-track {
		height: 8px;
		background: var(--bg-elevated);
		border-radius: var(--radius-full);
		overflow: hidden;
		margin-bottom: var(--space-2);
	}
	.bar-fill {
		height: 100%;
		border-radius: var(--radius-full);
		transition: width var(--transition-base), background var(--transition-base);
	}
	.meta-row {
		display: flex;
		justify-content: space-between;
	}
	.meta {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.avg-hint {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		margin: var(--space-2) 0 0;
	}
	.over-cap {
		font-size: var(--text-sm);
		color: var(--danger);
		font-weight: var(--font-medium);
		margin: var(--space-2) 0 0;
	}
	.empty {
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin: 0;
	}
</style>
