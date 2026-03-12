<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	let visible = $state(false);

	onMount(() => {
		if (!browser) return;

		// Only show on iOS Safari when not in standalone mode
		const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
		const isStandalone = window.matchMedia('(display-mode: standalone)').matches
			|| ('standalone' in navigator && (navigator as unknown as { standalone: boolean }).standalone);
		const dismissed = localStorage.getItem('installPromptDismissed');

		if (isIOS && !isStandalone && !dismissed) {
			visible = true;
		}
	});

	function dismiss() {
		visible = false;
		if (browser) localStorage.setItem('installPromptDismissed', 'true');
	}
</script>

{#if visible}
	<div class="install-prompt">
		<div class="prompt-content">
			<span class="prompt-icon">📲</span>
			<div>
				<strong>Install BOBA Scanner</strong>
				<p>
					Tap <span class="share-icon">⎙</span> then "Add to Home Screen" for the best experience.
				</p>
			</div>
			<button class="dismiss-btn" onclick={dismiss}>x</button>
		</div>
	</div>
{/if}

<style>
	.install-prompt {
		position: fixed;
		bottom: 80px;
		left: 1rem;
		right: 1rem;
		z-index: 500;
		animation: slide-up 0.3s ease;
	}
	.prompt-content {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 0.75rem 1rem;
	}
	.prompt-icon { font-size: 1.5rem; flex-shrink: 0; }
	.prompt-content strong { font-size: 0.85rem; }
	.prompt-content p {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin-top: 2px;
	}
	.share-icon {
		display: inline-block;
		transform: rotate(180deg);
	}
	.dismiss-btn {
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 0.5rem;
		font-size: 1rem;
		flex-shrink: 0;
	}
	@keyframes slide-up {
		from { opacity: 0; transform: translateY(20px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
