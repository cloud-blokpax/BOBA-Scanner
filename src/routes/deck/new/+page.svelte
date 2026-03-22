<script lang="ts">
	import { goto } from '$app/navigation';
	import { createDeck, getFormatDefaults } from '$lib/services/deck-service';
	import { showToast } from '$lib/stores/toast';

	let { data } = $props();

	// ── Wizard state ────────────────────────────────────────
	let step = $state(1);
	let selectedFormatId = $state<string | null>(null);
	let deckName = $state('');
	let notes = $state('');
	let creating = $state(false);

	// ── Build requirements (editable) ───────────────────────
	let heroDeckMin = $state(60);
	let heroDeckMax = $state<number | null>(null);
	let playDeckSize = $state(30);
	let bonusPlaysMax = $state(25);
	let hotDogDeckSize = $state(10);
	let dbsCap = $state<number | null>(1000);
	let specPowerCap = $state<number | null>(null);
	let combinedPowerCap = $state<number | null>(null);

	const isCustom = $derived(selectedFormatId === 'custom');

	const selectedFormat = $derived(
		selectedFormatId && selectedFormatId !== 'custom'
			? data.formats.find(f => f.id === selectedFormatId)
			: null
	);

	function selectFormat(formatId: string) {
		selectedFormatId = formatId;

		if (formatId === 'custom') {
			heroDeckMin = 60;
			heroDeckMax = null;
			playDeckSize = 30;
			bonusPlaysMax = 25;
			hotDogDeckSize = 10;
			dbsCap = 1000;
			specPowerCap = null;
			combinedPowerCap = null;
			deckName = '';
		} else {
			const fmt = data.formats.find(f => f.id === formatId);
			if (fmt) {
				heroDeckMin = fmt.heroDeckMin;
				heroDeckMax = fmt.heroDeckMax;
				playDeckSize = fmt.playDeckSize;
				bonusPlaysMax = fmt.maxBonusPlays;
				hotDogDeckSize = fmt.hotDogDeckSize;
				dbsCap = fmt.dbsCap;
				specPowerCap = fmt.specPowerCap;
				combinedPowerCap = fmt.combinedPowerCap;
				deckName = `My ${fmt.name} Deck`;
			}
		}

		step = 2;
	}

	function formatDisplayName(): string {
		if (isCustom) return 'Custom';
		return selectedFormat?.name || 'Unknown';
	}

	async function handleCreate() {
		if (!selectedFormatId || !deckName.trim()) return;
		creating = true;

		const deckId = await createDeck({
			name: deckName.trim(),
			format_id: selectedFormatId,
			is_custom_format: isCustom,
			notes: notes.trim() || undefined,
			hero_deck_min: heroDeckMin,
			hero_deck_max: heroDeckMax,
			play_deck_size: playDeckSize,
			bonus_plays_max: bonusPlaysMax,
			hot_dog_deck_size: hotDogDeckSize,
			dbs_cap: dbsCap ?? 1000,
			spec_power_cap: specPowerCap,
			combined_power_cap: combinedPowerCap
		});

		if (deckId) {
			showToast('Deck created!', 'check');
			goto(`/deck/${deckId}`);
		} else {
			showToast('Failed to create deck', 'error');
			creating = false;
		}
	}

	function parseNullableInt(val: string): number | null {
		if (!val.trim()) return null;
		const n = parseInt(val, 10);
		return isNaN(n) ? null : n;
	}
</script>

<svelte:head>
	<title>Create Deck | BOBA Scanner</title>
</svelte:head>

<div class="wizard-page">
	<div class="wizard-header">
		<a href="/deck" class="back-link">&larr; My Decks</a>
		<h1>Create New Deck</h1>
		<div class="step-indicator">Step {step} of 3</div>
	</div>

	<!-- Step 1: Choose Format -->
	{#if step === 1}
		<div class="step-content">
			<h2>Choose a Format</h2>
			<div class="format-grid">
				{#each data.formats as fmt}
					<button
						class="format-card"
						class:selected={selectedFormatId === fmt.id}
						onclick={() => selectFormat(fmt.id)}
					>
						<div class="format-card-name">{fmt.name}</div>
						<div class="format-card-desc">{fmt.description}</div>
					</button>
				{/each}
				<button
					class="format-card"
					class:selected={selectedFormatId === 'custom'}
					onclick={() => selectFormat('custom')}
				>
					<div class="format-card-name">Custom</div>
					<div class="format-card-desc">Set your own deck building rules and constraints.</div>
				</button>
			</div>
		</div>
	{/if}

	<!-- Step 2: Configure & Name -->
	{#if step === 2}
		<div class="step-content">
			<h2>Configure Your Deck</h2>

			<div class="form-group">
				<label for="deck-name">Deck Name</label>
				<input
					id="deck-name"
					type="text"
					bind:value={deckName}
					placeholder={isCustom ? 'My Custom Deck' : `My ${formatDisplayName()} Deck`}
					class="form-input"
				/>
			</div>

			<div class="form-group">
				<label for="deck-notes">Notes</label>
				<textarea
					id="deck-notes"
					bind:value={notes}
					placeholder="Tournament notes, strategy reminders..."
					class="form-input form-textarea"
					rows="4"
				></textarea>
			</div>

			<h3 class="section-title">Build Requirements</h3>

			<div class="requirements-grid">
				<div class="req-field">
					<label for="hero-min">Heroes Required</label>
					<input id="hero-min" type="number" bind:value={heroDeckMin} class="form-input req-input" placeholder={selectedFormat?.heroDeckMin?.toString() || '60'} />
				</div>
				<div class="req-field">
					<label for="hero-max">Heroes Maximum</label>
					<input id="hero-max" type="text" value={heroDeckMax?.toString() ?? ''} oninput={(e) => heroDeckMax = parseNullableInt((e.target as HTMLInputElement).value)} class="form-input req-input" placeholder={selectedFormat?.heroDeckMax?.toString() || 'No max'} />
				</div>
				<div class="req-field">
					<label for="play-size">Play Cards</label>
					<input id="play-size" type="number" bind:value={playDeckSize} class="form-input req-input" placeholder={selectedFormat?.playDeckSize?.toString() || '30'} />
				</div>
				<div class="req-field">
					<label for="bonus-max">Bonus Plays Max</label>
					<input id="bonus-max" type="number" bind:value={bonusPlaysMax} class="form-input req-input" placeholder={selectedFormat?.maxBonusPlays?.toString() || '25'} />
				</div>
				<div class="req-field">
					<label for="hot-dog-size">Hot Dog Cards</label>
					<input id="hot-dog-size" type="number" bind:value={hotDogDeckSize} class="form-input req-input" placeholder={selectedFormat?.hotDogDeckSize?.toString() || '10'} />
				</div>
				<div class="req-field">
					<label for="dbs-cap">DBS Cap</label>
					<input id="dbs-cap" type="text" value={dbsCap?.toString() ?? ''} oninput={(e) => dbsCap = parseNullableInt((e.target as HTMLInputElement).value)} class="form-input req-input" placeholder={selectedFormat?.dbsCap?.toString() || 'No cap'} />
				</div>
				<div class="req-field">
					<label for="spec-cap">SPEC Power Cap</label>
					<input id="spec-cap" type="text" value={specPowerCap?.toString() ?? ''} oninput={(e) => specPowerCap = parseNullableInt((e.target as HTMLInputElement).value)} class="form-input req-input" placeholder={selectedFormat?.specPowerCap?.toString() || 'No cap'} />
				</div>
				<div class="req-field">
					<label for="cp-cap">Combined Power Cap</label>
					<input id="cp-cap" type="text" value={combinedPowerCap?.toString() ?? ''} oninput={(e) => combinedPowerCap = parseNullableInt((e.target as HTMLInputElement).value)} class="form-input req-input" placeholder={selectedFormat?.combinedPowerCap?.toString() || 'No cap'} />
				</div>
			</div>

			<div class="step-actions">
				<button class="btn-back" onclick={() => step = 1}>Back</button>
				<button class="btn-next" onclick={() => { if (!deckName.trim()) deckName = `My ${formatDisplayName()} Deck`; step = 3; }}>Review</button>
			</div>
		</div>
	{/if}

	<!-- Step 3: Confirm -->
	{#if step === 3}
		<div class="step-content">
			<h2>Review & Create</h2>

			<div class="summary-card">
				<div class="summary-row">
					<span class="summary-label">Deck Name</span>
					<span class="summary-value">{deckName}</span>
				</div>
				<div class="summary-row">
					<span class="summary-label">Format</span>
					<span class="summary-value">{formatDisplayName()}</span>
				</div>
				{#if notes.trim()}
					<div class="summary-row">
						<span class="summary-label">Notes</span>
						<span class="summary-value summary-notes">{notes}</span>
					</div>
				{/if}
				<div class="summary-divider"></div>
				<div class="summary-row">
					<span class="summary-label">Heroes</span>
					<span class="summary-value">{heroDeckMin}{heroDeckMax ? ` - ${heroDeckMax}` : ''}</span>
				</div>
				<div class="summary-row">
					<span class="summary-label">Play Cards</span>
					<span class="summary-value">{playDeckSize} + {bonusPlaysMax} bonus</span>
				</div>
				<div class="summary-row">
					<span class="summary-label">Hot Dogs</span>
					<span class="summary-value">{hotDogDeckSize}</span>
				</div>
				<div class="summary-row">
					<span class="summary-label">DBS Cap</span>
					<span class="summary-value">{dbsCap ?? 'None'}</span>
				</div>
				{#if specPowerCap}
					<div class="summary-row">
						<span class="summary-label">SPEC Power Cap</span>
						<span class="summary-value">{specPowerCap}</span>
					</div>
				{/if}
				{#if combinedPowerCap}
					<div class="summary-row">
						<span class="summary-label">Combined Power Cap</span>
						<span class="summary-value">{combinedPowerCap}</span>
					</div>
				{/if}
			</div>

			<div class="step-actions">
				<button class="btn-back" onclick={() => step = 2}>Back</button>
				<button class="btn-create" onclick={handleCreate} disabled={creating}>
					{creating ? 'Creating...' : 'Start Building'}
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.wizard-page {
		max-width: 700px;
		margin: 0 auto;
		padding: 1rem;
	}

	.wizard-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.back-link {
		color: var(--text-secondary, #94a3b8);
		text-decoration: none;
		font-size: 0.9rem;
	}

	.back-link:hover { color: var(--text-primary, #f1f5f9); }

	.wizard-header h1 {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-primary, #f1f5f9);
		flex: 1;
	}

	.step-indicator {
		font-size: 0.8rem;
		color: var(--text-tertiary, #64748b);
	}

	.step-content h2 {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--text-primary, #f1f5f9);
		margin-bottom: 1rem;
	}

	/* Format grid */
	.format-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
	}

	@media (min-width: 500px) {
		.format-grid { grid-template-columns: 1fr 1fr; }
	}

	.format-card {
		padding: 0.875rem;
		border-radius: 10px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--bg-surface, #0d1524);
		cursor: pointer;
		text-align: left;
		transition: border-color 0.15s;
	}

	.format-card:hover { border-color: var(--accent-primary, #3b82f6); }

	.format-card.selected {
		border-color: var(--accent-primary, #3b82f6);
		background: rgba(59, 130, 246, 0.08);
	}

	.format-card-name {
		font-weight: 600;
		color: var(--text-primary, #f1f5f9);
		margin-bottom: 0.25rem;
	}

	.format-card-desc {
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
		line-height: 1.3;
	}

	/* Form */
	.form-group { margin-bottom: 1rem; }

	.form-group label {
		display: block;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-secondary, #94a3b8);
		margin-bottom: 0.375rem;
	}

	.form-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #f1f5f9);
		font-size: 0.9rem;
	}

	.form-input:focus { outline: none; border-color: var(--accent-primary, #3b82f6); }

	.form-textarea { resize: vertical; font-family: inherit; }

	.section-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text-secondary, #94a3b8);
		margin: 1.25rem 0 0.75rem;
	}

	.requirements-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.req-field label {
		display: block;
		font-size: 0.8rem;
		color: var(--text-tertiary, #64748b);
		margin-bottom: 0.25rem;
	}

	.req-input {
		width: 100%;
		padding: 0.4rem 0.625rem;
		border-radius: 6px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #f1f5f9);
		font-size: 0.85rem;
	}

	.req-input:focus { outline: none; border-color: var(--accent-primary, #3b82f6); }

	/* Step actions */
	.step-actions {
		display: flex;
		justify-content: space-between;
		margin-top: 1.5rem;
	}

	.btn-back {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		border: 1px solid var(--border-color, #1e293b);
		background: transparent;
		color: var(--text-secondary, #94a3b8);
		cursor: pointer;
	}

	.btn-next, .btn-create {
		padding: 0.5rem 1.25rem;
		border-radius: 6px;
		border: none;
		background: var(--accent-primary, #3b82f6);
		color: white;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-create:disabled { opacity: 0.5; cursor: not-allowed; }

	/* Summary card */
	.summary-card {
		border-radius: 10px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--bg-surface, #0d1524);
		padding: 1rem;
	}

	.summary-row {
		display: flex;
		justify-content: space-between;
		padding: 0.375rem 0;
	}

	.summary-label {
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
	}

	.summary-value {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-primary, #f1f5f9);
	}

	.summary-notes {
		max-width: 60%;
		text-align: right;
		white-space: pre-line;
	}

	.summary-divider {
		height: 1px;
		background: var(--border-color, #1e293b);
		margin: 0.5rem 0;
	}
</style>
