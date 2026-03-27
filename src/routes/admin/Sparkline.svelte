<script lang="ts">
	let { data = [], color = 'var(--gold)', height = 32, width = 120 }: {
		data: number[];
		color?: string;
		height?: number;
		width?: number;
	} = $props();

	const points = $derived.by(() => {
		if (data.length < 2) return '';
		const max = Math.max(...data, 1);
		const step = width / (data.length - 1);
		const pad = 2;
		const h = height - pad * 2;
		return data
			.map((v, i) => `${(i * step).toFixed(1)},${(pad + h - (v / max) * h).toFixed(1)}`)
			.join(' ');
	});

	const areaPath = $derived.by(() => {
		if (data.length < 2) return '';
		const max = Math.max(...data, 1);
		const step = width / (data.length - 1);
		const pad = 2;
		const h = height - pad * 2;
		const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(pad + h - (v / max) * h).toFixed(1)}`);
		return `M0,${height} L${pts.join(' L')} L${width},${height} Z`;
	});
</script>

<svg {width} {height} viewBox="0 0 {width} {height}" class="sparkline">
	{#if data.length >= 2}
		<path d={areaPath} fill={color} opacity="0.15" />
		<polyline
			{points}
			fill="none"
			stroke={color}
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	{:else}
		<text x={width / 2} y={height / 2} text-anchor="middle" dominant-baseline="middle" fill="var(--text-tertiary)" font-size="10">
			No data
		</text>
	{/if}
</svg>

<style>
	.sparkline {
		display: block;
		flex-shrink: 0;
	}
</style>
