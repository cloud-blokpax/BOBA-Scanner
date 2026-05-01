<script lang="ts">
	import type { ComboDetectionResult, HeroRecommendation } from '$lib/services/playbook-engine';
	import {
		selectedPlays,
		addPlay,
		getUniverse
	} from '$lib/stores/playbook-architect.svelte';
	import { getCombo, type ComboTier } from '$lib/data/combo-registry';

	let {
		combos,
		heroRec
	}: {
		combos: ComboDetectionResult;
		heroRec: HeroRecommendation;
	} = $props();

	let expandedId = $state<string | null>(null);

	const selectedNames = $derived(new Set(selectedPlays().map((p) => p.name)));
	const universeByName = $derived(new Map(getUniverse().map((p) => [p.name, p])));

	function riskBadge(risk: 'low' | 'medium' | 'high'): { label: string; color: string } {
		if (risk === 'low') return { label: 'Low Risk', color: 'var(--success)' };
		if (risk === 'medium') return { label: 'Med Risk', color: 'var(--warning)' };
		return { label: 'High Risk', color: 'var(--danger)' };
	}

	function tierBadge(tier: ComboTier): { label: string; color: string; description: string } {
		if (tier === 'S')
			return {
				label: 'S — Game-warping',
				color: 'var(--gold)',
				description: 'Single-card or two-card combo that defines the metagame.'
			};
		if (tier === 'A')
			return {
				label: 'A — Tournament-viable',
				color: 'var(--success)',
				description: 'Proven combo with redundancy. Wins games consistently.'
			};
		if (tier === 'B')
			return {
				label: 'B — Niche / Conditional',
				color: 'var(--warning)',
				description: 'Combo works under specific conditions. Build-around required.'
			};
		return {
			label: 'C — Synergy',
			color: 'var(--text-muted)',
			description: 'Value-engine support, not a primary win condition.'
		};
	}

	function toggle(id: string) {
		expandedId = expandedId === id ? null : id;
	}

	function handleAddEnhancer(name: string) {
		const card = universeByName.get(name);
		if (card) addPlay(card);
	}
</script>

<div class="card">
	<h3 class="card-title">Combo Status</h3>

	{#if combos.complete.length === 0 && combos.partial.length === 0}
		<p class="empty">No combo engines detected yet. Add plays to discover synergies.</p>
	{/if}

	{#each combos.complete as { engine, enhancersPresent } (engine.id)}
		{@const isOpen = expandedId === engine.id}
		<div class="combo complete">
			<button class="combo-header-btn" onclick={() => toggle(engine.id)}>
				<div class="combo-header">
					<span class="combo-name">{engine.name}</span>
					<span class="header-right">
						<span class="combo-badge complete-badge">Complete</span>
						<span class="chevron" class:open={isOpen}>▾</span>
					</span>
				</div>
				<p class="combo-tagline">{engine.tagline}</p>
				<div class="combo-meta">
					<span class="meta-chip">{engine.coreDBS} DBS</span>
					<span class="meta-chip">{engine.coreHD} HD</span>
					<span class="meta-chip" style="color: {riskBadge(engine.risk).color}">
						{riskBadge(engine.risk).label}
					</span>
				</div>
				{#if enhancersPresent.length > 0}
					<p class="enhancers">+{enhancersPresent.length} enhancers active</p>
				{/if}
			</button>

			{#if isOpen}
				{@const fullCombo = getCombo(engine.id)}
				<div class="combo-detail">
					{#if fullCombo}
						{@const tb = tierBadge(fullCombo.tier)}
						<div class="tier-row">
							<span class="tier-badge" style:color={tb.color} style:border-color={tb.color}>
								{tb.label}
							</span>
							<span class="tier-description">{tb.description}</span>
						</div>

						{#if fullCombo.ambiguity}
							<div class="ambiguity-warning">
								<strong>⚠ Rules ambiguity:</strong>
								{fullCombo.ambiguity.question}
								{#if fullCombo.ambiguity.exploitId}
									<span class="exploit-link">(see {fullCombo.ambiguity.exploitId} in admin)</span>
								{/if}
							</div>
						{/if}
					{/if}

					<h5 class="detail-title">How it works</h5>
					<p class="detail-chain">{engine.chain}</p>

					<h5 class="detail-title">Projected impact</h5>
					<p class="detail-impact">{engine.projectedImpact}</p>

					<h5 class="detail-title">Core cards</h5>
					<ul class="card-list">
						{#each engine.coreCards as cardName}
							<li class="card-row present">
								<span class="card-mark">✓</span>
								<span class="card-name">{cardName}</span>
							</li>
						{/each}
					</ul>

					{#if engine.enhancerCards.length > 0}
						<h5 class="detail-title">Enhancer cards</h5>
						<ul class="card-list">
							{#each engine.enhancerCards as cardName}
								{@const inDeck = selectedNames.has(cardName)}
								{@const inUniverse = universeByName.has(cardName)}
								<li class="card-row" class:present={inDeck}>
									<span class="card-mark">{inDeck ? '✓' : '·'}</span>
									<span class="card-name">{cardName}</span>
									{#if !inDeck && inUniverse}
										<button
											class="add-btn"
											onclick={() => handleAddEnhancer(cardName)}
										>
											Add
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}

					{#if fullCombo && fullCombo.counters.length > 0}
						<h5 class="detail-title">Counters</h5>
						<ul class="counters-list">
							{#each fullCombo.counters as counter}
								<li>{counter}</li>
							{/each}
						</ul>
					{/if}

					{#if fullCombo && fullCombo.ruleCitations.length > 0}
						<h5 class="detail-title">Rule basis</h5>
						<ul class="citations-list">
							{#each fullCombo.ruleCitations as cite}
								<li>
									<span class="cite-section">{cite.section}</span>
									<span class="cite-relevance">{cite.relevance}</span>
									{#if cite.exploitId}
										<span class="cite-exploit">({cite.exploitId})</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		</div>
	{/each}

	{#each combos.partial as { engine, present, missing } (engine.id)}
		{@const isOpen = expandedId === engine.id}
		<div class="combo partial">
			<button class="combo-header-btn" onclick={() => toggle(engine.id)}>
				<div class="combo-header">
					<span class="combo-name">{engine.name}</span>
					<span class="header-right">
						<span class="combo-badge partial-badge">
							{present.length}/{engine.coreCards.length}
						</span>
						<span class="chevron" class:open={isOpen}>▾</span>
					</span>
				</div>
				<p class="combo-tagline">{engine.tagline}</p>
				<div class="missing-cards">
					<span class="missing-label">Missing:</span>
					{#each missing as cardName}
						<span class="missing-card">{cardName}</span>
					{/each}
				</div>
			</button>

			{#if isOpen}
				{@const fullCombo = getCombo(engine.id)}
				<div class="combo-detail">
					{#if fullCombo}
						{@const tb = tierBadge(fullCombo.tier)}
						<div class="tier-row">
							<span class="tier-badge" style:color={tb.color} style:border-color={tb.color}>
								{tb.label}
							</span>
							<span class="tier-description">{tb.description}</span>
						</div>

						{#if fullCombo.ambiguity}
							<div class="ambiguity-warning">
								<strong>⚠ Rules ambiguity:</strong>
								{fullCombo.ambiguity.question}
								{#if fullCombo.ambiguity.exploitId}
									<span class="exploit-link">(see {fullCombo.ambiguity.exploitId} in admin)</span>
								{/if}
							</div>
						{/if}
					{/if}

					<h5 class="detail-title">How it works</h5>
					<p class="detail-chain">{engine.chain}</p>

					<h5 class="detail-title">Core cards</h5>
					<ul class="card-list">
						{#each engine.coreCards as cardName}
							{@const inDeck = selectedNames.has(cardName)}
							{@const inUniverse = universeByName.has(cardName)}
							<li class="card-row" class:present={inDeck}>
								<span class="card-mark">{inDeck ? '✓' : '✗'}</span>
								<span class="card-name">{cardName}</span>
								{#if !inDeck && inUniverse}
									<button
										class="add-btn"
										onclick={() => handleAddEnhancer(cardName)}
									>
										Add
									</button>
								{/if}
							</li>
						{/each}
					</ul>

					{#if engine.enhancerCards.length > 0}
						<h5 class="detail-title">Enhancer cards</h5>
						<ul class="card-list">
							{#each engine.enhancerCards as cardName}
								{@const inDeck = selectedNames.has(cardName)}
								{@const inUniverse = universeByName.has(cardName)}
								<li class="card-row" class:present={inDeck}>
									<span class="card-mark">{inDeck ? '✓' : '·'}</span>
									<span class="card-name">{cardName}</span>
									{#if !inDeck && inUniverse}
										<button
											class="add-btn"
											onclick={() => handleAddEnhancer(cardName)}
										>
											Add
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}

					{#if fullCombo && fullCombo.counters.length > 0}
						<h5 class="detail-title">Counters</h5>
						<ul class="counters-list">
							{#each fullCombo.counters as counter}
								<li>{counter}</li>
							{/each}
						</ul>
					{/if}

					{#if fullCombo && fullCombo.ruleCitations.length > 0}
						<h5 class="detail-title">Rule basis</h5>
						<ul class="citations-list">
							{#each fullCombo.ruleCitations as cite}
								<li>
									<span class="cite-section">{cite.section}</span>
									<span class="cite-relevance">{cite.relevance}</span>
									{#if cite.exploitId}
										<span class="cite-exploit">({cite.exploitId})</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
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
		border-radius: var(--radius-md);
		margin-bottom: var(--space-2);
		overflow: hidden;
	}
	.combo.complete {
		background: var(--success-light);
		border: 1px solid rgba(16, 185, 129, 0.25);
	}
	.combo.partial {
		background: var(--warning-light);
		border: 1px solid rgba(245, 158, 11, 0.25);
	}
	.combo-header-btn {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		padding: var(--space-3);
		cursor: pointer;
		font-family: inherit;
		color: inherit;
	}
	.combo-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-1);
	}
	.header-right {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.chevron {
		font-size: var(--text-base);
		color: var(--text-muted);
		transition: transform var(--transition-fast);
	}
	.chevron.open {
		transform: rotate(180deg);
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
	.combo-detail {
		padding: 0 var(--space-3) var(--space-3);
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}
	.detail-title {
		font-family: var(--font-display);
		font-size: 10px;
		font-weight: var(--font-semibold);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: var(--space-3) 0 var(--space-1);
	}
	.detail-chain,
	.detail-impact {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		line-height: 1.5;
		margin: 0;
	}
	.card-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.card-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.card-row.present {
		color: var(--text-primary);
	}
	.card-mark {
		font-weight: var(--font-bold);
		width: 12px;
	}
	.card-row.present .card-mark {
		color: var(--success);
	}
	.card-name {
		flex: 1;
	}
	.add-btn {
		font-size: 10px;
		font-weight: var(--font-medium);
		padding: 2px 6px;
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		color: var(--text-secondary);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-family: inherit;
		transition: color var(--transition-fast), border-color var(--transition-fast);
	}
	.add-btn:hover {
		color: var(--gold);
		border-color: var(--gold);
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

	/* Tier badge */
	.tier-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--border);
		flex-wrap: wrap;
	}
	.tier-badge {
		font-family: var(--font-display);
		font-size: var(--text-xs);
		font-weight: var(--font-bold);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: var(--space-1) var(--space-2);
		border: 1px solid currentColor;
		border-radius: var(--radius-sm);
		background: transparent;
		flex-shrink: 0;
	}
	.tier-description {
		font-size: var(--text-xs);
		color: var(--text-muted);
		flex: 1;
		min-width: 0;
	}

	/* Ambiguity warning */
	.ambiguity-warning {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		background: rgba(245, 158, 11, 0.08);
		border: 1px solid rgba(245, 158, 11, 0.2);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		margin-bottom: var(--space-3);
		line-height: 1.5;
	}
	.ambiguity-warning strong {
		color: var(--gold);
		font-weight: var(--font-bold);
	}
	.exploit-link {
		display: inline-block;
		margin-left: var(--space-1);
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 10px;
	}

	/* Counters list */
	.counters-list {
		margin: 0 0 var(--space-3);
		padding-left: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.counters-list li {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		line-height: 1.5;
	}

	/* Rule citations list */
	.citations-list {
		margin: 0 0 var(--space-3);
		padding-left: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.citations-list li {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		line-height: 1.5;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.cite-section {
		font-family: var(--font-mono);
		color: var(--gold);
		font-weight: var(--font-bold);
	}
	.cite-relevance {
		color: var(--text-muted);
	}
	.cite-exploit {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-muted);
		opacity: 0.7;
	}
</style>
