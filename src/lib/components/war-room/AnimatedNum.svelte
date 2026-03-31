<script lang="ts">
	import { onMount } from 'svelte';

	let { value, pre = '', suf = '', decimals = 0 }: { value: number; pre?: string; suf?: string; decimals?: number } = $props();

	let display = $state(0);
	let raf: number;

	$effect(() => {
		const target = value;
		const t0 = performance.now();
		function tick(now: number) {
			const p = Math.min(1, (now - t0) / 900);
			display = (1 - Math.pow(1 - p, 3)) * target;
			if (p < 1) raf = requestAnimationFrame(tick);
		}
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	const formatted = $derived(
		display.toLocaleString('en-US', {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
		})
	);
</script>

<span>{pre}{formatted}{suf}</span>
