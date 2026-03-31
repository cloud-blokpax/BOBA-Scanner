<script lang="ts">
	interface RingSegment {
		label: string;
		value: number;
		color: string;
	}

	let { data, size = 120, thickness = 14 }: { data: RingSegment[]; size?: number; thickness?: number } = $props();

	const cx = $derived(size / 2);
	const cy = $derived(size / 2);
	const r = $derived((size - thickness) / 2);
	const circ = $derived(2 * Math.PI * r);
	const total = $derived(data.reduce((s, d) => s + d.value, 0));

	const segments = $derived(() => {
		let offset = 0;
		return data.map((d, i) => {
			const len = (d.value / total) * circ;
			const seg = { ...d, len, offset, index: i };
			offset += len;
			return seg;
		});
	});
</script>

<svg width={size} height={size} style="display:block;margin:0 auto">
	<circle {cx} {cy} {r} fill="none" stroke="rgba(255,255,255,0.04)" stroke-width={thickness} />
	{#each segments() as seg}
		<circle
			{cx}
			{cy}
			{r}
			fill="none"
			stroke={seg.color}
			stroke-width={thickness}
			stroke-dasharray="{seg.len} {circ - seg.len}"
			stroke-dashoffset={-seg.offset}
			stroke-linecap="butt"
			style="transform:rotate(-90deg);transform-origin:50% 50%;transition:stroke-dasharray 1s cubic-bezier(0.16,1,0.3,1) {seg.index * 0.1}s, stroke-dashoffset 0.8s ease {seg.index * 0.1}s"
		/>
	{/each}
	<text x={cx} y={cy - 8} text-anchor="middle" fill="#e2e8f0" font-size="18" font-weight="800" font-family="'JetBrains Mono',monospace">{total}</text>
	<text x={cx} y={cy + 8} text-anchor="middle" fill="#4a6178" font-size="9" font-weight="600">CARDS</text>
</svg>
