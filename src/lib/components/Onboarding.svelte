<script lang="ts">
	import { browser } from '$app/environment';

	let { onComplete }: { onComplete?: (scanNow: boolean) => void } = $props();

	let visible = $state(false);

	const STORAGE_KEY = 'onboardingComplete';

	function shouldShow(): boolean {
		if (!browser) return false;
		return !localStorage.getItem(STORAGE_KEY);
	}

	function complete(scanNow: boolean) {
		if (browser) localStorage.setItem(STORAGE_KEY, 'true');
		visible = false;
		onComplete?.(scanNow);
	}

	if (shouldShow()) {
		visible = true;
	}
</script>

{#if visible}
	<div class="onboarding-overlay">
		<div class="onboarding-card">
			<div class="onboarding-icon">🎴</div>
			<h2>Welcome to BOBA Scanner</h2>
			<p>AI-powered Bo Jackson Battle Arena card recognition.</p>

			<div class="features">
				<div class="feature">
					<span class="feature-icon">📸</span>
					<div>
						<strong>Instant Scan</strong>
						<p>Point your camera at any card for instant identification</p>
					</div>
				</div>
				<div class="feature">
					<span class="feature-icon">📚</span>
					<div>
						<strong>Build Your Collection</strong>
						<p>Track every card you own with condition and pricing</p>
					</div>
				</div>
				<div class="feature">
					<span class="feature-icon">🤖</span>
					<div>
						<strong>3-Tier AI Recognition</strong>
						<p>Hash cache, OCR, and Claude AI for maximum accuracy</p>
					</div>
				</div>
			</div>

			<div class="onboarding-actions">
				<button class="btn-primary" onclick={() => complete(true)}>
					Scan Your First Card
				</button>
				<button class="btn-secondary" onclick={() => complete(false)}>
					Explore First
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.onboarding-overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: rgba(0, 0, 0, 0.8);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}
	.onboarding-card {
		background: var(--bg-surface);
		border-radius: 16px;
		padding: 2rem;
		max-width: 420px;
		width: 100%;
		text-align: center;
	}
	.onboarding-icon { font-size: 3rem; margin-bottom: 0.75rem; }
	h2 {
		font-family: 'Syne', sans-serif;
		font-weight: 700;
		font-size: 1.5rem;
		margin-bottom: 0.5rem;
	}
	.onboarding-card > p {
		color: var(--text-secondary);
		margin-bottom: 1.5rem;
	}
	.features {
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}
	.feature {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
	}
	.feature-icon { font-size: 1.5rem; flex-shrink: 0; }
	.feature strong { font-size: 0.9rem; }
	.feature p {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-top: 2px;
	}
	.onboarding-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
</style>
