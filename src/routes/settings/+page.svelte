<script lang="ts">
	import { supabase } from '$lib/services/supabase';
	import { user } from '$lib/stores/auth';
	import { showToast } from '$lib/stores/toast';

	let loading = $state(true);
	let saving = $state(false);
	let profileName = $state('');
	let discordId = $state('');
	let email = $state('');

	async function loadProfile() {
		loading = true;
		const currentUser = $user;
		if (!currentUser) {
			loading = false;
			return;
		}

		email = currentUser.email || '';

		const { data } = await supabase
			.from('users')
			.select('name, discord_id')
			.eq('auth_user_id', currentUser.id)
			.single();

		if (data) {
			profileName = data.name || '';
			discordId = data.discord_id || '';
		}
		loading = false;
	}

	async function saveProfile() {
		const currentUser = $user;
		if (!currentUser) return;

		saving = true;
		try {
			const { error } = await supabase
				.from('users')
				.update({
					name: profileName.trim() || null,
					discord_id: discordId.trim() || null
				})
				.eq('auth_user_id', currentUser.id);

			if (error) throw error;
			showToast('Profile saved', 'check');
		} catch {
			showToast('Failed to save profile', 'x');
		}
		saving = false;
	}

	$effect(() => {
		loadProfile();
	});
</script>

<svelte:head>
	<title>Settings - BOBA Scanner</title>
</svelte:head>

<div class="settings-page">
	<header class="page-header">
		<h1>Settings</h1>
		<p class="subtitle">Manage your profile information</p>
	</header>

	{#if loading}
		<div class="loading">Loading profile...</div>
	{:else}
		<div class="settings-card">
			<h2>Profile</h2>

			<div class="form-group">
				<label for="s-email">Email</label>
				<input id="s-email" type="email" value={email} disabled class="disabled-input" />
				<span class="field-hint">Email is managed by your Google account</span>
			</div>

			<div class="form-group">
				<label for="s-name">Name <span class="optional">(optional)</span></label>
				<input id="s-name" type="text" bind:value={profileName} placeholder="Your name" />
			</div>

			<div class="form-group">
				<label for="s-discord">Discord ID <span class="optional">(optional)</span></label>
				<input id="s-discord" type="text" bind:value={discordId} placeholder="username#1234 or username" />
			</div>

			<button class="save-btn" onclick={saveProfile} disabled={saving}>
				{saving ? 'Saving...' : 'Save Changes'}
			</button>
		</div>
	{/if}
</div>

<style>
	.settings-page {
		max-width: 500px;
		margin: 0 auto;
		padding: 1rem;
	}
	.page-header { margin-bottom: 1.5rem; }
	h1 { font-size: 1.5rem; font-weight: 700; }
	.subtitle {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
	}
	.loading {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}
	.settings-card {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1.25rem;
	}
	.settings-card h2 {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 1rem;
		color: var(--text-secondary);
	}
	.form-group {
		margin-bottom: 1rem;
	}
	.form-group label {
		display: block;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 4px;
	}
	.optional {
		font-weight: 400;
		color: var(--text-tertiary);
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
	.disabled-input {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.field-hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-top: 2px;
		display: block;
	}
	.save-btn {
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
	.save-btn:disabled { opacity: 0.6; }
</style>
