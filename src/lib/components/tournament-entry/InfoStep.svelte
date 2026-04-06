<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import type { TournamentInfo, PlayerInfo } from './types';

	interface Props {
		tournament: TournamentInfo;
		initial: PlayerInfo;
		existingSubmission: boolean;
		onProceed: (info: PlayerInfo) => void;
	}

	let { tournament, initial, existingSubmission, onProceed }: Props = $props();

	let regName = $state(initial.name);
	let regEmail = $state(initial.email);
	let regDiscord = $state(initial.discord);

	function handleProceed() {
		if (!regEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail.trim())) {
			showToast('Valid email is required', 'x'); return;
		}
		if (tournament.require_name && !regName.trim()) {
			showToast('Name is required', 'x'); return;
		}
		if (tournament.require_discord && !regDiscord.trim()) {
			showToast('Discord ID is required', 'x'); return;
		}
		onProceed({ name: regName.trim(), email: regEmail.trim(), discord: regDiscord.trim() });
	}
</script>

{#if existingSubmission}
	<div class="existing-banner">
		You already have a submission for this tournament. You can update it below.
	</div>
{/if}

<div class="step-card">
	<h2>Your Information</h2>
	<div class="form-group">
		<label for="reg-email">Email <span class="required">*</span></label>
		<input id="reg-email" type="email" bind:value={regEmail} placeholder="you@example.com" />
	</div>
	<div class="form-group">
		<label for="reg-name">
			Name
			{#if tournament.require_name}<span class="required">*</span>{:else}<span class="optional">(optional)</span>{/if}
		</label>
		<input id="reg-name" type="text" bind:value={regName} placeholder="Your name" />
	</div>
	<div class="form-group">
		<label for="reg-discord">
			Discord ID
			{#if tournament.require_discord}<span class="required">*</span>{:else}<span class="optional">(optional)</span>{/if}
		</label>
		<input id="reg-discord" type="text" bind:value={regDiscord} placeholder="username#1234" />
	</div>
	<button class="primary-btn" onclick={handleProceed}>Next: Select Deck</button>
</div>
