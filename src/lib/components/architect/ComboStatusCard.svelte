<script lang="ts">
	import type { ComboDetectionResult, HeroRecommendation } from '$lib/services/playbook-engine';

	let {
		combos,
		heroRec
	}: {
		combos: ComboDetectionResult;
		heroRec: HeroRecommendation;
	} = $props();

	function riskBadge(risk: 'low' | 'medium' | 'high'): { label: string; color: string } {
		if (risk === 'low') return { label: 'Low Risk', color: 'var(--success)' };
		if (risk === 'medium') return { label: 'Med Risk', color: 'var(--warning)' };
		return { label: 'High Risk', color: 'var(--danger)' };
	}
</script>

<div class="card">
	<h3 class="card-title">Combo Status</h3>

	{#if combos.complete.length === 0 && combos.partial.length === 0}
		<p class="empty">No combo engines detected yet. Add plays to discover synergies.</p>
	{/if}

	{#each combos.complete as { engine, enhancersPresent }}
		<div class="combo complete">
			<div class="combo-header">
				<span class="combo-name">{engine.name}</span>
				<span class="combo-badge complete-badge">Complete</span>
			</div>
			<p class="combo-tagline">{engine.tagline}</p>
			<div class="combo-meta">
				<span class="meta-chip">{engine.coreDBS} DBS</span>
				<span class="meta-chip">{engine.coreHD} HD</span>
				<span class="meta-chip" style="color: {riskBadge(engine.risk).color}">{riskBadge(engine.risk).label}</span>
			</div>
			{#if enhancersPresent.length > 0}
				<p class="enhancers">+{enhancersPresent.length} enhancers active</p>
			{/if}
		</div>
	{/each}

	{#each combos.partial as { engine, present, missing }}
		<div class="combo partial">
			<div class="combo-header">
				<span class="combo-name">{engine.name}</span>
				<span class="combo-badge partial-badge">
					{present.length}/{engine.coreCards.length}
				</span>
			</div>
			<p class="combo-tagline">{engine.tagline}</p>
			<div class="missing-cards">
				<span class="missing-label">Missing:</span>
				{#each missing as cardName}
					<span class="missing-card">{cardName}</span>
				{/each}
			</div>
		</div>
	{/each}

	<div class="hero-section">
		<h4 class="section-subtitle">Hero Recommendation</h4>
		{#if heroRec.primaryWeapon}
			<div class="hero-rec">
				<span class="weapon-badge" data-weapon={heroRec.primaryWeapon}>
					{heroRec.primaryWeapon}
				</span>
				<span class="hero-count">{heroRec.primaryCount}/60 heroes</span>
			</div>
			{#if heroRec.secondaryWeapon}
				<div class="hero-rec">
					<span class="weapon-badge" data-weapon={heroRec.secondaryWeapon}>
						{heroRec.secondaryWeapon}
					</span>
					<span class="hero-count">{heroRec.secondaryCount}/60 heroes</span>
				</div>
			{/if}
		{:else}
			<p class="hero-agnostic">Weapon-agnostic — run highest power heroes</p>
		{/if}
		<p class="hero-reasoning">{heroRec.reasoning}</p>
	</div>
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
	.combo {
		padding: var(--space-3);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-2);
	}
	.combo.complete {
		background: var(--success-light);
		border: 1px solid rgba(16, 185, 129, 0.25);
	}
	.combo.partial {
		background: var(--warning-light);
		border: 1px solid rgba(245, 158, 11, 0.25);
	}
	.combo-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-1);
	}
	.combo-name {
		font-family: var(--font-display);
		font-size: var(--text-sm);
		font-weight: var(--font-bold);
		color: var(--text-primary);
	}
	.combo-badge {
		font-size: 10px;
		font-weight: var(--font-semibold);
		padding: 2px 8px;
		border-radius: var(--radius-full);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.complete-badge {
		background: var(--success);
		color: #fff;
	}
	.partial-badge {
		background: var(--warning);
		color: #000;
	}
	.combo-tagline {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		margin: 0 0 var(--space-2);
		font-style: italic;
	}
	.combo-meta {
		display: flex;
		gap: var(--space-2);
	}
	.meta-chip {
		font-size: 10px;
		color: var(--text-muted);
	}
	.enhancers {
		font-size: var(--text-xs);
		color: var(--success);
		margin: var(--space-1) 0 0;
	}
	.missing-cards {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
	}
	.missing-label {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.missing-card {
		font-size: var(--text-xs);
		color: var(--warning);
		background: rgba(245, 158, 11, 0.1);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
	}
	.hero-section {
		margin-top: var(--space-4);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border);
	}
	.section-subtitle {
		font-family: var(--font-display);
		font-size: var(--text-xs);
		font-weight: var(--font-semibold);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--space-2);
	}
	.hero-rec {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-1);
	}
	.weapon-badge {
		font-size: var(--text-xs);
		font-weight: var(--font-semibold);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		text-transform: capitalize;
		background: var(--bg-elevated);
		color: var(--text-primary);
	}
	.hero-count {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.hero-agnostic {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		margin: 0 0 var(--space-2);
	}
	.hero-reasoning {
		font-size: var(--text-xs);
		color: var(--text-muted);
		margin: var(--space-2) 0 0;
		line-height: 1.4;
	}
	.empty {
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin: 0 0 var(--space-3);
	}
</style>
