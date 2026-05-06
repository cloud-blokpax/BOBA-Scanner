<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';

	type Status = 'Featured' | 'Highlighted' | 'Non-Featured';

	interface SetSummary {
		set_code: string;
		hero_count: number;
	}

	interface HeroRow {
		hero_name: string;
		set_code: string;
		status: Status;
		source: 'derived' | 'manual';
		notes: string | null;
		updated_at: string;
		card_count: number;
		has_inspired_ink: boolean;
	}

	let sets = $state<SetSummary[]>([]);
	let activeSet = $state<string | null>(null);
	let heroes = $state<HeroRow[]>([]);
	let loading = $state(true);
	let savingHero = $state<string | null>(null); // composite key "<set>::<hero>"
	let filter = $state('');
	let statusFilter = $state<Status | 'all'>('all');

	$effect(() => {
		loadSets();
	});

	async function loadSets() {
		loading = true;
		try {
			const res = await fetch('/api/admin/hero-status');
			if (!res.ok) throw new Error('Failed to load sets');
			const data = await res.json();
			sets = data.sets;
			if (sets.length > 0 && !activeSet) {
				// Default to Griffey Edition (largest set), else first.
				activeSet = sets.find((s) => s.set_code === 'Griffey Edition')?.set_code ?? sets[0].set_code;
				await loadHeroes(activeSet);
			}
		} catch {
			showToast('Failed to load sets', 'x');
		}
		loading = false;
	}

	async function loadHeroes(setCode: string) {
		loading = true;
		try {
			const res = await fetch(`/api/admin/hero-status?set=${encodeURIComponent(setCode)}`);
			if (!res.ok) throw new Error('Failed to load heroes');
			const data = await res.json();
			heroes = data.heroes;
		} catch {
			showToast('Failed to load heroes', 'x');
		}
		loading = false;
	}

	async function changeStatus(row: HeroRow, newStatus: Status) {
		if (newStatus === row.status) return;
		const key = `${row.set_code}::${row.hero_name}`;
		savingHero = key;

		// Optimistic update
		const original = { status: row.status, source: row.source };
		row.status = newStatus;
		row.source = 'manual';

		try {
			const res = await fetch('/api/admin/hero-status', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					hero_name: row.hero_name,
					set_code: row.set_code,
					status: newStatus
				})
			});
			if (!res.ok) throw new Error('Save failed');
			showToast(`${row.hero_name} → ${newStatus}`, 'check');
		} catch {
			// Roll back optimistic update
			row.status = original.status;
			row.source = original.source;
			showToast('Save failed', 'x');
		}
		savingHero = null;
	}

	async function resetToDerived(row: HeroRow) {
		const key = `${row.set_code}::${row.hero_name}`;
		savingHero = key;
		try {
			const res = await fetch('/api/admin/hero-status', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ hero_name: row.hero_name, set_code: row.set_code })
			});
			if (!res.ok) throw new Error('Reset failed');
			const data = await res.json();
			row.status = data.status;
			row.source = 'derived';
			row.notes = null;
			showToast(`Reset → ${data.status} (derived)`, 'check');
		} catch {
			showToast('Reset failed', 'x');
		}
		savingHero = null;
	}

	const filteredHeroes = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		return heroes.filter((h) => {
			if (statusFilter !== 'all' && h.status !== statusFilter) return false;
			if (q && !h.hero_name.toLowerCase().includes(q)) return false;
			return true;
		});
	});

	const stats = $derived.by(() => {
		const c = { Featured: 0, Highlighted: 0, 'Non-Featured': 0 };
		for (const h of heroes) c[h.status] += 1;
		return c;
	});

	function statusColor(status: Status): string {
		if (status === 'Featured') return 'var(--accent-gold, #d4a843)';
		if (status === 'Highlighted') return 'var(--accent-blue, #3b82f6)';
		return 'var(--text-muted, #94a3b8)';
	}
</script>

<div class="hero-status-tab">
	<div class="set-selector">
		<label for="set-select">Set</label>
		<select
			id="set-select"
			bind:value={activeSet}
			onchange={() => activeSet && loadHeroes(activeSet)}
			disabled={loading}
		>
			{#each sets as set}
				<option value={set.set_code}>{set.set_code} ({set.hero_count})</option>
			{/each}
		</select>
	</div>

	{#if heroes.length > 0}
		<div class="stats-row">
			<button
				class="stat-chip"
				class:active={statusFilter === 'all'}
				onclick={() => (statusFilter = 'all')}
			>
				All <span>{heroes.length}</span>
			</button>
			<button
				class="stat-chip"
				class:active={statusFilter === 'Featured'}
				onclick={() => (statusFilter = 'Featured')}
				style:--chip-color={statusColor('Featured')}
			>
				Featured <span>{stats.Featured}</span>
			</button>
			<button
				class="stat-chip"
				class:active={statusFilter === 'Highlighted'}
				onclick={() => (statusFilter = 'Highlighted')}
				style:--chip-color={statusColor('Highlighted')}
			>
				Highlighted <span>{stats.Highlighted}</span>
			</button>
			<button
				class="stat-chip"
				class:active={statusFilter === 'Non-Featured'}
				onclick={() => (statusFilter = 'Non-Featured')}
				style:--chip-color={statusColor('Non-Featured')}
			>
				Non-Featured <span>{stats['Non-Featured']}</span>
			</button>
		</div>

		<input
			type="search"
			class="hero-filter"
			placeholder="Filter by hero name…"
			bind:value={filter}
		/>
	{/if}

	{#if loading}
		<div class="loading">Loading…</div>
	{:else if filteredHeroes.length === 0}
		<div class="empty">No heroes match.</div>
	{:else}
		<ul class="hero-list">
			{#each filteredHeroes as hero (hero.hero_name)}
				{@const key = `${hero.set_code}::${hero.hero_name}`}
				<li class="hero-row" class:saving={savingHero === key}>
					<div class="hero-info">
						<div class="hero-name">{hero.hero_name}</div>
						<div class="hero-meta">
							{hero.card_count} cards
							{#if hero.has_inspired_ink}· has Ink{/if}
							{#if hero.source === 'manual'}· <span class="manual-tag">manual</span>{/if}
						</div>
					</div>
					<div class="hero-action">
						<select
							value={hero.status}
							onchange={(e) =>
								changeStatus(hero, (e.target as HTMLSelectElement).value as Status)}
							disabled={savingHero === key}
							style:--status-color={statusColor(hero.status)}
						>
							<option value="Featured">Featured</option>
							<option value="Highlighted">Highlighted</option>
							<option value="Non-Featured">Non-Featured</option>
						</select>
						{#if hero.source === 'manual'}
							<button
								class="reset-btn"
								onclick={() => resetToDerived(hero)}
								disabled={savingHero === key}
								title="Reset to auto-derived from catalog"
							>
								↺
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.hero-status-tab {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem 0;
	}
	.set-selector {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.set-selector label {
		font-size: 0.75rem;
		text-transform: uppercase;
		color: var(--text-muted, #94a3b8);
		letter-spacing: 0.05em;
	}
	.set-selector select {
		min-height: 44px;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border, rgba(148, 163, 184, 0.2));
		background: var(--surface, rgba(15, 23, 42, 0.6));
		color: var(--text-primary, #e2e8f0);
		font-size: 1rem;
	}
	.stats-row {
		display: flex;
		gap: 0.5rem;
		overflow-x: auto;
		padding-bottom: 0.25rem;
		scrollbar-width: thin;
	}
	.stat-chip {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		padding: 0.5rem 0.875rem;
		border-radius: 999px;
		border: 1px solid var(--border, rgba(148, 163, 184, 0.2));
		background: var(--surface, rgba(15, 23, 42, 0.6));
		color: var(--text-primary, #e2e8f0);
		font-size: 0.85rem;
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
		transition: border-color 0.12s;
	}
	.stat-chip span {
		opacity: 0.7;
		font-size: 0.8rem;
	}
	.stat-chip.active {
		border-color: var(--chip-color, var(--primary, #3b82f6));
	}
	.hero-filter {
		min-height: 44px;
		padding: 0.5rem 0.875rem;
		border-radius: 8px;
		border: 1px solid var(--border, rgba(148, 163, 184, 0.2));
		background: var(--surface, rgba(15, 23, 42, 0.6));
		color: var(--text-primary, #e2e8f0);
		font-size: 1rem;
	}
	.hero-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.hero-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		border-radius: 10px;
		background: var(--surface, rgba(15, 23, 42, 0.5));
		border: 1px solid var(--border, rgba(148, 163, 184, 0.15));
		transition: opacity 0.12s;
	}
	.hero-row.saving {
		opacity: 0.5;
	}
	.hero-info {
		flex: 1;
		min-width: 0;
	}
	.hero-name {
		font-weight: 600;
		font-size: 0.95rem;
		color: var(--text-primary, #e2e8f0);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hero-meta {
		font-size: 0.75rem;
		color: var(--text-muted, #94a3b8);
		margin-top: 0.125rem;
	}
	.manual-tag {
		color: var(--accent-blue, #3b82f6);
		font-weight: 500;
	}
	.hero-action {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-shrink: 0;
	}
	.hero-action select {
		min-height: 40px;
		padding: 0.375rem 0.625rem;
		border-radius: 8px;
		border: 1px solid var(--status-color, var(--border));
		background: var(--surface, rgba(15, 23, 42, 0.6));
		color: var(--status-color, var(--text-primary));
		font-size: 0.85rem;
		font-weight: 500;
	}
	.reset-btn {
		min-width: 40px;
		min-height: 40px;
		padding: 0;
		border-radius: 8px;
		border: 1px solid var(--border, rgba(148, 163, 184, 0.2));
		background: var(--surface, rgba(15, 23, 42, 0.6));
		color: var(--text-muted, #94a3b8);
		font-size: 1.1rem;
		cursor: pointer;
	}
	.reset-btn:hover:not(:disabled) {
		color: var(--text-primary, #e2e8f0);
	}
	.loading,
	.empty {
		text-align: center;
		padding: 2rem 1rem;
		color: var(--text-muted, #94a3b8);
		font-size: 0.9rem;
	}
</style>
