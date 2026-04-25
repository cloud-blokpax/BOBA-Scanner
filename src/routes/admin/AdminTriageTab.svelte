<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';

	type SubView = 'active' | 'archive' | 'patterns' | 'storage';
	type Status = 'active' | 'investigating' | 'understood' | 'ignore' | 'resolved';

	interface Fingerprint {
		fingerprint_hash: string;
		event_name: string;
		summary: string | null;
		error_code: string | null;
		status: Status;
		occurrence_count: number;
		first_seen: string;
		last_seen: string;
		notes: string | null;
		last_triaged_by: string | null;
		last_triaged_at: string | null;
	}

	interface Pattern {
		fingerprint_hash: string;
		event_name: string;
		summary: string | null;
		status: string;
		occurrence_count: number;
		last_seen: string;
		occurrences_last_7d: number;
	}

	interface StorageSummary {
		total_events: number;
		debug_count: number;
		info_count: number;
		warn_count: number;
		error_count: number;
		app_events_bytes: number;
		fingerprint_count: number;
		fingerprints_bytes: number;
		triage_history_count: number;
		triage_history_bytes: number;
		total_diagnostic_bytes: number;
		total_db_bytes: number;
		avg_events_per_day_last_7d: number;
	}

	interface DetailEvent {
		id: number;
		level: string;
		event_name: string;
		source: string;
		summary: string | null;
		error_code: string | null;
		error_detail: Record<string, unknown> | null;
		context: Record<string, unknown>;
		request_path: string | null;
		user_id: string | null;
		created_at: string;
	}

	let subView = $state<SubView>('active');
	let loading = $state(false);
	let fingerprints = $state<Fingerprint[]>([]);
	let patterns = $state<Pattern[]>([]);
	let storage = $state<StorageSummary | null>(null);

	let detailFingerprint = $state<Fingerprint | null>(null);
	let detailEvents = $state<DetailEvent[]>([]);
	let detailNotes = $state('');
	let detailStatus = $state<Status>('active');

	$effect(() => {
		void load(subView);
	});

	async function load(view: SubView) {
		loading = true;
		try {
			const res = await fetch(`/api/admin/triage?view=${view}`);
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			if (view === 'active' || view === 'archive') {
				fingerprints = data.fingerprints ?? [];
			} else if (view === 'patterns') {
				patterns = data.patterns ?? [];
			} else if (view === 'storage') {
				storage = data.storage ?? null;
			}
		} catch (err) {
			showToast(`Failed to load ${view}: ${err instanceof Error ? err.message : err}`, '✕');
		}
		loading = false;
	}

	async function openDetail(fp: Fingerprint) {
		detailFingerprint = fp;
		detailNotes = fp.notes ?? '';
		detailStatus = fp.status;
		try {
			const res = await fetch(`/api/admin/triage?view=detail&fingerprint=${encodeURIComponent(fp.fingerprint_hash)}`);
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			detailEvents = data.events ?? [];
		} catch (err) {
			showToast(`Failed to load detail: ${err instanceof Error ? err.message : err}`, '✕');
		}
	}

	function closeDetail() {
		detailFingerprint = null;
		detailEvents = [];
	}

	async function saveTriage() {
		if (!detailFingerprint) return;
		try {
			const res = await fetch('/api/admin/triage', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					fingerprint_hash: detailFingerprint.fingerprint_hash,
					status: detailStatus,
					notes: detailNotes
				})
			});
			if (!res.ok) throw new Error(await res.text());
			showToast('Triage saved', '✓');
			closeDetail();
			await load(subView);
		} catch (err) {
			showToast(`Save failed: ${err instanceof Error ? err.message : err}`, '✕');
		}
	}

	function fmtBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
		return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
	}

	function storageColor(bytes: number): 'green' | 'yellow' | 'orange' | 'red' {
		const mb = bytes / 1024 / 1024;
		if (mb < 200) return 'green';
		if (mb < 1024) return 'yellow';
		if (mb < 4096) return 'orange';
		return 'red';
	}

	function fmtDate(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleString();
	}

	function statusBadge(s: string): string {
		switch (s) {
			case 'active':        return '🔴 Active';
			case 'investigating': return '🔶 Investigating';
			case 'understood':    return '🟦 Understood';
			case 'ignore':        return '⚪ Ignore';
			case 'resolved':      return '✅ Resolved';
			default: return s;
		}
	}

	function levelBadge(l: string): string {
		switch (l) {
			case 'debug': return '·';
			case 'info':  return 'ℹ';
			case 'warn':  return '⚠';
			case 'error': return '✕';
			case 'fatal': return '☠';
			default: return l;
		}
	}
</script>

<div class="triage-tab">
	<div class="sub-tabs">
		<button class="sub-tab" class:active={subView === 'active'} onclick={() => (subView = 'active')}>
			Active
		</button>
		<button class="sub-tab" class:active={subView === 'archive'} onclick={() => (subView = 'archive')}>
			Archive
		</button>
		<button class="sub-tab" class:active={subView === 'patterns'} onclick={() => (subView = 'patterns')}>
			Patterns
		</button>
		<button class="sub-tab" class:active={subView === 'storage'} onclick={() => (subView = 'storage')}>
			Storage
		</button>
	</div>

	{#if loading}
		<div class="loading">Loading…</div>
	{:else if subView === 'active' || subView === 'archive'}
		{#if fingerprints.length === 0}
			<div class="empty">
				{subView === 'active' ? 'No active fingerprints — system is quiet.' : 'No archived fingerprints yet.'}
			</div>
		{:else}
			<table class="fingerprints">
				<thead>
					<tr>
						<th>Status</th>
						<th>Event</th>
						<th>Summary</th>
						<th>Count</th>
						<th>Last seen</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each fingerprints as fp}
						<tr>
							<td>{statusBadge(fp.status)}</td>
							<td><code>{fp.event_name}</code></td>
							<td class="summary">{fp.summary ?? ''}</td>
							<td>{fp.occurrence_count}</td>
							<td>{fmtDate(fp.last_seen)}</td>
							<td><button class="link" onclick={() => openDetail(fp)}>Triage →</button></td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	{:else if subView === 'patterns'}
		{#if patterns.length === 0}
			<div class="empty">No known patterns yet. Mark a fingerprint as understood/ignore to populate.</div>
		{:else}
			<table class="fingerprints">
				<thead>
					<tr>
						<th>Status</th>
						<th>Event</th>
						<th>Summary</th>
						<th>7d</th>
						<th>Total</th>
						<th>Last seen</th>
					</tr>
				</thead>
				<tbody>
					{#each patterns as p}
						<tr>
							<td>{statusBadge(p.status)}</td>
							<td><code>{p.event_name}</code></td>
							<td class="summary">{p.summary ?? ''}</td>
							<td>{p.occurrences_last_7d}</td>
							<td>{p.occurrence_count}</td>
							<td>{fmtDate(p.last_seen)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	{:else if subView === 'storage'}
		{#if storage}
			{@const color = storageColor(storage.app_events_bytes)}
			<div class="storage-grid">
				<div class="storage-card health-{color}">
					<div class="storage-label">app_events table</div>
					<div class="storage-value">{fmtBytes(storage.app_events_bytes)}</div>
					<div class="storage-sub">{storage.total_events.toLocaleString()} rows</div>
				</div>
				<div class="storage-card">
					<div class="storage-label">Fingerprints</div>
					<div class="storage-value">{fmtBytes(storage.fingerprints_bytes)}</div>
					<div class="storage-sub">{storage.fingerprint_count.toLocaleString()} rows</div>
				</div>
				<div class="storage-card">
					<div class="storage-label">Triage history</div>
					<div class="storage-value">{fmtBytes(storage.triage_history_bytes)}</div>
					<div class="storage-sub">{storage.triage_history_count.toLocaleString()} rows</div>
				</div>
				<div class="storage-card">
					<div class="storage-label">Total diagnostic</div>
					<div class="storage-value">{fmtBytes(storage.total_diagnostic_bytes)}</div>
					<div class="storage-sub">of {fmtBytes(storage.total_db_bytes)} DB</div>
				</div>
				<div class="storage-card">
					<div class="storage-label">Daily volume (7d avg)</div>
					<div class="storage-value">{Math.round(storage.avg_events_per_day_last_7d).toLocaleString()}</div>
					<div class="storage-sub">events / day</div>
				</div>
				<div class="storage-card">
					<div class="storage-label">Mix</div>
					<div class="storage-value mix">
						<span title="debug">D {storage.debug_count.toLocaleString()}</span> ·
						<span title="info">I {storage.info_count.toLocaleString()}</span> ·
						<span title="warn">W {storage.warn_count.toLocaleString()}</span> ·
						<span title="error">E {storage.error_count.toLocaleString()}</span>
					</div>
				</div>
			</div>
			<div class="storage-thresholds">
				<strong>Thresholds:</strong>
				🟢 &lt;200MB · 🟡 200MB–1GB · 🟠 1GB–4GB · 🔴 &gt;4GB.
				If yellow/orange, tighten purge in <code>migrations/016_app_events_purge.sql</code> first; reduce <code>DEBUG_SUCCESS_SAMPLE_RATE</code> in <code>diagnostics.ts</code> next.
			</div>
		{:else}
			<div class="empty">No storage data available.</div>
		{/if}
	{/if}

	{#if detailFingerprint}
		<div class="modal-backdrop" role="presentation" onclick={closeDetail}></div>
		<div class="modal" role="dialog" aria-modal="true">
			<div class="modal-header">
				<div>
					<div class="modal-title">{detailFingerprint.event_name}</div>
					<div class="modal-sub"><code>{detailFingerprint.fingerprint_hash}</code></div>
				</div>
				<button class="close" onclick={closeDetail} aria-label="Close">×</button>
			</div>

			<div class="modal-body">
				<div class="field">
					<label for="status-select">Status</label>
					<select id="status-select" bind:value={detailStatus}>
						<option value="active">Active</option>
						<option value="investigating">Investigating</option>
						<option value="understood">Understood (auto-suppress)</option>
						<option value="ignore">Ignore (noise)</option>
						<option value="resolved">Resolved (fix shipped)</option>
					</select>
				</div>

				<div class="field">
					<label for="notes-area">Notes</label>
					<textarea id="notes-area" rows="3" bind:value={detailNotes}></textarea>
				</div>

				<div class="field">
					<div class="meta-row"><span>First seen:</span> {fmtDate(detailFingerprint.first_seen)}</div>
					<div class="meta-row"><span>Last seen:</span> {fmtDate(detailFingerprint.last_seen)}</div>
					<div class="meta-row"><span>Occurrences:</span> {detailFingerprint.occurrence_count}</div>
				</div>

				<div class="events-list">
					<h4>Recent occurrences</h4>
					{#each detailEvents as ev}
						<div class="event-row">
							<div class="event-head">
								<span class="event-level">{levelBadge(ev.level)}</span>
								<span class="event-time">{fmtDate(ev.created_at)}</span>
								{#if ev.request_path}<span class="event-path">{ev.request_path}</span>{/if}
							</div>
							{#if ev.summary}<div class="event-summary">{ev.summary}</div>{/if}
							{#if ev.error_detail?.stack}
								<details>
									<summary>Stack trace</summary>
									<pre>{String(ev.error_detail.stack)}</pre>
								</details>
							{/if}
						</div>
					{/each}
				</div>
			</div>

			<div class="modal-footer">
				<button class="btn-secondary" onclick={closeDetail}>Cancel</button>
				<button class="btn-primary" onclick={saveTriage}>Save</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.triage-tab { padding: 1rem; }
	.sub-tabs {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
		border-bottom: 1px solid var(--border);
	}
	.sub-tab {
		padding: 0.5rem 1rem;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.sub-tab.active {
		color: var(--text-primary);
		border-bottom-color: var(--accent);
	}
	.loading, .empty {
		padding: 2rem;
		text-align: center;
		color: var(--text-tertiary);
	}
	table.fingerprints {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}
	table.fingerprints th,
	table.fingerprints td {
		text-align: left;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--border);
	}
	table.fingerprints code {
		background: var(--surface-2);
		padding: 0.125rem 0.375rem;
		border-radius: 3px;
		font-size: 0.8125rem;
	}
	td.summary {
		max-width: 30rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	button.link {
		background: transparent;
		border: none;
		color: var(--accent);
		cursor: pointer;
	}
	.storage-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 1rem;
		margin-bottom: 1.5rem;
	}
	.storage-card {
		padding: 1rem;
		background: var(--surface-2);
		border-radius: 8px;
	}
	.storage-card.health-yellow { border-left: 3px solid #d4a017; }
	.storage-card.health-orange { border-left: 3px solid #cc7a00; }
	.storage-card.health-red    { border-left: 3px solid #cc3333; }
	.storage-label {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.storage-value {
		font-size: 1.5rem;
		font-weight: 600;
		margin: 0.25rem 0;
	}
	.storage-value.mix { font-size: 0.875rem; font-weight: 400; }
	.storage-sub { font-size: 0.75rem; color: var(--text-tertiary); }
	.storage-thresholds {
		font-size: 0.875rem;
		color: var(--text-secondary);
		padding: 0.75rem;
		background: var(--surface-2);
		border-radius: 4px;
	}
	.modal-backdrop {
		position: fixed; inset: 0;
		background: rgba(0,0,0,0.5);
		z-index: 100;
	}
	.modal {
		position: fixed;
		top: 50%; left: 50%;
		transform: translate(-50%, -50%);
		width: min(720px, 90vw);
		max-height: 85vh;
		background: var(--surface-1);
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		z-index: 101;
	}
	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--border);
	}
	.modal-title { font-weight: 600; }
	.modal-sub { font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.25rem; }
	.modal-body {
		padding: 1rem 1.5rem;
		overflow-y: auto;
		flex: 1;
	}
	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--border);
	}
	.close {
		background: transparent;
		border: none;
		font-size: 1.5rem;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.field { margin-bottom: 1rem; }
	.field label { display: block; font-size: 0.75rem; color: var(--text-tertiary); margin-bottom: 0.25rem; }
	.field select, .field textarea {
		width: 100%;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-primary);
		padding: 0.5rem;
		border-radius: 4px;
	}
	.meta-row { font-size: 0.875rem; margin: 0.25rem 0; }
	.meta-row span { color: var(--text-tertiary); margin-right: 0.5rem; }
	.events-list h4 { margin: 1rem 0 0.5rem; font-size: 0.875rem; color: var(--text-secondary); }
	.event-row {
		padding: 0.5rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.8125rem;
	}
	.event-head {
		display: flex;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}
	.event-level { font-weight: 600; }
	.event-summary { margin-top: 0.25rem; }
	.event-row pre {
		font-size: 0.6875rem;
		overflow-x: auto;
		margin: 0.5rem 0 0;
		padding: 0.5rem;
		background: var(--surface-2);
		border-radius: 4px;
	}
	.btn-primary, .btn-secondary {
		padding: 0.5rem 1rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		cursor: pointer;
	}
	.btn-primary { background: var(--accent); color: white; border-color: var(--accent); }
	.btn-secondary { background: transparent; color: var(--text-primary); }
</style>
