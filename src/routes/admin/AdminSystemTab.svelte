<script lang="ts">
	import { onMount } from 'svelte';
	import { showToast } from '$lib/stores/toast.svelte';

	let { health }: {
		health: Record<string, { status: string; message?: string }>;
	} = $props();

	let exporting = $state<string | null>(null);
	let exportFormat = $state<'json' | 'csv'>('csv');

	const exportTypes = [
		{ key: 'users', label: 'Users', desc: 'All user accounts' },
		{ key: 'scans', label: 'Scans', desc: 'Recent scan logs (5000)' },
		{ key: 'prices', label: 'Prices', desc: 'Price cache data (5000)' },
		{ key: 'changelog', label: 'Changelog', desc: 'All changelog entries' },
		{ key: 'feature-flags', label: 'Feature Flags', desc: 'All feature flags' }
	];

	// ── Wonders hash backfill (Phase 1 / Session 1.1.1) ──
	type BackfillStatus = {
		started_at: string;
		last_batch_at: string;
		batch_count: number;
		total_cards: number;
		processed: number;
		succeeded: number;
		skipped: number;
		fetch_failed: number;
		hash_failed: number;
		db_failed: number;
		completed: boolean;
		completed_at?: string;
	};

	let backfillStatus = $state<BackfillStatus | null>(null);
	let backfillTriggering = $state(false);

	let bobaBackfillStatus = $state<BackfillStatus | null>(null);
	let bobaBackfillTriggering = $state(false);
	let bobaBackfillAutoRun = $state(false);

	const backfillPercent = $derived(
		backfillStatus && backfillStatus.total_cards > 0
			? Math.round((backfillStatus.processed / backfillStatus.total_cards) * 100)
			: 0
	);

	const bobaBackfillPercent = $derived(
		bobaBackfillStatus && bobaBackfillStatus.total_cards > 0
			? Math.min(
					100,
					Math.round(
						(bobaBackfillStatus.processed / bobaBackfillStatus.total_cards) * 100
					)
				)
			: 0
	);

	async function refreshBackfillStatus() {
		try {
			const res = await fetch('/api/admin/backfill/wonders-hashes/status');
			if (!res.ok) return;
			const data = await res.json();
			backfillStatus = data.status ?? null;
		} catch {
			// non-fatal
		}
	}

	async function refreshBobaBackfillStatus() {
		try {
			const res = await fetch('/api/admin/backfill/boba-hashes/status');
			if (!res.ok) return;
			const data = await res.json();
			bobaBackfillStatus = data.status ?? null;
		} catch {
			// non-fatal
		}
	}

	async function triggerBackfill() {
		if (backfillTriggering) return;
		// Only confirm on initial start — resume taps are obviously intentional.
		if (!backfillStatus && !confirm('Start Wonders hash backfill? Takes ~4 taps to finish.')) return;
		backfillTriggering = true;
		try {
			const res = await fetch('/api/admin/backfill/wonders-hashes', {
				method: 'POST'
			});
			if (!res.ok) {
				showToast(`Failed: HTTP ${res.status}`, 'x');
			} else {
				const data = await res.json();
				backfillStatus = data.status ?? null;
				// Button label updates reactively:
				//   completed → "Re-run backfill"
				//   else → "Continue backfill (N/total)"
			}
		} catch (err) {
			showToast(
				'Network error: ' + (err instanceof Error ? err.message : 'unknown'),
				'x'
			);
		}
		backfillTriggering = false;
	}

	async function runBobaBackfillBatch(): Promise<boolean> {
		const res = await fetch('/api/admin/backfill/boba-hashes', {
			method: 'POST'
		});
		if (!res.ok) {
			showToast(`Failed: HTTP ${res.status}`, 'x');
			return false;
		}
		const data = await res.json();
		bobaBackfillStatus = data.status ?? null;
		return data.done === true;
	}

	async function triggerBobaBackfill() {
		if (bobaBackfillTriggering) return;
		if (!bobaBackfillStatus && !confirm('Start BoBA hash backfill? Loops automatically until done (~5-10 min).')) return;
		bobaBackfillTriggering = true;
		bobaBackfillAutoRun = true;
		try {
			// Auto-loop batches until the server reports done=true or the user
			// cancels. Each batch is its own serverless invocation (≤55s), so
			// we don't need to worry about a single request timing out.
			// eslint-disable-next-line no-constant-condition
			while (bobaBackfillAutoRun) {
				const done = await runBobaBackfillBatch();
				if (done) {
					showToast('BoBA hash backfill complete', 'check');
					break;
				}
			}
		} catch (err) {
			showToast(
				'Network error: ' + (err instanceof Error ? err.message : 'unknown'),
				'x'
			);
		}
		bobaBackfillTriggering = false;
		bobaBackfillAutoRun = false;
	}

	function cancelBobaBackfill() {
		bobaBackfillAutoRun = false;
	}

	async function resetBobaBackfill() {
		if (!confirm('Reset BoBA backfill status? Clears the saved progress so the next start is a fresh run.')) return;
		try {
			const res = await fetch('/api/admin/backfill/boba-hashes', {
				method: 'DELETE'
			});
			if (!res.ok) {
				showToast(`Reset failed: HTTP ${res.status}`, 'x');
				return;
			}
			bobaBackfillStatus = null;
			bobaBackfillAutoRun = false;
			showToast('Backfill status cleared', 'check');
		} catch (err) {
			showToast(
				'Network error: ' + (err instanceof Error ? err.message : 'unknown'),
				'x'
			);
		}
	}

	onMount(() => {
		refreshBackfillStatus();
		refreshBobaBackfillStatus();
	});

	// ── Scan pipeline diagnostic (Phase 1 / Session 1.1.1d) ──
	let diagResult = $state<unknown>(null);
	let diagRunning = $state(false);

	async function runScanPipelineDiag() {
		if (diagRunning) return;
		diagRunning = true;
		diagResult = null;
		try {
			const res = await fetch('/api/admin/diag/scan-pipeline');
			diagResult = await res.json();
		} catch (err) {
			diagResult = {
				verdict: 'network_error',
				error: err instanceof Error ? err.message : String(err)
			};
		}
		diagRunning = false;
	}

	async function doExport(type: string) {
		exporting = type;
		try {
			const res = await fetch('/api/admin/export', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type, format: exportFormat })
			});
			if (!res.ok) throw new Error('Export failed');

			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${type}-export.${exportFormat}`;
			a.click();
			URL.revokeObjectURL(url);
			showToast(`Exported ${type}`, 'check');
		} catch {
			showToast('Export failed', 'x');
		}
		exporting = null;
	}
</script>

<div class="system-tab">
	<!-- System Health -->
	<div class="section">
		<h3 class="section-title">System Health</h3>
		<div class="health-grid">
			{#each Object.entries(health || {}) as [name, check]}
				<div class="health-card">
					<div class="health-header">
						<span
							class="health-dot"
							class:ok={check.status === 'ok'}
							class:degraded={check.status === 'degraded'}
							class:down={check.status === 'down'}
						></span>
						<span class="health-name">{name}</span>
					</div>
					<div class="health-status">{check.status}</div>
					{#if check.message}
						<div class="health-msg">{check.message}</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<!-- Data Export -->
	<div class="section">
		<h3 class="section-title">Data Export</h3>
		<div class="export-format">
			<label class="format-option">
				<input type="radio" name="format" value="csv" bind:group={exportFormat} />
				<span>CSV</span>
			</label>
			<label class="format-option">
				<input type="radio" name="format" value="json" bind:group={exportFormat} />
				<span>JSON</span>
			</label>
		</div>
		<div class="export-grid">
			{#each exportTypes as exp}
				<button
					class="export-btn"
					onclick={() => doExport(exp.key)}
					disabled={exporting === exp.key}
				>
					<span class="export-label">{exp.label}</span>
					<span class="export-desc">{exp.desc}</span>
					{#if exporting === exp.key}
						<span class="export-status">Exporting...</span>
					{/if}
				</button>
			{/each}
		</div>
	</div>

	<!-- Wonders Hash Backfill (Phase 1) -->
	<div class="section">
		<h3 class="section-title">Wonders Hash Backfill</h3>
		<p class="section-desc">
			Seeds <code>hash_cache</code> for all Wonders cards using first-party
			images. Each tap processes one batch; tap again to continue until the
			button reads "Re-run backfill". Safe to re-run — already-seeded cards
			are skipped.
		</p>
		<div class="backfill-controls">
			<button
				class="backfill-btn"
				onclick={triggerBackfill}
				disabled={backfillTriggering}
			>
				{#if backfillTriggering}
					Running…
				{:else if backfillStatus && !backfillStatus.completed}
					Continue backfill ({backfillStatus.processed}/{backfillStatus.total_cards})
				{:else if backfillStatus?.completed}
					Re-run backfill
				{:else}
					Start backfill
				{/if}
			</button>
		</div>

		{#if backfillStatus}
			<div class="backfill-status">
				<div class="backfill-bar">
					<div class="backfill-fill" style:width="{backfillPercent}%"></div>
				</div>
				<div class="backfill-stats">
					<span>Processed: {backfillStatus.processed} / {backfillStatus.total_cards} ({backfillPercent}%)</span>
					<span>Succeeded: {backfillStatus.succeeded}</span>
					<span>Skipped: {backfillStatus.skipped}</span>
					{#if backfillStatus.fetch_failed > 0}
						<span class="backfill-warn">Fetch failures: {backfillStatus.fetch_failed}</span>
					{/if}
					{#if backfillStatus.hash_failed > 0}
						<span class="backfill-warn">Hash failures: {backfillStatus.hash_failed}</span>
					{/if}
					{#if backfillStatus.db_failed > 0}
						<span class="backfill-err">DB failures: {backfillStatus.db_failed}</span>
					{/if}
					<span>Batches: {backfillStatus.batch_count}</span>
					{#if backfillStatus.completed && backfillStatus.completed_at}
						<span class="backfill-done">
							✓ Completed at {new Date(backfillStatus.completed_at).toLocaleTimeString()}
						</span>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<!-- BoBA Hash Backfill (Phase 1 / Session 1.3 follow-up) -->
	<div class="section">
		<h3 class="section-title">BoBA Hash Backfill</h3>
		<p class="section-desc">
			Seeds <code>hash_cache</code> for BoBA cards with an
			<code>image_url</code> but no hash row yet. Tap once and leave the page
			open — it auto-loops batches until done. Idempotent; safe to re-run.
		</p>
		<div class="backfill-controls">
			<button
				class="backfill-btn"
				onclick={triggerBobaBackfill}
				disabled={bobaBackfillTriggering}
			>
				{#if bobaBackfillTriggering}
					Running… ({bobaBackfillStatus?.processed ?? 0}/{bobaBackfillStatus?.total_cards ?? '?'})
				{:else if bobaBackfillStatus && !bobaBackfillStatus.completed}
					Continue backfill ({bobaBackfillStatus.processed}/{bobaBackfillStatus.total_cards})
				{:else if bobaBackfillStatus?.completed}
					Re-run backfill
				{:else}
					Start backfill
				{/if}
			</button>
			{#if bobaBackfillTriggering}
				<button class="backfill-btn" onclick={cancelBobaBackfill}>
					Stop after current batch
				</button>
			{/if}
			{#if bobaBackfillStatus && !bobaBackfillTriggering}
				<button class="backfill-btn" onclick={resetBobaBackfill}>
					Reset
				</button>
			{/if}
		</div>

		{#if bobaBackfillStatus}
			<div class="backfill-status">
				<div class="backfill-bar">
					<div class="backfill-fill" style:width="{bobaBackfillPercent}%"></div>
				</div>
				<div class="backfill-stats">
					<span>Processed: {bobaBackfillStatus.processed} / {bobaBackfillStatus.total_cards} ({bobaBackfillPercent}%)</span>
					<span>Succeeded: {bobaBackfillStatus.succeeded}</span>
					<span>Skipped: {bobaBackfillStatus.skipped}</span>
					{#if bobaBackfillStatus.fetch_failed > 0}
						<span class="backfill-warn">Fetch failures: {bobaBackfillStatus.fetch_failed}</span>
					{/if}
					{#if bobaBackfillStatus.hash_failed > 0}
						<span class="backfill-warn">Hash failures: {bobaBackfillStatus.hash_failed}</span>
					{/if}
					{#if bobaBackfillStatus.db_failed > 0}
						<span class="backfill-err">DB failures: {bobaBackfillStatus.db_failed}</span>
					{/if}
					<span>Batches: {bobaBackfillStatus.batch_count}</span>
					{#if bobaBackfillStatus.completed && bobaBackfillStatus.completed_at}
						<span class="backfill-done">
							✓ Completed at {new Date(bobaBackfillStatus.completed_at).toLocaleTimeString()}
						</span>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<!-- Scan Pipeline Diagnostic (Phase 1 / Session 1.1.1d) -->
	<div class="section">
		<h3 class="section-title">Scan Pipeline Diagnostic</h3>
		<p class="section-desc">
			Tests whether authenticated scans can write to the new-pipeline tables.
			Creates throwaway <code>scan_sessions</code> / <code>scans</code> /
			<code>scan_tier_results</code> rows using your own client, then cleans
			them up via service-role cascade delete. No side effects on real data.
		</p>
		<div class="diag-controls">
			<button
				class="diag-btn"
				onclick={runScanPipelineDiag}
				disabled={diagRunning}
			>
				{diagRunning ? 'Running…' : 'Diagnose scan pipeline'}
			</button>
		</div>

		{#if diagResult}
			{@const dr = diagResult as { verdict?: string }}
			<div class="diag-result">
				<div class="diag-verdict">
					Verdict: <code>{dr.verdict ?? 'unknown'}</code>
				</div>
				<pre class="diag-json">{JSON.stringify(diagResult, null, 2)}</pre>
			</div>
		{/if}
	</div>

	<!-- Quick DB Info -->
	<div class="section">
		<h3 class="section-title">Database Info</h3>
		<p class="section-desc">
			Database operations like migrations, materialized view refreshes, and search index rebuilds
			should be performed via the Supabase dashboard or CLI directly.
		</p>
		<div class="db-links">
			<a class="db-link" href="https://supabase.com/dashboard" target="_blank" rel="noopener">
				Open Supabase Dashboard
			</a>
		</div>
	</div>
</div>

<style>
	.system-tab {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.section {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
	}

	.section-title {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}

	.section-desc {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		margin-bottom: 0.75rem;
	}

	/* Health */
	.health-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		gap: 0.5rem;
	}

	.health-card {
		background: var(--bg-surface);
		border-radius: 8px;
		padding: 0.75rem;
	}

	.health-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.375rem;
	}

	.health-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.health-dot.ok { background: var(--success); }
	.health-dot.degraded { background: var(--warning); }
	.health-dot.down { background: var(--danger); }

	.health-name {
		font-size: 0.85rem;
		font-weight: 600;
		text-transform: capitalize;
	}

	.health-status {
		font-size: 0.75rem;
		color: var(--text-secondary);
		text-transform: uppercase;
	}

	.health-msg {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		margin-top: 2px;
	}

	/* Export */
	.export-format {
		display: flex;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	.format-option {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.export-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 0.5rem;
	}

	.export-btn {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding: 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		cursor: pointer;
		text-align: left;
		transition: border-color 0.15s;
	}

	.export-btn:hover {
		border-color: var(--gold);
	}

	.export-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.export-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.export-desc {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		margin-top: 2px;
	}

	.export-status {
		font-size: 0.7rem;
		color: var(--gold);
		margin-top: 4px;
	}

	/* DB Links */
	.db-links {
		display: flex;
		gap: 0.5rem;
	}

	.db-link {
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		color: var(--text-secondary);
		text-decoration: none;
		font-size: 0.85rem;
		transition: border-color 0.15s, color 0.15s;
	}

	.db-link:hover {
		border-color: var(--gold);
		color: var(--gold);
	}

	/* Backfill */
	.backfill-controls {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.backfill-btn {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s;
	}

	.backfill-btn:hover:not(:disabled) {
		border-color: var(--gold);
		color: var(--gold);
	}

	.backfill-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.backfill-status {
		margin-top: 0.5rem;
	}

	.backfill-bar {
		height: 8px;
		background: var(--border);
		border-radius: 4px;
		overflow: hidden;
	}

	.backfill-fill {
		height: 100%;
		background: var(--success, #22c55e);
		transition: width 0.5s ease;
	}

	.backfill-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 0.5rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.backfill-warn { color: var(--warning); }
	.backfill-err { color: var(--danger); }
	.backfill-done { color: var(--success); font-weight: 600; }

	/* Diagnostic */
	.diag-controls {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.diag-btn {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s;
	}

	.diag-btn:hover:not(:disabled) {
		border-color: var(--gold);
		color: var(--gold);
	}

	.diag-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.diag-result {
		margin-top: 0.5rem;
	}

	.diag-verdict {
		font-size: 0.85rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
		color: var(--text-secondary);
	}

	.diag-json {
		background: rgba(0, 0, 0, 0.3);
		padding: 0.75rem;
		border-radius: 6px;
		font-size: 0.72rem;
		color: var(--text-secondary);
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-all;
		max-height: 480px;
	}
</style>
