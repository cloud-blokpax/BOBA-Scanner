<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';

	interface Fingerprint {
		fingerprint_hash: string;
		event_name: string;
		error_code: string | null;
		level: string;
		status: string;
		summary: string | null;
		occurrence_count: number;
		first_seen: string;
		last_seen: string;
		fixed_in_release_git_sha: string | null;
		fixed_at: string | null;
	}

	interface HistoryRow {
		id: string;
		fingerprint_hash: string;
		prev_status: string | null;
		new_status: string;
		note: string | null;
		author: string;
		created_at: string;
	}

	interface RecentEvent {
		id: string;
		short_code: string;
		level: string;
		created_at: string;
		error_message: string | null;
		context: Record<string, unknown> | null;
		user_id: string | null;
	}

	let view = $state<'active' | 'archive'>('active');
	let fingerprints = $state<Fingerprint[]>([]);
	let recentActivity = $state<HistoryRow[]>([]);
	let loading = $state(true);
	let selectedHash = $state<string | null>(null);
	let detailFp = $state<Fingerprint | null>(null);
	let detailEvents = $state<RecentEvent[]>([]);
	let detailHistory = $state<HistoryRow[]>([]);

	$effect(() => {
		loadQueue();
	});

	async function loadQueue() {
		loading = true;
		try {
			const res = await fetch(`/api/admin/triage?view=${view}`);
			if (!res.ok) throw new Error('failed to load');
			const data = await res.json();
			fingerprints = data.fingerprints;
			recentActivity = data.recent_activity ?? [];
		} catch {
			showToast('Failed to load triage queue', 'x');
		}
		loading = false;
	}

	async function openDetail(hash: string) {
		selectedHash = hash;
		try {
			const res = await fetch(`/api/admin/triage/${hash}`);
			if (!res.ok) throw new Error('failed to load detail');
			const data = await res.json();
			detailFp = data.fingerprint;
			detailEvents = data.recent_events;
			detailHistory = data.history;
		} catch {
			showToast('Failed to load detail', 'x');
			selectedHash = null;
		}
	}

	async function setStatus(hash: string, newStatus: string, note: string) {
		try {
			const res = await fetch(`/api/admin/triage/${hash}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: newStatus, note })
			});
			if (!res.ok) throw new Error('triage failed');
			showToast(`Marked ${newStatus}`, 'check');
			await loadQueue();
			if (selectedHash === hash) await openDetail(hash);
		} catch {
			showToast('Failed to update status', 'x');
		}
	}

	function copyClaudeBundle(fp: Fingerprint, events: RecentEvent[]) {
		const sample = events[0];
		const md = `**Triage request: ${fp.event_name}** (${fp.occurrence_count} occurrences)

Status: ${fp.status}
Level: ${fp.level}
Error code: ${fp.error_code ?? '(none)'}
Fingerprint: \`${fp.fingerprint_hash}\`
Last seen: ${new Date(fp.last_seen).toLocaleString()}
${fp.summary ? `\nCurrent summary: ${fp.summary}` : ''}

**Sample event** (short code: \`${sample?.short_code ?? '(none)'}\`):
\`\`\`json
${JSON.stringify(sample ?? {}, null, 2)}
\`\`\`

**Recent occurrences:** ${events.length} (showing up to 20)

**To resolve via MCP:**
\`\`\`sql
SELECT public.triage_fingerprint(
  '${fp.fingerprint_hash}',
  'fixed',
  'note describing the fix',
  'claude',
  '<deploy_sha>'
);
\`\`\`

**Or commit a fix referencing the short code:**
\`Fixes diag ${sample?.short_code ?? '<short_code>'}\``;

		navigator.clipboard.writeText(md).then(() => {
			showToast('Bundle copied for Claude', 'copy');
		});
	}

	function statusBadgeClass(status: string): string {
		switch (status) {
			case 'new':
				return 'badge-new';
			case 'regression':
				return 'badge-regression';
			case 'investigating':
				return 'badge-investigating';
			case 'fix_pending':
				return 'badge-pending';
			case 'fixed':
				return 'badge-fixed';
			case 'understood':
				return 'badge-understood';
			case 'ignore':
				return 'badge-ignore';
			case 'duplicate':
				return 'badge-duplicate';
			default:
				return '';
		}
	}

	function relativeTime(iso: string): string {
		const ms = Date.now() - new Date(iso).getTime();
		const m = Math.floor(ms / 60_000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		const d = Math.floor(h / 24);
		return `${d}d ago`;
	}
</script>

<div class="triage-tab">
	<div class="view-tabs">
		<button
			class:active={view === 'active'}
			onclick={() => {
				view = 'active';
				loadQueue();
			}}
		>
			Active queue
		</button>
		<button
			class:active={view === 'archive'}
			onclick={() => {
				view = 'archive';
				loadQueue();
			}}
		>
			Archive
		</button>
	</div>

	{#if loading}
		<div class="loading">Loading...</div>
	{:else if fingerprints.length === 0}
		<div class="empty">
			{view === 'active' ? '🎉 No active issues.' : 'Archive is empty.'}
		</div>
	{:else}
		<div class="fp-list">
			{#each fingerprints as fp (fp.fingerprint_hash)}
				<div class="fp-row" class:selected={selectedHash === fp.fingerprint_hash}>
					<button class="fp-summary" onclick={() => openDetail(fp.fingerprint_hash)}>
						<div class="fp-header">
							<span class={`badge ${statusBadgeClass(fp.status)}`}>{fp.status}</span>
							<span class="event-name">{fp.event_name}</span>
							{#if fp.error_code}
								<span class="error-code">· {fp.error_code}</span>
							{/if}
						</div>
						<div class="fp-meta">
							<span>{fp.occurrence_count} occurrences</span>
							<span>· last seen {relativeTime(fp.last_seen)}</span>
							{#if fp.summary}
								<div class="fp-summary-text">{fp.summary}</div>
							{/if}
						</div>
					</button>
				</div>

				{#if selectedHash === fp.fingerprint_hash && detailFp}
					<div class="fp-detail">
						<div class="detail-actions">
							<button onclick={() => copyClaudeBundle(detailFp!, detailEvents)}>
								📋 Send to Claude
							</button>
							<button
								onclick={() =>
									setStatus(detailFp!.fingerprint_hash, 'investigating', 'Investigating')}
							>
								Investigating
							</button>
							<button
								onclick={() =>
									setStatus(detailFp!.fingerprint_hash, 'fix_pending', 'Fix in progress')}
							>
								Fix pending
							</button>
							<button
								onclick={() =>
									setStatus(
										detailFp!.fingerprint_hash,
										'understood',
										"Known cause, won't fix"
									)}
							>
								Understood
							</button>
							<button
								onclick={() => setStatus(detailFp!.fingerprint_hash, 'ignore', 'Noise')}
							>
								Ignore
							</button>
						</div>

						<div class="detail-events">
							<h4>Recent occurrences ({detailEvents.length})</h4>
							{#each detailEvents.slice(0, 5) as ev}
								<div class="event-row">
									<code>{ev.short_code}</code>
									<span>{relativeTime(ev.created_at)}</span>
									{#if ev.error_message}
										<div class="error-msg">{ev.error_message}</div>
									{/if}
								</div>
							{/each}
						</div>

						<div class="detail-history">
							<h4>Triage history</h4>
							{#each detailHistory as h}
								<div class="history-row">
									<span class="history-author">[{h.author}]</span>
									<span>{h.prev_status ?? '(initial)'} → {h.new_status}</span>
									<span class="history-time">{relativeTime(h.created_at)}</span>
									{#if h.note}
										<div class="history-note">{h.note}</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/each}
		</div>
	{/if}

	{#if view === 'active' && recentActivity.length > 0}
		<div class="recent-activity">
			<h3>Recent triage actions</h3>
			{#each recentActivity as h}
				<div class="activity-row">
					<span class="history-author">[{h.author}]</span>
					<span>{h.prev_status ?? '(initial)'} → {h.new_status}</span>
					<span class="history-time">{relativeTime(h.created_at)}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.triage-tab {
		padding: 1rem;
	}
	.view-tabs {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.view-tabs button {
		padding: 0.5rem 1rem;
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
		color: var(--text-secondary);
	}
	.view-tabs button.active {
		background: var(--gold);
		color: #000;
		border-color: var(--gold);
	}
	.loading,
	.empty {
		padding: 2rem;
		text-align: center;
		color: var(--text-tertiary);
	}
	.fp-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.fp-row {
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.fp-summary {
		width: 100%;
		text-align: left;
		padding: 1rem;
		background: transparent;
		border: 0;
		cursor: pointer;
		color: inherit;
	}
	.fp-row.selected {
		border-color: var(--gold);
	}
	.fp-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.badge {
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
	}
	.badge-new {
		background: #dc2626;
		color: white;
	}
	.badge-regression {
		background: #f59e0b;
		color: black;
	}
	.badge-investigating {
		background: #3b82f6;
		color: white;
	}
	.badge-pending {
		background: #8b5cf6;
		color: white;
	}
	.badge-fixed {
		background: #22c55e;
		color: white;
	}
	.badge-understood {
		background: #6b7280;
		color: white;
	}
	.badge-ignore {
		background: #9ca3af;
		color: white;
	}
	.badge-duplicate {
		background: #6b7280;
		color: white;
	}
	.event-name {
		font-family: monospace;
		font-weight: 600;
	}
	.error-code {
		color: var(--text-tertiary);
	}
	.fp-meta {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		margin-top: 0.25rem;
	}
	.fp-summary-text {
		margin-top: 0.5rem;
		color: var(--text-primary);
	}
	.fp-detail {
		padding: 1rem;
		border-top: 1px solid var(--border);
		background: var(--bg-deep, var(--bg-elevated));
	}
	.detail-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	.detail-actions button {
		padding: 0.4rem 0.8rem;
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.detail-events h4,
	.detail-history h4 {
		margin: 0.75rem 0 0.5rem;
		font-size: 0.9rem;
	}
	.event-row,
	.history-row,
	.activity-row {
		padding: 0.5rem;
		border-left: 2px solid var(--border);
		margin-bottom: 0.25rem;
		font-size: 0.85rem;
	}
	.event-row code {
		background: var(--bg-elevated);
		padding: 0.1rem 0.3rem;
		border-radius: 3px;
	}
	.error-msg {
		font-family: monospace;
		font-size: 0.8rem;
		color: #dc2626;
		margin-top: 0.25rem;
	}
	.history-author {
		font-weight: 600;
		color: var(--gold);
		margin-right: 0.5rem;
	}
	.history-time {
		color: var(--text-tertiary);
		margin-left: 0.5rem;
		font-size: 0.8rem;
	}
	.history-note {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		margin-top: 0.25rem;
	}
	.recent-activity {
		margin-top: 2rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
	.recent-activity h3 {
		font-size: 1rem;
		margin-bottom: 0.5rem;
	}
</style>
