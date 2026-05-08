<script lang="ts">
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
</style>
