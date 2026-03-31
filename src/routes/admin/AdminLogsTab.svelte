<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';

	interface LogRow {
		id: string;
		user_id: string | null;
		call_type: string;
		error_message: string | null;
		success: boolean;
		created_at: string;
	}

	let logs = $state<LogRow[]>([]);
	let loading = $state(true);

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	$effect(() => {
		loadLogs();
	});

	async function loadLogs() {
		loading = true;
		try {
			const res = await fetch('/api/admin/logs');
			if (!res.ok) throw new Error('Failed to load logs');
			const data = await res.json();
			logs = data.logs as LogRow[];
		} catch {
			showToast('Failed to load logs', 'x');
		}
		loading = false;
	}
</script>

<div class="tab-content">
	{#if loading}
		<div class="loading">Loading logs...</div>
	{:else}
		<div class="logs-list">
			{#each logs as log}
				<div class="log-entry">
					<div class="log-action">
						{log.call_type}
						{#if !log.success}<span class="badge-fail">Failed</span>{/if}
					</div>
					<div class="log-details">{log.error_message || ''}</div>
					<div class="log-time">{formatDate(log.created_at)}</div>
				</div>
			{/each}
			{#if logs.length === 0}
				<p class="empty">No recent logs.</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.loading, .empty {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}
	.logs-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.log-entry {
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		background: var(--bg-elevated);
	}
	.log-action {
		font-weight: 600;
		font-size: 0.85rem;
	}
	.badge-fail {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		background: #ef444420;
		color: #ef4444;
		margin-left: 0.5rem;
	}
	.log-details {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-top: 2px;
	}
	.log-time {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		margin-top: 4px;
	}
</style>
