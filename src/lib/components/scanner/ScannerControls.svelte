<script lang="ts">
	let {
		torchOn,
		foilMode,
		cameraReady,
		scanning,
		stabilityProgress,
		scanMode = 'single',
		onTorchToggle,
		onCapture,
		onFoilCapture,
		onFoilToggle,
		onFileUpload,
		onFileDialogOpen,
		onFileDialogClose,
		onModeChange
	}: {
		torchOn: boolean;
		foilMode: boolean;
		cameraReady: boolean;
		scanning: boolean;
		stabilityProgress: number;
		scanMode?: 'single' | 'batch' | 'binder' | 'roll';
		onTorchToggle: () => void;
		onCapture: () => void;
		onFoilCapture: () => void;
		onFoilToggle: () => void;
		onFileUpload: (event: Event) => void;
		onFileDialogOpen?: () => void;
		onFileDialogClose?: () => void;
		onModeChange?: (mode: 'single' | 'batch' | 'binder' | 'roll') => void;
	} = $props();
</script>

<div class="scanner-controls">
	<!-- Mode switcher -->
	{#if onModeChange}
		<div class="mode-switcher">
			<button
				class="mode-btn"
				class:mode-active={scanMode === 'single'}
				onclick={() => onModeChange?.('single')}
			>Single</button>
			<button
				class="mode-btn"
				class:mode-active={scanMode === 'batch'}
				onclick={() => onModeChange?.('batch')}
			>Batch</button>
			<button
				class="mode-btn"
				class:mode-active={scanMode === 'binder'}
				onclick={() => onModeChange?.('binder')}
			>Binder</button>
			<button
				class="mode-btn"
				class:mode-active={scanMode === 'roll'}
				onclick={() => onModeChange?.('roll')}
			>Roll</button>
		</div>
	{/if}

	<!-- Capture controls -->
	<div class="capture-row">
		<label class="control-btn upload-btn" onclick={() => onFileDialogOpen?.()}>
			<span>📁</span>
			<input
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

	.mode-switcher {
		display: flex;
		justify-content: center;
		gap: 6px;
		padding: 8px 12px;
		background: rgba(0, 0, 0, 0.75);
		border-radius: 28px;
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		width: 100%;
		max-width: 300px;
	}

	.mode-btn {
		flex: 1;
		padding: 8px 14px;
		border: none;
		border-radius: 20px;
		background: transparent;
		color: rgba(255, 255, 255, 0.6);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.mode-btn:active {
		transform: scale(0.95);
	}

	.mode-active {
		background: rgba(255, 255, 255, 0.2);
		color: #fff;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3);
	}

	.capture-row {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 2rem;
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
