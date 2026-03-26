<script lang="ts">
	let {
		onclick,
		position = 'top-right',
		variant = 'dark'
	}: {
		onclick: () => void;
		position?: 'top-right' | 'top-left';
		variant?: 'dark' | 'light';
	} = $props();
</script>

<button
	class="close-btn close-{position} close-{variant}"
	{onclick}
	aria-label="Close"
>
	<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
		<line x1="4" y1="4" x2="16" y2="16" />
		<line x1="16" y1="4" x2="4" y2="16" />
	</svg>
</button>

<style>
	.close-btn {
		position: absolute;
		z-index: 10001;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		border: none;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition: transform 0.1s;
	}

	.close-top-right {
		top: calc(env(safe-area-inset-top, 0px) + 12px);
		right: 12px;
	}

	.close-top-left {
		top: calc(env(safe-area-inset-top, 0px) + 12px);
		left: 12px;
	}

	/* Dark background overlay (scanner, dark modals) */
	.close-dark {
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		color: white;
	}

	/* Light background overlay (Go Pro page, light modals) */
	.close-light {
		background: rgba(0, 0, 0, 0.08);
		color: #333;
	}

	.close-btn:active {
		transform: scale(0.9);
	}
</style>
