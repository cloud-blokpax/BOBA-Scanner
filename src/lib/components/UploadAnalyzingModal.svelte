<script lang="ts">
	import CameraBrackets from '$lib/components/scan/CameraBrackets.svelte';
	import CloseButton from '$lib/components/CloseButton.svelte';

	let {
		imageUrl,
		statusText,
		onCancel
	}: {
		imageUrl: string | null;
		statusText: string;
		onCancel: () => void;
	} = $props();
</script>

<div class="upload-overlay" role="dialog" aria-modal="true" aria-label="Analyzing uploaded photo">
	<div class="upload-backdrop"></div>

	<div class="upload-container">
		<CloseButton onclick={onCancel} position="top-left" variant="dark" />

		<div class="upload-preview-wrap">
			{#if imageUrl}
				<img src={imageUrl} alt="Uploaded card" class="upload-preview" />
			{/if}
			<!-- Same brackets as live scan. 'reading' = amber while OCR runs. -->
			<CameraBrackets state="reading" />
		</div>

		<div class="upload-status-pill" aria-live="polite">
			<div class="upload-spinner"></div>
			<span>{statusText}</span>
		</div>
	</div>
</div>

<style>
	.upload-overlay {
		position: fixed;
		inset: 0;
		z-index: calc(var(--z-sticky, 1020) + 30);
	}
	.upload-backdrop {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.85);
		animation: fade-in 0.2s ease-out;
	}
	.upload-container {
		position: relative;
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		padding: env(safe-area-inset-top, 1rem) 1rem env(safe-area-inset-bottom, 1rem);
	}
	.upload-preview-wrap {
		position: relative;
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 0;
		margin-top: 3rem; /* clear the absolutely-positioned CloseButton */
	}
	.upload-preview {
		max-width: 100%;
		max-height: 100%;
		width: auto;
		height: auto;
		object-fit: contain;
		border-radius: 8px;
	}
	.upload-status-pill {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.625rem 1rem;
		background: rgba(0, 0, 0, 0.75);
		backdrop-filter: blur(12px);
		border-radius: 999px;
		color: var(--text-primary, #e2e8f0);
		font-size: 0.9rem;
		font-weight: 500;
		z-index: 10;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	}
	.upload-spinner {
		width: 16px;
		height: 16px;
		border: 2px solid rgba(255, 255, 255, 0.2);
		border-top-color: var(--primary, #3b82f6);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
</style>
