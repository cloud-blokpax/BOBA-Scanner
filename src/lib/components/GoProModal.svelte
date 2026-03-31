<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { buildVenmoUrl, buildPayPalUrl } from '$lib/utils/payment-links';

	let {
		open,
		onclose
	}: {
		open: boolean;
		onclose: () => void;
	} = $props();

	interface Tier {
		key: string;
		label: string;
		description: string;
		amount: number | null;
		icon: string;
		popular?: boolean;
	}

	const tiers: Tier[] = [
		{ key: 'legendary', label: 'LEGENDARY', description: 'Unbelievable and worth every penny', amount: 25, icon: '⭐' },
		{ key: 'epic', label: 'EPIC', description: 'Must have for this price', amount: 15, icon: '★', popular: true },
		{ key: 'standard', label: 'STANDARD', description: 'This app is ok — I will give', amount: 5, icon: '' },
		{ key: 'custom', label: 'CUSTOM', description: 'I must ponder the value', amount: null, icon: '' }
	];

	let processing = $state(false);
	let confirmation = $state<{ shown: boolean; cooldownActive: boolean }>({ shown: false, cooldownActive: false });

	async function handleTierClick(tier: Tier, method: 'venmo' | 'paypal') {
		if (processing) return;
		processing = true;

		try {
			const res = await fetch('/api/go-pro', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tier_key: tier.key,
					payment_method: method
				})
			});

			if (res.ok) {
				const data = await res.json();

				// Open payment link
				const url = method === 'venmo'
					? buildVenmoUrl(tier.amount)
					: buildPayPalUrl(tier.amount);
				window.open(url, '_blank', 'noopener');

				// Show confirmation
				confirmation = { shown: true, cooldownActive: data.cooldown_active };

				// Refresh layout data to pick up new Pro status
				invalidate('supabase:auth');

				// Auto-close after 2.5 seconds
				setTimeout(() => {
					confirmation = { shown: false, cooldownActive: false };
					onclose();
				}, 2500);
			}
		} catch (err) {
			console.debug('[GoProModal] Error:', err);
		}
		processing = false;
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

{#if open}
<div class="modal-backdrop" role="presentation" onclick={handleBackdropClick} onkeydown={handleKeydown}>
	<div class="modal-sheet" role="dialog" aria-modal="true" aria-label="Go Pro">
		<button class="modal-close" onclick={onclose} aria-label="Close">×</button>
		<div class="modal-scroll">
		{#if confirmation.shown}
			<div class="confirmation">
				<div class="confirmation-check">✓</div>
				{#if confirmation.cooldownActive}
					<p class="confirmation-text">Thanks for the support! Your Pro time was recently extended — this one's on us.</p>
				{:else}
					<h2 class="confirmation-title">You're Pro!</h2>
					<p class="confirmation-text">Thank you for supporting BOBA Scanner.</p>
				{/if}
			</div>
		{:else}
			<div class="modal-header">
				<h2>Go Pro</h2>
				<p class="modal-subtitle">Choose the tier that matches your feeling on the app. Each choice provides Pro access for 30 days.</p>
			</div>

			<div class="tier-list">
				{#each tiers as tier}
					<div class="tier-card" class:tier-popular={tier.popular}>
						<div class="tier-info">
							<div class="tier-name-row">
								{#if tier.icon}<span class="tier-icon">{tier.icon}</span>{/if}
								<span class="tier-name">{tier.label}</span>
								{#if tier.popular}<span class="popular-badge">Most Popular</span>{/if}
							</div>
							<div class="tier-price">
								{#if tier.amount}${tier.amount}{:else}$???{/if}
							</div>
						</div>
						<p class="tier-desc">{tier.description}</p>
						<div class="tier-buttons">
							<button
								class="pay-btn pay-venmo"
								onclick={() => handleTierClick(tier, 'venmo')}
								disabled={processing}
							>Venmo</button>
							<button
								class="pay-btn pay-paypal"
								onclick={() => handleTierClick(tier, 'paypal')}
								disabled={processing}
							>PayPal</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
		</div>
	</div>
</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}
	@media (min-width: 640px) {
		.modal-backdrop {
			align-items: center;
		}
	}
	.modal-sheet {
		background: var(--bg-elevated);
		border-radius: 20px 20px 0 0;
		width: 100%;
		max-width: 440px;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		padding: 1.5rem;
		position: relative;
	}
	.modal-scroll {
		overflow-y: auto;
		flex: 1;
		min-height: 0;
	}
	@media (min-width: 640px) {
		.modal-sheet {
			border-radius: 20px;
		}
	}
	.modal-header {
		margin-bottom: 1.25rem;
		position: relative;
	}
	.modal-header h2 {
		font-size: 1.5rem;
		font-weight: 800;
		color: var(--gold);
	}
	.modal-subtitle {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
		line-height: 1.4;
		padding-right: 2rem;
	}
	.modal-close {
		position: absolute;
		top: 1rem;
		right: 1rem;
		background: none;
		border: none;
		font-size: 1.5rem;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		line-height: 1;
		z-index: 1;
	}

	.tier-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.tier-card {
		background: var(--bg-base);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 1rem;
	}
	.tier-popular {
		border-color: var(--gold);
		box-shadow: 0 0 0 1px var(--gold), var(--shadow-gold);
	}
	.tier-info {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.25rem;
	}
	.tier-name-row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}
	.tier-icon {
		color: var(--gold);
	}
	.tier-name {
		font-size: 0.85rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--text-primary);
	}
	.popular-badge {
		font-size: 0.6rem;
		font-weight: 700;
		padding: 1px 5px;
		border-radius: 3px;
		background: var(--gold);
		color: #000;
	}
	.tier-price {
		font-size: 1.1rem;
		font-weight: 800;
		color: var(--text-primary);
	}
	.tier-desc {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}
	.tier-buttons {
		display: flex;
		gap: 0.5rem;
	}
	.pay-btn {
		flex: 1;
		padding: 0.5rem;
		border-radius: 8px;
		border: none;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		color: #fff;
	}
	.pay-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.pay-venmo {
		background: #008CFF;
	}
	.pay-paypal {
		background: #003087;
	}

	/* Confirmation */
	.confirmation {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem 1rem;
		text-align: center;
	}
	.confirmation-check {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: var(--gold);
		color: #000;
		font-size: 2rem;
		font-weight: 800;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 1rem;
		box-shadow: var(--shadow-gold);
	}
	.confirmation-title {
		font-size: 1.5rem;
		font-weight: 800;
		color: var(--gold);
		margin-bottom: 0.5rem;
	}
	.confirmation-text {
		font-size: 0.9rem;
		color: var(--text-secondary);
		max-width: 280px;
		line-height: 1.4;
	}
</style>
