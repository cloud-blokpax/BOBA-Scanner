<!--
  Sparkline — inline SVG price trend line.
  Props: data (number[]), width, height, color (optional, auto green/red).
-->
<script lang="ts">
	interface Props {
		data: number[];
		width?: number;
		height?: number;
		color?: string;
	}

	let { data, width = 72, height = 24, color }: Props = $props();

	const resolvedColor = $derived(
		color ?? (data.length > 1 && data[data.length - 1] >= data[0] ? 'var(--success)' : 'var(--danger)')
	);

	const points = $derived.by(() => {
		if (data.length < 2) return '';
		const mn = Math.min(...data);
		const mx = Math.max(...data);
		const r = mx - mn || 1;
		return data
			.map((v, i) => `${(i / (data.length - 1)) * width},${height - 2 - ((v - mn) / r) * (height - 4)}`)
			.join(' ');
	});

	const areaPoints = $derived(points ? points + ` ${width},${height} 0,${height}` : '');
	const gradId = $derived(`spark-${Math.random().toString(36).slice(2, 8)}`);
</script>

{#if points}
	<svg {width} {height} style="display:block;flex-shrink:0">
		<defs>
			<linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={resolvedColor} stop-opacity="0.25" />
				<stop offset="100%" stop-color={resolvedColor} stop-opacity="0" />
			</linearGradient>
		</defs>
		<polygon points={areaPoints} fill="url(#{gradId})" />
		<polyline {points} fill="none" stroke={resolvedColor} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
{/if}
