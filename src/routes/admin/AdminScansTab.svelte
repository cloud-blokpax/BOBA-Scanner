<script lang="ts">
	import { getSupabase } from '$lib/services/supabase';
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
		tier2Rate: 0,
		tier3Rate: 0
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
		const client = getSupabase();
		if (!client) { loading = false; return; }

		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const todayIso = today.toISOString();

		const weekAgo = new Date();
		weekAgo.setDate(weekAgo.getDate() - 7);
		const weekAgoIso = weekAgo.toISOString();

		const monthAgo = new Date();
		monthAgo.setDate(monthAgo.getDate() - 30);
		const monthAgoIso = monthAgo.toISOString();

		const fourteenDaysAgo = new Date();
		fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

		try {
			const [todayRes, weekRes, monthRes, errorsRes, recentRes, todayAllRes] = await Promise.all([
				client.from('api_call_logs').select('id', { count: 'exact', head: true })
					.gte('created_at', todayIso).eq('call_type', 'scan'),
				client.from('api_call_logs').select('id', { count: 'exact', head: true })
					.gte('created_at', weekAgoIso).eq('call_type', 'scan'),
				client.from('api_call_logs').select('id', { count: 'exact', head: true })
					.gte('created_at', monthAgoIso).eq('call_type', 'scan'),
				client.from('api_call_logs').select('id', { count: 'exact', head: true })
					.gte('created_at', todayIso).eq('success', false),
				client.from('api_call_logs').select('*')
					.order('created_at', { ascending: false })
					.limit(100),
				client.from('api_call_logs').select('created_at, success')
					.gte('created_at', todayIso)
					.eq('call_type', 'scan')
			]);

			scanMetrics.totalToday = todayRes.count || 0;
			scanMetrics.totalWeek = weekRes.count || 0;
			scanMetrics.totalMonth = monthRes.count || 0;
			scanMetrics.errorsToday = errorsRes.count || 0;

			if (todayAllRes.data && todayAllRes.data.length > 0) {
				const total = todayAllRes.data.length;
				const successes = todayAllRes.data.filter((s: { success: boolean }) => s.success).length;
				scanMetrics.successRate = Math.round((successes / total) * 100);

				// Build hourly heatmap
				const hourly = new Array(24).fill(0);
				for (const scan of todayAllRes.data) {
					const hour = new Date(scan.created_at).getHours();
					hourly[hour]++;
				}
				hourlyData = hourly;
			}

			if (recentRes.data) {
				recentScans = recentRes.data as ScanLog[];
			}

			// Build 14-day trend
			const { data: trendRows } = await client
				.from('api_call_logs')
				.select('created_at')
				.gte('created_at', fourteenDaysAgo.toISOString())
				.eq('call_type', 'scan')
				.order('created_at', { ascending: true });

			if (trendRows) {
				const counts = new Array(14).fill(0);
				const now = Date.now();
				for (const row of trendRows) {
					const daysAgoIdx = Math.floor((now - new Date(row.created_at).getTime()) / 86400000);
					const idx = 13 - daysAgoIdx;
					if (idx >= 0 && idx < 14) counts[idx]++;
				}
				trendData = counts;
			}
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
