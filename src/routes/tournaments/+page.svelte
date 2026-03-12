<script lang="ts">
	import { supabase } from '$lib/services/supabase';
	import { user } from '$lib/stores/auth';
	import { showToast } from '$lib/stores/toast';

	interface Tournament {
		id: string;
		code: string;
		name: string;
		max_heroes: number;
		max_plays: number;
		max_bonus: number;
		usage_count: number;
		is_active: boolean;
		created_at: string;
		creator_id: string;
	}

	let tournaments = $state<Tournament[]>([]);
	let loading = $state(true);
	let showCreate = $state(false);

	let newName = $state('');
	let newCode = $state('');
	let newMaxHeroes = $state(30);
	let newMaxPlays = $state(30);
	let newMaxBonus = $state(15);
	let creating = $state(false);

	function generateCode(): string {
		const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
		let code = '';
		for (let i = 0; i < 8; i++) {
			code += chars[Math.floor(Math.random() * chars.length)];
		}
		return code;
	}

	async function loadTournaments() {
		loading = true;
		try {
			const currentUser = $user;
			if (!currentUser) {
				tournaments = [];
				loading = false;
				return;
			}

			const { data, error } = await supabase
				.from('tournaments')
				.select('*')
				.or(`creator_id.eq.${currentUser.id},is_active.eq.true`)
				.order('created_at', { ascending: false });

			if (error) throw error;
			tournaments = (data || []) as Tournament[];
		} catch {
			showToast('Failed to load tournaments', 'x');
		}
		loading = false;
	}

	async function createTournament() {
		if (!newName.trim() || !newCode.trim()) {
			showToast('Name and code are required', 'x');
			return;
		}
		const currentUser = $user;
		if (!currentUser) {
			showToast('Sign in required', 'x');
			return;
		}

		creating = true;
		try {
			const { error } = await supabase.from('tournaments').insert({
				creator_id: currentUser.id,
				code: newCode.toUpperCase(),
				name: newName.trim(),
				max_heroes: newMaxHeroes,
				max_plays: newMaxPlays,
				max_bonus: newMaxBonus,
				is_active: true,
				usage_count: 0
			});
			if (error) throw error;
			showToast('Tournament created!', 'check');
			showCreate = false;
			newName = '';
			newCode = generateCode();
			await loadTournaments();
		} catch (err) {
			showToast('Failed to create tournament', 'x');
		}
		creating = false;
	}

	async function toggleActive(tournament: Tournament) {
		try {
			const { error } = await supabase
				.from('tournaments')
				.update({ is_active: !tournament.is_active })
				.eq('id', tournament.id);
			if (error) throw error;
			tournament.is_active = !tournament.is_active;
			tournaments = [...tournaments];
		} catch {
			showToast('Failed to update', 'x');
		}
	}

	async function copyCode(code: string) {
		try {
			await navigator.clipboard.writeText(code);
			showToast('Code copied', 'check');
		} catch {
			showToast('Copy failed', 'x');
		}
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	$effect(() => {
		loadTournaments();
	});

	// Init code
	newCode = generateCode();
</script>

<svelte:head>
	<title>Tournaments - BOBA Scanner</title>
</svelte:head>

<div class="tournaments-page">
	<header class="page-header">
		<h1>Tournaments</h1>
		<button class="create-btn" onclick={() => (showCreate = !showCreate)}>
			{showCreate ? 'Cancel' : '+ Create'}
		</button>
	</header>

	{#if showCreate}
		<div class="create-card">
			<div class="form-group">
				<label for="t-name">Tournament Name</label>
				<input id="t-name" type="text" bind:value={newName} placeholder="Weekly Showdown" />
			</div>

			<div class="form-group">
				<label for="t-code">Tournament Code</label>
				<div class="code-row">
					<input id="t-code" type="text" bind:value={newCode} maxlength="8" class="code-input" />
					<button class="btn-small" onclick={() => (newCode = generateCode())}>Generate</button>
				</div>
			</div>

			<div class="params-row">
				<div class="form-group">
					<label for="t-heroes">Max Heroes</label>
					<input id="t-heroes" type="number" bind:value={newMaxHeroes} min="1" max="50" />
				</div>
				<div class="form-group">
					<label for="t-plays">Max Plays</label>
					<input id="t-plays" type="number" bind:value={newMaxPlays} min="1" max="50" />
				</div>
				<div class="form-group">
					<label for="t-bonus">Max Bonus</label>
					<input id="t-bonus" type="number" bind:value={newMaxBonus} min="0" max="30" />
				</div>
			</div>

			<button class="submit-btn" onclick={createTournament} disabled={creating}>
				{creating ? 'Creating...' : 'Create Tournament'}
			</button>
		</div>
	{/if}

	{#if loading}
		<div class="loading">Loading tournaments...</div>
	{:else if tournaments.length === 0}
		<div class="empty">
			<p>No tournaments yet.</p>
		</div>
	{:else}
		<div class="tournament-list">
			{#each tournaments as t}
				<div class="tournament-card" class:inactive={!t.is_active}>
					<div class="tournament-header">
						<div>
							<div class="tournament-name">{t.name}</div>
							<button class="tournament-code" onclick={() => copyCode(t.code)}>
								{t.code}
							</button>
						</div>
						<span class="status-badge" class:active={t.is_active}>
							{t.is_active ? 'Active' : 'Inactive'}
						</span>
					</div>

					<div class="tournament-meta">
						<span>Heroes: {t.max_heroes}</span>
						<span>Plays: {t.max_plays}</span>
						<span>Bonus: {t.max_bonus}</span>
					</div>

					<div class="tournament-footer">
						<span class="usage">{t.usage_count} uses · {formatDate(t.created_at)}</span>
						{#if $user && t.creator_id === $user.id}
							<button class="toggle-btn" onclick={() => toggleActive(t)}>
								{t.is_active ? 'Deactivate' : 'Activate'}
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.tournaments-page {
		max-width: 600px;
		margin: 0 auto;
		padding: 1rem;
	}
	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}
	h1 { font-size: 1.5rem; font-weight: 700; }
	.create-btn {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-primary);
		font-size: 0.85rem;
		cursor: pointer;
	}
	.create-card {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}
	.form-group {
		margin-bottom: 0.75rem;
	}
	.form-group label {
		display: block;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 4px;
	}
	.form-group input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.9rem;
	}
	.code-row {
		display: flex;
		gap: 0.5rem;
	}
	.code-input {
		flex: 1;
		font-family: monospace;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.btn-small {
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-primary);
		font-size: 0.85rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.params-row {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 0.75rem;
	}
	.params-row input { text-align: center; }
	.submit-btn {
		width: 100%;
		padding: 0.75rem;
		border-radius: 10px;
		border: none;
		background: var(--accent-primary);
		color: #fff;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		margin-top: 0.5rem;
	}
	.submit-btn:disabled { opacity: 0.6; }
	.loading, .empty {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}
	.tournament-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.tournament-card {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
	}
	.tournament-card.inactive { opacity: 0.6; }
	.tournament-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 0.5rem;
	}
	.tournament-name { font-weight: 600; font-size: 1rem; }
	.tournament-code {
		background: var(--bg-base);
		border: none;
		border-radius: 4px;
		padding: 2px 8px;
		font-family: monospace;
		font-size: 0.85rem;
		color: var(--accent-primary);
		cursor: pointer;
		letter-spacing: 0.05em;
		margin-top: 4px;
	}
	.tournament-code:hover { background: var(--bg-hover); }
	.status-badge {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 4px;
		background: var(--bg-hover);
		color: var(--text-secondary);
	}
	.status-badge.active {
		background: #22c55e20;
		color: #22c55e;
	}
	.tournament-meta {
		display: flex;
		gap: 1rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}
	.tournament-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.usage {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}
	.toggle-btn {
		background: none;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 0.25rem 0.625rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.toggle-btn:hover { background: var(--bg-hover); }
</style>
