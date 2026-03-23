<script lang="ts">
	let {
		visible,
		deckName,
		notes,
		heroDeckMin,
		heroDeckMax,
		playDeckSize,
		bonusPlaysMax,
		hotDogDeckSize,
		dbsCap,
		specPowerCap,
		combinedPowerCap,
		onSave,
		onClose
	}: {
		visible: boolean;
		deckName: string;
		notes: string;
		heroDeckMin: number;
		heroDeckMax: number | null;
		playDeckSize: number;
		bonusPlaysMax: number;
		hotDogDeckSize: number;
		dbsCap: number;
		specPowerCap: number | null;
		combinedPowerCap: number | null;
		onSave: (settings: {
			name: string;
			notes: string;
			hero_deck_min: number;
			hero_deck_max: number | null;
			play_deck_size: number;
			bonus_plays_max: number;
			hot_dog_deck_size: number;
			dbs_cap: number;
			spec_power_cap: number | null;
			combined_power_cap: number | null;
		}) => void;
		onClose: () => void;
	} = $props();

	let localName = $state('');
	let localNotes = $state('');
	let localHeroMin = $state(60);
	let localHeroMax = $state<string>('');
	let localPlaySize = $state(30);
	let localBonusMax = $state(25);
	let localHotDogSize = $state(10);
	let localDbsCap = $state(1000);
	let localSpecCap = $state<string>('');
	let localCpCap = $state<string>('');

	$effect(() => {
		if (visible) {
			localName = deckName;
			localNotes = notes;
			localHeroMin = heroDeckMin;
			localHeroMax = heroDeckMax !== null ? String(heroDeckMax) : '';
			localPlaySize = playDeckSize;
			localBonusMax = bonusPlaysMax;
			localHotDogSize = hotDogDeckSize;
			localDbsCap = dbsCap;
			localSpecCap = specPowerCap !== null ? String(specPowerCap) : '';
			localCpCap = combinedPowerCap !== null ? String(combinedPowerCap) : '';
		}
	});

	function handleSave() {
		onSave({
			name: localName,
			notes: localNotes,
			hero_deck_min: localHeroMin,
			hero_deck_max: localHeroMax ? Number(localHeroMax) : null,
			play_deck_size: localPlaySize,
			bonus_plays_max: localBonusMax,
			hot_dog_deck_size: localHotDogSize,
			dbs_cap: localDbsCap,
			spec_power_cap: localSpecCap ? Number(localSpecCap) : null,
			combined_power_cap: localCpCap ? Number(localCpCap) : null
		});
	}
</script>

{#if visible}
	<div class="modal-backdrop" role="presentation" onkeydown={(e) => e.key === 'Escape' && onClose()}>
		<button class="backdrop-dismiss" type="button" aria-label="Close" tabindex="-1" onclick={onClose}></button>
		<div class="modal-card">
			<div class="modal-header">
				<h2>Deck Settings</h2>
				<button class="close-btn" onclick={onClose} aria-label="Close">x</button>
			</div>

			<div class="modal-body">
				<label class="field">
					<span>Deck Name</span>
					<input type="text" bind:value={localName} />
				</label>

				<label class="field">
					<span>Notes</span>
					<textarea rows="3" placeholder="Tournament notes, strategy reminders..." bind:value={localNotes}></textarea>
				</label>

				<h3>Build Requirements</h3>
				<div class="settings-grid">
					<label class="field">
						<span>Heroes Min</span>
						<input type="number" bind:value={localHeroMin} min="0" />
					</label>
					<label class="field">
						<span>Heroes Max</span>
						<input type="text" inputmode="numeric" bind:value={localHeroMax} placeholder="No limit" />
					</label>
					<label class="field">
						<span>Play Cards</span>
						<input type="number" bind:value={localPlaySize} min="0" />
					</label>
					<label class="field">
						<span>Bonus Plays Max</span>
						<input type="number" bind:value={localBonusMax} min="0" />
					</label>
					<label class="field">
						<span>Hot Dog Cards</span>
						<input type="number" bind:value={localHotDogSize} min="0" />
					</label>
					<label class="field">
						<span>DBS Cap</span>
						<input type="number" bind:value={localDbsCap} min="0" />
					</label>
					<label class="field">
						<span>SPEC Power Cap</span>
						<input type="text" inputmode="numeric" bind:value={localSpecCap} placeholder="No limit" />
					</label>
					<label class="field">
						<span>Combined Power Cap</span>
						<input type="text" inputmode="numeric" bind:value={localCpCap} placeholder="No limit" />
					</label>
				</div>
			</div>

			<div class="modal-footer">
				<button class="btn-cancel" onclick={onClose}>Cancel</button>
				<button class="btn-save" onclick={handleSave}>Save</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}
	.backdrop-dismiss {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.6);
		border: none;
		appearance: none;
		cursor: default;
	}
	.modal-card {
		width: 100%;
		max-width: 480px;
		max-height: 85vh;
		overflow-y: auto;
		background: var(--bg-elevated, #1e293b);
		border: 1px solid var(--border-color, #334155);
		border-radius: 12px;
	}
	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem;
		border-bottom: 1px solid var(--border-color, #334155);
	}
	.modal-header h2 {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text-primary, #f1f5f9);
		margin: 0;
	}
	.close-btn {
		width: 32px;
		height: 32px;
		border: none;
		background: none;
		color: var(--text-secondary, #94a3b8);
		font-size: 1.1rem;
		font-weight: 700;
		cursor: pointer;
		border-radius: 6px;
	}
	.close-btn:hover { background: var(--bg-hover, rgba(255,255,255,0.05)); }
	.modal-body { padding: 1rem; }
	h3 {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-secondary, #94a3b8);
		margin: 1rem 0 0.5rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
	}
	.field span {
		font-size: 0.75rem;
		color: var(--text-secondary, #94a3b8);
	}
	.field input, .field textarea {
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--border-color, #334155);
		border-radius: 6px;
		background: var(--bg-base, #0f172a);
		color: var(--text-primary, #f1f5f9);
		font-size: 0.85rem;
		font-family: inherit;
	}
	.field input::placeholder, .field textarea::placeholder {
		color: var(--text-tertiary, #64748b);
	}
	.settings-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.modal-footer {
		display: flex;
		gap: 0.5rem;
		padding: 1rem;
		border-top: 1px solid var(--border-color, #334155);
		justify-content: flex-end;
	}
	.btn-cancel {
		padding: 0.5rem 1rem;
		border: 1px solid var(--border-color, #334155);
		border-radius: 8px;
		background: transparent;
		color: var(--text-secondary, #94a3b8);
		font-size: 0.85rem;
		cursor: pointer;
	}
	.btn-save {
		padding: 0.5rem 1.25rem;
		border: none;
		border-radius: 8px;
		background: var(--accent-primary, #3b82f6);
		color: white;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.btn-save:hover { filter: brightness(1.1); }
</style>
