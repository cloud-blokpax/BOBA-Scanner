<script lang="ts">
	let {
		deckName,
		formatName,
		saveState,
		heroCount,
		heroTarget,
		onBack,
		onSettings,
		onNameChange
	}: {
		deckName: string;
		formatName: string;
		saveState: 'saved' | 'saving' | 'unsaved';
		heroCount: number;
		heroTarget: number;
		onBack: () => void;
		onSettings: () => void;
		onNameChange: (name: string) => void;
	} = $props();

	const progressPercent = $derived(Math.min(100, heroTarget > 0 ? (heroCount / heroTarget) * 100 : 100));
	const progressColor = $derived(
		heroCount >= heroTarget ? 'var(--color-success, #22c55e)' :
		progressPercent >= 50 ? 'var(--accent-gold, #f59e0b)' :
		'var(--color-error, #ef4444)'
	);
</script>

<div class="deck-header">
	<div class="header-top">
		<button class="header-btn" onclick={onBack} aria-label="Back">
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
		</button>
		<input
			class="deck-name-input"
			type="text"
			value={deckName}
			oninput={(e) => onNameChange(e.currentTarget.value)}
			placeholder="Deck name..."
		/>
		<span class="format-badge">{formatName}</span>
		<button class="header-btn" onclick={onSettings} aria-label="Settings">
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 13a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" stroke-width="1.5"/><path d="M16.5 10c0-.34-.03-.67-.08-1l1.58-1.24-1.5-2.6-1.83.73a6.5 6.5 0 00-1.74-1l-.28-1.89h-3l-.28 1.89a6.5 6.5 0 00-1.74 1l-1.83-.73-1.5 2.6L5.88 9c-.05.33-.08.66-.08 1s.03.67.08 1l-1.58 1.24 1.5 2.6 1.83-.73c.5.42 1.09.76 1.74 1l.28 1.89h3l.28-1.89a6.5 6.5 0 001.74-1l1.83.73 1.5-2.6L14.12 11c.05-.33.08-.66.08-1z" stroke="currentColor" stroke-width="1.5"/></svg>
		</button>
	</div>

	<div class="progress-track">
		<div class="progress-fill" style:width="{progressPercent}%" style:background={progressColor}></div>
	</div>

	<div class="save-indicator" class:saved={saveState === 'saved'} class:saving={saveState === 'saving'}>
		{#if saveState === 'saved'}
			Saved
		{:else if saveState === 'saving'}
			Saving...
		{:else}
			Unsaved
		{/if}
	</div>
</div>

<style>
	.deck-header {
		position: sticky;
		top: 0;
		z-index: 50;
		background: var(--bg-elevated, #1e293b);
		border-bottom: 1px solid var(--border-color, #334155);
		padding: 0.5rem 0.75rem 0.25rem;
	}
	.header-top {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.header-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border: none;
		background: none;
		color: var(--text-secondary, #94a3b8);
		cursor: pointer;
		border-radius: 8px;
		flex-shrink: 0;
	}
	.header-btn:hover { background: var(--bg-hover, rgba(255,255,255,0.05)); }
	.deck-name-input {
		flex: 1;
		min-width: 0;
		padding: 0.375rem 0.5rem;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: var(--text-primary, #f1f5f9);
		font-size: 1rem;
		font-weight: 600;
	}
	.deck-name-input:focus {
		outline: none;
		border-color: var(--accent-primary, #3b82f6);
		background: var(--bg-base, #0f172a);
	}
	.format-badge {
		padding: 0.2rem 0.5rem;
		border-radius: 10px;
		background: rgba(59, 130, 246, 0.15);
		color: #60a5fa;
		font-size: 0.7rem;
		font-weight: 600;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.progress-track {
		height: 3px;
		background: var(--border-color, #334155);
		border-radius: 2px;
		margin-top: 0.375rem;
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		border-radius: 2px;
		transition: width 0.3s ease, background 0.3s ease;
	}
	.save-indicator {
		font-size: 0.7rem;
		color: var(--text-tertiary, #64748b);
		text-align: right;
		padding-top: 0.125rem;
	}
	.save-indicator.saved { color: var(--color-success, #22c55e); }
	.save-indicator.saving { color: var(--accent-gold, #f59e0b); }
</style>
