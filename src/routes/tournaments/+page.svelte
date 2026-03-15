<script lang="ts">
	import { onMount } from 'svelte';
	import { getSupabase } from '$lib/services/supabase';
	import { showToast } from '$lib/stores/toast';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	interface Tournament {
		id: string;
		code: string;
		name: string;
		max_heroes: number;
		max_plays: number;
		max_bonus: number;
		usage_count: number;
		is_active: boolean;
		require_email: boolean;
		require_name: boolean;
		require_discord: boolean;
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
	let newRequireEmail = $state(true);
	let newRequireName = $state(false);
	let newRequireDiscord = $state(false);
	let creating = $state(false);

	// Tournament code entry
	let entryCode = $state('');
	let entryLoading = $state(false);
	let entryError = $state<string | null>(null);

	function generateCode(): string {
		const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
		let code = '';
		for (let i = 0; i < 8; i++) {
			code += chars[Math.floor(Math.random() * chars.length)];
		}
		return code;
	}

	// Cache the resolved users.id so we don't look it up on every load
	let resolvedUserId = $state<string | null>(null);

	async function loadTournaments() {
		loading = true;
		try {
			const currentUser = $page.data.user;
			const sb = getSupabase();
			if (!currentUser || !sb) {
				tournaments = [];
				loading = false;
				return;
			}

			// Resolve users.id (may differ from auth user id for pre-migration users)
			if (!resolvedUserId) {
				resolvedUserId = await resolveUserId(currentUser, sb);
			}

			const { data, error } = await sb
				.from('tournaments')
				.select('*')
				.or(`creator_id.eq.${resolvedUserId},is_active.eq.true`)
				.order('created_at', { ascending: false });

			if (error) throw error;
			tournaments = (data || []) as Tournament[];
		} catch (err) {
			console.error('Failed to load tournaments:', err);
			showToast('Failed to load tournaments', 'x');
		}
		loading = false;
	}

	/**
	 * Resolve the `users.id` for the current auth user, creating the record if needed.
	 * The `tournaments.creator_id` FK points to `users.id`, which may differ from the
	 * Supabase Auth UUID for pre-migration users.
	 */
	async function resolveUserId(authUser: { id: string; email?: string; user_metadata?: Record<string, unknown> }, sb: NonNullable<ReturnType<typeof getSupabase>>): Promise<string> {
		// Look up by auth_user_id first
		const { data: byAuth } = await sb
			.from('users')
			.select('id')
			.eq('auth_user_id', authUser.id)
			.maybeSingle();
		if (byAuth) return byAuth.id;

		// Fallback: look up by email and link
		if (authUser.email) {
			const { data: byEmail } = await sb
				.from('users')
				.select('id')
				.eq('email', authUser.email)
				.maybeSingle();
			if (byEmail) {
				await sb
					.from('users')
					.update({ auth_user_id: authUser.id })
					.eq('id', byEmail.id);
				return byEmail.id;
			}
		}

		// No record at all — create one using the auth UUID as the primary key
		const googleId =
			(authUser.user_metadata?.provider_id as string) || authUser.id;
		const { data: created, error } = await sb
			.from('users')
			.insert({
				id: authUser.id,
				auth_user_id: authUser.id,
				google_id: googleId,
				email: authUser.email ?? '',
				name: (authUser.user_metadata?.full_name as string) || authUser.email?.split('@')[0] || 'User'
			})
			.select('id')
			.single();
		if (error) throw error;
		return created.id;
	}

	async function createTournament() {
		if (!newName.trim() || !newCode.trim()) {
			showToast('Name and code are required', 'x');
			return;
		}
		const currentUser = $page.data.user;
		if (!currentUser) {
			showToast('Sign in required', 'x');
			return;
		}

		creating = true;
		try {
			const sb = getSupabase();
			if (!sb) { showToast('Service unavailable', 'x'); creating = false; return; }
			const usersTableId = resolvedUserId ?? await resolveUserId(currentUser, sb);
			resolvedUserId = usersTableId;
			const { error } = await sb.from('tournaments').insert({
				creator_id: usersTableId,
				code: newCode.toUpperCase(),
				name: newName.trim(),
				max_heroes: newMaxHeroes,
				max_plays: newMaxPlays,
				max_bonus: newMaxBonus,
				require_email: newRequireEmail,
				require_name: newRequireName,
				require_discord: newRequireDiscord,
				is_active: true,
				usage_count: 0
			});
			if (error) throw error;
			showToast('Tournament created!', 'check');
			showCreate = false;
			newName = '';
			newCode = generateCode();
			newRequireEmail = true;
			newRequireName = false;
			newRequireDiscord = false;
			await loadTournaments();
		} catch (err: unknown) {
			const errObj = err as Record<string, unknown>;
			const msg = errObj?.message || (err instanceof Error ? err.message : String(err));
			console.error('Tournament creation failed:', err);
			showToast(`Failed to create tournament: ${msg}`, 'x');
		}
		creating = false;
	}

	async function toggleActive(tournament: Tournament) {
		try {
			const sb = getSupabase();
			if (!sb) return;
			const { error } = await sb
				.from('tournaments')
				.update({ is_active: !tournament.is_active })
				.eq('id', tournament.id);
			if (error) throw error;
			tournament.is_active = !tournament.is_active;
			tournaments = [...tournaments];
		} catch (err) {
			console.error('Failed to toggle tournament active state:', err);
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

	async function enterTournament() {
		const code = entryCode.trim().toUpperCase();
		if (code.length !== 8) {
			entryError = 'Code must be 8 characters';
			return;
		}
		entryLoading = true;
		entryError = null;
		try {
			const res = await fetch(`/api/tournament/${encodeURIComponent(code)}`);
			if (!res.ok) {
				entryError = res.status === 404 ? 'Tournament not found' : 'Failed to look up tournament';
				return;
			}
			goto(`/tournaments/enter?code=${code}`);
		} catch {
			entryError = 'Network error';
		} finally {
			entryLoading = false;
		}
	}

	const myTournaments = $derived(
		tournaments.filter((t) => resolvedUserId && t.creator_id === resolvedUserId)
	);

	const otherTournaments = $derived(
		tournaments.filter((t) => !resolvedUserId || t.creator_id !== resolvedUserId)
	);

	onMount(() => {
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

	<!-- Enter tournament by code -->
	<div class="enter-section">
		<h2>Enter a Tournament</h2>
		<form class="enter-form" onsubmit={(e) => { e.preventDefault(); enterTournament(); }}>
			<input
				type="text"
				class="code-entry-input"
				bind:value={entryCode}
				placeholder="ABCD1234"
				maxlength="8"
				autocapitalize="characters"
				spellcheck="false"
			/>
			<button type="submit" class="enter-btn" disabled={entryLoading || entryCode.trim().length !== 8}>
				{entryLoading ? 'Looking up...' : 'Enter'}
			</button>
		</form>
		{#if entryError}
			<p class="entry-error">{entryError}</p>
		{/if}
	</div>

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

			<div class="requirements-section">
				<h3>Registration Requirements</h3>
				<label class="toggle-row">
					<input type="checkbox" bind:checked={newRequireEmail} disabled />
					<span>Require Email</span>
					<span class="req-hint">(always required)</span>
				</label>
				<label class="toggle-row">
					<input type="checkbox" bind:checked={newRequireName} />
					<span>Require Name</span>
				</label>
				<label class="toggle-row">
					<input type="checkbox" bind:checked={newRequireDiscord} />
					<span>Require Discord ID</span>
				</label>
			</div>

			<button class="submit-btn" onclick={createTournament} disabled={creating}>
				{creating ? 'Creating...' : 'Create Tournament'}
			</button>
		</div>
	{/if}

	{#if loading}
		<div class="loading">Loading tournaments...</div>
	{:else}
		{#if myTournaments.length > 0}
			<h2 class="section-title">My Tournaments</h2>
			<div class="tournament-list">
				{#each myTournaments as t}
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

						<div class="requirement-tags">
							{#if t.require_name}<span class="req-tag">Name required</span>{/if}
							{#if t.require_discord}<span class="req-tag">Discord required</span>{/if}
						</div>

						<div class="tournament-footer">
							<span class="usage">{t.usage_count} entries · {formatDate(t.created_at)}</span>
							<div class="footer-actions">
								<a href="/tournaments/detail?id={t.id}" class="view-btn">View Entries</a>
								<button class="toggle-btn" onclick={() => toggleActive(t)}>
									{t.is_active ? 'Deactivate' : 'Activate'}
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if otherTournaments.length > 0}
			<h2 class="section-title">Active Tournaments</h2>
			<div class="tournament-list">
				{#each otherTournaments as t}
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
							<span class="usage">{t.usage_count} entries · {formatDate(t.created_at)}</span>
							<a href="/tournaments/enter?code={t.code}" class="enter-link">Enter</a>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if tournaments.length === 0}
			<div class="empty">
				<p>No tournaments yet.</p>
			</div>
		{/if}
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

	/* Enter section */
	.enter-section {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
		margin-bottom: 1.5rem;
	}
	.enter-section h2 {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}
	.enter-form {
		display: flex;
		gap: 0.5rem;
	}
	.code-entry-input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-family: monospace;
		font-size: 1rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		text-align: center;
	}
	.enter-btn {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: none;
		background: var(--accent-primary);
		color: #fff;
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
	}
	.enter-btn:disabled { opacity: 0.5; }
	.entry-error {
		color: #ef4444;
		font-size: 0.8rem;
		margin-top: 0.5rem;
	}

	/* Create form */
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

	/* Requirements */
	.requirements-section {
		margin: 1rem 0 0.75rem;
	}
	.requirements-section h3 {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}
	.toggle-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		padding: 0.25rem 0;
		cursor: pointer;
	}
	.toggle-row input[disabled] {
		cursor: not-allowed;
	}
	.req-hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

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

	/* Tournament list */
	.section-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
		margin-top: 1rem;
	}
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
	.requirement-tags {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}
	.req-tag {
		font-size: 0.7rem;
		padding: 2px 6px;
		border-radius: 4px;
		background: rgba(59, 130, 246, 0.1);
		color: var(--accent-primary);
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
	.footer-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.view-btn {
		font-size: 0.75rem;
		color: var(--accent-primary);
		text-decoration: none;
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--accent-primary);
	}
	.view-btn:hover { background: rgba(59, 130, 246, 0.1); }
	.enter-link {
		font-size: 0.8rem;
		color: var(--accent-primary);
		text-decoration: none;
		font-weight: 600;
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
