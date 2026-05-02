<script lang="ts">
	import type { PageData } from './$types';
	import LabelEditor from '$lib/components/admin/LabelEditor.svelte';

	let { data }: { data: PageData } = $props();
	let activeIndex = $state(0);

	const states: Array<{ key: string; label: string }> = [
		{ key: 'auto_labelled', label: 'Auto-labelled (review queue)' },
		{ key: 'auto_failed', label: 'Auto-failed (hand-label)' },
		{ key: 'human_confirmed', label: 'Confirmed' },
		{ key: 'human_corrected', label: 'Corrected' },
		{ key: 'rejected', label: 'Rejected' }
	];

	function gotoState(state: string) {
		const u = new URL(window.location.href);
		u.searchParams.set('state', state);
		window.location.href = u.toString();
	}

	async function saveDecision(
		decision: 'human_confirmed' | 'human_corrected' | 'rejected',
		corners: number[][] | null,
		rejectReason: string | null
	) {
		const row = data.rows[activeIndex];
		if (!row) return;
		const res = await fetch('/api/admin/detector-labels/save', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				id: row.id,
				label_state: decision,
				corners_px: corners,
				reject_reason: rejectReason
			})
		});
		if (!res.ok) {
			console.error('save failed', await res.text());
			return;
		}
		if (activeIndex < data.rows.length - 1) activeIndex++;
		else window.location.reload();
	}

	const activeRow = $derived(data.rows[activeIndex]);
</script>

<div class="page">
	<header>
		<h1>Detector label review</h1>
		<nav>
			{#each states as s}
				<button
					type="button"
					class:active={s.key === data.stateFilter}
					onclick={() => gotoState(s.key)}
				>
					{s.label}
					{#if data.totals?.[s.key]}<span class="count">{data.totals[s.key]}</span>{/if}
				</button>
			{/each}
		</nav>
	</header>

	{#if data.rows.length === 0}
		<p class="empty">No rows in this state.</p>
	{:else if activeRow}
		<aside class="meta">
			<div>{activeIndex + 1} / {data.rows.length}</div>
			<div>{activeRow.cards?.name ?? '—'} · {activeRow.cards?.card_number ?? '—'}</div>
			<div>quality: {activeRow.auto_quality_score?.toFixed(3) ?? '—'}</div>
			<div>aspect: {activeRow.auto_aspect_ratio?.toFixed(3) ?? '—'}</div>
			<div>layer: {activeRow.auto_detection_layer ?? '—'}</div>
		</aside>

		<LabelEditor
			imageUrl={activeRow.source_url}
			imageW={activeRow.image_w}
			imageH={activeRow.image_h}
			initialCorners={activeRow.corners_px}
			onConfirm={(corners) => saveDecision('human_confirmed', corners, null)}
			onCorrect={(corners) => saveDecision('human_corrected', corners, null)}
			onReject={(reason) => saveDecision('rejected', null, reason)}
		/>
	{/if}
</div>

<style>
	.page {
		padding: 1rem;
		max-width: 100%;
	}
	header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	nav button {
		padding: 0.5rem 0.75rem;
		border: 1px solid #444;
		background: transparent;
		color: inherit;
		border-radius: 0.25rem;
	}
	nav button.active {
		background: var(--brand, #3b82f6);
		color: white;
		border-color: transparent;
	}
	.count {
		margin-left: 0.5rem;
		opacity: 0.6;
		font-size: 0.85em;
	}
	.meta {
		display: flex;
		gap: 1rem;
		padding: 0.75rem;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 0.25rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}
	.empty {
		padding: 2rem;
		text-align: center;
		opacity: 0.6;
	}
</style>
