<script lang="ts">
	export type CameraPillState = 'searching' | 'reading' | 'got_it' | 'try_again';

	let {
		state = 'searching' as CameraPillState,
		cardName = ''
	}: {
		state?: CameraPillState;
		cardName?: string;
	} = $props();

	type Config = { text: string; bg: string; fg: string };

	const config: Record<CameraPillState, Config> = {
		searching: { text: 'Point at card', bg: 'rgba(0, 0, 0, 0.65)', fg: '#fff' },
		reading: { text: 'Reading', bg: '#FFA726', fg: '#1a1a1a' },
		got_it: { text: '', bg: '#10B981', fg: '#fff' },
		try_again: { text: "Couldn't read — tap to retry", bg: '#EF4444', fg: '#fff' }
	};

	const c = $derived(config[state]);
	const label = $derived(state === 'got_it' ? cardName || 'Got it' : c.text);
</script>

<div class="status-pill" style="background: {c.bg}; color: {c.fg};">
	<span class="status-pill-label">{label}</span>
	{#if state === 'reading'}
		<span class="status-pill-dots" aria-hidden="true"></span>
	{/if}
</div>

<style>
	.status-pill {
		position: absolute;
		left: 50%;
		top: 42%;
		transform: translateX(-50%);
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0.5rem 1rem;
		border-radius: 9999px;
		font-size: 0.875rem;
		font-weight: 500;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
		pointer-events: none;
		z-index: 6;
		white-space: nowrap;
		transition: background 150ms ease, color 150ms ease;
	}

	.status-pill-label {
		display: inline-block;
	}

	.status-pill-dots::after {
		display: inline-block;
		width: 1.25em;
		text-align: left;
		content: '';
		animation: pill-ellipsis 1.4s steps(4, end) infinite;
	}

	@keyframes pill-ellipsis {
		0% {
			content: '';
		}
		25% {
			content: '.';
		}
		50% {
			content: '..';
		}
		75%,
		100% {
			content: '...';
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.status-pill-dots::after {
			animation: none;
			content: '…';
		}
	}
</style>
