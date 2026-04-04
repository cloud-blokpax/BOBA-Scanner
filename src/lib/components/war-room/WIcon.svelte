<script lang="ts">
	import { W_ICONS } from './war-room-constants';

	let { type, size = 14, color = '#6b7d8e' }: { type: string; size?: number; color?: string } = $props();

	const path = $derived(W_ICONS[type] ?? null);
</script>

{#if path}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<path d={path} />
	</svg>
{/if}
