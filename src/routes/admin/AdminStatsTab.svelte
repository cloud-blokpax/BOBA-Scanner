<script lang="ts">
	let {
		stats
	}: {
		stats: { totalUsers: number; totalScans: number; activeToday: number; totalCards: number };
	} = $props();
</script>

<div class="tab-content">
	<div class="stats-detail">
		<div class="detail-row">
			<span>Total Users</span>
			<strong>{stats.totalUsers}</strong>
		</div>
		<div class="detail-row">
			<span>Total Scans</span>
			<strong>{stats.totalScans}</strong>
		</div>
		<div class="detail-row">
			<span>Cards in Database</span>
			<strong>{stats.totalCards}</strong>
		</div>
		<div class="detail-row">
			<span>Active Today</span>
			<strong>{stats.activeToday}</strong>
		</div>
	</div>
</div>

<style>
	.stats-detail {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.detail-row {
		display: flex;
		justify-content: space-between;
		padding: 0.75rem;
		border-radius: 8px;
		background: var(--bg-elevated);
	}
	.detail-row span {
		color: var(--text-secondary);
	}
</style>
