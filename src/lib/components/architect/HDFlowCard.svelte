<script lang="ts">
	import type { HDFlowProjection } from '$lib/services/playbook-engine';

	let { flow }: { flow: HDFlowProjection } = $props();

	const maxHD = 10;

	function hdColor(hd: number): string {
		if (hd < 2) return 'var(--danger)';
		if (hd < 4) return 'var(--warning)';
		return 'var(--success)';
	}
</script>

<div class="card">
	<h3 class="card-title">Hot Dog Flow</h3>

	<div class="sparkline">
		{#each flow.hdPerBattle as hd, i}
			{@const pct = Math.min(100, (hd / maxHD) * 100)}
			<div class="bar-col">
				<div class="bar-wrapper">
					<div
						class="bar"
						style="height: {pct}%; background: {hdColor(hd)}"
					></div>
				</div>
				<span class="battle-label">B{i + 1}</span>
			</div>
		{/each}
	</div>

	<div class="metrics">
		<div class="metric">
			<span class="metric-value">{flow.totalActivations}</span>
			<span class="metric-label">plays activated</span>
		</div>
		<div class="metric">
			<span class="metric-value">{flow.totalSubstitutions.toFixed(1)}</span>
			<span class="metric-label">subs needed</span>
		</div>
		<div class="metric">
			<span class="metric-value">{flow.hdEndOfGame}</span>
			<span class="metric-label">HD remaining</span>
		</div>
	</div>

	{#if flow.runsOutAt !== null}
		<p class="warning">Runs out of HD at Battle {flow.runsOutAt}</p>
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
	.sparkline {
		display: flex;
		gap: var(--space-2);
		align-items: flex-end;
		height: 80px;
		margin-bottom: var(--space-3);
	}
	.bar-col {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		height: 100%;
	}
	.bar-wrapper {
		flex: 1;
		width: 100%;
		display: flex;
		align-items: flex-end;
	}
	.bar {
		width: 100%;
		border-radius: var(--radius-sm) var(--radius-sm) 0 0;
		transition: height var(--transition-base), background var(--transition-base);
		min-height: 2px;
	}
	.battle-label {
		font-size: 10px;
		color: var(--text-muted);
	}
	.metrics {
		display: flex;
		gap: var(--space-4);
	}
	.metric {
		display: flex;
		flex-direction: column;
	}
	.metric-value {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: var(--font-bold);
		color: var(--text-primary);
	}
	.metric-label {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.warning {
		font-size: var(--text-sm);
		color: var(--danger);
		font-weight: var(--font-medium);
		margin: var(--space-2) 0 0;
		padding: var(--space-2);
		background: var(--danger-light);
		border-radius: var(--radius-sm);
	}
</style>
