<script lang="ts">
	import { getSupabase } from '$lib/services/supabase';
	import { showToast } from '$lib/stores/toast.svelte';

	let freeRefreshLimit = $state(3);
	let memberRefreshLimit = $state(10);
	let configLoading = $state(false);

	$effect(() => {
		loadDeckShopConfig();
	});

	async function loadDeckShopConfig() {
		const client = getSupabase();
		if (!client) return;
		const { data } = await client
			.from('app_config')
			.select('key, value')
			.in('key', ['deck_shop_daily_refreshes_free', 'deck_shop_daily_refreshes_member']);
		if (data) {
			for (const row of data) {
				if (row.key === 'deck_shop_daily_refreshes_free') freeRefreshLimit = Number(row.value);
				if (row.key === 'deck_shop_daily_refreshes_member') memberRefreshLimit = Number(row.value);
			}
		}
	}

	async function saveDeckShopConfig() {
		const client = getSupabase();
		if (!client) return;
		configLoading = true;
		try {
			await client.from('app_config').upsert([
				{ key: 'deck_shop_daily_refreshes_free', value: freeRefreshLimit as unknown, updated_at: new Date().toISOString() },
				{ key: 'deck_shop_daily_refreshes_member', value: memberRefreshLimit as unknown, updated_at: new Date().toISOString() }
			], { onConflict: 'key' });
			showToast('Config saved', 'check');
		} catch {
			showToast('Failed to save', 'x');
		}
		configLoading = false;
	}
</script>

<div class="tab-content">
	<h2 class="section-title">Deck Shop — Price Refresh Limits</h2>
	<p class="section-desc">Configure how many price refresh batches each user tier gets per day.</p>
	<div class="config-row">
		<label class="config-label" for="free-refresh-limit">Free users (per day)</label>
		<input id="free-refresh-limit" type="number" min="0" max="50" bind:value={freeRefreshLimit} class="config-input" />
	</div>
	<div class="config-row">
		<label class="config-label" for="member-refresh-limit">Members (per day)</label>
		<input id="member-refresh-limit" type="number" min="0" max="100" bind:value={memberRefreshLimit} class="config-input" />
	</div>
	<button class="btn-action" onclick={saveDeckShopConfig} disabled={configLoading}>
		{configLoading ? 'Saving...' : 'Save Limits'}
	</button>
	<p class="config-hint">
		Per-user overrides: add a key <code>deck_shop_limit:USER_ID</code> to app_config with a numeric value.
	</p>
</div>

<style>
	.section-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.25rem; }
	.section-desc { font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 1rem; }
	.config-row { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem; }
	.config-label { font-size: 0.9rem; color: var(--text-secondary); min-width: 160px; }
	.config-input {
		width: 80px; padding: 0.5rem 0.75rem; border-radius: 8px;
		border: 1px solid var(--border-color); background: var(--bg-base);
		color: var(--text-primary); font-size: 0.9rem; text-align: center;
	}
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
	.config-hint { font-size: 0.8rem; color: var(--text-tertiary); margin-top: 1rem; }
	.config-hint code { background: var(--bg-hover); padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; }
</style>
