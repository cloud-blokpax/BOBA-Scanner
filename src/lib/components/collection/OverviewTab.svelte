<!--
	Collection Overview Tab

	Set completion rings, aggregate stats, recent scans,
	power distribution, and top 5 most valuable cards.
-->
<script lang="ts">
	import { getWeapon } from '$lib/data/boba-weapons';
	import type { CollectionItem } from '$lib/types';

	let {
		items,
		avgPower,
		parallelCount,
		highPowerCount,
		setCounts,
		recentDays,
		powerBuckets,
		topCards,
		cardValue,
	}: {
		items: CollectionItem[];
		avgPower: number;
		parallelCount: number;
		highPowerCount: number;
		setCounts: Record<string, number>;
		recentDays: { day: number; count: number }[];
		powerBuckets: { power: number; count: number }[];
		topCards: CollectionItem[];
		cardValue: (item: CollectionItem) => number;
	} = $props();

	const SET_META: Record<string, { label: string; color: string; icon: string; totalCards: number }> = {
		G: { label: 'Griffey', color: '#60a5fa', icon: '🏆', totalCards: 60 },
		A: { label: 'Alpha', color: '#f59e0b', icon: '⚔️', totalCards: 60 },
		U: { label: 'Update', color: '#a78bfa', icon: '🔄', totalCards: 60 },
	};

	function wColor(weaponKey: string): string {
		return getWeapon(weaponKey)?.color ?? '#9CA3AF';
	}

	function ringOffset(percent: number, radius: number): number {
		const circ = 2 * Math.PI * radius;
		return circ - (percent / 100) * circ;
	}

	function ringCirc(radius: number): number {
		return 2 * Math.PI * radius;
	}
</script>

<div class="sections" style="animation: countUp 0.4s ease-out">
	<!-- Quick stats -->
	<div class="stat-grid">
		<div class="stat-card">
			<div class="stat-value" style="color: #60a5fa">{avgPower}</div>
			<div class="stat-label">Avg Power</div>
		</div>
		<div class="stat-card">
			<div class="stat-value" style="color: #fbbf24">{parallelCount}</div>
			<div class="stat-label">Parallels</div>
		</div>
		<div class="stat-card">
			<div class="stat-value" style="color: #ef4444">{highPowerCount}</div>
			<div class="stat-label">160+ Power</div>
		</div>
	</div>

	<!-- Set Completion -->
	<div class="panel">
		<div class="panel-title">Set Completion</div>
		<div class="ring-row">
			{#each Object.entries(SET_META) as [key, meta]}
				{@const count = setCounts[key] ?? 0}
				{@const pct = Math.min(99, Math.round((count / meta.totalCards) * 100))}
				{@const r = 36}
				<div class="ring-cell">
					<svg width="80" height="80" style="transform: rotate(-90deg)">
						<circle cx="40" cy="40" r={r} fill="none" stroke="#1e293b" stroke-width="6" />
						<circle cx="40" cy="40" r={r} fill="none" stroke={meta.color} stroke-width="6"
							stroke-dasharray={ringCirc(r)} stroke-dashoffset={ringOffset(pct, r)}
							stroke-linecap="round"
							style="transition: stroke-dashoffset 1.5s cubic-bezier(0.4, 0, 0.2, 1)"
						/>
					</svg>
					<div style="margin-top: -48px; height: 80px; display: flex; flex-direction: column; align-items: center; justify-content: center">
						<span class="ring-pct" style="color: {meta.color}">{pct}%</span>
					</div>
					<div class="ring-label">{meta.label}</div>
					<div class="ring-count">{count}/{meta.totalCards}</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Recent Activity -->
	{#if true}
		{@const maxD = Math.max(...recentDays.map(d => d.count), 1)}
		{@const dayLabels = ['Today', '1d', '2d', '3d', '4d', '5d', '6d']}
		<div class="panel">
			<div class="panel-title">Recent Scans</div>
			<div class="activity-bars">
				{#each recentDays as d, i}
					<div class="activity-col">
						<div
							class="activity-bar"
							style="
								height: {Math.max(4, (d.count / maxD) * 40)}px;
								background: {d.day === 0
									? 'linear-gradient(180deg, #3b82f6, #6366f1)'
									: `rgba(59, 130, 246, ${0.2 + (1 - d.day / 7) * 0.4})`};
							"
						></div>
						<span class="activity-day">{dayLabels[i]}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Power Distribution -->
	{#if true}
		{@const maxC = Math.max(...powerBuckets.map(b => b.count), 1)}
		{@const svgW = 280}
		{@const svgH = 100}
		{@const barW = svgW / powerBuckets.length - 2}
		<div class="panel">
			<div class="panel-title">Power Distribution</div>
			<svg class="power-svg" viewBox="0 0 {svgW} {svgH + 20}">
				{#each powerBuckets as b, i}
					{@const barH = (b.count / maxC) * svgH}
					{@const x = i * (barW + 2)}
					{@const hue = ((b.power - 80) / 120) * 240}
					<rect {x} y={svgH - barH} width={barW} height={barH} rx="3"
						fill="hsl({hue}, 70%, 55%)" opacity="0.85" />
					{#if b.count > 0}
						<text x={x + barW / 2} y={svgH - barH - 4} text-anchor="middle"
							fill="#94a3b8" font-size="8" font-weight="600">{b.count}</text>
					{/if}
					<text x={x + barW / 2} y={svgH + 12} text-anchor="middle"
						fill="#475569" font-size="7">{b.power}</text>
				{/each}
			</svg>
		</div>
	{/if}

	<!-- Top 5 Most Valuable -->
	<div class="panel">
		<div class="panel-title">Most Valuable</div>
		<div class="top-list">
			{#each topCards as card, i}
				{@const wt = card.card?.weapon_type ?? 'steel'}
				<div class="top-row" style="animation-delay: {i * 0.1}s">
					<div class="top-rank" class:gold={i === 0} class:default={i > 0}>{i + 1}</div>
					<div class="top-info">
						<div class="top-name">{card.card?.hero_name ?? card.card?.name ?? 'Unknown'}</div>
						<div class="top-meta" style="color: {wColor(wt)}">
							{getWeapon(wt)?.name ?? wt} &middot; {card.card?.power ?? '?'}
						</div>
					</div>
					<div class="top-value">${cardValue(card).toFixed(2)}</div>
				</div>
			{/each}
			{#if topCards.length === 0}
				<div style="text-align: center; color: #475569; font-size: 0.75rem; padding: 1rem">
					No cards in collection yet
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.sections { display: flex; flex-direction: column; gap: 1rem; }
	.stat-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
	.stat-card {
		background: #0f172a; border-radius: 12px; padding: 0.75rem 0.625rem;
		text-align: center; border: 1px solid #1e293b;
	}
	.stat-card .stat-value { font-size: 1.375rem; font-weight: 900; }
	.stat-card .stat-label { font-size: 0.625rem; color: #64748b; margin-top: 2px; }
	.panel {
		background: #0f172a; border-radius: 14px; padding: 1rem; border: 1px solid #1e293b;
	}
	.panel-title { font-size: 0.8125rem; font-weight: 700; color: #94a3b8; margin-bottom: 0.75rem; }
	.ring-row { display: flex; justify-content: space-around; }
	.ring-cell { text-align: center; }
	.ring-pct { font-size: 1.125rem; font-weight: 800; }
	.ring-label { font-size: 0.6875rem; color: #94a3b8; margin-top: 0.25rem; font-weight: 600; }
	.ring-count { font-size: 0.625rem; color: #475569; }
	.activity-bars { display: flex; gap: 4px; align-items: flex-end; height: 50px; margin-bottom: 0.5rem; }
	.activity-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; }
	.activity-bar { width: 100%; border-radius: 4px; transition: height 0.5s ease; }
	.activity-day { font-size: 0.5rem; color: #475569; }
	.power-svg { width: 100%; overflow: visible; }
	.top-list { display: flex; flex-direction: column; gap: 0.5rem; }
	.top-row {
		display: flex; align-items: center; gap: 0.625rem;
		animation: slideIn 0.3s ease-out both;
	}
	.top-rank {
		width: 24px; height: 24px; border-radius: 6px; display: flex;
		align-items: center; justify-content: center;
		font-size: 0.75rem; font-weight: 800;
	}
	.top-rank.gold { background: linear-gradient(135deg, #ffd700, #f59e0b); color: #000; }
	.top-rank.default { background: #1e293b; color: #64748b; }
	.top-info { flex: 1; }
	.top-name { font-size: 0.75rem; font-weight: 600; }
	.top-meta { font-size: 0.625rem; }
	.top-value { font-size: 0.875rem; font-weight: 800; color: #10b981; }

	@keyframes countUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
	@keyframes slideIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
</style>
