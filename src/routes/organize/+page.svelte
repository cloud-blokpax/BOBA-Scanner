<script lang="ts">
	import { goto } from '$app/navigation';
	import { getFormatOptions } from '$lib/data/tournament-formats';
	import { showToast } from '$lib/stores/toast.svelte';

	const { data } = $props();

	const formatOptions = getFormatOptions();

	// Form state
	let name = $state('');
	let formatId = $state('apex_playmaker');
	let description = $state('');
	let venue = $state('');
	let eventDate = $state('');
	let entryFee = $state('');
	let prizePool = $state('');
	let maxPlayers = $state('');
	let deadlineMode = $state<'manual' | 'datetime' | 'both'>('manual');
	let submissionDeadline = $state('');
	let requireDiscord = $state(false);
	let creating = $state(false);

	async function createTournament() {
		if (!name.trim()) {
			showToast('Tournament name is required', 'x');
			return;
		}
		creating = true;
		try {
			const res = await fetch('/api/organize/create', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					format_id: formatId,
					description: description.trim() || null,
					venue: venue.trim() || null,
					event_date: eventDate || null,
					entry_fee: entryFee.trim() || null,
					prize_pool: prizePool.trim() || null,
					max_players: maxPlayers ? parseInt(maxPlayers) : null,
					deadline_mode: deadlineMode,
					submission_deadline: (deadlineMode !== 'manual' && submissionDeadline)
						? new Date(submissionDeadline).toISOString()
						: null,
					require_discord: requireDiscord
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message || 'Failed to create tournament');
			}
			const result = await res.json();
			showToast('Tournament created!', 'check');
			goto(`/organize/${result.tournament.code}`);
		} catch (err) {
			showToast(err instanceof Error ? err.message : 'Failed to create tournament', 'x');
		}
		creating = false;
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short', day: 'numeric', year: 'numeric'
		});
	}

	function getSubmissionCount(t: Record<string, unknown>): number {
		const subs = t.deck_submissions as Array<{ count: number }> | undefined;
		return subs?.[0]?.count ?? 0;
	}

	function isOpen(t: Record<string, unknown>): boolean {
		if (t.registration_closed) return false;
		if (t.submission_deadline) {
			return new Date(t.submission_deadline as string) > new Date();
		}
		return t.is_active as boolean;
	}
</script>

<svelte:head>
	<title>Organize Tournaments - BOBA Scanner</title>
</svelte:head>

<div class="organize-page">
	<h1>Organize Tournaments</h1>

	<section class="create-section">
		<h2>Create Tournament</h2>

		<div class="form-group">
			<label for="t-name">Tournament Name <span class="required">*</span></label>
			<input id="t-name" type="text" bind:value={name} placeholder="e.g. Weekly SPEC Showdown" maxlength="200" />
		</div>

		<div class="form-group">
			<label for="t-format">Format <span class="required">*</span></label>
			<select id="t-format" bind:value={formatId}>
				{#each formatOptions as fmt}
					<option value={fmt.id}>{fmt.name}</option>
				{/each}
				<option value="custom">Custom</option>
			</select>
		</div>

		<div class="form-row">
			<div class="form-group">
				<label for="t-date">Event Date</label>
				<input id="t-date" type="date" bind:value={eventDate} />
			</div>
			<div class="form-group">
				<label for="t-venue">Venue</label>
				<input id="t-venue" type="text" bind:value={venue} placeholder="Location" />
			</div>
		</div>

		<div class="form-group">
			<label for="t-desc">Description</label>
			<textarea id="t-desc" bind:value={description} placeholder="Tournament details..." rows="3"></textarea>
		</div>

		<div class="form-row">
			<div class="form-group">
				<label for="t-fee">Entry Fee</label>
				<input id="t-fee" type="text" bind:value={entryFee} placeholder="$25 or Free" />
			</div>
			<div class="form-group">
				<label for="t-prize">Prize Pool</label>
				<input id="t-prize" type="text" bind:value={prizePool} placeholder="$500 cash" />
			</div>
		</div>

		<div class="form-group">
			<label for="t-max">Max Players</label>
			<input id="t-max" type="number" bind:value={maxPlayers} placeholder="No limit" min="2" />
		</div>

		<fieldset class="form-group">
			<legend>Registration Deadline</legend>
			<label class="radio-label">
				<input type="radio" bind:group={deadlineMode} value="manual" />
				I'll close registration manually
			</label>
			<label class="radio-label">
				<input type="radio" bind:group={deadlineMode} value="datetime" />
				Set a specific deadline
			</label>
			<label class="radio-label">
				<input type="radio" bind:group={deadlineMode} value="both" />
				Both — auto-close at deadline, but I can close early
			</label>
			{#if deadlineMode !== 'manual'}
				<input
					type="datetime-local"
					bind:value={submissionDeadline}
					class="deadline-input"
				/>
			{/if}
		</fieldset>

		<label class="toggle-label">
			<input type="checkbox" bind:checked={requireDiscord} />
			Require Discord ID
		</label>

		<button class="primary-btn" onclick={createTournament} disabled={creating || !name.trim()}>
			{creating ? 'Creating...' : 'Create Tournament'}
		</button>
	</section>

	<section class="my-tournaments">
		<h2>My Tournaments</h2>
		{#if data.tournaments.length === 0}
			<p class="empty">No tournaments created yet.</p>
		{:else}
			<div class="tournament-list">
				{#each data.tournaments as t}
					<a href="/organize/{t.code}" class="tournament-row">
						<div class="t-info">
							<span class="t-name">{t.name}</span>
							<span class="t-code">{t.code}</span>
						</div>
						<div class="t-meta">
							{#if t.event_date}
								<span>{formatDate(t.event_date as string)}</span>
							{/if}
							{#if t.format_id}
								<span class="t-format">{t.format_id}</span>
							{/if}
							<span class="t-subs">{getSubmissionCount(t)} submissions</span>
							<span class="t-status" class:open={isOpen(t)} class:closed={!isOpen(t)}>
								{isOpen(t) ? 'Open' : 'Closed'}
							</span>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.organize-page {
		max-width: 640px;
		margin: 0 auto;
		padding: 1rem;
	}
	h1 {
		font-size: 1.4rem;
		font-weight: 700;
		margin-bottom: 1.5rem;
	}
	h2 {
		font-size: 1.1rem;
		font-weight: 700;
		margin-bottom: 1rem;
	}
	.create-section {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1.25rem;
		margin-bottom: 2rem;
	}
	.form-group {
		margin-bottom: 0.75rem;
	}
	.form-group label, .form-group legend {
		display: block;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 4px;
	}
	fieldset {
		border: none;
		padding: 0;
		margin: 0;
	}
	.required { color: #ef4444; }
	.form-group input[type="text"],
	.form-group input[type="number"],
	.form-group input[type="date"],
	.form-group input[type="datetime-local"],
	.form-group textarea,
	.form-group select {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.9rem;
	}
	.form-group textarea {
		resize: vertical;
	}
	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	.radio-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--text-primary);
		margin-bottom: 0.375rem;
		cursor: pointer;
	}
	.radio-label input[type="radio"] {
		accent-color: var(--accent-primary);
	}
	.deadline-input {
		margin-top: 0.5rem;
	}
	.toggle-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--text-primary);
		margin-bottom: 1rem;
		cursor: pointer;
	}
	.primary-btn {
		width: 100%;
		padding: 0.75rem;
		border-radius: 10px;
		border: none;
		background: var(--accent-primary);
		color: #fff;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
	}
	.primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }

	/* My Tournaments */
	.my-tournaments { margin-bottom: 2rem; }
	.empty {
		text-align: center;
		color: var(--text-tertiary);
		padding: 2rem;
	}
	.tournament-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.tournament-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem;
		background: var(--bg-elevated);
		border-radius: 10px;
		text-decoration: none;
		color: var(--text-primary);
		gap: 0.75rem;
	}
	.tournament-row:hover {
		background: var(--bg-hover);
	}
	.t-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.t-name {
		font-weight: 600;
		font-size: 0.9rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.t-code {
		font-family: monospace;
		font-size: 0.75rem;
		padding: 1px 6px;
		border-radius: 4px;
		background: var(--bg-base);
		color: var(--accent-primary);
		flex-shrink: 0;
	}
	.t-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
		flex-shrink: 0;
	}
	.t-format {
		padding: 1px 6px;
		border-radius: 4px;
		background: var(--bg-base);
	}
	.t-status {
		padding: 1px 8px;
		border-radius: 4px;
		font-weight: 600;
	}
	.t-status.open { background: #16a34a20; color: #16a34a; }
	.t-status.closed { background: #ef444420; color: #ef4444; }
</style>
