<!--
  Inline pricing nudge that appears under the price input when:
    - shipping is free (default for <$20 via eSE)
    - current price is between $0.01 and $18.49
    - the bumped price would meaningfully cover the eSE label

  One-tap "Bump it" applies the suggestion. Per-listing dismissible via "×".
  Persona-blind by design — same friendly tone for everyone (per Jimmy's call).
-->
<script lang="ts">
	import { suggestedBumpedPrice, ESE_LABEL_COST_USD } from '$lib/constants/shipping';

	interface Props {
		currentPrice: number;
		onAccept: (newPrice: number) => void;
	}

	let { currentPrice, onAccept }: Props = $props();

	// Session-scoped dismissal state. Reset on page navigation.
	let dismissed = $state(false);

	const suggested = $derived(suggestedBumpedPrice(currentPrice));

	const show = $derived(suggested !== null && !dismissed);

	function accept() {
		if (suggested !== null) {
			onAccept(suggested);
			dismissed = true; // Hide chip after accept; user can edit if they want
		}
	}

	function dismiss() {
		dismissed = true;
	}
</script>

{#if show && suggested !== null}
	<div class="sln-chip" role="status">
		<div class="sln-content">
			<div class="sln-text">
				<div class="sln-headline">
					<span class="sln-icon" aria-hidden="true">💡</span>
					Cover your shipping label
				</div>
				<div class="sln-body">
					Bump to <strong>${suggested.toFixed(2)}</strong> to net the same after the ${ESE_LABEL_COST_USD.toFixed(2)} eSE label.
				</div>
			</div>
			<button class="sln-accept" onclick={accept} type="button">
				Bump it
				<span aria-hidden="true">▸</span>
			</button>
		</div>
		<button class="sln-dismiss" onclick={dismiss} type="button" aria-label="Dismiss suggestion">
			×
		</button>
	</div>
{/if}

<style>
	.sln-chip {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin-top: 8px;
		padding: 10px 12px;
		background: rgba(255, 193, 7, 0.08);
		border: 1px solid rgba(255, 193, 7, 0.25);
		border-radius: 10px;
		animation: sln-fade-in 150ms ease-out;
	}

	@keyframes sln-fade-in {
		from { opacity: 0; transform: translateY(4px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.sln-content {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: 1;
		min-width: 0;
	}

	.sln-text {
		flex: 1;
		min-width: 0;
	}

	.sln-headline {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.sln-icon {
		font-size: 14px;
	}

	.sln-body {
		font-size: 12px;
		color: var(--text-secondary, #555);
		margin-top: 2px;
		line-height: 1.4;
	}

	.sln-body strong {
		color: var(--text-primary, #1a1a1a);
		font-weight: 600;
	}

	.sln-accept {
		min-height: 44px;
		padding: 8px 14px;
		background: var(--accent, #2563eb);
		color: #fff;
		border: none;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.sln-accept:active {
		transform: scale(0.97);
	}

	.sln-dismiss {
		min-width: 32px;
		min-height: 32px;
		background: transparent;
		border: none;
		color: var(--text-secondary, #888);
		font-size: 20px;
		line-height: 1;
		cursor: pointer;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.sln-dismiss:active {
		transform: scale(0.92);
	}

	/* Dark mode (Card Scanner uses dark theme on mobile) */
	@media (prefers-color-scheme: dark) {
		.sln-chip {
			background: rgba(255, 193, 7, 0.06);
			border-color: rgba(255, 193, 7, 0.2);
		}
		.sln-headline {
			color: var(--text-primary, #f0f0f0);
		}
		.sln-body {
			color: var(--text-secondary, #aaa);
		}
		.sln-body strong {
			color: var(--text-primary, #f0f0f0);
		}
	}
</style>
