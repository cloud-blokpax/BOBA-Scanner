<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';

	type Window = '24h' | '7d' | '30d';

	interface TierRow { tier: string; n: number; pct: number }
	interface SliceRow { game_id: string; capture_source: string; tier: string; n: number }
	interface AgreementRow { game_id: string; n_live_reached: number; n_agreed: number; agreed_pct: number | null }
	interface BinderRow { n_binder_cells: number; n_haiku: number; n_tier1: number; haiku_pct: number | null }
	interface OverrideRow { tier: string; n: number; n_overridden: number; override_pct: number | null }
	interface CostRow { tier: string; n: number; total_usd: number; avg_per_scan_usd: number }
	interface LatencyRow { tier: string; n: number; p50_ms: number | null; p95_ms: number | null; p99_ms: number | null }
	interface QualityFailRow { reason: string; n: number }
	interface OutcomeRow { outcome: string; n: number }
	interface RecentOverride {
		created_at: string;
		winning_tier: string | null;
		game_id: string | null;
		capture_source: string | null;
		originally_matched: string | null;
		corrected_to: string | null;
		final_confidence: number | null;
	}

	interface Payload {
		window: Window;
		timestamp: string;
		pipelineMix: TierRow[];
		sliceByGameAndSource: SliceRow[];
		ocrRegionAgreement: AgreementRow[];
		binderCellFallback: BinderRow;
		overrideRateByTier: OverrideRow[];
		costByTier: CostRow[];
		latencyByTier: LatencyRow[];
		qualityGateFails: QualityFailRow[];
		outcomeDistribution: OutcomeRow[];
		recentOverrides: RecentOverride[];
	}

	// Thresholds — see docs/phase-2-telemetry.md
	const OCR_AGREEMENT_THRESHOLD = 90;     // below = tune ocr-regions.ts
	const BINDER_HAIKU_THRESHOLD = 25;      // above = build per-cell TTA
	const OVERRIDE_WARN_THRESHOLD = 5;      // above per tier = investigate

	let loading = $state(true);
	let data = $state<Payload | null>(null);
	let window = $state<Window>('7d');

	$effect(() => {
		load(window);
	});

	async function load(w: Window) {
		loading = true;
		try {
			const res = await fetch(`/api/admin/phase-2-telemetry?window=${w}`);
			if (!res.ok) throw new Error('Failed to load Phase 2 telemetry');
			data = (await res.json()) as Payload;
		} catch {
			showToast('Failed to load Phase 2 telemetry', 'x');
		}
		loading = false;
	}

	function formatPct(v: number | null): string {
		if (v == null) return '—';
		return `${v.toFixed(1)}%`;
	}

	function formatMs(v: number | null): string {
		if (v == null) return '—';
		if (v >= 1000) return `${(v / 1000).toFixed(1)}s`;
		return `${Math.round(v)}ms`;
	}

	function formatUsd(v: number): string {
		if (v < 0.01) return `$${v.toFixed(5)}`;
		return `$${v.toFixed(2)}`;
	}

	function tierLabel(tier: string): string {
		switch (tier) {
			case 'tier1_local_ocr':  return 'Local OCR';
			case 'tier1_upload_tta': return 'Upload TTA';
			case 'tier1_hash':       return 'Hash (legacy)';
			case 'tier2_ocr':        return 'Tesseract (legacy)';
			case 'tier3_claude':     return 'Haiku';
			case 'manual':           return 'Manual';
			case 'null_abandoned':   return 'Abandoned';
			default: return tier;
		}
	}

	function agreementStatus(pct: number | null): 'ok' | 'warn' | 'unknown' {
		if (pct == null) return 'unknown';
		return pct >= OCR_AGREEMENT_THRESHOLD ? 'ok' : 'warn';
	}

	function binderStatus(pct: number | null): 'ok' | 'warn' | 'unknown' {
		if (pct == null) return 'unknown';
		return pct <= BINDER_HAIKU_THRESHOLD ? 'ok' : 'warn';
	}

	function overrideStatus(pct: number | null): 'ok' | 'warn' | 'unknown' {
		if (pct == null) return 'unknown';
		return pct <= OVERRIDE_WARN_THRESHOLD ? 'ok' : 'warn';
	}

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleString('en-US', {
			month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
		});
	}

	const totalScans = $derived(
		(data?.pipelineMix ?? []).reduce((acc, r) => acc + r.n, 0)
	);

	const tier1Total = $derived(
		(data?.pipelineMix ?? [])
			.filter((r) => r.tier.startsWith('tier1'))
			.reduce((acc, r) => acc + r.n, 0)
	);

	const tier1Pct = $derived(
		totalScans > 0 ? Math.round(100 * (tier1Total / totalScans)) : null
	);
</script>

<div class="p2-tab">
	<div class="tab-header">
		<h2 class="tab-title">Phase 2 Pipeline Health</h2>
		<div class="window-toggle">
			{#each ['24h', '7d', '30d'] as const as w}
				<button
					class="window-btn"
					class:active={window === w}
					onclick={() => (window = w)}
				>
					{w}
				</button>
			{/each}
		</div>
	</div>

	{#if loading && !data}
		<div class="loading">Loading Phase 2 telemetry…</div>
	{:else if data}
		<!-- Headline -->
		<div class="metrics-row">
			<div class="mini-card">
				<div class="mc-value">{totalScans.toLocaleString()}</div>
				<div class="mc-label">Total scans</div>
			</div>
			<div class="mini-card">
				<div class="mc-value">{tier1Pct == null ? '—' : `${tier1Pct}%`}</div>
				<div class="mc-label">Tier 1 (local OCR) share</div>
			</div>
			<div class="mini-card">
				<div class="mc-value">
					{formatUsd(
						(data.costByTier ?? []).reduce((acc, r) => acc + (r.total_usd ?? 0), 0)
					)}
				</div>
				<div class="mc-label">Total cost ({window})</div>
			</div>
		</div>

		<!-- Pipeline mix -->
		<div class="section">
			<h3 class="section-title">Pipeline mix</h3>
			{#if data.pipelineMix.length === 0}
				<div class="empty">No scans in this window.</div>
			{:else}
				<table class="thin-table">
					<thead>
						<tr><th>Tier</th><th class="num">Scans</th><th class="num">Share</th></tr>
					</thead>
					<tbody>
						{#each data.pipelineMix as row}
							<tr>
								<td>{tierLabel(row.tier)}</td>
								<td class="num">{row.n.toLocaleString()}</td>
								<td class="num">{formatPct(row.pct)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		<!-- Gating signal 1: OCR region agreement -->
		<div class="section">
			<h3 class="section-title">
				OCR region agreement
				<span class="threshold-hint">threshold ≥ {OCR_AGREEMENT_THRESHOLD}%</span>
			</h3>
			{#if data.ocrRegionAgreement.length === 0}
				<div class="empty">No live consensus signal yet. Live OCR runs on camera_live only.</div>
			{:else}
				<div class="gate-grid">
					{#each data.ocrRegionAgreement as row}
						{@const status = agreementStatus(row.agreed_pct)}
						<div class="gate-card" class:ok={status === 'ok'} class:warn={status === 'warn'}>
							<div class="gate-label">{row.game_id}</div>
							<div class="gate-value">{formatPct(row.agreed_pct)}</div>
							<div class="gate-sub">{row.n_agreed}/{row.n_live_reached} agreed</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Gating signal 2: Binder Haiku fallback -->
		<div class="section">
			<h3 class="section-title">
				Binder Haiku fallback
				<span class="threshold-hint">threshold ≤ {BINDER_HAIKU_THRESHOLD}%</span>
			</h3>
			{#if data.binderCellFallback.n_binder_cells === 0}
				<div class="empty">No binder scans in this window.</div>
			{:else}
				{@const status = binderStatus(data.binderCellFallback.haiku_pct)}
				<div class="gate-grid">
					<div class="gate-card" class:ok={status === 'ok'} class:warn={status === 'warn'}>
						<div class="gate-label">Binder cells</div>
						<div class="gate-value">{formatPct(data.binderCellFallback.haiku_pct)}</div>
						<div class="gate-sub">
							{data.binderCellFallback.n_haiku}/{data.binderCellFallback.n_binder_cells} to Haiku
						</div>
					</div>
					<div class="gate-card">
						<div class="gate-label">Tier 1 wins</div>
						<div class="gate-value">
							{data.binderCellFallback.n_binder_cells > 0
								? formatPct(100 * data.binderCellFallback.n_tier1 / data.binderCellFallback.n_binder_cells)
								: '—'}
						</div>
						<div class="gate-sub">{data.binderCellFallback.n_tier1} cells</div>
					</div>
				</div>
			{/if}
		</div>

		<!-- Override rate by tier -->
		<div class="section">
			<h3 class="section-title">
				Override rate by tier
				<span class="threshold-hint">healthy &lt; {OVERRIDE_WARN_THRESHOLD}%</span>
			</h3>
			{#if data.overrideRateByTier.length === 0}
				<div class="empty">No resolved scans in this window.</div>
			{:else}
				<table class="thin-table">
					<thead>
						<tr><th>Tier</th><th class="num">Scans</th><th class="num">Overridden</th><th class="num">Rate</th></tr>
					</thead>
					<tbody>
						{#each data.overrideRateByTier as row}
							{@const status = overrideStatus(row.override_pct)}
							<tr>
								<td>{tierLabel(row.tier)}</td>
								<td class="num">{row.n.toLocaleString()}</td>
								<td class="num">{row.n_overridden.toLocaleString()}</td>
								<td class="num" class:warn-text={status === 'warn'}>{formatPct(row.override_pct)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		<!-- Slice by game × capture_source -->
		<div class="section">
			<h3 class="section-title">Mix by game × capture_source</h3>
			{#if data.sliceByGameAndSource.length === 0}
				<div class="empty">No data.</div>
			{:else}
				<table class="thin-table">
					<thead>
						<tr><th>Game</th><th>Source</th><th>Tier</th><th class="num">n</th></tr>
					</thead>
					<tbody>
						{#each data.sliceByGameAndSource as row}
							<tr>
								<td>{row.game_id}</td>
								<td class="monospace">{row.capture_source}</td>
								<td>{tierLabel(row.tier)}</td>
								<td class="num">{row.n.toLocaleString()}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		<!-- Cost + latency side by side -->
		<div class="side-by-side">
			<div class="section half">
				<h3 class="section-title">Cost by tier</h3>
				<table class="thin-table">
					<thead><tr><th>Tier</th><th class="num">n</th><th class="num">Total</th><th class="num">Avg</th></tr></thead>
					<tbody>
						{#each data.costByTier as row}
							<tr>
								<td>{tierLabel(row.tier)}</td>
								<td class="num">{row.n.toLocaleString()}</td>
								<td class="num">{formatUsd(row.total_usd)}</td>
								<td class="num">{formatUsd(row.avg_per_scan_usd)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="section half">
				<h3 class="section-title">Latency by tier</h3>
				<table class="thin-table">
					<thead><tr><th>Tier</th><th class="num">p50</th><th class="num">p95</th><th class="num">p99</th></tr></thead>
					<tbody>
						{#each data.latencyByTier as row}
							<tr>
								<td>{tierLabel(row.tier)}</td>
								<td class="num">{formatMs(row.p50_ms)}</td>
								<td class="num">{formatMs(row.p95_ms)}</td>
								<td class="num">{formatMs(row.p99_ms)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>

		<!-- Quality + outcome side by side -->
		<div class="side-by-side">
			<div class="section half">
				<h3 class="section-title">Quality gate fails</h3>
				{#if data.qualityGateFails.length === 0}
					<div class="empty">No quality-gate fails.</div>
				{:else}
					<table class="thin-table">
						<thead><tr><th>Reason</th><th class="num">n</th></tr></thead>
						<tbody>
							{#each data.qualityGateFails as row}
								<tr><td class="monospace">{row.reason}</td><td class="num">{row.n.toLocaleString()}</td></tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>

			<div class="section half">
				<h3 class="section-title">Outcome distribution</h3>
				<table class="thin-table">
					<thead><tr><th>Outcome</th><th class="num">n</th></tr></thead>
					<tbody>
						{#each data.outcomeDistribution as row}
							<tr><td class="monospace">{row.outcome}</td><td class="num">{row.n.toLocaleString()}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>

		<!-- Recent overrides -->
		<div class="section">
			<h3 class="section-title">Recent user overrides</h3>
			{#if data.recentOverrides.length === 0}
				<div class="empty">No recent overrides.</div>
			{:else}
				<table class="thin-table">
					<thead>
						<tr>
							<th>Time</th>
							<th>Tier</th>
							<th>Game</th>
							<th>Matched</th>
							<th>Corrected to</th>
						</tr>
					</thead>
					<tbody>
						{#each data.recentOverrides as row}
							<tr>
								<td class="time-cell">{formatTime(row.created_at)}</td>
								<td>{tierLabel(row.winning_tier ?? 'null_abandoned')}</td>
								<td>{row.game_id ?? '—'}</td>
								<td>{row.originally_matched ?? '—'}</td>
								<td>{row.corrected_to ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		<div class="footer-hint">
			Refreshes every 60s via Redis cache. Full query reference in
			<code>docs/phase-2-telemetry.md</code>.
		</div>
	{/if}
</div>

<style>
	.p2-tab {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.tab-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.tab-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.window-toggle {
		display: flex;
		gap: 0.25rem;
		background: var(--bg-elevated);
		border-radius: 8px;
		padding: 0.25rem;
	}

	.window-btn {
		background: none;
		border: none;
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		color: var(--text-tertiary);
		cursor: pointer;
		font-size: 0.8rem;
	}

	.window-btn.active {
		background: var(--bg-hover);
		color: var(--gold);
		font-weight: 600;
	}

	.loading, .empty {
		padding: 1rem;
		color: var(--text-tertiary);
		font-size: 0.85rem;
		text-align: center;
	}

	.metrics-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.75rem;
	}

	.mini-card {
		background: var(--bg-elevated);
		border-radius: 10px;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.mc-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.mc-label {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.section {
		background: var(--bg-elevated);
		border-radius: 10px;
		padding: 0.875rem 1rem;
	}

	.section-title {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-secondary);
		margin-bottom: 0.625rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.threshold-hint {
		font-weight: 400;
		font-size: 0.7rem;
		color: var(--text-tertiary);
	}

	.thin-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.82rem;
	}

	.thin-table th {
		text-align: left;
		padding: 0.375rem 0.5rem;
		color: var(--text-tertiary);
		font-weight: 500;
		border-bottom: 1px solid var(--border);
	}

	.thin-table td {
		padding: 0.375rem 0.5rem;
		border-bottom: 1px solid var(--border);
		color: var(--text-primary);
	}

	.thin-table .num { text-align: right; }
	.thin-table .monospace { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.78rem; }
	.thin-table .time-cell { white-space: nowrap; color: var(--text-secondary); font-size: 0.78rem; }

	.warn-text { color: var(--warning); font-weight: 600; }

	.gate-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.5rem;
	}

	.gate-card {
		background: var(--bg-hover);
		border-radius: 8px;
		padding: 0.625rem;
		display: flex;
		flex-direction: column;
		gap: 2px;
		border-left: 3px solid var(--border);
	}

	.gate-card.ok   { border-left-color: var(--success); }
	.gate-card.warn { border-left-color: var(--warning); }

	.gate-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		color: var(--text-tertiary);
		letter-spacing: 0.04em;
	}

	.gate-value {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.gate-sub {
		font-size: 0.72rem;
		color: var(--text-tertiary);
	}

	.side-by-side {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.side-by-side .half {
		min-width: 0;
	}

	@media (max-width: 640px) {
		.side-by-side { grid-template-columns: 1fr; }
	}

	.footer-hint {
		font-size: 0.72rem;
		color: var(--text-tertiary);
		text-align: center;
		padding: 0.5rem 0;
	}

	.footer-hint code {
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 0.72rem;
		color: var(--text-secondary);
	}
</style>
