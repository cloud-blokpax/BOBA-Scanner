<script lang="ts">
	import { getSupabase } from '$lib/services/supabase';
	import { user } from '$lib/stores/auth';
	import { showToast } from '$lib/stores/toast';

	let visible = $state(false);
	let profileName = $state('');
	let discordId = $state('');
	let saving = $state(false);
	let checkedForUserId = $state<string | null>(null);

	$effect(() => {
		const currentUser = $user;
		if (!currentUser) return;
		// Re-check when user changes (e.g., sign out and sign in as different user)
		if (checkedForUserId === currentUser.id) return;
		checkedForUserId = currentUser.id;
		checkProfile(currentUser.id);
	});

	async function checkProfile(authUserId: string) {
		const client = getSupabase();
		if (!client) return;
		try {
			const { data } = await client
				.from('users')
				.select('name, discord_id')
				.eq('auth_user_id', authUserId)
				.single();

			// Show prompt if user has no name and no discord_id set
			if (data && !data.name && !data.discord_id) {
				visible = true;
			}
		} catch (err) {
			console.debug('[profile-prompt] Profile check failed:', err);
		}
	}

	async function save() {
		const currentUser = $user;
		if (!currentUser) return;
		const client = getSupabase();
		if (!client) return;

		saving = true;
		try {
			const { error } = await client
				.from('users')
				.update({
					name: profileName.trim() || null,
					discord_id: discordId.trim() || null
				})
				.eq('auth_user_id', currentUser.id);

			if (error) throw error;
			showToast('Profile updated', 'check');
		} catch (err) {
			console.debug('[ProfilePrompt] Profile save failed:', err);
			showToast('Failed to save', 'x');
		}
		visible = false;
		saving = false;
	}

	function dismiss() {
		visible = false;
	}
</script>

{#if visible}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="prompt-overlay" role="presentation" onclick={dismiss}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="prompt-card" onclick={(e) => e.stopPropagation()}>
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
				<button class="save-btn" onclick={save} disabled={saving}>
					{saving ? 'Saving...' : 'Save'}
				</button>
				<button class="skip-btn" onclick={dismiss}>Skip for now</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.prompt-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}
	.prompt-card {
		background: var(--bg-elevated);
		border-radius: 16px;
		padding: 1.5rem;
		max-width: 400px;
		width: 100%;
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
</style>
