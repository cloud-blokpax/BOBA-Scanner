<script lang="ts">
	let {
		torchOn,
		foilMode,
		cameraReady,
		scanning,
		stabilityProgress,
		onTorchToggle,
		onCapture,
		onFoilCapture,
		onFoilToggle,
		onFileUpload,
		onFileDialogOpen,
		onFileDialogClose
	}: {
		torchOn: boolean;
		foilMode: boolean;
		cameraReady: boolean;
		scanning: boolean;
		stabilityProgress: number;
		onTorchToggle: () => void;
		onCapture: () => void;
		onFoilCapture: () => void;
		onFoilToggle: () => void;
		onFileUpload: (event: Event) => void;
		onFileDialogOpen?: () => void;
		onFileDialogClose?: () => void;
	} = $props();

	let fileInputEl = $state<HTMLInputElement | null>(null);
</script>

<div class="scanner-controls">
	<!-- Secondary tools (small, above capture button) -->
	<div class="tools-row">
		<button type="button" class="tool-btn" onclick={() => { onFileDialogOpen?.(); fileInputEl?.click(); }}
			aria-label="Upload photo">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
		</button>
		<button class="tool-btn" class:tool-active={foilMode} onclick={onFoilToggle}
			aria-label="Toggle foil mode">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
		</button>
	</div>
	<input
		bind:this={fileInputEl}
		type="file"
		accept="image/jpeg,image/png,image/webp"
		onchange={onFileUpload}
		onclick={(e) => {
			const handler = () => {
				setTimeout(() => onFileDialogClose?.(), 300);
				window.removeEventListener('focus', handler);
			};
			window.addEventListener('focus', handler);
		}}
		hidden
	/>

	<!-- Capture button — big, centered, unobstructed -->
	<div class="capture-row">
		<button
			class="capture-btn"
			onclick={foilMode ? onFoilCapture : onCapture}
			disabled={!cameraReady || scanning}
			aria-label="Capture"
		>
			{#if stabilityProgress > 0 && !scanning}
				<div class="stability-ring" style:background="conic-gradient(#22C55E {stabilityProgress * 360}deg, transparent {stabilityProgress * 360}deg)"></div>
			{/if}
			<div class="capture-ring">
				{#if scanning}
					<div class="capture-spinner"></div>
				{/if}
			</div>
		</button>
	</div>
</div>

<style>
	.scanner-controls {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1.5rem calc(env(safe-area-inset-bottom, 8px) + 0.5rem);
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.85));
		flex-shrink: 0;
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 8;
	}

	.tools-row {
		display: flex;
		justify-content: center;
		gap: 1.5rem;
	}

	.tool-btn {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.15);
		background: rgba(0, 0, 0, 0.5);
		color: rgba(255, 255, 255, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.15s;
	}

	.tool-btn:active {
		transform: scale(0.92);
	}

	.tool-active {
		background: rgba(245, 158, 11, 0.15);
		border-color: rgba(245, 158, 11, 0.4);
		color: #f59e0b;
	}

	.capture-row {
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.capture-btn {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		border: 4px solid white;
		background: transparent;
		padding: 4px;
		cursor: pointer;
		position: relative;
	}

	.stability-ring {
		position: absolute;
		inset: -2px;
		border-radius: 50%;
		opacity: 0.7;
		pointer-events: none;
		mask: radial-gradient(circle, transparent 60%, black 61%);
		-webkit-mask: radial-gradient(circle, transparent 60%, black 61%);
	}

	.capture-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.capture-ring {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		background: white;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.capture-spinner {
		width: 24px;
		height: 24px;
		border: 3px solid transparent;
		border-top-color: var(--accent-primary, #3b82f6);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

</style>
