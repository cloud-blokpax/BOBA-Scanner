<script lang="ts">
	import type { SubmissionResult } from './types';

	interface Props {
		tournamentName: string;
		result: SubmissionResult;
		canModify: boolean;
		onModify: () => void;
	}

	let { tournamentName, result, canModify, onModify }: Props = $props();
</script>

<div class="done-card">
	<h2>Deck Submitted!</h2>
	<p>Your deck has been submitted for <strong>{tournamentName}</strong>.</p>

	<div class="verify-section">
		<p class="verify-label">Verification Code</p>
		<p class="verify-code">{result.verification_code}</p>
		<a href={result.verify_url} class="verify-link">View Verification Page</a>
	</div>

	{#if !result.is_valid}
		<p class="warn-text">Note: Your deck has validation issues. You may want to resubmit with a valid deck.</p>
	{/if}

	<div class="done-actions">
		<a href="/tournaments" class="primary-btn done-link">Back to Tournaments</a>
		{#if canModify}
			<button class="secondary-btn" onclick={onModify}>Modify Deck</button>
		{/if}
	</div>
</div>
