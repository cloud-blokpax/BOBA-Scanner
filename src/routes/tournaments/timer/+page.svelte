<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { getSupabase } from '$lib/services/supabase';
	import { triggerHaptic } from '$lib/utils/haptics';

	const code = $derived($page.url.searchParams.get('code') || '');
	const isOrganizer = $derived($page.url.searchParams.get('admin') === '1');

	// Timer state
	let endTime = $state<number | null>(null);
	let pausedAt = $state<number | null>(null);
	let remaining = $state(0);
	let isRunning = $state(false);
	let connected = $state(false);

	// Preset durations (minutes)
	const PRESETS = [25, 30, 35, 40, 50, 60];
	let selectedPreset = $state(30);

	let rafId: number | null = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let channel: any = null;

	const minutes = $derived(Math.floor(remaining / 60));
	const seconds = $derived(Math.floor(remaining % 60));
	const displayTime = $derived(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
	const timerColor = $derived(
		remaining <= 10 ? 'var(--danger, #ef4444)' :
		remaining <= 60 ? 'var(--warning, #f59e0b)' :
		'var(--text-primary, #e2e8f0)'
	);
	const isPulsing = $derived(remaining > 0 && remaining <= 10 && isRunning);

	onMount(() => {
		if (!code) return;

		const client = getSupabase();
		if (!client) return;

		channel = (client as any).channel(`timer:${code}`);

		channel.on('broadcast', { event: 'timer' }, ({ payload }: { payload: { action: string; endTime?: number; pausedAt?: number } }) => {
			if (payload.action === 'start' && payload.endTime) {
				endTime = payload.endTime;
				pausedAt = null;
				isRunning = true;
				startCountdown();
			} else if (payload.action === 'pause') {
				pausedAt = Date.now();
				isRunning = false;
				if (rafId) cancelAnimationFrame(rafId);
			} else if (payload.action === 'reset') {
				endTime = null;
				pausedAt = null;
				isRunning = false;
				remaining = 0;
				if (rafId) cancelAnimationFrame(rafId);
			}
		});

		channel.subscribe((status: string) => {
			connected = status === 'SUBSCRIBED';
		});
	});

	onDestroy(() => {
		if (rafId) cancelAnimationFrame(rafId);
		if (channel) channel.unsubscribe();
	});

	function startCountdown() {
		if (rafId) cancelAnimationFrame(rafId);

		function tick() {
			if (!endTime) return;
			const now = Date.now();
			remaining = Math.max(0, (endTime - now) / 1000);

			if (remaining <= 0) {
				isRunning = false;
				remaining = 0;
				triggerHaptic('error');
				return;
			}

			// Haptic at 10s, 5s, 0s
			const secs = Math.floor(remaining);
			if (secs === 10 || secs === 5) {
				triggerHaptic('tap');
			}

			rafId = requestAnimationFrame(tick);
		}
		tick();
	}

	// Organizer controls
	function sendTimerEvent(action: string, data: Record<string, unknown> = {}) {
		if (!channel) return;
		channel.send({
			type: 'broadcast',
			event: 'timer',
			payload: { action, ...data }
		});
	}

	function startTimer() {
		const duration = selectedPreset * 60 * 1000;
		const newEndTime = Date.now() + duration;
		endTime = newEndTime;
		pausedAt = null;
		isRunning = true;
		startCountdown();
		sendTimerEvent('start', { endTime: newEndTime });
	}

	function pauseTimer() {
		pausedAt = Date.now();
		isRunning = false;
		if (rafId) cancelAnimationFrame(rafId);
		sendTimerEvent('pause');
	}

	function resetTimer() {
		endTime = null;
		pausedAt = null;
		isRunning = false;
		remaining = 0;
		if (rafId) cancelAnimationFrame(rafId);
		sendTimerEvent('reset');
	}
</script>

<svelte:head>
	<title>Round Timer {code ? `— ${code}` : ''} | BOBA Scanner</title>
</svelte:head>

<div class="timer-page">
	{#if !code}
		<div class="timer-setup">
			<h1>Tournament Timer</h1>
			<p class="info">Enter a tournament code to join a shared timer.</p>
			<form onsubmit={(e) => { e.preventDefault(); const input = (e.target as HTMLFormElement).querySelector('input'); if (input?.value) window.location.search = `?code=${input.value}`; }}>
				<input type="text" placeholder="Tournament code..." class="code-input" />
				<button type="submit" class="join-btn">Join</button>
			</form>
		</div>
	{:else}
		<div class="timer-display">
			<div class="connection-status" class:connected>
				{connected ? 'Connected' : 'Connecting...'}
			</div>

			<div class="timer-value" class:pulsing={isPulsing} style:color={timerColor}>
				{displayTime}
			</div>

			<div class="timer-code">Tournament: {code}</div>

			{#if isOrganizer}
				<div class="organizer-controls">
					{#if !isRunning && remaining <= 0}
						<div class="preset-row">
							{#each PRESETS as mins}
								<button
									class="preset-btn"
									class:active={selectedPreset === mins}
									onclick={() => selectedPreset = mins}
								>{mins}m</button>
							{/each}
						</div>
						<button class="control-btn start-btn" onclick={startTimer}>Start</button>
					{:else if isRunning}
						<button class="control-btn pause-btn" onclick={pauseTimer}>Pause</button>
					{:else}
						<button class="control-btn start-btn" onclick={startTimer}>Resume</button>
					{/if}
					<button class="control-btn reset-btn" onclick={resetTimer}>Reset</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.timer-page {
		min-height: 80vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.timer-setup {
		text-align: center;
		max-width: 400px;
	}

	.timer-setup h1 {
		font-size: 1.75rem;
		font-weight: 700;
		margin-bottom: 0.5rem;
	}

	.info {
		color: var(--text-secondary, #94a3b8);
		font-size: 0.9rem;
		margin-bottom: 1.5rem;
	}

	.timer-setup form {
		display: flex;
		gap: 0.5rem;
	}

	.code-input {
		flex: 1;
		padding: 0.75rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #e2e8f0);
		font-size: 1rem;
		text-transform: uppercase;
	}

	.join-btn {
		padding: 0.75rem 1.5rem;
		border-radius: 8px;
		border: none;
		background: var(--primary, #3b82f6);
		color: white;
		font-weight: 600;
		cursor: pointer;
	}

	.timer-display {
		text-align: center;
		width: 100%;
		max-width: 500px;
	}

	.connection-status {
		font-size: 0.75rem;
		color: var(--text-muted, #475569);
		margin-bottom: 1rem;
	}

	.connection-status.connected {
		color: var(--success, #10b981);
	}

	.timer-value {
		font-family: 'Syne', monospace;
		font-size: clamp(4rem, 15vw, 8rem);
		font-weight: 800;
		line-height: 1;
		margin-bottom: 0.5rem;
		transition: color 0.3s ease;
	}

	.timer-value.pulsing {
		animation: timer-pulse 1s ease-in-out infinite;
	}

	@keyframes timer-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

	.timer-code {
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
		margin-bottom: 2rem;
	}

	.organizer-controls {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: center;
	}

	.preset-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.preset-btn {
		padding: 0.5rem 0.875rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, #1e293b);
		background: transparent;
		color: var(--text-secondary, #94a3b8);
		font-size: 0.85rem;
		cursor: pointer;
	}

	.preset-btn.active {
		background: rgba(59, 130, 246, 0.15);
		border-color: var(--primary, #3b82f6);
		color: var(--primary, #3b82f6);
	}

	.control-btn {
		padding: 0.75rem 2rem;
		border-radius: 10px;
		border: none;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		min-width: 140px;
	}

	.start-btn { background: var(--success, #10b981); color: white; }
	.pause-btn { background: var(--warning, #f59e0b); color: white; }
	.reset-btn { background: transparent; border: 1px solid var(--border-color, #1e293b); color: var(--text-secondary, #94a3b8); }
	.reset-btn:hover { border-color: var(--danger, #ef4444); color: var(--danger, #ef4444); }

	@media (prefers-reduced-motion: reduce) {
		.timer-value.pulsing { animation: none; }
	}
</style>
