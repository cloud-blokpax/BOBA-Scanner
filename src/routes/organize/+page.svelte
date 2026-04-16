<script lang="ts">
	import { goto } from '$app/navigation';
	import { getFormat, getFormatOptions } from '$lib/data/tournament-formats';
	import { showToast } from '$lib/stores/toast.svelte';

	const { data } = $props();

	const formatOptions = getFormatOptions();

	// Form state
	let name = $state('');
	let deckType = $state<'constructed' | 'sealed'>('sealed');
	let formatId = $state('apex_playmaker');
	let description = $state('');
	let venue = $state('');
	let eventDate = $state('');
	let maxPlayers = $state('');
	let deadlineMode = $state<'manual' | 'datetime' | 'both'>('manual');
	let submissionDeadline = $state('');
	let requireName = $state(false);
	let requireDiscord = $state(false);
	let creating = $state(false);

	// Deck size fields — default from format, editable by organizer
	let maxHeroes = $state(40);
	let maxPlays = $state(20);
	let maxBonus = $state(0);

	// Auto-populate deck sizes when format or deck type changes
	$effect(() => {
		const format = getFormat(formatId);
		if (format) {
			if (deckType === 'sealed') {
				// Sealed defaults: smaller deck from limited card pool
				maxHeroes = 40;
				maxPlays = 20;
				maxBonus = 0;
			} else {
				// Constructed: use format's official rules
				maxHeroes = format.heroDeckMin;
				maxPlays = format.playDeckSize;
				maxBonus = format.bonusPlaysAllowed ? format.maxBonusPlays : 0;
			}
		}
	});

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
					deck_type: deckType,
					format_id: formatId,
					description: description.trim() || null,
					venue: venue.trim() || null,
					event_date: eventDate || null,
					max_heroes: maxHeroes,
					max_plays: maxPlays,
					max_bonus: maxBonus,
					max_players: maxPlayers ? parseInt(maxPlayers) : null,
					deadline_mode: deadlineMode,
					submission_deadline: (deadlineMode !== 'manual' && submissionDeadline)
						? new Date(submissionDeadline).toISOString()
						: null,
					require_name: requireName,
					require_discord: requireDiscord
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error || err.message || 'Failed to create tournament');
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
	<title>Organize Tournaments - Card Scanner</title>
</svelte:head>

<div class="organize-page">
	<h1>Organize Tournaments</h1>

	<section class="create-section">
		<h2>Create Tournament</h2>

		<div class="form-group">
			<label for="t-name">Tournament Name <span class="required">*</span></label>
			<input id="t-name" type="text" bind:value={name} placeholder="e.g. Weekly SPEC Showdown" maxlength="200" />
		</div>

		<fieldset class="form-group">
			<legend>Deck Type <span class="required">*</span></legend>
			<label class="radio-label">
				<input type="radio" bind:group={deckType} value="sealed" />
				Sealed
				<span class="deck-type-desc">Players scan cards from a sealed product opening</span>
			</label>
			<label class="radio-label disabled">
				<input type="radio" bind:group={deckType} value="constructed" disabled />
				Constructed
				<span class="deck-type-desc">Players build decks from their collection (coming soon)</span>
			</label>
		</fieldset>

		<div class="form-group">
			<label for="t-format">Format <span class="required">*</span></label>
			<select id="t-format" bind:value={formatId}>
				{#each formatOptions as fmt}
					<option value={fmt.id}>{fmt.name}</option>
				{/each}
				<option value="custom">Custom</option>
			</select>
		</div>

		{#if formatId !== 'custom'}
			{@const fmt = getFormat(formatId)}
			{#if fmt}
				<p class="field-hint" style="margin-top: -0.25rem;">
					{fmt.division} division · {fmt.description}
				</p>
			{/if}
		{/if}

		<div class="deck-sizes">
			<h3 class="subsection-heading">Deck Requirements</h3>
			<div class="form-row-3">
				<div class="form-group">
					<label for="t-heroes">Heroes <span class="required">*</span></label>
					<input id="t-heroes" type="number" bind:value={maxHeroes} min="1" max="120" />
				</div>
				<div class="form-group">
					<label for="t-plays">Plays <span class="required">*</span></label>
					<input id="t-plays" type="number" bind:value={maxPlays} min="0" max="60" />
				</div>
				<div class="form-group">
					<label for="t-bonus">Bonus Plays</label>
					<input id="t-bonus" type="number" bind:value={maxBonus} min="0" max="50" />
				</div>
			</div>
			<p class="field-hint">Defaults based on {deckType === 'sealed' ? 'sealed' : 'constructed'} {formatId !== 'custom' ? getFormat(formatId)?.name ?? formatId : 'custom'} format. Edit as needed.</p>
		</div>

		<div class="form-group">
			<label for="t-date">Event Date</label>
			<input id="t-date" type="date" bind:value={eventDate} />
		</div>

		<div class="form-group">
			<label for="t-venue">Venue / Location</label>
			<input id="t-venue" type="text" bind:value={venue} placeholder="Store name, city, or online" />
		</div>

		<div class="form-group">
			<label for="t-desc">Description</label>
			<textarea id="t-desc" bind:value={description} placeholder="Tournament details, rules, prizes..." rows="3"></textarea>
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

		<fieldset class="form-group">
			<legend>Player Registration Info</legend>
			<div class="reg-field-row">
				<span class="reg-field-name">Email</span>
				<span class="reg-field-badge required-badge">Required</span>
			</div>
			<label class="toggle-label">
				<input type="checkbox" bind:checked={requireName} />
				Name
				<span class="reg-field-badge optional-badge">Optional</span>
			</label>
			<label class="toggle-label">
				<input type="checkbox" bind:checked={requireDiscord} />
				Discord ID
				<span class="reg-field-badge optional-badge">Optional</span>
			</label>
			<p class="field-hint">Toggle to require name or Discord. Email is always required for communication.</p>
		</fieldset>

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
	.deck-type-desc {
		display: block;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-left: 1.5rem;
		font-weight: 400;
	}
	.radio-label.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.subsection-heading {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}
	.form-row-3 {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 0.75rem;
	}
	.deck-sizes {
		margin-bottom: 0.75rem;
		padding: 0.75rem;
		background: var(--bg-base);
		border-radius: 8px;
		border: 1px solid var(--border, rgba(148,163,184,0.10));
	}
	.field-hint {
		font-size: 0.7rem;
		color: var(--text-muted, #475569);
		margin-top: 0.375rem;
		line-height: 1.3;
	}
	.reg-field-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--text-primary);
		margin-bottom: 0.375rem;
		padding: 0.25rem 0;
	}
	.reg-field-badge {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 1px 6px;
		border-radius: 4px;
	}
	.required-badge {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}
	.optional-badge {
		background: rgba(148, 163, 184, 0.1);
		color: var(--text-muted, #475569);
	}

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
