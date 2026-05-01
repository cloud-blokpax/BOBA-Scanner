<script lang="ts">
	import {
		RULE_EXPLOITS,
		exploitsToMarkdownReport,
		getOpenHighSeverityExploits,
		type ExploitSeverity,
		type ExploitStatus
	} from '$lib/data/rule-exploits';
	import { showToast } from '$lib/stores/toast.svelte';

	let severityFilter = $state<ExploitSeverity | 'all'>('all');
	let statusFilter = $state<ExploitStatus | 'all'>('all');
	let expandedId = $state<string | null>(null);

	const sevOrder: Record<ExploitSeverity, number> = { high: 0, medium: 1, low: 2 };

	const filtered = $derived(
		RULE_EXPLOITS.filter((e) => {
			if (severityFilter !== 'all' && e.severity !== severityFilter) return false;
			if (statusFilter !== 'all' && e.status !== statusFilter) return false;
			return true;
		}).sort((a, b) => {
			const sevDiff = sevOrder[a.severity] - sevOrder[b.severity];
			if (sevDiff !== 0) return sevDiff;
			return a.id.localeCompare(b.id);
		})
	);

	const counts = $derived({
		total: RULE_EXPLOITS.length,
		high: RULE_EXPLOITS.filter((e) => e.severity === 'high').length,
		medium: RULE_EXPLOITS.filter((e) => e.severity === 'medium').length,
		low: RULE_EXPLOITS.filter((e) => e.severity === 'low').length,
		open: RULE_EXPLOITS.filter((e) => e.status === 'open').length,
		fixed: RULE_EXPLOITS.filter((e) => e.status === 'fixed').length
	});

	function toggleExpand(id: string) {
		expandedId = expandedId === id ? null : id;
	}

	function severityColor(sev: ExploitSeverity): string {
		if (sev === 'high') return 'var(--danger)';
		if (sev === 'medium') return 'var(--warning)';
		return 'var(--text-muted)';
	}

	function statusColor(status: ExploitStatus): string {
		if (status === 'fixed') return 'var(--success)';
		if (status === 'acknowledged') return 'var(--info, var(--text-secondary))';
		if (status === 'discussed') return 'var(--warning)';
		return 'var(--text-muted)';
	}

	async function handleCopyAll() {
		try {
			const md = exploitsToMarkdownReport(filtered);
			await navigator.clipboard.writeText(md);
			showToast(`Copied ${filtered.length} findings as Markdown`, '✓');
		} catch (err) {
			showToast('Copy failed — check clipboard permissions', '✗');
		}
	}

	async function handleCopyHighSeverity() {
		try {
			const exploits = getOpenHighSeverityExploits();
			const md = exploitsToMarkdownReport(exploits);
			await navigator.clipboard.writeText(md);
			showToast(`Copied ${exploits.length} high-priority findings`, '✓');
		} catch (err) {
			showToast('Copy failed — check clipboard permissions', '✗');
		}
	}
</script>

<div class="rules-tab">
	<header class="tab-header">
		<div>
			<h2 class="tab-title">Rule Exploit Registry</h2>
			<p class="tab-hint">
				Findings from the BoBA Comprehensive Rules Guide v1 and Card Scanner combo
				analysis. Use this to brief the BoBA dev team.
			</p>
		</div>
		<div class="actions">
			<button class="action-btn" onclick={handleCopyHighSeverity}>
				Copy high-priority for devs
			</button>
			<button class="action-btn secondary" onclick={handleCopyAll}>
				Copy all visible
			</button>
		</div>
	</header>

	<div class="counts">
		<span class="count-chip"><strong>{counts.total}</strong> total</span>
		<span class="count-chip danger"><strong>{counts.high}</strong> high</span>
		<span class="count-chip warning"><strong>{counts.medium}</strong> medium</span>
		<span class="count-chip"><strong>{counts.low}</strong> low</span>
		<span class="count-divider">|</span>
		<span class="count-chip"><strong>{counts.open}</strong> open</span>
		<span class="count-chip success"><strong>{counts.fixed}</strong> fixed</span>
	</div>

	<div class="filters">
		<div class="filter-group">
			<span class="filter-label">Severity:</span>
			<button class="chip" class:active={severityFilter === 'all'} onclick={() => (severityFilter = 'all')}>All</button>
			<button class="chip" class:active={severityFilter === 'high'} onclick={() => (severityFilter = 'high')}>High</button>
			<button class="chip" class:active={severityFilter === 'medium'} onclick={() => (severityFilter = 'medium')}>Medium</button>
			<button class="chip" class:active={severityFilter === 'low'} onclick={() => (severityFilter = 'low')}>Low</button>
		</div>
		<div class="filter-group">
			<span class="filter-label">Status:</span>
			<button class="chip" class:active={statusFilter === 'all'} onclick={() => (statusFilter = 'all')}>All</button>
			<button class="chip" class:active={statusFilter === 'open'} onclick={() => (statusFilter = 'open')}>Open</button>
			<button class="chip" class:active={statusFilter === 'discussed'} onclick={() => (statusFilter = 'discussed')}>Discussed</button>
			<button class="chip" class:active={statusFilter === 'acknowledged'} onclick={() => (statusFilter = 'acknowledged')}>Acknowledged</button>
			<button class="chip" class:active={statusFilter === 'fixed'} onclick={() => (statusFilter = 'fixed')}>Fixed</button>
		</div>
	</div>

	<div class="exploit-list">
		{#each filtered as exploit (exploit.id)}
			{@const isOpen = expandedId === exploit.id}
			<div class="exploit-row" class:expanded={isOpen}>
				<button class="row-summary" onclick={() => toggleExpand(exploit.id)}>
					<span class="row-id">{exploit.id}</span>
					<span class="row-area">{exploit.ruleArea}</span>
					{#if exploit.ruleSection}
						<span class="row-section">{exploit.ruleSection}</span>
					{/if}
					<span class="row-severity" style:color={severityColor(exploit.severity)}>
						{exploit.severity}
					</span>
					<span class="row-status" style:color={statusColor(exploit.status)}>
						{exploit.status}
					</span>
					<span class="chevron" class:rotated={isOpen}>▾</span>
				</button>

				{#if isOpen}
					<div class="row-detail">
						<section>
							<h4>Rule text</h4>
							<blockquote class="rule-quote">{exploit.ruleQuote}</blockquote>
						</section>
						<section>
							<h4>Exploit</h4>
							<p>{exploit.exploit}</p>
						</section>
						<section>
							<h4>Cards / Plays affected</h4>
							<ul>
								{#each exploit.cardsAffected as c}
									<li>{c}</li>
								{/each}
							</ul>
						</section>
						<section>
							<h4>Unintended effect</h4>
							<p>{exploit.unintendedEffect}</p>
						</section>
						<section>
							<h4>Suggested clarifications</h4>
							<ol>
								{#each exploit.suggestedClarifications as c}
									<li>{c}</li>
								{/each}
							</ol>
						</section>
						{#if exploit.internalNotes}
							<section>
								<h4>Internal notes</h4>
								<p class="notes">{exploit.internalNotes}</p>
							</section>
						{/if}
					</div>
				{/if}
			</div>
		{/each}

		{#if filtered.length === 0}
			<p class="empty">No exploits match the current filters.</p>
		{/if}
	</div>
</div>

<style>
	.rules-tab {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.tab-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.tab-title {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		font-weight: var(--font-bold);
		color: var(--text-primary);
		margin: 0 0 var(--space-1);
	}
	.tab-hint {
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin: 0;
		line-height: 1.5;
		max-width: 60ch;
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.action-btn {
		font-family: var(--font-display);
		font-size: var(--text-xs);
		font-weight: var(--font-bold);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: var(--space-2) var(--space-3);
		background: var(--gold);
		color: var(--bg-base);
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background var(--transition-fast);
	}
	.action-btn:hover {
		background: var(--gold-dark);
	}
	.action-btn.secondary {
		background: var(--bg-elevated);
		color: var(--text-secondary);
		border: 1px solid var(--border);
	}
	.action-btn.secondary:hover {
		color: var(--text-primary);
		border-color: var(--border-strong);
	}

	.counts {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.count-chip {
		font-size: var(--text-xs);
		color: var(--text-muted);
		padding: var(--space-1) var(--space-2);
		background: var(--bg-elevated);
		border-radius: var(--radius-sm);
	}
	.count-chip strong {
		color: var(--text-primary);
		font-weight: var(--font-bold);
	}
	.count-chip.danger strong {
		color: var(--danger);
	}
	.count-chip.warning strong {
		color: var(--warning);
	}
	.count-chip.success strong {
		color: var(--success);
	}
	.count-divider {
		color: var(--text-muted);
		opacity: 0.5;
	}

	.filters {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.filter-group {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.filter-label {
		font-size: var(--text-xs);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: var(--font-medium);
		min-width: 60px;
	}
	.chip {
		font-size: var(--text-xs);
		padding: var(--space-1) var(--space-2);
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		color: var(--text-secondary);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-family: inherit;
		transition: all var(--transition-fast);
	}
	.chip:hover {
		border-color: var(--border-strong);
	}
	.chip.active {
		background: var(--gold);
		border-color: var(--gold);
		color: var(--bg-base);
		font-weight: var(--font-medium);
	}

	.exploit-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.exploit-row {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
		transition: border-color var(--transition-fast);
	}
	.exploit-row:hover {
		border-color: var(--border-strong);
	}
	.exploit-row.expanded {
		border-color: var(--gold);
	}
	.row-summary {
		display: grid;
		grid-template-columns: 80px 1fr auto auto auto auto;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-3);
		background: transparent;
		border: none;
		cursor: pointer;
		font-family: inherit;
		color: inherit;
		text-align: left;
	}
	.row-id {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: var(--font-bold);
		color: var(--text-secondary);
	}
	.row-area {
		font-size: var(--text-sm);
		color: var(--text-primary);
		font-weight: var(--font-medium);
	}
	.row-section {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.row-severity,
	.row-status {
		font-size: var(--text-xs);
		font-weight: var(--font-bold);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.chevron {
		color: var(--text-muted);
		font-size: var(--text-base);
		transition: transform var(--transition-fast);
	}
	.chevron.rotated {
		transform: rotate(180deg);
	}

	.row-detail {
		padding: 0 var(--space-3) var(--space-3);
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.row-detail section {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.row-detail h4 {
		font-family: var(--font-display);
		font-size: 10px;
		font-weight: var(--font-bold);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: var(--space-2) 0 0;
	}
	.row-detail p {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		line-height: 1.5;
		margin: 0;
	}
	.rule-quote {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text-secondary);
		background: var(--bg-elevated);
		padding: var(--space-2) var(--space-3);
		border-left: 3px solid var(--gold);
		border-radius: var(--radius-sm);
		margin: 0;
		line-height: 1.5;
	}
	.row-detail ul,
	.row-detail ol {
		margin: 0;
		padding-left: var(--space-4);
	}
	.row-detail li {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		line-height: 1.5;
		margin-bottom: var(--space-1);
	}
	.notes {
		font-style: italic;
	}
	.empty {
		font-size: var(--text-sm);
		color: var(--text-muted);
		text-align: center;
		padding: var(--space-8);
	}

	@media (max-width: 768px) {
		.row-summary {
			grid-template-columns: 1fr auto;
			grid-template-rows: auto auto;
			gap: var(--space-1) var(--space-2);
		}
		.row-id {
			grid-column: 1;
			grid-row: 1;
		}
		.row-area {
			grid-column: 1;
			grid-row: 2;
		}
		.row-section {
			display: none;
		}
		.row-severity,
		.row-status {
			grid-column: 2;
		}
		.row-severity {
			grid-row: 1;
		}
		.row-status {
			grid-row: 2;
		}
		.chevron {
			grid-column: 2;
			grid-row: 1 / 3;
			align-self: center;
		}
	}
</style>
