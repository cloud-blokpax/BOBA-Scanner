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
		onFileUpload
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
	} = $props();
</script>

<div class="scanner-controls">
	<label class="control-btn upload-btn">
		<span>📁</span>
		<input
			type="file"
			accept="image/jpeg,image/png,image/webp"
			onchange={onFileUpload}
			hidden
		/>
	</label>

	<button
		class="capture-btn"
		onclick={foilMode ? onFoilCapture : onCapture}
		disabled={!cameraReady || scanning}
		aria-label="Capture"
		style:--stability-progress="{stabilityProgress * 100}%"
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

	<button
		class="control-btn"
		class:foil-active={foilMode}
		onclick={onFoilToggle}
		aria-label="Toggle foil mode"
	>
		<span>✨</span>
	</button>
</div>

<style>
	.scanner-controls {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 2rem;
		padding: 0.75rem 1.5rem;
		background: var(--surface-primary, #070b14);
		flex-shrink: 0;
	}

	.control-btn {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--surface-secondary, #0d1524);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		font-size: 1.2rem;
	}

	.upload-btn { cursor: pointer; }

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

	.foil-active {
		background: rgba(245, 158, 11, 0.15) !important;
		border-color: rgba(245, 158, 11, 0.4) !important;
		color: #f59e0b;
	}
</style>
