<!--
	Collection Weapons Tab

	Weapon distribution bars with icons and counts, plus rarity breakdown.
-->
<script lang="ts">
	import { getWeapon, WEAPON_HIERARCHY } from '$lib/data/boba-weapons';

	const WEAPON_ICONS: Record<string, string> = {
		super: '👑', gum: '🫧', hex: '💀', glow: '☢️',
		fire: '🔥', ice: '❄️', steel: '🛡️', brawl: '👊',
		alt: '🎭', cyber: '🔮',
	};

	const RARITY_TIERS = [
		{ tier: 'Legendary', keys: ['super', 'gum'], color: '#ffd700', bg: '#ffd70012' },
		{ tier: 'Ultra Rare', keys: ['hex', 'glow'], color: '#a78bfa', bg: '#a78bfa12' },
		{ tier: 'Rare', keys: ['fire', 'ice'], color: '#ef4444', bg: '#ef444412' },
		{ tier: 'Common', keys: ['steel', 'brawl'], color: '#9CA3AF', bg: '#9CA3AF12' },
	];

	let {
		items,
		weaponCounts,
		maxWeaponCount,
	}: {
		items: { length: number };
		weaponCounts: Record<string, number>;
		maxWeaponCount: number;
	} = $props();

	function wIcon(weaponKey: string): string {
		return WEAPON_ICONS[weaponKey.toLowerCase()] ?? '⚔️';
	}
</script>

<div style="animation: countUp 0.3s ease-out">
	<!-- Weapon distribution bars -->
	<div class="panel">
		<div class="panel-title">Weapon Distribution</div>
		{#each WEAPON_HIERARCHY.slice(0, 8) as w}
			{@const count = weaponCounts[w.key] ?? 0}
			{@const pct = items.length > 0 ? (count / items.length * 100) : 0}
			<div class="weapon-row">
				<span class="weapon-icon">{wIcon(w.key)}</span>
				<span class="weapon-name" style="color: {w.color}">{w.name}</span>
				<div class="weapon-track">
					<div
						class="weapon-fill"
						style="
							width: {maxWeaponCount > 0 ? (count / maxWeaponCount * 100) : 0}%;
							background: linear-gradient(90deg, {w.color}88, {w.color});
							box-shadow: {w.rank <= 4 ? `0 0 8px ${w.color}66` : 'none'};
						"
					></div>
					<span class="weapon-count">{count}</span>
				</div>
				<span class="weapon-pct">{pct.toFixed(1)}%</span>
			</div>
		{/each}
	</div>

	<!-- Rarity breakdown -->
	<div class="panel" style="margin-top: 1rem">
		<div class="panel-title">Rarity Breakdown</div>
		{#each RARITY_TIERS as t}
			{@const count = t.keys.reduce((s, k) => s + (weaponCounts[k] ?? 0), 0)}
			{@const pct = items.length > 0 ? ((count / items.length) * 100).toFixed(1) : '0.0'}
			<div class="rarity-row" style="background: {t.bg}">
				<div>
					<div class="rarity-name" style="color: {t.color}">{t.tier}</div>
					<div class="rarity-sub">
						{t.keys.map(k => wIcon(k)).join(' ')}
						{t.keys.map(k => getWeapon(k)?.name ?? k).join(' · ')}
					</div>
				</div>
				<div style="text-align: right">
					<div class="rarity-count" style="color: {t.color}">{count}</div>
					<div class="rarity-pct">{pct}%</div>
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.panel {
		background: #0f172a; border-radius: 14px; padding: 1rem; border: 1px solid #1e293b;
	}
	.panel-title { font-size: 0.8125rem; font-weight: 700; color: #94a3b8; margin-bottom: 0.75rem; }
	.weapon-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
	.weapon-icon { width: 24px; text-align: center; font-size: 0.875rem; }
	.weapon-name { width: 45px; font-size: 0.6875rem; font-weight: 600; }
	.weapon-track { flex: 1; height: 16px; background: #0f172a; border-radius: 8px; overflow: hidden; position: relative; }
	.weapon-fill { height: 100%; border-radius: 8px; transition: width 1s cubic-bezier(0.4, 0, 0.2, 1); }
	.weapon-count {
		position: absolute; right: 6px; top: 0; height: 100%;
		display: flex; align-items: center;
		font-size: 0.625rem; font-weight: 700; color: #e2e8f0;
	}
	.weapon-pct { width: 35px; font-size: 0.625rem; color: #64748b; text-align: right; }
	.rarity-row {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0.625rem 0.75rem; margin-bottom: 6px; border-radius: 10px;
	}
	.rarity-name { font-size: 0.8125rem; font-weight: 700; }
	.rarity-sub { font-size: 0.625rem; color: #64748b; }
	.rarity-count { font-size: 1.125rem; font-weight: 900; }
	.rarity-pct { font-size: 0.625rem; color: #64748b; }

	@keyframes countUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
</style>
