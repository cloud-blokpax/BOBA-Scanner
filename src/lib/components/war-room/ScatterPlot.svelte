<script lang="ts">
	import type { HeroCard } from './war-room-data';

	const PARALLEL_COLORS: Record<string, string> = {
		Paper: '#22c55e',
		Battlefoil: '#3b82f6',
		"80's Rad": '#f59e0b',
		Superfoil: '#ef4444',
		'Bubble Gum': '#f472b6',
		'Blue BF': '#60a5fa',
		'Green BF': '#4ade80',
		'Silver BF': '#94a3b8',
		'Blizzard BF': '#67e8f9',
		'Linoleum BF': '#a78bfa',
	};

	let {
		data,
		width = 340,
		height = 180,
		hovered = null,
		onhover,
	}: {
		data: HeroCard[];
		width?: number;
		height?: number;
		hovered: string | null;
		onhover: (num: string | null) => void;
	} = $props();

	const pad = { t: 12, r: 12, b: 24, l: 36 };
	const w = $derived(width - pad.l - pad.r);
	const h = $derived(height - pad.t - pad.b);

	const xMin = $derived(Math.min(...data.map((d) => d.pwr)) - 5);
	const xMax = $derived(Math.max(...data.map((d) => d.pwr)) + 5);
	const yMax = $derived(Math.max(...data.map((d) => d.mid)) * 1.1);

	function xScale(v: number) {
		return pad.l + ((v - xMin) / (xMax - xMin)) * w;
	}
	function yScale(v: number) {
		return pad.t + h - (v / yMax) * h;
	}

	const gridY = $derived([0, 0.25, 0.5, 0.75, 1].map((p) => p * yMax));
	const gridX = $derived([xMin, Math.round((xMin + xMax) / 2), xMax]);
</script>

<svg {width} {height} style="display:block">
	{#each gridY as v}
		<line x1={pad.l} x2={width - pad.r} y1={yScale(v)} y2={yScale(v)} stroke="rgba(255,255,255,0.04)" stroke-width="1" />
	{/each}
	{#each gridY.filter((_, i) => i % 2 === 0) as v}
		<text x={pad.l - 4} y={yScale(v) + 3} text-anchor="end" fill="#4a6178" font-size="9" font-family="'JetBrains Mono',monospace">
			${v < 10 ? v.toFixed(1) : Math.round(v)}
		</text>
	{/each}
	{#each gridX as v}
		<text x={xScale(v)} y={height - 4} text-anchor="middle" fill="#4a6178" font-size="9" font-family="'JetBrains Mono',monospace">
			{Math.round(v)}
		</text>
	{/each}
	<text x={width / 2} y={height} text-anchor="middle" fill="#4a6178" font-size="8">POWER</text>

	{#each data as d}
		{@const x = xScale(d.pwr)}
		{@const y = yScale(d.mid)}
		{@const isH = hovered === d.num}
		{@const sz = isH ? 7 : Math.max(3, Math.min(6, d.ls / 8))}
		{@const c = PARALLEL_COLORS[d.p] || '#6b7d8e'}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<g
			onmouseenter={() => onhover(d.num)}
			onmouseleave={() => onhover(null)}
			style="cursor:pointer"
		>
			<circle cx={x} cy={y} r={sz + 4} fill="transparent" />
			<circle
				cx={x}
				cy={y}
				r={sz}
				fill={c}
				opacity={isH ? 1 : 0.7}
				stroke={isH ? '#fff' : 'none'}
				stroke-width={1.5}
				style="transition:all 0.15s"
			/>
			{#if isH}
				<rect x={x - 45} y={y - 32} width={90} height={22} rx={4} fill="#0d1524" stroke="rgba(255,255,255,0.15)" stroke-width={0.5} />
				<text {x} y={y - 18} text-anchor="middle" fill="#e2e8f0" font-size="10" font-weight="600">
					{d.hero} ${d.mid} · {d.pwr}p
				</text>
			{/if}
		</g>
	{/each}
</svg>
