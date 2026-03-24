<script lang="ts">
	import { scanState } from '$lib/stores/scanner.svelte';

	let {
		statusText,
		statusType
	}: {
		statusText: string;
		statusType: string;
	} = $props();
</script>

<div class="status-overlay" class:status-success={statusType === 'success'} class:status-error={statusType === 'error'} class:status-scanning={statusType === 'scanning'}>
	{#if statusType === 'scanning'}
		<span class="status-spinner"></span>
	{/if}
	<span class="status-text">{statusText}</span>
	{#if scanState().status === 'tier1' || scanState().status === 'tier2' || scanState().status === 'tier3'}
		<div class="tier-progress">
			<div class="tier-dot" class:active={scanState().status === 'tier1'} class:done={['tier2', 'tier3'].includes(scanState().status)}></div>
			<div class="tier-dot" class:active={scanState().status === 'tier2'} class:done={scanState().status === 'tier3'}></div>
			<div class="tier-dot" class:active={scanState().status === 'tier3'}></div>
		</div>
	{/if}
</div>

<style>
	.status-overlay {
		position: absolute;
		bottom: 2rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.5rem 1rem;
		background: rgba(0, 0, 0, 0.7);
		border-radius: 20px;
		backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		transition: background 0.3s, border-color 0.3s;
		border: 1px solid transparent;
	}

	.status-overlay.status-success {
		background: rgba(16, 185, 129, 0.15);
		border-color: rgba(16, 185, 129, 0.3);
	}

	.status-overlay.status-error {
		background: rgba(239, 68, 68, 0.15);
		border-color: rgba(239, 68, 68, 0.3);
	}

	.status-overlay.status-scanning {
		background: rgba(59, 130, 246, 0.12);
		border-color: rgba(59, 130, 246, 0.2);
	}

	.status-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex-shrink: 0;
	}

	.status-text {
		font-size: 0.85rem;
		color: white;
	}

	.tier-progress {
		display: flex;
		gap: 6px;
		margin-top: 6px;
	}
	.tier-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: rgba(255,255,255,0.2);
		transition: background 0.3s;
	}
	.tier-dot.active {
		background: var(--gold, #f59e0b);
		box-shadow: 0 0 6px var(--gold-glow, rgba(245, 158, 11, 0.5));
	}
	.tier-dot.done {
		background: var(--success, #22c55e);
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
