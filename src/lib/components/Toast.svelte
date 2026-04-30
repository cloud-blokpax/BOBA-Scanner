<script lang="ts">
	import { toasts } from '$lib/stores/toast.svelte';
</script>

{#if toasts().length > 0}
	<div class="toast-container">
		{#each toasts() as toast (toast.id)}
			<div class="toast-item" class:has-action={toast.action}>
				{#if toast.icon}<span class="toast-icon">{toast.icon}</span>{/if}
				<span class="toast-message">{toast.message}</span>
				{#if toast.action}
					<button class="toast-action" onclick={toast.action.onAction}>
						{toast.action.label}
					</button>
				{/if}
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
		pointer-events: auto;
	}
	.toast-item.has-action {
		padding-right: 0.5rem;
	}
	.toast-icon {
		font-size: 1rem;
		flex-shrink: 0;
	}
	.toast-message {
		flex: 1;
	}
	.toast-action {
		font-family: inherit;
		font-size: var(--text-xs, 0.75rem);
		font-weight: var(--font-bold, 700);
		color: var(--gold, #f59e0b);
		background: transparent;
		border: none;
		padding: var(--space-1, 0.25rem) var(--space-2, 0.5rem);
		cursor: pointer;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-radius: var(--radius-sm, 0.375rem);
		transition: background var(--transition-fast, 150ms);
	}
	.toast-action:hover {
		background: var(--gold-light, rgba(245, 158, 11, 0.12));
	}
	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(-10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
