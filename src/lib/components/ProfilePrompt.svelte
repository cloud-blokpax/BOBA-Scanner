<script lang="ts">
	import { getSupabase } from '$lib/services/supabase';
	import { user } from '$lib/stores/auth.svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import { loadPersona, type PersonaId } from '$lib/stores/persona.svelte';

	const personaOptions: { id: PersonaId; icon: string; name: string; description: string }[] = [
		{
			id: 'collector',
			icon: '\u{1F4E6}',
			name: 'Collector',
			description: 'I scan cards, track my collection, and watch prices'
		},
		{
			id: 'deck_builder',
			icon: '\u{1F3D7}',
			name: 'Deck Builder',
			description: 'I build decks, optimize playbooks, and brew strategies'
		},
		{
			id: 'seller',
			icon: '\u{1F4B0}',
			name: 'Seller',
			description: 'I sell cards on eBay and need pricing & listing tools'
		},
		{
			id: 'tournament',
			icon: '\u{1F3C6}',
			name: 'Tournament Player',
			description: 'I compete in tournaments and submit decks'
		}
	];

	let visible = $state(false);
	let step = $state<1 | 2>(1);
	let profileName = $state('');
	let discordId = $state('');
	let selectedPersonas = $state<PersonaId[]>([]);
	let saving = $state(false);
	let checkedForUserId = $state<string | null>(null);

	$effect(() => {
		const currentUser = user();
		if (!currentUser) return;
		if (checkedForUserId === currentUser.id) return;
		checkedForUserId = currentUser.id;
		checkProfile(currentUser.id);
	});

	async function checkProfile(authUserId: string) {
		// Don't show if dismissed within the last 30 days
		try {
			const dismissedAt = localStorage.getItem('profilePromptDismissedAt');
			if (dismissedAt) {
				const elapsed = Date.now() - Number(dismissedAt);
				const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
				if (elapsed < THIRTY_DAYS) return;
			}
		} catch (err) {
			console.debug('[profile-prompt] localStorage read failed:', err);
		}

		const client = getSupabase();
		if (!client) return;
		try {
			const { data } = await client
				.from('users')
				.select('name, discord_id, persona')
				.eq('auth_user_id', authUserId)
				.single();

			// Show prompt if user has no name and no discord_id set
			if (data && !data.name && !data.discord_id) {
				visible = true;
				step = 1;
			}
		} catch (err) {
			console.debug('[profile-prompt] Profile check failed:', err);
		}
	}

	function togglePersona(id: PersonaId) {
		if (selectedPersonas.includes(id)) {
			selectedPersonas = selectedPersonas.filter((p) => p !== id);
		} else {
			selectedPersonas = [...selectedPersonas, id];
		}
	}

	function goToStep2() {
		step = 2;
	}

	async function save() {
		const currentUser = user();
		if (!currentUser) return;
		const client = getSupabase();
		if (!client) return;

		saving = true;
		try {
			// Build persona weights
			const weights: Record<string, number> = {
				collector: 0,
				deck_builder: 0,
				seller: 0,
				tournament: 0
			};
			const selected = selectedPersonas.length > 0 ? selectedPersonas : ['collector'];
			for (const id of selected) weights[id] = 1.0;

			const { error } = await client
				.from('users')
				.update({
					name: profileName.trim() || null,
					discord_id: discordId.trim() || null,
					persona: weights
				} as Record<string, unknown>)
				.eq('auth_user_id', currentUser.id);

			if (error) throw error;
			showToast('Profile updated', 'check');
			// Reload persona store with new weights
			await loadPersona();
		} catch (err) {
			console.debug('[ProfilePrompt] Profile save failed:', err);
			showToast('Failed to save', 'x');
		}
		visible = false;
		saving = false;
	}

	function dismiss() {
		visible = false;
		try {
			localStorage.setItem('profilePromptDismissedAt', Date.now().toString());
		} catch (err) {
			console.debug('[profile-prompt] localStorage write failed:', err);
		}
	}
</script>

{#if visible}
	<div class="prompt-overlay" role="presentation" onkeydown={(e) => e.key === 'Escape' && dismiss()}>
		<button class="overlay-dismiss" type="button" aria-label="Close" tabindex="-1" onclick={dismiss}></button>
		<div class="prompt-card">
			{#if step === 1}
				<h2>Complete Your Profile</h2>
				<p class="prompt-desc">Add your name and Discord ID so tournament organizers can reach you. Both are optional.</p>

				<div class="form-group">
					<label for="pp-name">Name</label>
					<input id="pp-name" type="text" bind:value={profileName} placeholder="Your name" />
				</div>

				<div class="form-group">
					<label for="pp-discord">Discord ID</label>
					<input id="pp-discord" type="text" bind:value={discordId} placeholder="username#1234" />
				</div>

				<div class="prompt-actions">
					<button class="save-btn" onclick={goToStep2}>Next</button>
					<button class="skip-btn" onclick={dismiss}>Skip for now</button>
				</div>
			{:else}
				<h2>How do you use BoBA cards?</h2>
				<p class="prompt-desc">This personalizes your home screen. Select all that apply.</p>

				<div class="persona-grid">
					{#each personaOptions as p}
						<button
							class="persona-card"
							class:selected={selectedPersonas.includes(p.id)}
							onclick={() => togglePersona(p.id)}
							type="button"
						>
							<span class="persona-icon">{p.icon}</span>
							<div class="persona-text">
								<span class="persona-name">{p.name}</span>
								<span class="persona-desc">{p.description}</span>
							</div>
						</button>
					{/each}
				</div>
				<p class="persona-hint">You can change this anytime in Settings</p>

				<div class="prompt-actions">
					<button class="save-btn" onclick={save} disabled={saving}>
						{saving ? 'Saving...' : 'Save'}
					</button>
					<button class="skip-btn" onclick={() => { step = 1; }}>Back</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.prompt-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}
	.overlay-dismiss {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.6);
		border: none;
		appearance: none;
		cursor: default;
	}
	.prompt-card {
		background: var(--bg-elevated);
		border-radius: 16px;
		padding: 1.5rem;
		max-width: 420px;
		width: 100%;
		position: relative;
		z-index: 1;
	}
	.prompt-card h2 {
		font-size: 1.15rem;
		font-weight: 700;
		margin-bottom: 0.5rem;
	}
	.prompt-desc {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 1rem;
		line-height: 1.4;
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
	.prompt-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 1rem;
	}
	.save-btn {
		padding: 0.75rem;
		border-radius: 10px;
		border: none;
		background: var(--accent-primary);
		color: #fff;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
	}
	.save-btn:disabled { opacity: 0.6; }
	.skip-btn {
		padding: 0.5rem;
		border: none;
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.85rem;
		cursor: pointer;
	}
	.skip-btn:hover { color: var(--text-primary); }

	/* Persona picker */
	.persona-grid {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.persona-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		border-radius: 10px;
		border: 2px solid var(--border-color, rgba(148,163,184,0.15));
		background: var(--bg-base);
		cursor: pointer;
		text-align: left;
		transition: border-color 0.15s, background 0.15s;
	}
	.persona-card:hover {
		border-color: var(--text-secondary);
	}
	.persona-card.selected {
		border-color: var(--accent-primary, #3b82f6);
		background: rgba(59, 130, 246, 0.08);
	}
	.persona-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}
	.persona-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.persona-name {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--text-primary);
	}
	.persona-desc {
		font-size: 0.75rem;
		color: var(--text-secondary);
		line-height: 1.3;
	}
	.persona-hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		text-align: center;
		margin-top: 0.75rem;
	}
</style>
