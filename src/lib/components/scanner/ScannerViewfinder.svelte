<script lang="ts">
	import type { AlignmentState } from './use-scanner-analysis.svelte';

	let {
		alignmentState = 'no_card',
		cameraReady,
		showFlash,
		blurWarning,
		glareRegions,
		scanning,
		foilMode,
		foilStep,
		foilCapturesNeeded,
		foilGuidance,
		cameraError,
		onAlignmentStateChanged
	}: {
		alignmentState?: AlignmentState;
		cameraReady: boolean;
		showFlash: boolean;
		blurWarning: boolean;
		glareRegions: Array<{ x: number; y: number; w: number; h: number }>;
		scanning: boolean;
		foilMode: boolean;
		foilStep: number;
		foilCapturesNeeded: number;
		foilGuidance: string[];
		cameraError: string | null;
		onAlignmentStateChanged?: (state: AlignmentState) => void;
	} = $props();

	// Forward alignment transitions to the parent so the live-OCR coordinator
	// can start/stop sessions in sync with the viewfinder's readiness.
	$effect(() => {
		onAlignmentStateChanged?.(alignmentState);
	});
</script>

<!-- Auto-capture flash overlay -->
{#if showFlash}
	<div class="flash-overlay"></div>
{/if}

<!-- Blur warning overlay -->
{#if blurWarning}
	<div class="blur-warning">
		<span>Hold steady — image is blurry</span>
	</div>
{/if}

<!-- Glare region overlays -->
{#each glareRegions as region}
	<div
		class="glare-region"
		style="left: {region.x * 100}%; top: {region.y * 100}%; width: {region.w * 100}%; height: {region.h * 100}%"
	></div>
{/each}

<!-- Foil capture guidance -->
{#if foilMode && foilStep < foilCapturesNeeded && !scanning}
	<div class="guidance-text foil-guidance">
		{foilGuidance[foilStep]}
	</div>
{/if}

<!-- Foil capture progress -->
{#if foilMode && foilStep > 0 && foilStep < foilCapturesNeeded}
	<div class="foil-progress">
		{#each Array(foilCapturesNeeded) as _, i}
			<div class="foil-dot" class:foil-dot-filled={i < foilStep}></div>
		{/each}
	</div>
{/if}

<!-- Camera error state -->
{#if cameraError && !cameraReady}
	<div class="camera-error">
		<p class="camera-error-text">{cameraError}</p>
		<button class="camera-error-retry" onclick={() => location.reload()}>
			Retry
		</button>
	</div>
{/if}

<style>
	/* Auto-capture flash */
	.flash-overlay {
		position: absolute;
		inset: 0;
		background: white;
		z-index: 20;
		animation: flash-burst 0.15s ease-out forwards;
		pointer-events: none;
	}

	@keyframes flash-burst {
		0% { opacity: 0.8; }
		100% { opacity: 0; }
	}

	/* Blur warning overlay */
	.blur-warning {
		position: absolute;
		inset: 0;
		background: rgba(239, 68, 68, 0.15);
		border: 2px solid rgba(239, 68, 68, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10;
		animation: fade-in 0.2s ease-out;
	}
	.blur-warning span {
		background: rgba(0, 0, 0, 0.8);
		color: #ef4444;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		font-size: 0.9rem;
		font-weight: 600;
	}

	/* Glare region highlights */
	.glare-region {
		position: absolute;
		background: rgba(239, 68, 68, 0.2);
		border: 1px solid rgba(239, 68, 68, 0.5);
		border-radius: 4px;
		z-index: 9;
		pointer-events: none;
		animation: fade-in 0.2s ease-out;
	}

	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	/* Foil-mode guidance text */
	.guidance-text {
		position: absolute;
		bottom: 4.5rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.375rem 0.875rem;
		background: rgba(0, 0, 0, 0.6);
		border-radius: 16px;
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.85);
		pointer-events: none;
		z-index: 5;
		white-space: nowrap;
	}

	/* Camera error state */
	.camera-error {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 2rem;
		z-index: 10;
	}
	.camera-error-text {
		color: rgba(255, 255, 255, 0.85);
		font-size: 0.95rem;
		text-align: center;
		max-width: 300px;
		margin: 0;
		line-height: 1.5;
	}
	.camera-error-retry {
		padding: 0.5rem 1.5rem;
		background: var(--primary, #3b82f6);
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}

	/* Foil mode */
	.foil-guidance {
		background: rgba(245, 158, 11, 0.15);
		border: 1px solid rgba(245, 158, 11, 0.3);
		color: #fbbf24;
	}
	.foil-progress {
		position: absolute;
		top: 10%;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 6px;
		z-index: 5;
		pointer-events: none;
	}
	.foil-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.3);
		border: 1px solid rgba(255, 255, 255, 0.5);
	}
	.foil-dot-filled {
		background: #f59e0b;
		border-color: #f59e0b;
	}
</style>
