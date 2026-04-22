<script lang="ts">
	import { onMount } from 'svelte';
	import {
		DRAGON_POINTS_CONFIG,
		setDragonPointsConfig,
		getEffectiveDragonPointsConfig,
		type DragonPointsConfigOverrides,
	} from '$lib/games/wonders/dragon-points';
	import { rowsToOverrides } from '$lib/games/wonders/dragon-points-config';
	import { showToast } from '$lib/stores/toast.svelte';

	interface ConfigRow {
		config_type: string;
		key: string;
		value: Record<string, unknown>;
		description?: string | null;
		updated_at?: string;
	}

	type DragonRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'mythic';
	type FoilParallel = 'cf' | 'ff' | 'ocm' | 'sf';
	const RARITIES: DragonRarity[] = ['common', 'uncommon', 'rare', 'epic', 'mythic'];
	const PARALLELS: FoilParallel[] = ['cf', 'ff', 'ocm', 'sf'];
	const PARALLEL_LABELS: Record<FoilParallel, string> = {
		cf: 'Classic Foil',
		ff: 'Formless Foil',
		ocm: 'Orbital Color Match',
		sf: 'Stonefoil',
	};

	let loading = $state(true);
	let saving = $state(false);
	let configRows = $state<ConfigRow[]>([]);

	// Editable grid state — starts from hardcoded defaults, overridden by DB.
	let baseTable = $state<Record<DragonRarity, Record<FoilParallel, number>>>(
		JSON.parse(JSON.stringify(DRAGON_POINTS_CONFIG.baseTable))
	);
	// Explicit `number` cast — DRAGON_POINTS_CONFIG fields have literal types (`as const`)
	// which would lock the state to the initial value.
	let classMultiplier = $state<number>(DRAGON_POINTS_CONFIG.classMultiplier as number);
	let freshnessYear = $state<number>(DRAGON_POINTS_CONFIG.freshnessYear as number);
	let freshnessMultiplier = $state<number>(DRAGON_POINTS_CONFIG.freshnessMultiplier as number);

	async function loadConfig() {
		loading = true;
		try {
			const res = await fetch('/api/admin/dragon-points');
			if (!res.ok) {
				showToast('Failed to load config — using defaults', 'x');
				setDragonPointsConfig(null);
				return;
			}
			const body = (await res.json()) as { config: ConfigRow[] };
			configRows = body.config || [];

			// Apply overrides to the calculator so the live preview reflects DB state.
			const overrides = rowsToOverrides(configRows);
			setDragonPointsConfig(overrides);

			// Mirror the effective config into local editable state.
			const eff = getEffectiveDragonPointsConfig();
			baseTable = JSON.parse(JSON.stringify(eff.baseTable));
			classMultiplier = eff.classMultiplier;
			freshnessYear = eff.freshnessYear;
			freshnessMultiplier = eff.freshnessMultiplier;
		} catch (err) {
			console.warn('[admin/dragon-points] load failed:', err);
			showToast('Failed to load config', 'x');
		} finally {
			loading = false;
		}
	}

	onMount(loadConfig);

	async function saveCell(rarity: DragonRarity, variant: FoilParallel, value: number) {
		if (!Number.isFinite(value) || value < 0) {
			showToast('Value must be a non-negative number', 'x');
			return;
		}
		saving = true;
		try {
			const res = await fetch('/api/admin/dragon-points', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					config_type: 'base_table',
					key: `${rarity}_${variant}`,
					value: { points: value },
					description: `${rarity} × ${PARALLEL_LABELS[variant]}`,
				}),
			});
			if (!res.ok) throw new Error(`Save failed: ${res.status}`);
			showToast(`Saved ${rarity} × ${PARALLEL_LABELS[variant]} = ${value}`, 'check');
			await loadConfig();
		} catch (err) {
			console.error('[admin/dragon-points] save failed:', err);
			showToast('Save failed', 'x');
		} finally {
			saving = false;
		}
	}

	async function saveClassMultiplier() {
		saving = true;
		try {
			const res = await fetch('/api/admin/dragon-points', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					config_type: 'class_multiplier',
					key: 'stoneseeker_lore_mythic',
					value: { multiplier: classMultiplier },
					description: 'Shared multiplier for Stoneseekers and Lore Mythics',
				}),
			});
			if (!res.ok) throw new Error(`Save failed: ${res.status}`);
			showToast(`Class multiplier saved (${classMultiplier}×)`, 'check');
			await loadConfig();
		} catch {
			showToast('Save failed', 'x');
		} finally {
			saving = false;
		}
	}

	async function saveYearBonus() {
		saving = true;
		try {
			const res = await fetch('/api/admin/dragon-points', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					config_type: 'year_bonus',
					key: String(freshnessYear),
					value: { multiplier: freshnessMultiplier },
					description: `Freshness bonus for ${freshnessYear} cards`,
				}),
			});
			if (!res.ok) throw new Error(`Save failed: ${res.status}`);
			showToast(`Year bonus saved (${freshnessYear}: ${freshnessMultiplier}×)`, 'check');
			await loadConfig();
		} catch {
			showToast('Save failed', 'x');
		} finally {
			saving = false;
		}
	}

	async function resetToDefaults() {
		if (!confirm('Delete all admin overrides and fall back to hardcoded defaults?')) return;
		saving = true;
		try {
			for (const row of configRows) {
				await fetch('/api/admin/dragon-points', {
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ config_type: row.config_type, key: row.key }),
				});
			}
			showToast('Reset to defaults', 'check');
			await loadConfig();
		} catch {
			showToast('Reset partially failed', 'x');
		} finally {
			saving = false;
		}
	}

	function findRow(type: string, key: string): ConfigRow | undefined {
		return configRows.find((r) => r.config_type === type && r.key === key);
	}
</script>

<svelte:head>
	<title>Dragon Points Config | Admin</title>
</svelte:head>

<div class="dp-admin">
	<header class="dp-admin-header">
		<h1>Dragon Points Configuration</h1>
		<p>
			These values drive the Dragon Points calculator. Changes take effect immediately
			for all users on their next page load. Empty cells fall back to hardcoded defaults.
		</p>
		<div class="dp-admin-actions">
			<button type="button" onclick={loadConfig} disabled={loading || saving}>
				{loading ? 'Loading…' : 'Refresh'}
			</button>
			<button type="button" class="dp-btn-danger" onclick={resetToDefaults} disabled={loading || saving}>
				Reset all overrides
			</button>
		</div>
	</header>

	<section class="dp-admin-section">
		<h2>Base Point Table (rarity × parallel)</h2>
		<p class="dp-admin-hint">Click a cell value to edit. Save commits to the DB.</p>
		<div class="dp-table-wrap">
			<table class="dp-table">
				<thead>
					<tr>
						<th></th>
						{#each PARALLELS as p}
							<th>{PARALLEL_LABELS[p]}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each RARITIES as r}
						<tr>
							<th>{r}</th>
							{#each PARALLELS as v}
								{@const row = findRow('base_table', `${r}_${v}`)}
								<td class:dp-overridden={!!row}>
									<input
										type="number"
										min="0"
										step="1"
										bind:value={baseTable[r][v]}
										aria-label={`${r} ${PARALLEL_LABELS[v]}`}
									/>
									<button
										type="button"
										class="dp-cell-save"
										onclick={() => saveCell(r, v, baseTable[r][v])}
										disabled={saving}
										aria-label="Save"
									>✓</button>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section class="dp-admin-section">
		<h2>Class Multiplier</h2>
		<p class="dp-admin-hint">
			Multiplier applied on top of base + freshness for Stoneseekers and Lore Mythics.
		</p>
		<div class="dp-inline-edit">
			<input
				type="number"
				min="1"
				step="0.1"
				bind:value={classMultiplier}
				aria-label="Class multiplier"
			/>
			<button type="button" onclick={saveClassMultiplier} disabled={saving}>Save</button>
			<span class="dp-current">
				Current: {classMultiplier}× (default {DRAGON_POINTS_CONFIG.classMultiplier}×)
			</span>
		</div>
	</section>

	<section class="dp-admin-section">
		<h2>Year Freshness Bonus</h2>
		<p class="dp-admin-hint">
			Cards released in this year receive their base × multiplier. Typical value: 1.35
			(a 35% bonus) for the most recent year.
		</p>
		<div class="dp-inline-edit">
			<label>Year
				<input
					type="number"
					min="2024"
					max="2040"
					step="1"
					bind:value={freshnessYear}
				/>
			</label>
			<label>Multiplier
				<input
					type="number"
					min="1"
					step="0.01"
					bind:value={freshnessMultiplier}
				/>
			</label>
			<button type="button" onclick={saveYearBonus} disabled={saving}>Save</button>
			<span class="dp-current">
				Default: {DRAGON_POINTS_CONFIG.freshnessYear} × {DRAGON_POINTS_CONFIG.freshnessMultiplier}
			</span>
		</div>
	</section>

	<section class="dp-admin-section">
		<h2>Bonus Card Values</h2>
		<p class="dp-admin-hint">
			Autographs, Alt-Arts, Echoes, Art Proofs — values TBD pending the Dragon Cup PDF.
			When values are confirmed, add rows here via future UI or direct SQL. The calculator
			currently returns zero with the reason "bonus card values TBD".
		</p>
	</section>
</div>

<style>
	.dp-admin {
		max-width: 960px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
	}
	.dp-admin-header h1 {
		font-family: var(--font-display, 'Syne', sans-serif);
		font-size: 1.6rem;
		margin: 0 0 0.5rem;
	}
	.dp-admin-header p {
		color: var(--text-secondary, #94a3b8);
		font-size: 0.9rem;
		margin: 0 0 1rem;
	}
	.dp-admin-actions {
		display: flex;
		gap: 8px;
		margin-bottom: 1rem;
	}
	.dp-admin-actions button {
		padding: 6px 12px;
		border-radius: 6px;
		border: 1px solid var(--border-strong, rgba(148,163,184,0.3));
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #e2e8f0);
		cursor: pointer;
		font-size: 0.85rem;
	}
	.dp-btn-danger { color: #ef4444 !important; border-color: rgba(239,68,68,0.3) !important; }

	.dp-admin-section {
		margin-top: 2rem;
		padding: 1rem;
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		border-radius: 12px;
		background: var(--bg-surface, #0d1524);
	}
	.dp-admin-section h2 {
		font-family: var(--font-display, 'Syne', sans-serif);
		font-size: 1.1rem;
		margin: 0 0 0.25rem;
	}
	.dp-admin-hint {
		color: var(--text-secondary, #94a3b8);
		font-size: 0.8rem;
		margin: 0 0 1rem;
	}

	/* ── Base table grid ─── */
	.dp-table-wrap { overflow-x: auto; }
	.dp-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	.dp-table th,
	.dp-table td {
		border: 1px solid var(--border, rgba(148,163,184,0.15));
		padding: 4px;
		text-align: center;
		text-transform: capitalize;
	}
	.dp-table thead th {
		background: var(--bg-elevated, #121d34);
		font-weight: 700;
		padding: 8px;
	}
	.dp-table tbody th {
		background: var(--bg-elevated, #121d34);
		text-align: left;
		padding: 8px 10px;
		font-weight: 700;
	}
	.dp-table td { position: relative; }
	.dp-table td.dp-overridden {
		background: color-mix(in srgb, #D4AF37 10%, transparent);
	}
	.dp-table td input {
		width: 64px;
		padding: 4px 6px;
		border: none;
		background: transparent;
		color: var(--text-primary, #e2e8f0);
		text-align: center;
		font-family: inherit;
		font-size: 0.9rem;
	}
	.dp-cell-save {
		margin-left: 2px;
		padding: 2px 5px;
		border: 1px solid rgba(34, 197, 94, 0.5);
		background: rgba(34, 197, 94, 0.1);
		color: #22c55e;
		border-radius: 4px;
		font-size: 0.7rem;
		cursor: pointer;
	}
	.dp-cell-save:hover { background: rgba(34, 197, 94, 0.2); }

	.dp-inline-edit {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.dp-inline-edit input[type="number"] {
		width: 96px;
		padding: 6px 8px;
		border: 1px solid var(--border-strong, rgba(148,163,184,0.3));
		border-radius: 6px;
		background: var(--bg-input, #0a1020);
		color: var(--text-primary, #e2e8f0);
	}
	.dp-inline-edit label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
	}
	.dp-inline-edit button {
		padding: 6px 12px;
		border-radius: 6px;
		border: 1px solid rgba(212, 175, 55, 0.5);
		background: rgba(212, 175, 55, 0.1);
		color: #D4AF37;
		font-weight: 700;
		cursor: pointer;
	}
	.dp-current {
		margin-left: 8px;
		color: var(--text-muted, #475569);
		font-size: 0.75rem;
	}
</style>
