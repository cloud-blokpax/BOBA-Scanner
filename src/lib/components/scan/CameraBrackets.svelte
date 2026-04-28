<script lang="ts">
	export type CameraBracketState = 'searching' | 'reading' | 'got_it' | 'try_again';

	let { state = 'searching' as CameraBracketState }: { state?: CameraBracketState } = $props();

	const colorByState: Record<CameraBracketState, string> = {
		searching: 'rgba(255, 255, 255, 0.85)',
		reading: '#FFA726',
		got_it: '#10B981',
		try_again: '#EF4444'
	};

	const stroke = $derived(colorByState[state]);
</script>

<div class="brackets-overlay" aria-hidden="true">
	<!--
		The bracket frame doubles as `.scanner-guide-rect`, which Scanner.svelte
		queries via `videoEl.closest('.viewfinder')?.querySelector(...)` to map the
		visible target into source-video pixels. Keeping the visible target and
		the OCR ROI on the same element is exactly what kills the dual-framing.
	-->
	<div class="scanner-guide-rect bracket-frame">
		<div class="bracket-corner tl" style="border-color: {stroke};"></div>
		<div class="bracket-corner tr" style="border-color: {stroke};"></div>
		<div class="bracket-corner bl" style="border-color: {stroke};"></div>
		<div class="bracket-corner br" style="border-color: {stroke};"></div>
	</div>
</div>

<style>
	.brackets-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		z-index: 4;
	}

	/* 5:7 outline at 78vw, capped on landscape so the frame fits the viewport. */
	.bracket-frame {
		position: relative;
		width: min(78vw, calc(70vh * 5 / 7));
		aspect-ratio: 5 / 7;
		/* Dim everything outside the bracketed region. */
		box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
	}

	.bracket-corner {
		position: absolute;
		width: 3rem;
		height: 3rem;
		border-style: solid;
		border-width: 0;
		transition: border-color 150ms ease;
	}

	.bracket-corner.tl {
		top: 0;
		left: 0;
		border-top-width: 3px;
		border-left-width: 3px;
		border-top-left-radius: 6px;
	}
	.bracket-corner.tr {
		top: 0;
		right: 0;
		border-top-width: 3px;
		border-right-width: 3px;
		border-top-right-radius: 6px;
	}
	.bracket-corner.bl {
		bottom: 0;
		left: 0;
		border-bottom-width: 3px;
		border-left-width: 3px;
		border-bottom-left-radius: 6px;
	}
	.bracket-corner.br {
		bottom: 0;
		right: 0;
		border-bottom-width: 3px;
		border-right-width: 3px;
		border-bottom-right-radius: 6px;
	}
</style>
