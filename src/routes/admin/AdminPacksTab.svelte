<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import { DEFAULT_CONFIGS, getBoxConfig } from '$lib/data/pack-defaults';
	import { getAllWeaponKeys } from '$lib/data/boba-weapons';
	import type { SlotConfig, SlotOutcome } from '$lib/types/pack-simulator';

	const BOX_TYPES = ['blaster', 'double_mega', 'hobby', 'jumbo'];
	const SET_OPTIONS = [
		{ key: 'A', label: 'Alpha' },
		{ key: 'U', label: 'Update' },
		{ key: 'G', label: 'Griffey' },
		{ key: 'T', label: 'Tecmo' }
	];
	const OUTCOME_TYPES: SlotOutcome['type'][] = ['weapon_rarity', 'parallel', 'card_type'];

	const WEAPON_OPTIONS = getAllWeaponKeys();
	const PARALLEL_OPTIONS = [
		'battlefoil', 'silver', 'blue_battlefoil', 'orange_battlefoil', 'red_battlefoil',
		'green_battlefoil', 'pink_battlefoil', 'blizzard', '80s_rad', 'grandmas_linoleum',
		'great_grandmas_linoleum', 'headlines', 'red_headlines', 'orange_headlines',
		'blue_headlines', 'icon', 'colosseum', 'logo', 'mixtape', 'miami_ice',
		'fire_tracks', 'bubblegum', 'grillin', 'chillin', 'slime', 'alpha', 'alt',
		'power_glove', 'inspired_ink', 'metallic_inspired_ink', 'super_parallel'
	];
	const CARD_TYPE_OPTIONS = ['play', 'bonus_play', 'hotdog'];

	let selectedBox = $state('blaster');
	let selectedSet = $state('G');
	let slots = $state<SlotConfig[]>([]);
	let packsPerBox = $state(6);
	let configId = $state<string | null>(null);
	let loading = $state(true);
	let saving = $state(false);
	let expandedSlot = $state<number | null>(null);

	// Derived: available box types for the selected set
	const availableBoxTypes = $derived(
		BOX_TYPES.filter((bt) => {
			const config = DEFAULT_CONFIGS[bt];
			return config?.availableForSets.includes(selectedSet);
		})
	);

	$effect(() => {
		loadConfig();
	});

	async function loadConfig() {
		loading = true;
		try {
			const res = await fetch(`/api/admin/pack-config?box_type=${selectedBox}`);
			if (res.ok) {
				const data = await res.json();
				if (data && data.slots) {
					slots = structuredClone(data.slots as SlotConfig[]);
					packsPerBox = data.packs_per_box || 10;
					configId = data.id;
					loading = false;
					return;
				}
			}
		} catch { /* use defaults */ }

		// Fall back to defaults
		const config = getBoxConfig(selectedBox, selectedSet);
		if (config) {
			slots = structuredClone(config.slots);
			packsPerBox = config.packsPerBox;
		}
		configId = null;
		loading = false;
	}

	function handleSetChange() {
		// If current box type isn't available for new set, switch to blaster
		if (!availableBoxTypes.includes(selectedBox)) {
			selectedBox = 'blaster';
		}
		loadConfig();
	}

	function slotWeightSum(slot: SlotConfig): number {
		return slot.outcomes.reduce((sum, o) => sum + o.weight, 0);
	}

	function isWeightValid(slot: SlotConfig): boolean {
		const sum = slotWeightSum(slot);
		return Math.abs(sum - 100) < 0.01;
	}

	function allSlotsValid(): boolean {
		return slots.every(isWeightValid);
	}

	function addOutcome(slotIdx: number) {
		slots[slotIdx].outcomes = [
			...slots[slotIdx].outcomes,
			{ type: 'weapon_rarity', value: 'steel', label: 'Steel', weight: 0 }
		];
	}

	function removeOutcome(slotIdx: number, outcomeIdx: number) {
		slots[slotIdx].outcomes = slots[slotIdx].outcomes.filter((_, i) => i !== outcomeIdx);
	}

	function getValueOptions(type: SlotOutcome['type']): string[] {
		switch (type) {
			case 'weapon_rarity': return WEAPON_OPTIONS;
			case 'parallel': return PARALLEL_OPTIONS;
			case 'card_type': return CARD_TYPE_OPTIONS;
			default: return [];
		}
	}

	async function saveConfig() {
		if (!allSlotsValid()) {
			showToast('All slot weights must sum to 100%', 'x');
			return;
		}

		saving = true;
		try {
			const config = getBoxConfig(selectedBox, selectedSet);
			const res = await fetch('/api/admin/pack-config', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: configId,
					box_type: selectedBox,
					set_code: selectedSet,
					display_name: config?.displayName || selectedBox,
					slots,
					packs_per_box: packsPerBox,
					box_guarantees: config?.guarantees || []
				})
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error || 'Save failed');
			}

			const data = await res.json();
			configId = data.id;
			showToast('Pack configuration saved', 'check');
		} catch (err) {
			showToast(err instanceof Error ? err.message : 'Save failed', 'x');
		}
		saving = false;
	}

	function resetToDefaults() {
		const config = getBoxConfig(selectedBox, selectedSet);
		if (config) {
			slots = structuredClone(config.slots);
			packsPerBox = config.packsPerBox;
		}
		showToast('Reset to defaults', 'check');
	}
</script>

<div class="packs-admin">
	<!-- Set Selector -->
	<div class="set-selector">
		<span class="sel-label">Set</span>
		<div class="set-buttons">
			{#each SET_OPTIONS as setOpt}
				<button
					class="set-btn"
					class:active={selectedSet === setOpt.key}
					onclick={() => { selectedSet = setOpt.key; handleSetChange(); }}
				>
					{setOpt.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Box Type Selector -->
	<div class="box-selector">
		{#each availableBoxTypes as box}
			<button
				class="box-btn"
				class:active={selectedBox === box}
				onclick={() => { selectedBox = box; loadConfig(); }}
			>
				{box.replace(/_/g, ' ')}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="loading">Loading...</div>
	{:else}
		<div class="meta-row">
			<label class="meta-field">
				<span>Packs per box</span>
				<input type="number" min="1" max="100" bind:value={packsPerBox} />
			</label>
		</div>

		<!-- Slot list -->
		<div class="slots-list">
			{#each slots as slot, slotIdx}
				<div class="slot-card" class:invalid={!isWeightValid(slot)}>
					<button class="slot-header" onclick={() => { expandedSlot = expandedSlot === slotIdx ? null : slotIdx; }}>
						<span class="slot-num">Slot {slot.slotNumber}</span>
						<input
							class="slot-label-input"
							type="text"
							bind:value={slot.label}
							onclick={(e) => e.stopPropagation()}
						/>
						<span class="weight-sum" class:valid={isWeightValid(slot)} class:invalid={!isWeightValid(slot)}>
							{slotWeightSum(slot).toFixed(1)}%
						</span>
						<span class="expand-icon">{expandedSlot === slotIdx ? '−' : '+'}</span>
					</button>

					{#if expandedSlot === slotIdx}
						<div class="slot-body">
							<table class="outcomes-table">
								<thead>
									<tr>
										<th>Type</th>
										<th>Value</th>
										<th>Label</th>
										<th>Weight %</th>
										<th></th>
									</tr>
								</thead>
								<tbody>
									{#each slot.outcomes as outcome, outcomeIdx}
										<tr>
											<td>
												<select bind:value={outcome.type}>
													{#each OUTCOME_TYPES as t}
														<option value={t}>{t}</option>
													{/each}
												</select>
											</td>
											<td>
												<select bind:value={outcome.value}>
													{#each getValueOptions(outcome.type) as v}
														<option value={v}>{v}</option>
													{/each}
												</select>
											</td>
											<td>
												<input type="text" bind:value={outcome.label} class="label-input" />
											</td>
											<td>
												<input type="number" min="0" max="100" step="0.1" bind:value={outcome.weight} class="weight-input" />
											</td>
											<td>
												<button class="btn-remove" onclick={() => removeOutcome(slotIdx, outcomeIdx)}>x</button>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
							<button class="btn-add-outcome" onclick={() => addOutcome(slotIdx)}>+ Add Outcome</button>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Actions -->
		<div class="admin-actions">
			<button class="btn-save" onclick={saveConfig} disabled={saving || !allSlotsValid()}>
				{saving ? 'Saving...' : 'Save Configuration'}
			</button>
			<button class="btn-reset" onclick={resetToDefaults}>Reset to Defaults</button>
		</div>
	{/if}
</div>

<style>
	.packs-admin { display: flex; flex-direction: column; gap: 1rem; }

	.set-selector { display: flex; flex-direction: column; gap: 0.25rem; }
	.sel-label { font-size: 0.7rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; }
	.set-buttons { display: flex; gap: 0.375rem; }
	.set-btn {
		flex: 1; padding: 0.375rem; border-radius: 6px; border: 1px solid var(--border-color);
		background: var(--bg-elevated); color: var(--text-secondary); font-size: 0.75rem;
		font-weight: 600; cursor: pointer; transition: all 0.15s;
	}
	.set-btn.active { border-color: var(--accent-primary); color: var(--accent-primary); }

	.box-selector { display: flex; gap: 0.5rem; flex-wrap: wrap; }
	.box-btn {
		flex: 1; min-width: calc(50% - 0.25rem); padding: 0.5rem; border-radius: 8px; border: 1px solid var(--border-color);
		background: var(--bg-elevated); color: var(--text-secondary); font-size: 0.85rem;
		font-weight: 600; cursor: pointer; text-transform: capitalize;
	}
	.box-btn.active { border-color: var(--accent-primary); color: var(--accent-primary); }
	.loading { text-align: center; padding: 2rem; color: var(--text-tertiary); }

	.meta-row { display: flex; gap: 1rem; }
	.meta-field {
		display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8rem; color: var(--text-secondary);
	}
	.meta-field input {
		padding: 0.375rem 0.5rem; border-radius: 6px; border: 1px solid var(--border-color);
		background: var(--bg-base); color: var(--text-primary); font-size: 0.85rem; width: 80px;
	}

	.slots-list { display: flex; flex-direction: column; gap: 0.5rem; }
	.slot-card {
		border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden;
		background: var(--bg-elevated);
	}
	.slot-card.invalid { border-color: #ef4444; }
	.slot-header {
		display: flex; align-items: center; gap: 0.5rem; padding: 0.625rem 0.75rem;
		background: none; border: none; width: 100%; cursor: pointer; color: var(--text-primary);
	}
	.slot-num { font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); min-width: 44px; }
	.slot-label-input {
		flex: 1; padding: 0.25rem 0.375rem; border-radius: 4px; border: 1px solid transparent;
		background: transparent; color: var(--text-primary); font-size: 0.8rem;
	}
	.slot-label-input:focus { border-color: var(--border-color); background: var(--bg-base); }
	.weight-sum { font-size: 0.75rem; font-weight: 600; min-width: 48px; text-align: right; }
	.weight-sum.valid { color: #22c55e; }
	.weight-sum.invalid { color: #ef4444; }
	.expand-icon { font-size: 1rem; color: var(--text-tertiary); min-width: 20px; text-align: center; }

	.slot-body { padding: 0.5rem 0.75rem 0.75rem; border-top: 1px solid var(--border-color); }
	.outcomes-table { width: 100%; font-size: 0.75rem; border-collapse: collapse; }
	.outcomes-table th {
		text-align: left; padding: 0.25rem 0.375rem; color: var(--text-tertiary); font-weight: 500;
	}
	.outcomes-table td { padding: 0.25rem 0.375rem; }
	.outcomes-table select, .label-input, .weight-input {
		width: 100%; padding: 0.25rem 0.375rem; border-radius: 4px;
		border: 1px solid var(--border-color); background: var(--bg-base);
		color: var(--text-primary); font-size: 0.75rem;
	}
	.weight-input { width: 60px; }
	.btn-remove {
		background: none; border: none; color: #ef4444; cursor: pointer; font-size: 0.85rem; padding: 0.25rem;
	}
	.btn-add-outcome {
		margin-top: 0.5rem; padding: 0.375rem 0.75rem; border-radius: 6px;
		border: 1px dashed var(--border-color); background: none;
		color: var(--text-secondary); font-size: 0.75rem; cursor: pointer;
	}

	.admin-actions { display: flex; gap: 0.5rem; }
	.btn-save {
		flex: 2; padding: 0.75rem; border-radius: 10px; border: none;
		background: var(--accent-primary); color: #fff; font-size: 0.9rem;
		font-weight: 600; cursor: pointer;
	}
	.btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-reset {
		flex: 1; padding: 0.75rem; border-radius: 10px;
		border: 1px solid var(--border-color); background: var(--bg-elevated);
		color: var(--text-secondary); font-size: 0.9rem; cursor: pointer;
	}
</style>
