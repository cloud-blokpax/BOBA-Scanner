<script lang="ts">
	import { updateAvailable } from '$lib/services/version';

	function handleUpdate() {
		// Force service worker to check for updates, then reload
		if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
			navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
		}
		location.reload();
	}

	function dismiss() {
		updateAvailable.set(null);
	}
</script>

{#if $updateAvailable?.available}
	<div class="update-banner">
		<div class="update-content">
			<span class="update-text">
				Version {$updateAvailable.version} available
				{#if $updateAvailable.notes}
					— {$updateAvailable.notes}
				{/if}
			</span>
			<button class="update-btn" onclick={handleUpdate}>Update</button>
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
	.dismiss-btn {
		background: none;
		border: none;
		color: rgba(255,255,255,0.7);
		cursor: pointer;
		font-size: 1rem;
		padding: 0.2rem;
	}
</style>
