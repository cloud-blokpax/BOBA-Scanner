<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import Sparkline from './Sparkline.svelte';

	interface ScanLog {
		id: string;
		user_id: string | null;
		call_type: string;
		error_message: string | null;
		success: boolean;
		created_at: string;
	}

	let loading = $state(true);
	let recentScans = $state<ScanLog[]>([]);
	let scanMetrics = $state({
		totalToday: 0,
		totalWeek: 0,
		totalMonth: 0,
		successRate: 0,
		errorsToday: 0,
		tier1Rate: 0,
		tier2Rate: 0
	});
	let hourlyData = $state<number[]>(new Array(24).fill(0));
	let trendData = $state<number[]>([]);

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleString('en-US', {
			month: 'short', day: 'numeric',
			hour: 'numeric', minute: '2-digit'
		});
	}

	$effect(() => {
		loadScans();
	});

	async function loadScans() {
		loading = true;
		try {
			const res = await fetch('/api/admin/scan-analytics');
			if (!res.ok) throw new Error('Failed to load scan analytics');
			const data = await res.json();

			scanMetrics.totalToday = data.metrics.totalToday;
			scanMetrics.totalWeek = data.metrics.totalWeek;
			scanMetrics.totalMonth = data.metrics.totalMonth;
			scanMetrics.errorsToday = data.metrics.errorsToday;
			scanMetrics.successRate = data.metrics.successRate;
			hourlyData = data.hourlyData;
			trendData = data.trendData;
			recentScans = data.recentScans as ScanLog[];
		} catch {
			showToast('Failed to load scan data', 'x');
		}
		loading = false;
	}

	const maxHourly = $derived(Math.max(...hourlyData, 1));
</script>

<div class="scans-tab">
	{#if loading}
		<div class="loading">Loading scan analytics...</div>
	{:else}
		<!-- Metrics Row -->
		<div class="metrics-row">
			<div class="mini-card">
				<div class="mc-value">{scanMetrics.totalToday}</div>
				<div class="mc-label">Today</div>
			</div>
			<div class="mini-card">
				<div class="mc-value">{scanMetrics.totalWeek}</div>
				<div class="mc-label">This Week</div>
			</div>
			<div class="mini-card">
				<div class="mc-value">{scanMetrics.totalMonth}</div>
				<div class="mc-label">This Month</div>
			</div>
			<div class="mini-card">
				<div class="mc-value">{scanMetrics.successRate}%</div>
				<div class="mc-label">Success Rate</div>
			</div>
			<div class="mini-card">
				<div class="mc-value err">{scanMetrics.errorsToday}</div>
				<div class="mc-label">Errors Today</div>
			</div>
		</div>

		<!-- 14-day Trend -->
		<div class="chart-section">
			<h3 class="section-title">14-Day Scan Trend</h3>
			<Sparkline data={trendData} color="var(--gold)" width={400} height={48} />
		</div>

		<!-- Hourly Heatmap -->
		<div class="chart-section">
			<h3 class="section-title">Scans by Hour (Today)</h3>
			<div class="heatmap">
				{#each hourlyData as count, hour}
					<div class="heat-bar-container">
						<div
							class="heat-bar"
							style:height="{Math.max((count / maxHourly) * 100, 2)}%"
							style:background="var(--gold)"
							style:opacity={count > 0 ? 0.3 + (count / maxHourly) * 0.7 : 0.1}
							title="{hour}:00 — {count} scans"
						></div>
						<span class="heat-label">{hour}</span>
					</div>
				{/each}
			</div>
		</div>

		<!-- Recent Scans Table -->
		<div class="table-section">
			<h3 class="section-title">Recent API Calls</h3>
			<div class="table-wrapper">
				<table>
					<thead>
						<tr>
							<th>Time</th>
							<th>Type</th>
							<th>Status</th>
							<th>Details</th>
						</tr>
					</thead>
					<tbody>
						{#each recentScans.slice(0, 50) as scan}
							<tr>
								<td class="time-cell">{formatTime(scan.created_at)}</td>
								<td>{scan.call_type}</td>
								<td>
									{#if scan.success}
										<span class="badge-success">OK</span>
									{:else}
										<span class="badge-fail">Failed</span>
									{/if}
								</td>
								<td class="detail-cell">{scan.error_message || '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>

<style>
	.scans-tab {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.loading {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}

	.metrics-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
		gap: 0.5rem;
	}

	.mini-card {
		background: var(--bg-elevated);
		border-radius: 10px;
		padding: 0.75rem;
		text-align: center;
	}

	.mc-value {
		font-size: 1.2rem;
		font-weight: 700;
		color: var(--gold);
	}

	.mc-value.err { color: var(--danger); }

	.mc-label {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		margin-top: 2px;
	}

	.chart-section {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
	}

	.section-title {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}

	/* Heatmap */
	.heatmap {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 80px;
	}

	.heat-bar-container {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		height: 100%;
		justify-content: flex-end;
	}

	.heat-bar {
		width: 100%;
		border-radius: 2px 2px 0 0;
		min-height: 2px;
		transition: height 0.3s;
	}

	.heat-label {
		font-size: 0.55rem;
		color: var(--text-tertiary);
		margin-top: 2px;
	}

	/* Table */
	.table-wrapper { overflow-x: auto; }

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}

	th {
		text-align: left;
		padding: 0.5rem;
		border-bottom: 1px solid var(--border);
		color: var(--text-tertiary);
		font-weight: 600;
		white-space: nowrap;
	}

	td {
		padding: 0.5rem;
		border-bottom: 1px solid var(--border);
	}

	.time-cell {
		white-space: nowrap;
		color: var(--text-secondary);
		font-size: 0.75rem;
	}

	.detail-cell {
		max-width: 250px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-secondary);
		font-size: 0.75rem;
	}

	.badge-success {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		background: rgba(16, 185, 129, 0.15);
		color: var(--success);
	}

	.badge-fail {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		background: rgba(239, 68, 68, 0.15);
		color: var(--danger);
	}
</style>
