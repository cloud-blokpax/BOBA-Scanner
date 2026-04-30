<script lang="ts">
	import {
		getExcludedPlayNames,
		removeExcludedPlayName,
		clearExcludedPlayNames
	} from '$lib/stores/playbook-architect.svelte';

	let {
		open,
		onclose
	}: {
		open: boolean;
		onclose: () => void;
	} = $props();

	const excluded = $derived([...getExcludedPlayNames()].sort());

	function handleRestore(name: string) {
		removeExcludedPlayName(name);
	}

	function handleClearAll() {
		clearExcludedPlayNames();
		onclose();
	}

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose();
	}
</script>

{#if open}
	<div
		class="backdrop"
		onclick={handleBackdrop}
		onkeydown={(e) => e.key === 'Escape' && onclose()}
		role="dialog"
		aria-modal="true"
		aria-label="Manage excluded plays"
		tabindex="-1"
	>
		<div class="sheet">
			<header class="sheet-header">
				<div>
					<h3 class="sheet-title">Excluded Plays</h3>
					<p class="sheet-hint">
						Plays the strategy engine won't suggest. Tap Restore to bring one back.
					</p>
				</div>
				<button class="close-btn" onclick={onclose} aria-label="Close">✕</button>
			</header>

			<div class="exclusion-list">
				{#if excluded.length === 0}
					<p class="empty">Nothing excluded.</p>
				{:else}
					{#each excluded as name (name)}
						<div class="exclusion-row">
							<span class="exclusion-name">{name}</span>
							<button class="restore-btn" onclick={() => handleRestore(name)}>
								Restore
							</button>
						</div>
					{/each}
				{/if}
			</div>

			{#if excluded.length > 1}
				<footer class="sheet-footer">
					<button class="clear-all-btn" onclick={handleClearAll}>
						Restore all ({excluded.length})
					</button>
				</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		z-index: 100;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		animation: fade-in 200ms ease-out;
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.sheet {
		width: 100%;
		max-width: 520px;
		max-height: 80vh;
		background: var(--bg-surface);
		border: 1px solid var(--border-strong);
		border-bottom: none;
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		display: flex;
		flex-direction: column;
		animation: slide-up 300ms ease-out;
	}
	@keyframes slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}
	@media (min-width: 768px) {
		.backdrop {
			align-items: center;
		}
		.sheet {
			border-radius: var(--radius-lg);
			border-bottom: 1px solid var(--border-strong);
		}
	}

	.sheet-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-4);
		border-bottom: 1px solid var(--border);
	}
	.sheet-title {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: var(--font-bold);
		color: var(--text-primary);
		margin: 0 0 var(--space-1);
	}
	.sheet-hint {
		font-size: var(--text-xs);
		color: var(--text-muted);
		margin: 0;
		line-height: 1.5;
	}
	.close-btn {
		font-size: var(--text-base);
		color: var(--text-muted);
		background: transparent;
		border: none;
		cursor: pointer;
		padding: var(--space-1);
		border-radius: var(--radius-sm);
		font-family: inherit;
		flex-shrink: 0;
	}
	.close-btn:hover {
		color: var(--text-primary);
		background: var(--bg-elevated);
	}

	.exclusion-list {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-2) var(--space-4);
	}
	.empty {
		font-size: var(--text-sm);
		color: var(--text-muted);
		text-align: center;
		padding: var(--space-8) 0;
	}
	.exclusion-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--border);
	}
	.exclusion-row:last-child {
		border-bottom: none;
	}
	.exclusion-name {
		font-size: var(--text-sm);
		color: var(--text-primary);
		font-weight: var(--font-medium);
	}
	.restore-btn {
		font-family: var(--font-display);
		font-size: var(--text-xs);
		font-weight: var(--font-bold);
		color: var(--gold);
		background: var(--gold-light);
		border: 1px solid rgba(245, 158, 11, 0.25);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		transition: background var(--transition-fast);
	}
	.restore-btn:hover {
		background: var(--gold-glow);
	}

	.sheet-footer {
		padding: var(--space-3) var(--space-4);
		border-top: 1px solid var(--border);
	}
	.clear-all-btn {
		width: 100%;
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--text-secondary);
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		padding: var(--space-2);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: color var(--transition-fast);
	}
	.clear-all-btn:hover {
		color: var(--gold);
	}
</style>
