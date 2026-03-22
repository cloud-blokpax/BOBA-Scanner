<script lang="ts">
	import type { Card } from '$lib/types';
	import type { DeckValidationResult } from '$lib/services/deck-validator';

	let {
		heroCards,
		validationResult,
		validating
	}: {
		heroCards: Card[];
		validationResult: DeckValidationResult | null;
		validating: boolean;
	} = $props();

	const totalPower = $derived(heroCards.reduce((sum, c) => sum + (c.power || 0), 0));
	const avgPower = $derived(heroCards.length > 0 ? Math.round(totalPower / heroCards.length) : 0);

	const powerLevelCounts = $derived.by(() => {
		const counts: Record<number, number> = {};
		for (const card of heroCards) {
			if (card.power) counts[card.power] = (counts[card.power] || 0) + 1;
		}
		return Object.entries(counts)
			.map(([power, count]) => ({ power: Number(power), count }))
			.sort((a, b) => a.power - b.power);
	});

	const maxPowerCount = $derived(Math.max(1, ...powerLevelCounts.map(p => p.count)));

	const weaponCounts = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const card of heroCards) {
			const w = card.weapon_type || 'Unknown';
			counts[w] = (counts[w] || 0) + 1;
		}
		return Object.entries(counts)
			.map(([weapon, count]) => ({ weapon, count }))
			.sort((a, b) => b.count - a.count);
	});

	const uniqueWeapons = $derived(weaponCounts.length);
</script>

<div class="stats-tab">
	{#if validating}
		<div class="validation-banner validating">Validating...</div>
	{:else if validationResult}
		<div class="validation-banner" class:valid={validationResult.isValid} class:invalid={!validationResult.isValid}>
			{#if validationResult.isValid}
				Deck Valid
			{:else}
				{validationResult.violations.length} violation{validationResult.violations.length !== 1 ? 's' : ''}
			{/if}
		</div>
		{#if validationResult.violations.length > 0}
			<div class="violations">
				{#each validationResult.violations as violation}
					<div class="violation-row">
						<span class="violation-severity" class:error={violation.severity === 'error'} class:warning={violation.severity === 'warning'}>
							{violation.severity}
						</span>
						<span class="violation-msg">{violation.message}</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}

	<div class="stats-grid">
		<div class="stat-card">
			<div class="stat-value">{heroCards.length}</div>
			<div class="stat-label">Total Heroes</div>
		</div>
		<div class="stat-card">
			<div class="stat-value">{totalPower.toLocaleString()}</div>
			<div class="stat-label">Total Power</div>
		</div>
		<div class="stat-card">
			<div class="stat-value">{avgPower}</div>
			<div class="stat-label">Avg Power</div>
		</div>
		<div class="stat-card">
			<div class="stat-value">{uniqueWeapons}</div>
			<div class="stat-label">Unique Weapons</div>
		</div>
	</div>

	{#if powerLevelCounts.length > 0}
		<section class="distribution">
			<h3>Power Distribution</h3>
			<div class="bar-chart">
				{#each powerLevelCounts as { power, count }}
					<div class="bar-row">
						<span class="bar-label">{power}</span>
						<div class="bar-track">
							<div class="bar-fill" style:width="{(count / maxPowerCount) * 100}%"></div>
						</div>
						<span class="bar-count">{count}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if weaponCounts.length > 0}
		<section class="breakdown">
			<h3>Weapon Breakdown</h3>
			<div class="bar-chart">
				{#each weaponCounts as { weapon, count }}
					<div class="bar-row">
						<span class="bar-label weapon-label">{weapon}</span>
						<div class="bar-track">
							<div class="bar-fill weapon-fill" style:width="{(count / heroCards.length) * 100}%"></div>
						</div>
						<span class="bar-count">{count}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>

<style>
	.stats-tab { padding: 0.75rem 1rem; }
	.validation-banner {
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		font-size: 0.9rem;
		font-weight: 600;
		text-align: center;
		margin-bottom: 1rem;
	}
	.validation-banner.valid {
		background: rgba(34, 197, 94, 0.1);
		color: var(--color-success, #22c55e);
		border: 1px solid rgba(34, 197, 94, 0.2);
	}
	.validation-banner.invalid {
		background: rgba(239, 68, 68, 0.1);
		color: var(--color-error, #ef4444);
		border: 1px solid rgba(239, 68, 68, 0.2);
	}
	.validation-banner.validating {
		background: rgba(59, 130, 246, 0.1);
		color: var(--accent-primary, #3b82f6);
		border: 1px solid rgba(59, 130, 246, 0.2);
	}
	.violations {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-bottom: 1rem;
	}
	.violation-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		border-radius: 6px;
		background: var(--bg-surface, #0d1524);
		font-size: 0.8rem;
	}
	.violation-severity {
		padding: 0.1rem 0.375rem;
		border-radius: 4px;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		flex-shrink: 0;
	}
	.violation-severity.error { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
	.violation-severity.warning { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
	.violation-msg { color: var(--text-primary, #f1f5f9); }
	.stats-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}
	.stat-card {
		padding: 0.75rem;
		border-radius: 8px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		text-align: center;
	}
	.stat-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-primary, #f1f5f9);
	}
	.stat-label {
		font-size: 0.7rem;
		color: var(--text-tertiary, #64748b);
		margin-top: 0.125rem;
	}
	h3 {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-secondary, #94a3b8);
		margin: 0 0 0.5rem;
	}
	.distribution, .breakdown { margin-bottom: 1.25rem; }
	.bar-chart {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.bar-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.bar-label {
		width: 40px;
		text-align: right;
		font-size: 0.75rem;
		color: var(--text-secondary, #94a3b8);
		font-family: monospace;
		flex-shrink: 0;
	}
	.weapon-label { width: 60px; font-family: inherit; }
	.bar-track {
		flex: 1;
		height: 12px;
		background: var(--border-color, #334155);
		border-radius: 3px;
		overflow: hidden;
	}
	.bar-fill {
		height: 100%;
		border-radius: 3px;
		background: var(--accent-primary, #3b82f6);
		transition: width 0.3s ease;
	}
	.weapon-fill { background: var(--text-tertiary, #64748b); }
	.bar-count {
		width: 24px;
		font-size: 0.75rem;
		color: var(--text-secondary, #94a3b8);
		flex-shrink: 0;
	}
</style>
