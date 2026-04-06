<script lang="ts">
	import { updateAvailable, setUpdateAvailable } from '$lib/services/version.svelte';

	let updating = $state(false);
	let info = $derived(updateAvailable());

	function handleUpdate() {
		if (updating) return;
		updating = true;

		if ('serviceWorker' in navigator) {
			// Wait for the new SW to take control before reloading
			navigator.serviceWorker.addEventListener('controllerchange', () => {
				location.reload();
			});

			// Tell the waiting SW to activate
			if (navigator.serviceWorker.controller) {
				navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
			}

			// Safety timeout — if controllerchange doesn't fire within 3s, reload anyway
			setTimeout(() => location.reload(), 3000);
		} else {
			location.reload();
		}
	}

	function dismiss() {
		setUpdateAvailable(null);
	}
</script>

{#if info?.available}
	<div class="update-banner">
		<div class="update-content">
			<span class="update-text">
				Version {info.version} available
				{#if info.notes}
					— {info.notes}
				{/if}
			</span>
			<button class="update-btn" onclick={handleUpdate} disabled={updating}>
				{updating ? 'Updating...' : 'Update'}
			</button>
			<button class="dismiss-btn" onclick={dismiss} aria-label="Dismiss">x</button>
		</div>
	</div>
{/if}

<style>
	.update-banner {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 1000;
		background: linear-gradient(135deg, #0064d2, #0070e0);
		color: white;
		padding: 0.5rem 1rem;
		font-size: 0.85rem;
		animation: slide-down 0.3s ease;
	}
	@keyframes slide-down {
		from { transform: translateY(-100%); }
		to { transform: translateY(0); }
	}
	.update-content {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		max-width: 800px;
		margin: 0 auto;
	}
	.update-text {
		flex: 1;
	}
	.update-btn {
		padding: 0.3rem 0.75rem;
		border-radius: 6px;
		border: 1px solid rgba(255,255,255,0.4);
		background: rgba(255,255,255,0.15);
		color: white;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.update-btn:hover {
		background: rgba(255,255,255,0.25);
	}
	.update-btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}
	.dismiss-btn {
		background: none;
		border: none;
		color: rgba(255,255,255,0.7);
		cursor: pointer;
		font-size: 1rem;
		padding: 0.2rem;
	}
</style>
