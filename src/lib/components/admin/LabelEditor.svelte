<script lang="ts">
	let {
		imageUrl,
		imageW,
		imageH,
		initialCorners,
		onConfirm,
		onCorrect,
		onReject
	}: {
		imageUrl: string;
		imageW: number;
		imageH: number;
		initialCorners: number[][] | null;
		onConfirm: (corners: number[][]) => void;
		onCorrect: (corners: number[][]) => void;
		onReject: (reason: string) => void;
	} = $props();

	function makeDefaultCorners(): number[][] {
		return (
			initialCorners ?? [
				[imageW * 0.15, imageH * 0.1],
				[imageW * 0.85, imageH * 0.1],
				[imageW * 0.85, imageH * 0.9],
				[imageW * 0.15, imageH * 0.9]
			]
		).map((p) => [...p]);
	}

	let corners = $state<number[][]>(makeDefaultCorners());
	let modified = $state(false);

	let svgEl: SVGSVGElement | null = $state(null);
	let dragIdx: number | null = null;

	function svgPointFromEvent(e: PointerEvent): [number, number] | null {
		if (!svgEl) return null;
		const rect = svgEl.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * imageW;
		const y = ((e.clientY - rect.top) / rect.height) * imageH;
		return [x, y];
	}

	function onPointerDown(idx: number, e: PointerEvent) {
		dragIdx = idx;
		(e.target as Element).setPointerCapture(e.pointerId);
	}
	function onPointerMove(e: PointerEvent) {
		if (dragIdx === null) return;
		const p = svgPointFromEvent(e);
		if (!p) return;
		corners = corners.map((c, i) =>
			i === dragIdx
				? [Math.max(0, Math.min(imageW, p[0])), Math.max(0, Math.min(imageH, p[1]))]
				: c
		);
		modified = true;
	}
	function onPointerUp() {
		dragIdx = null;
	}

	const polyPoints = $derived(corners.map((c) => `${c[0]},${c[1]}`).join(' '));
	const cornerLabels = ['TL', 'TR', 'BR', 'BL'];

	function reset() {
		corners = makeDefaultCorners();
		modified = false;
	}
</script>

<div class="editor">
	<svg
		bind:this={svgEl}
		viewBox="0 0 {imageW} {imageH}"
		preserveAspectRatio="xMidYMid meet"
		role="application"
		aria-label="Card corner editor"
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
	>
		<image href={imageUrl} x="0" y="0" width={imageW} height={imageH} />
		<polygon
			points={polyPoints}
			fill="rgba(16,185,129,0.18)"
			stroke="#10B981"
			stroke-width="3"
			stroke-linejoin="round"
			vector-effect="non-scaling-stroke"
		/>
		{#each corners as c, i}
			<circle
				cx={c[0]}
				cy={c[1]}
				r="14"
				fill="#10B981"
				stroke="white"
				stroke-width="2"
				vector-effect="non-scaling-stroke"
				role="button"
				tabindex="0"
				aria-label={`${cornerLabels[i]} corner handle at x ${Math.round(c[0])}, y ${Math.round(c[1])}`}
				style="cursor: grab; touch-action: none;"
				onpointerdown={(e) => onPointerDown(i, e)}
			/>
			<text
				x={c[0]}
				y={c[1] - 22}
				text-anchor="middle"
				fill="white"
				font-size="20"
				stroke="black"
				stroke-width="0.5"
				vector-effect="non-scaling-stroke">{cornerLabels[i]}</text
			>
		{/each}
	</svg>

	<div class="actions">
		<button type="button" onclick={reset}>Reset</button>
		{#if modified || initialCorners === null}
			<button type="button" class="primary" onclick={() => onCorrect(corners)}>
				Save corrected
			</button>
		{:else}
			<button type="button" class="primary" onclick={() => onConfirm(corners)}>
				Confirm as-is
			</button>
		{/if}
		<button
			type="button"
			class="reject"
			onclick={() => {
				const r = prompt('Reject reason?', 'multi_card_collage');
				if (r) onReject(r);
			}}>Reject</button
		>
	</div>
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	svg {
		width: 100%;
		max-height: 70vh;
		background: #1a1a1a;
		border-radius: 0.25rem;
		user-select: none;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.actions button {
		padding: 0.6rem 1rem;
		border: 1px solid #444;
		background: transparent;
		color: inherit;
		border-radius: 0.25rem;
		font-weight: 500;
	}
	.actions button.primary {
		background: #10b981;
		border-color: transparent;
		color: white;
	}
	.actions button.reject {
		border-color: #dc2626;
		color: #dc2626;
	}
</style>
