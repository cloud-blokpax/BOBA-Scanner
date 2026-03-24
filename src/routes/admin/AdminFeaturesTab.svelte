<script lang="ts">
	import { getSupabase } from '$lib/services/supabase';
	import { showToast } from '$lib/stores/toast.svelte';
	import {
		getAllFeatureFlags,
		saveFeatureFlag,
		loadFeatureFlags,
		type FeatureFlag
	} from '$lib/stores/feature-flags.svelte';

	let featureList = $state<FeatureFlag[]>([]);
	let featuresLoading = $state(false);
	let savingFlag = $state<string | null>(null);
	let overrideUserId = $state('');
	let overrideFeatureKey = $state('');
	let overrideEnabled = $state(true);
	let overrideSaving = $state(false);
	let userOverridesList = $state<Array<{
		user_id: string;
		feature_key: string;
		enabled: boolean;
		user_email?: string;
	}>>([]);

	$effect(() => {
		loadFeaturesTab();
	});

	async function loadFeaturesTab() {
		featuresLoading = true;
		try {
			await loadFeatureFlags();
			featureList = getAllFeatureFlags();
			const client = getSupabase();
			if (client) {
				const { data } = await client
					.from('user_feature_overrides')
					.select('user_id, feature_key, enabled')
					.order('created_at', { ascending: false })
					.limit(200);
				if (data) {
					const userIds = [...new Set(data.map((d: { user_id: string }) => d.user_id))];
					const { data: userRows } = await client
						.from('users')
						.select('id, email')
						.in('id', userIds);
					const emailMap = new Map((userRows || []).map((u: { id: string; email: string }) => [u.id, u.email]));
					userOverridesList = data.map((d: { user_id: string; feature_key: string; enabled: boolean }) => ({
						...d,
						user_email: emailMap.get(d.user_id) || d.user_id
					}));
				}
			}
		} catch (err) {
			console.debug('[admin] Features load failed:', err);
			showToast('Failed to load features', 'x');
		}
		featuresLoading = false;
	}

	async function toggleFlagRole(
		featureKey: string,
		role: 'enabled_globally' | 'enabled_for_guest' | 'enabled_for_authenticated' | 'enabled_for_member' | 'enabled_for_admin',
		currentValue: boolean
	) {
		savingFlag = featureKey;
		const success = await saveFeatureFlag(featureKey, { [role]: !currentValue });
		if (success) {
			featureList = getAllFeatureFlags();
			showToast('Flag updated', 'check');
		} else {
			showToast('Failed to update flag', 'x');
		}
		savingFlag = null;
	}

	async function addUserOverride() {
		if (!overrideUserId.trim() || !overrideFeatureKey) return;
		overrideSaving = true;
		const client = getSupabase();
		if (!client) { overrideSaving = false; return; }
		try {
			let userId = overrideUserId.trim();
			if (!userId.match(/^[0-9a-f-]{36}$/i)) {
				const { data: userRow } = await client.from('users').select('id').eq('email', userId).maybeSingle();
				if (!userRow) { showToast('User not found', 'x'); overrideSaving = false; return; }
				userId = userRow.id;
			}
			const { error } = await client.from('user_feature_overrides').upsert(
				{ user_id: userId, feature_key: overrideFeatureKey, enabled: overrideEnabled, updated_at: new Date().toISOString() },
				{ onConflict: 'user_id,feature_key' }
			);
			if (error) throw error;
			showToast('Override saved', 'check');
			overrideUserId = '';
			await loadFeaturesTab();
		} catch { showToast('Failed to save override', 'x'); }
		overrideSaving = false;
	}

	async function removeOverride(userId: string, featureKey: string) {
		const client = getSupabase();
		if (!client) return;
		const { error } = await client.from('user_feature_overrides').delete().eq('user_id', userId).eq('feature_key', featureKey);
		if (error) showToast('Failed to remove override', 'x');
		else { showToast('Override removed', 'check'); await loadFeaturesTab(); }
	}
</script>

<div class="tab-content">
	{#if featuresLoading}
		<div class="loading">Loading features...</div>
	{:else}
		<h2 class="section-title">Feature Flags</h2>
		<p class="section-desc">Toggle features for each role tier. Per-user overrides below take precedence.</p>
		<div class="feature-flags-list">
			{#each featureList as flag}
				<div class="feature-flag-row">
					<div class="flag-info">
						<span class="flag-icon">{flag.icon}</span>
						<div>
							<div class="flag-name">{flag.display_name}</div>
							<div class="flag-desc">{flag.description}</div>
							<div class="flag-key">{flag.feature_key}</div>
						</div>
					</div>
					<div class="flag-toggles">
						{#each [
							{ key: 'enabled_globally', label: 'Global' },
							{ key: 'enabled_for_guest', label: 'Guest' },
							{ key: 'enabled_for_authenticated', label: 'Auth' },
							{ key: 'enabled_for_member', label: 'Member' },
							{ key: 'enabled_for_admin', label: 'Admin' }
						] as tier}
							<label class="toggle-label">
								<span class="toggle-tier">{tier.label}</span>
								<button
									class="toggle-btn"
									class:toggle-on={flag[tier.key as keyof FeatureFlag]}
									onclick={() => toggleFlagRole(flag.feature_key, tier.key as 'enabled_globally' | 'enabled_for_guest' | 'enabled_for_authenticated' | 'enabled_for_member' | 'enabled_for_admin', !!flag[tier.key as keyof FeatureFlag])}
									disabled={savingFlag === flag.feature_key}
									aria-label="Toggle {tier.label} for {flag.feature_key}"
								></button>
							</label>
						{/each}
					</div>
				</div>
			{/each}
		</div>

		<h2 class="section-title" style="margin-top: 2rem;">Per-User Overrides</h2>
		<p class="section-desc">Grant or revoke specific features for individual users by email or UUID.</p>
		<div class="override-form">
			<input type="text" bind:value={overrideUserId} placeholder="User email or ID" class="search-input" style="flex: 2;" />
			<select bind:value={overrideFeatureKey} class="override-select">
				<option value="">Select feature...</option>
				{#each featureList as flag}
					<option value={flag.feature_key}>{flag.display_name}</option>
				{/each}
			</select>
			<select bind:value={overrideEnabled} class="override-select" style="flex: 0.5;">
				<option value={true}>Grant</option>
				<option value={false}>Revoke</option>
			</select>
			<button class="btn-action" onclick={addUserOverride} disabled={overrideSaving || !overrideUserId.trim() || !overrideFeatureKey}>
				{overrideSaving ? 'Saving...' : 'Add'}
			</button>
		</div>
		{#if userOverridesList.length > 0}
			<div class="overrides-table">
				<table>
					<thead><tr><th>User</th><th>Feature</th><th>Status</th><th></th></tr></thead>
					<tbody>
						{#each userOverridesList as ov}
							<tr>
								<td class="email-cell">{ov.user_email}</td>
								<td>{ov.feature_key}</td>
								<td>
									{#if ov.enabled}<span class="badge member">Granted</span>
									{:else}<span class="badge-revoked">Revoked</span>{/if}
								</td>
								<td><button class="remove-btn" onclick={() => removeOverride(ov.user_id, ov.feature_key)}>✕</button></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="empty">No per-user overrides set.</p>
		{/if}
	{/if}
</div>

<style>
	.loading, .empty {
		text-align: center;
		padding: 2rem;
		color: var(--text-tertiary);
	}
	.section-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.25rem; }
	.section-desc { font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 1rem; }
	.feature-flags-list { display: flex; flex-direction: column; gap: 0.75rem; }
	.feature-flag-row { background: var(--bg-elevated); border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
	.flag-info { display: flex; gap: 0.75rem; align-items: flex-start; }
	.flag-icon { font-size: 1.5rem; flex-shrink: 0; margin-top: 2px; }
	.flag-name { font-weight: 600; font-size: 0.95rem; }
	.flag-desc { font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px; }
	.flag-key { font-size: 0.7rem; color: var(--text-tertiary); font-family: var(--font-mono); margin-top: 4px; }
	.flag-toggles { display: flex; gap: 0.75rem; flex-wrap: wrap; }
	.toggle-label { display: flex; flex-direction: column; align-items: center; gap: 4px; }
	.toggle-tier { font-size: 0.65rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
	.toggle-btn { width: 36px; height: 20px; border-radius: 10px; border: none; background: var(--bg-hover); position: relative; cursor: pointer; transition: background 0.2s; }
	.toggle-btn::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--text-secondary); transition: transform 0.2s, background 0.2s; }
	.toggle-btn.toggle-on { background: var(--success, #10b981); }
	.toggle-btn.toggle-on::after { transform: translateX(16px); background: white; }
	.toggle-btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.override-form { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
	.search-input {
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.9rem;
	}
	.override-select { padding: 0.5rem 0.75rem; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-base); color: var(--text-primary); font-size: 0.85rem; flex: 1; }
	.btn-action {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--accent-primary);
		background: transparent;
		color: var(--accent-primary);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-action:disabled { opacity: 0.5; cursor: not-allowed; }
	.overrides-table { margin-top: 0.5rem; }
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	th {
		text-align: left;
		padding: 0.5rem;
		border-bottom: 1px solid var(--border-color);
		color: var(--text-secondary);
		font-weight: 600;
		white-space: nowrap;
	}
	td {
		padding: 0.5rem;
		border-bottom: 1px solid var(--border-color);
	}
	.email-cell {
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge.member {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		background: #2563eb20;
		color: #2563eb;
	}
	.badge-revoked {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		background: #ef444420;
		color: #ef4444;
	}
	.remove-btn { background: none; border: none; color: var(--text-tertiary); cursor: pointer; font-size: 0.9rem; padding: 2px 6px; border-radius: 4px; }
	.remove-btn:hover { background: var(--danger-light); color: var(--danger); }
</style>
