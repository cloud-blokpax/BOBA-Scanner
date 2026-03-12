<script lang="ts">
	import { theme, setThemeMode, type ThemeMode } from '$lib/stores/theme';

	const modes: { value: ThemeMode; label: string }[] = [
		{ value: 'dark', label: 'Dark' },
		{ value: 'light', label: 'Light' },
		{ value: 'system', label: 'System' }
	];
</script>

<div class="theme-switcher">
	{#each modes as mode}
		<button
			class="theme-option"
			class:active={$theme.mode === mode.value}
			onclick={() => setThemeMode(mode.value)}
		>
			{mode.label}
		</button>
	{/each}
</div>

<style>
	.theme-switcher {
		display: flex;
		gap: 2px;
		background: var(--bg-base);
		border-radius: 8px;
		padding: 2px;
		border: 1px solid var(--border-color);
	}
	.theme-option {
		padding: 0.4rem 0.75rem;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.15s;
	}
	.theme-option.active {
		background: var(--accent-primary);
		color: white;
	}
</style>
