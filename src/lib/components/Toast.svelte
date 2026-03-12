<script lang="ts">
	import { toasts } from '$lib/stores/toast';
</script>

{#if $toasts.length > 0}
	<div class="toast-container">
		{#each $toasts as toast (toast.id)}
			<div class="toast-item">
				{#if toast.icon}<span class="toast-icon">{toast.icon}</span>{/if}
				<span class="toast-message">{toast.message}</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	.toast-container {
		position: fixed;
		top: 1rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 9999;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		pointer-events: none;
	}
	.toast-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem;
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		color: var(--text-primary);
		font-size: 0.875rem;
		font-weight: 500;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		animation: toast-in 0.3s ease;
	}
	.toast-icon {
		font-size: 1rem;
		flex-shrink: 0;
	}
	@keyframes toast-in {
		from { opacity: 0; transform: translateY(-10px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
