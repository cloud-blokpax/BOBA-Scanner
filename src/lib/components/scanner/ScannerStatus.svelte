<script lang="ts">
	import { scanState } from '$lib/stores/scanner.svelte';

	let {
		statusText,
		statusType
	}: {
		statusText: string;
		statusType: string;
	} = $props();

	// Tier 2 (Claude Haiku) escalation: show progressive messages after delays
	let tier2Elapsed = $state(0);
	let tier2Interval: ReturnType<typeof setInterval> | null = null;

	$effect(() => {
		const state = scanState();
		if (state.status === 'tier2') {
			if (!tier2Interval) {
				tier2Elapsed = 0;
				tier2Interval = setInterval(() => { tier2Elapsed += 1; }, 1000);
			}
		} else {
			if (tier2Interval) {
				clearInterval(tier2Interval);
				tier2Interval = null;
				tier2Elapsed = 0;
			}
		}
	});

	const displayText = $derived.by(() => {
		const state = scanState();
		if (state.status === 'tier2') {
			if (tier2Elapsed >= 8) return 'Almost there...';
			if (tier2Elapsed >= 4) return 'Still analyzing...';
		}
		return statusText;
	});
</script>

<div class="status-overlay" class:status-success={statusType === 'success'} class:status-error={statusType === 'error'} class:status-scanning={statusType === 'scanning'}>
	{#if statusType === 'scanning'}
		<span class="status-dot"></span>
	{/if}
	<span class="status-text">{displayText}</span>
	{#if scanState().status === 'tier1' || scanState().status === 'tier2'}
		<div class="tier-progress">
			<div class="tier-dot" class:active={scanState().status === 'tier1'} class:done={scanState().status === 'tier2'}></div>
			<div class="tier-dot" class:active={scanState().status === 'tier2'}></div>
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

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--gold, #f59e0b);
		animation: pulse-dot 1.2s ease-in-out infinite;
		flex-shrink: 0;
	}

	@keyframes pulse-dot {
		0%, 100% { opacity: 0.4; transform: scale(0.8); }
		50% { opacity: 1; transform: scale(1.2); }
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
</style>
