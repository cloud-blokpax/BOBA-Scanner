<script lang="ts">
	// Toggle state for the collapsible guide panel
	let expanded = $state(false);

	// Track which step the coach is currently viewing (for mobile-friendly accordion)
	let activeStep = $state<number | null>(null);

	function toggleStep(step: number) {
		activeStep = activeStep === step ? null : step;
	}
</script>

<!-- Toggle link — always visible when this component renders -->
<button
	class="guide-toggle"
	onclick={() => { expanded = !expanded; if (!expanded) activeStep = null; }}
	aria-expanded={expanded}
>
	<svg class="guide-toggle-icon" class:rotated={expanded} width="16" height="16" viewBox="0 0 16 16" fill="none">
		<path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>
	<span>Need help connecting?</span>
</button>

{#if expanded}
	<div class="guide-panel" role="region" aria-label="eBay setup guide">
		<p class="guide-intro">
			Connect your eBay seller account in 3 quick steps. Once connected, you can list scanned cards directly to eBay.
		</p>

		<!-- Step 1 -->
		<button class="step-header" onclick={() => toggleStep(1)} aria-expanded={activeStep === 1}>
			<span class="step-number" class:active={activeStep === 1}>1</span>
			<span class="step-title">Tap "Connect eBay Account"</span>
			<svg class="step-chevron" class:rotated={activeStep === 1} width="14" height="14" viewBox="0 0 16 16" fill="none">
				<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>
		{#if activeStep === 1}
			<div class="step-content">
				<p>
					Scroll down on this page to the <strong>eBay Seller</strong> section below.
					Tap the blue <strong>Connect eBay Account</strong> button. You'll be redirected to eBay's secure authorization page.
				</p>
				<img
					src="/guide/ebay-step1-sell-page.png"
					alt="The Sell page showing the Connect eBay Account button in the eBay Seller section"
					class="step-image"
					loading="lazy"
				/>
			</div>
		{/if}

		<!-- Step 2 -->
		<button class="step-header" onclick={() => toggleStep(2)} aria-expanded={activeStep === 2}>
			<span class="step-number" class:active={activeStep === 2}>2</span>
			<span class="step-title">Authorize on eBay</span>
			<svg class="step-chevron" class:rotated={activeStep === 2} width="14" height="14" viewBox="0 0 16 16" fill="none">
				<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>
		{#if activeStep === 2}
			<div class="step-content">
				<p>
					Review the permissions eBay shows you. Card Scanner needs access to view and manage your
					inventory so it can create listings on your behalf. Tap <strong>Agree and Continue</strong>.
				</p>
				<p class="step-note">
					This is eBay's official authorization page — your login credentials are never shared with Card Scanner.
				</p>
				<img
					src="/guide/ebay-step2-authorize.png"
					alt="eBay's authorization page showing the permissions being requested and the Agree and Continue button"
					class="step-image"
					loading="lazy"
				/>
			</div>
		{/if}

		<!-- Step 3 -->
		<button class="step-header" onclick={() => toggleStep(3)} aria-expanded={activeStep === 3}>
			<span class="step-number" class:active={activeStep === 3}>3</span>
			<span class="step-title">You're connected!</span>
			<svg class="step-chevron" class:rotated={activeStep === 3} width="14" height="14" viewBox="0 0 16 16" fill="none">
				<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>
		{#if activeStep === 3}
			<div class="step-content">
				<p>
					After authorizing, you'll be sent back here automatically. The eBay Seller section will show a
					green <strong>Connected</strong> badge with your seller username, connection date, and token status.
				</p>
				<p>
					Use the <strong>Test</strong> button to verify everything works. You can <strong>Disconnect</strong> anytime
					if you need to switch accounts.
				</p>
				<img
					src="/guide/ebay-step3-connected.png"
					alt="The Sell page showing a successfully connected eBay seller account with green Connected status"
					class="step-image"
					loading="lazy"
				/>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* --- Toggle link --- */
	.guide-toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		background: none;
		border: none;
		color: var(--color-primary, #7c3aed);
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		padding: 0.5rem 0;
		margin-bottom: 0.5rem;
		transition: color 0.15s;
	}
	.guide-toggle:hover {
		color: var(--color-primary-light, #a78bfa);
	}
	.guide-toggle-icon {
		transition: transform 0.2s ease;
		flex-shrink: 0;
	}
	.guide-toggle-icon.rotated {
		transform: rotate(90deg);
	}

	/* --- Guide panel --- */
	.guide-panel {
		background: var(--color-surface, rgba(30, 41, 59, 0.5));
		border: 1px solid var(--color-border, rgba(148, 163, 184, 0.15));
		border-radius: 0.75rem;
		padding: 1rem;
		margin-bottom: 1rem;
		animation: slideDown 0.2s ease-out;
	}
	@keyframes slideDown {
		from { opacity: 0; transform: translateY(-8px); }
		to { opacity: 1; transform: translateY(0); }
	}
	.guide-intro {
		font-size: 0.85rem;
		color: var(--color-text-secondary, #94a3b8);
		margin: 0 0 1rem 0;
		line-height: 1.5;
	}

	/* --- Step headers (accordion buttons) --- */
	.step-header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		background: none;
		border: none;
		border-top: 1px solid var(--color-border, rgba(148, 163, 184, 0.1));
		padding: 0.75rem 0;
		cursor: pointer;
		text-align: left;
		color: var(--color-text, #e2e8f0);
	}
	.step-header:first-of-type {
		border-top: none;
	}

	/* --- Step number badge --- */
	.step-number {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		background: var(--color-border, rgba(148, 163, 184, 0.15));
		color: var(--color-text-secondary, #94a3b8);
		font-size: 0.75rem;
		font-weight: 700;
		flex-shrink: 0;
		transition: background 0.15s, color 0.15s;
	}
	.step-number.active {
		background: var(--color-primary, #7c3aed);
		color: #fff;
	}

	.step-title {
		flex: 1;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.step-chevron {
		color: var(--color-text-secondary, #94a3b8);
		transition: transform 0.2s ease;
		flex-shrink: 0;
	}
	.step-chevron.rotated {
		transform: rotate(180deg);
	}

	/* --- Step content (expanded) --- */
	.step-content {
		padding: 0 0 0.75rem 2.2rem;
		animation: fadeIn 0.15s ease-out;
	}
	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	.step-content p {
		font-size: 0.85rem;
		color: var(--color-text-secondary, #94a3b8);
		line-height: 1.5;
		margin: 0 0 0.6rem 0;
	}
	.step-content p :global(strong) {
		color: var(--color-text, #e2e8f0);
	}

	/* --- Security reassurance note --- */
	.step-note {
		font-size: 0.8rem !important;
		color: var(--color-text-tertiary, #64748b) !important;
		font-style: italic;
		border-left: 2px solid var(--color-primary, #7c3aed);
		padding-left: 0.6rem;
	}

	/* --- Screenshot images --- */
	.step-image {
		width: 100%;
		max-width: 400px;
		border-radius: 0.5rem;
		border: 1px solid var(--color-border, rgba(148, 163, 184, 0.15));
		margin-top: 0.5rem;
	}
</style>
