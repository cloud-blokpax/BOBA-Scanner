<script lang="ts">
	import { getWeapon, WEAPON_HIERARCHY } from '$lib/data/boba-weapons';
	import { TOURNAMENT_FORMATS } from '$lib/data/tournament-formats';
	import { collectionItems } from '$lib/stores/collection.svelte';

	/** Weapon icons for display */
	const WEAPON_ICONS: Record<string, string> = {
		super: '👑', gum: '🫧', hex: '💀', glow: '☢️',
		fire: '🔥', ice: '❄️', steel: '🛡️', brawl: '👊',
	};

	/** Format display metadata (subset of tournament formats relevant to builder) */
	interface BuilderFormat {
		id: string; name: string; prize: string; icon: string; color: string;
		powerCap: number | null; dbsCap: number; minHeroes: number;
		maxPlays: number; bonusPlays: number | 'unlimited';
		combinedPowerCap: number | null;
	}

	const FORMATS: BuilderFormat[] = [
		{ id: 'apex_playmaker', name: 'APEX Playmaker', prize: '$150K', icon: '👑', powerCap: null, dbsCap: 1000, minHeroes: 60, maxPlays: 45, bonusPlays: 'unlimited', color: '#ffd700', combinedPowerCap: null },
		{ id: 'alpha_trilogy', name: 'AlphaTrilogy', prize: '$100K', icon: '🏆', powerCap: null, dbsCap: 1000, minHeroes: 60, maxPlays: 45, bonusPlays: 'unlimited', color: '#c084fc', combinedPowerCap: null },
		{ id: 'spec_playmaker', name: 'SPEC Playmaker', prize: '$50K', icon: '⚡', powerCap: 160, dbsCap: 1000, minHeroes: 60, maxPlays: 45, bonusPlays: 25, color: '#3b82f6', combinedPowerCap: null },
		{ id: 'elite_playmaker', name: 'Elite Playmaker', prize: '$40K', icon: '💎', powerCap: null, dbsCap: 1000, minHeroes: 60, maxPlays: 45, bonusPlays: 25, color: '#10b981', combinedPowerCap: 8250 },
		{ id: 'brawl', name: 'Brawl', prize: '$20K', icon: '👊', powerCap: 140, dbsCap: 800, minHeroes: 60, maxPlays: 30, bonusPlays: 15, color: '#f97316', combinedPowerCap: null },
		{ id: 'blast', name: 'Blast', prize: '$20K', icon: '💥', powerCap: 130, dbsCap: 600, minHeroes: 60, maxPlays: 30, bonusPlays: 10, color: '#ef4444', combinedPowerCap: null },
	];

	/** Demo hero pool */
	interface DemoHero {
		id: number; name: string; weapon: string; power: number; set: string;
	}
	const HERO_POOL: DemoHero[] = [
		{ name: 'Bo Jackson', weapon: 'super', power: 185, set: 'GE' },
		{ name: 'Ken Griffey Jr.', weapon: 'gum', power: 175, set: 'GE' },
		{ name: 'Deion Sanders', weapon: 'hex', power: 168, set: 'GE' },
		{ name: 'Michael Jordan', weapon: 'hex', power: 165, set: 'AE' },
		{ name: 'Wayne Gretzky', weapon: 'glow', power: 160, set: 'AE' },
		{ name: 'Jim Thorpe', weapon: 'glow', power: 158, set: 'AU' },
		{ name: 'Jackie Robinson', weapon: 'fire', power: 155, set: 'GE' },
		{ name: 'Herschel Walker', weapon: 'fire', power: 150, set: 'AE' },
		{ name: 'Babe Ruth', weapon: 'fire', power: 148, set: 'GE' },
		{ name: 'Muhammad Ali', weapon: 'fire', power: 145, set: 'AE' },
		{ name: 'Bruce Lee', weapon: 'ice', power: 145, set: 'AU' },
		{ name: 'Jim Brown', weapon: 'ice', power: 142, set: 'GE' },
		{ name: 'Pelé', weapon: 'ice', power: 140, set: 'AE' },
		{ name: 'Jesse Owens', weapon: 'ice', power: 138, set: 'AU' },
		{ name: 'Jerry Rice', weapon: 'fire', power: 135, set: 'GE' },
		{ name: 'Walter Payton', weapon: 'steel', power: 132, set: 'AE' },
		{ name: 'Joe Montana', weapon: 'steel', power: 130, set: 'GE' },
		{ name: 'Magic Johnson', weapon: 'steel', power: 128, set: 'AE' },
		{ name: 'Larry Bird', weapon: 'steel', power: 125, set: 'AU' },
		{ name: 'Willie Mays', weapon: 'brawl', power: 122, set: 'GE' },
		{ name: 'Hank Aaron', weapon: 'brawl', power: 120, set: 'AE' },
		{ name: 'Mickey Mantle', weapon: 'steel', power: 118, set: 'GE' },
		{ name: 'Ted Williams', weapon: 'brawl', power: 115, set: 'AU' },
		{ name: 'Nolan Ryan', weapon: 'steel', power: 112, set: 'AE' },
		{ name: 'Roberto Clemente', weapon: 'brawl', power: 110, set: 'GE' },
		{ name: 'Stan Musial', weapon: 'steel', power: 108, set: 'AU' },
		{ name: 'Reggie Jackson', weapon: 'brawl', power: 105, set: 'AE' },
		{ name: 'Pete Rose', weapon: 'steel', power: 102, set: 'GE' },
		{ name: 'Johnny Bench', weapon: 'brawl', power: 100, set: 'AU' },
		{ name: 'Ty Cobb', weapon: 'steel', power: 98, set: 'AE' },
		{ name: 'Carl Lewis', weapon: 'brawl', power: 95, set: 'GE' },
		{ name: 'Wilt Chamberlain', weapon: 'steel', power: 92, set: 'AU' },
	].map((h, i) => ({ ...h, id: i }));

	/** Demo play pool */
	interface DemoPlay {
		id: number; name: string; type: 'PL' | 'BPL'; dbs: number;
		cost: number; ability: string; category: string;
	}
	const PLAY_POOL: DemoPlay[] = [
		{ name: 'Dog Gone Inflation', type: 'PL', dbs: 90, cost: 1, ability: "Opponent's Plays cost +2 HD", category: 'control' },
		{ name: 'Add Firepower', type: 'PL', dbs: 39, cost: 2, ability: 'Flip 4 coins, draw or recover per heads', category: 'draw' },
		{ name: 'Back From The Dumps', type: 'PL', dbs: 39, cost: 0, ability: 'Both players recover 3 HD', category: 'recovery' },
		{ name: "It's Gonna Cost Ya", type: 'PL', dbs: 37, cost: 0, ability: 'Hero -15 but recover 2 HD', category: 'recovery' },
		{ name: 'Win The Toss', type: 'PL', dbs: 34, cost: 1, ability: 'Flip: run top Play for free', category: 'draw' },
		{ name: '1-4-1 Play', type: 'PL', dbs: 34, cost: 1, ability: 'Draw a Play', category: 'draw' },
		{ name: 'Victory Dinner', type: 'PL', dbs: 34, cost: 1, ability: 'Win = recover 3 HD', category: 'recovery' },
		{ name: 'Adding Depth', type: 'PL', dbs: 32, cost: 2, ability: 'Draw from Playbook or Hero Deck', category: 'draw' },
		{ name: 'Deadline Deal', type: 'PL', dbs: 24, cost: 3, ability: 'Swap powers this battle', category: 'power' },
		{ name: 'Get What You Pay For', type: 'PL', dbs: 24, cost: 0, ability: '+10 per HD paid', category: 'power' },
		{ name: 'No Huddle', type: 'PL', dbs: 23, cost: 0, ability: 'If ran a Play last battle, +15', category: 'power' },
		{ name: "Don't Call It A Comeback", type: 'PL', dbs: 21, cost: 1, ability: 'Replace hero from discard', category: 'utility' },
		{ name: 'Late Game Magic', type: 'PL', dbs: 17, cost: 2, ability: 'Battle 5+: Hero +20', category: 'power' },
		{ name: 'Easy Choice', type: 'PL', dbs: 17, cost: 1, ability: 'You choose who gets Honors', category: 'control' },
		{ name: 'Front Run', type: 'PL', dbs: 16, cost: 2, ability: "If opponent hasn't played: +20", category: 'power' },
		{ name: 'Tough Call', type: 'PL', dbs: 43, cost: 2, ability: 'Reveal top 3 Plays, choose 1', category: 'draw' },
		{ name: 'A Hard Bargain', type: 'BPL', dbs: 73, cost: 2, ability: 'Flip opponent hero, if 130+ they stop', category: 'control' },
		{ name: 'Hungry Demands', type: 'BPL', dbs: 34, cost: 3, ability: 'Opponent discards 2 HD', category: 'control' },
		{ name: 'Clean Slate', type: 'BPL', dbs: 49, cost: 1, ability: 'Both discard all Plays, draw 3', category: 'draw' },
		{ name: 'Turn the Tide', type: 'BPL', dbs: 1, cost: 4, ability: 'Lost first 3? Hero +60', category: 'power' },
		{ name: 'The Perfect Offense', type: 'BPL', dbs: 1, cost: 6, ability: 'Cancel all opponent Plays this battle', category: 'control' },
		{ name: 'Bull Market', type: 'BPL', dbs: 20, cost: 2, ability: 'Flip: opponent Plays +1 HD cost', category: 'control' },
	].map((p, i) => ({ ...p, id: i })) as DemoPlay[];

	const CATEGORIES: Record<string, { label: string; color: string; icon: string }> = {
		power: { label: 'Power Boost', color: '#ef4444', icon: '⚡' },
		draw: { label: 'Card Draw', color: '#3b82f6', icon: '🎴' },
		recovery: { label: 'HD Recovery', color: '#10b981', icon: '🌭' },
		control: { label: 'Disruption', color: '#a855f7', icon: '🎯' },
		utility: { label: 'Utility', color: '#f59e0b', icon: '🔧' },
	};

	// ── State ──────────────────────────────────────────────
	let format = $state<BuilderFormat>(FORMATS[2]);
	let heroes = $state<DemoHero[]>([]);
	let plays = $state<DemoPlay[]>([]);
	let activeTab = $state<'heroes' | 'plays' | 'analysis'>('heroes');
	let searchHero = $state('');
	let searchPlay = $state('');

	// ── Actions ────────────────────────────────────────────
	function addHero(hero: DemoHero) {
		if (heroes.find(h => h.id === hero.id)) return;
		heroes = [...heroes, hero].sort((a, b) => b.power - a.power);
	}

	function removeHero(index: number) {
		heroes = heroes.filter((_, i) => i !== index);
	}

	function addPlay(play: DemoPlay) {
		if (plays.find(p => p.id === play.id)) return;
		plays = [...plays, play];
	}

	function removePlay(index: number) {
		plays = plays.filter((_, i) => i !== index);
	}

	// ── Analysis ───────────────────────────────────────────
	const totalDbs = $derived(plays.reduce((s, p) => s + p.dbs, 0));
	const totalPower = $derived(heroes.reduce((s, h) => s + h.power, 0));
	const avgPower = $derived(heroes.length > 0 ? Math.round(totalPower / heroes.length) : 0);
	const plCount = $derived(plays.filter(p => p.type === 'PL').length);
	const bplCount = $derived(plays.filter(p => p.type === 'BPL').length);
	const freePlays = $derived(plays.filter(p => p.cost === 0).length);
	const avgCost = $derived(plays.length > 0 ? (plays.reduce((s, p) => s + p.cost, 0) / plays.length).toFixed(1) : '0');

	const catCounts = $derived(() => {
		const counts: Record<string, number> = {};
		for (const p of plays) counts[p.category] = (counts[p.category] || 0) + 1;
		return counts;
	});

	const deckWeaponCounts = $derived(() => {
		const counts: Record<string, number> = {};
		for (const h of heroes) counts[h.weapon] = (counts[h.weapon] || 0) + 1;
		return counts;
	});

	interface Violation { type: string; heroes?: DemoHero[] }
	const violations = $derived(() => {
		const v: Violation[] = [];
		if (format.powerCap) {
			const overCap = heroes.filter(h => h.power > format.powerCap!);
			if (overCap.length > 0) v.push({ type: 'power_cap', heroes: overCap });
		}
		if (totalDbs > format.dbsCap) v.push({ type: 'dbs_over' });
		if (format.combinedPowerCap && totalPower > format.combinedPowerCap) v.push({ type: 'combined_power' });
		if (format.bonusPlays !== 'unlimited' && bplCount > format.bonusPlays) v.push({ type: 'bonus_limit' });
		return v;
	});

	const violatedHeroIds = $derived(() => {
		if (!format.powerCap) return new Set<number>();
		return new Set(heroes.filter(h => h.power > format.powerCap!).map(h => h.id));
	});

	const filteredHeroes = $derived(() => {
		let pool = HERO_POOL.filter(h => !heroes.find(x => x.id === h.id));
		if (searchHero) pool = pool.filter(h => h.name.toLowerCase().includes(searchHero.toLowerCase()));
		return pool;
	});

	const filteredPlays = $derived(() => {
		let pool = PLAY_POOL.filter(p => !plays.find(x => x.id === p.id));
		if (searchPlay) pool = pool.filter(p => p.name.toLowerCase().includes(searchPlay.toLowerCase()));
		return pool;
	});

	// ── Collection awareness ──────────────────────────────────
	const ownedHeroNames = $derived(() => {
		const names = new Set<string>();
		for (const item of collectionItems()) {
			if (item.card?.hero_name) names.add(item.card.hero_name.toLowerCase());
		}
		return names;
	});

	// ── Helpers ─────────────────────────────────────────────
	function wColor(key: string): string { return getWeapon(key)?.color ?? '#9CA3AF'; }
	function wIcon(key: string): string { return WEAPON_ICONS[key] ?? '⚔️'; }
	function wLabel(key: string): string { return getWeapon(key)?.name ?? key; }

	function dbsPct(): number { return Math.min(100, (totalDbs / format.dbsCap) * 100); }
	function dbsOver(): boolean { return totalDbs > format.dbsCap; }
	function dbsRemaining(): number { return format.dbsCap - totalDbs; }
</script>

<svelte:head>
	<title>Deck Builder | BOBA Scanner</title>
</svelte:head>

<div class="builder-page">
	<!-- Header -->
	<div class="builder-header">
		<div class="header-label">BoBA Scanner</div>
		<h1 style="background: linear-gradient(135deg, {format.color}, #e2e8f0); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text">
			Deck Builder
		</h1>

		<!-- Format selector -->
		<div class="format-chips">
			{#each FORMATS as f}
				<button
					class="format-chip"
					class:active={format.id === f.id}
					style="
						background: {format.id === f.id ? `${f.color}22` : '#1e293b'};
						color: {format.id === f.id ? f.color : '#475569'};
						border-bottom: 2px solid {format.id === f.id ? f.color : 'transparent'};
					"
					onclick={() => format = f}
				>
					{f.icon} {f.name.split(' ')[0]}
				</button>
			{/each}
		</div>

		<!-- Format info bar -->
		<div class="format-info">
			<span>Prize: <strong style="color: #ffd700">{format.prize}</strong></span>
			<span>Power Cap: <strong style="color: {format.powerCap ? '#ef4444' : '#10b981'}">{format.powerCap ?? 'None'}</strong></span>
			<span>DBS Cap: <strong style="color: #3b82f6">{format.dbsCap}</strong></span>
			<span>Max Plays: <strong style="color: #a78bfa">{format.maxPlays}</strong></span>
		</div>
	</div>

	<!-- DBS Gauge -->
	<div class="gauge-wrap">
		<div class="gauge-header">
			<span class="gauge-label">DBS Budget</span>
			<span class="gauge-value" style="color: {dbsOver() ? '#ef4444' : dbsRemaining() < 100 ? '#f59e0b' : '#10b981'}">
				{totalDbs} / {format.dbsCap} {dbsOver() ? '⚠️ OVER' : `(${dbsRemaining()} left)`}
			</span>
		</div>
		<div class="gauge-track">
			<div
				class="gauge-fill"
				style="
					width: {Math.min(dbsPct(), 100)}%;
					background: {dbsOver()
						? 'linear-gradient(90deg, #ef4444, #dc2626)'
						: dbsPct() > 80
						? 'linear-gradient(90deg, #f59e0b, #ef4444)'
						: `linear-gradient(90deg, ${format.color}88, ${format.color})`};
					box-shadow: {dbsOver() ? '0 0 12px #ef444466' : 'none'};
				"
			></div>
			{#each [250, 500, 750] as mark}
				<div class="gauge-marker" style="left: {(mark / format.dbsCap) * 100}%"></div>
			{/each}
		</div>
	</div>

	<!-- Quick stats -->
	<div class="quick-stats">
		{#each [
			{ v: heroes.length, l: 'Heroes', c: format.color },
			{ v: plCount, l: 'Plays', c: '#3b82f6' },
			{ v: bplCount, l: 'Bonus', c: '#a78bfa' },
			{ v: avgPower, l: 'Avg PWR', c: '#ef4444' },
		] as s}
			<div class="qs-card">
				<div class="qs-value" style="color: {s.c}">{s.v}</div>
				<div class="qs-label">{s.l}</div>
			</div>
		{/each}
	</div>

	<!-- Tabs -->
	<div class="tabs">
		{#each [
			{ id: 'heroes', label: `Heroes (${heroes.length})`, icon: '⚔️' },
			{ id: 'plays', label: `Plays (${plays.length})`, icon: '📜' },
			{ id: 'analysis', label: 'Analysis', icon: '📊' },
		] as t}
			<button
				class="tab-btn"
				style="background: {activeTab === t.id ? `${format.color}22` : '#1e293b'}; color: {activeTab === t.id ? format.color : '#475569'}"
				onclick={() => activeTab = t.id as typeof activeTab}
			>
				{t.icon} {t.label}
			</button>
		{/each}
	</div>

	<div class="tab-content">
		<!-- ════════ Heroes Tab ════════ -->
		{#if activeTab === 'heroes'}
			<div class="tab-anim">
				<!-- Current roster -->
				{#if heroes.length > 0}
					<div class="roster-section">
						<div class="roster-label">
							Your Roster &mdash; {heroes.length} heroes
							{#if format.combinedPowerCap}
								<span style="color: {totalPower > format.combinedPowerCap ? '#ef4444' : '#10b981'}; margin-left: 6px">
									(CP: {totalPower}/{format.combinedPowerCap})
								</span>
							{/if}
						</div>
						<div class="roster-list">
							{#each heroes as hero, i}
								{@const w = getWeapon(hero.weapon)}
								{@const isViolated = violatedHeroIds().has(hero.id)}
								<div
									class="hero-slot"
									style="
										background: linear-gradient(135deg, {wColor(hero.weapon)}15, #0f172a);
										border-color: {isViolated ? '#ef4444' : `${wColor(hero.weapon)}44`};
										box-shadow: {isViolated ? '0 0 8px #ef444433' : (w?.rank ?? 8) <= 4 ? `0 0 6px ${wColor(hero.weapon)}22` : 'none'};
									"
								>
									<div class="hero-info">
										<div class="hero-name">{hero.name}</div>
										<div class="hero-meta">
											<span style="color: {wColor(hero.weapon)}">{wIcon(hero.weapon)} {wLabel(hero.weapon)}</span>
										</div>
									</div>
									<div class="hero-power-block">
										<span
											class="hero-power"
											style="color: {wColor(hero.weapon)}; text-shadow: {(w?.rank ?? 8) <= 4 ? `0 0 8px ${wColor(hero.weapon)}66` : 'none'}"
										>{hero.power}</span>
										{#if isViolated}
											<span class="over-cap-label">OVER CAP</span>
										{/if}
									</div>
									<button class="remove-btn" onclick={() => removeHero(i)}>&times;</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Add heroes search -->
				<div>
					<input
						class="search-input"
						type="text"
						placeholder="Search heroes..."
						bind:value={searchHero}
					/>
					<div class="add-list">
						{#each filteredHeroes() as h}
							{@const wouldViolate = format.powerCap != null && h.power > format.powerCap}
							{@const owned = ownedHeroNames().has(h.name.toLowerCase())}
							<button class="add-item" class:owned onclick={() => addHero(h)}>
								<div class="add-item-info">
									<div class="add-item-name">{h.name}</div>
									<div class="add-item-meta" style="color: {wColor(h.weapon)}">{wIcon(h.weapon)} {wLabel(h.weapon)} &middot; {h.set}</div>
								</div>
								<div class="add-item-right">
									{#if owned}
										<span class="own-badge" title="In your collection">{'\u2713'}</span>
									{:else}
										<span class="need-badge" title="Not in collection">Need</span>
									{/if}
									{#if wouldViolate}<span class="warn-icon">{'\u26A0\uFE0F'}</span>{/if}
									<span class="add-item-power" style="color: {wColor(h.weapon)}">{h.power}</span>
									<span class="add-icon">+</span>
								</div>
							</button>
						{/each}
					</div>
				</div>
			</div>
		{/if}

		<!-- ════════ Plays Tab ════════ -->
		{#if activeTab === 'plays'}
			<div class="tab-anim">
				<!-- Current plays -->
				{#if plays.length > 0}
					<div class="roster-section">
						<div class="roster-label">
							Playbook &mdash; {plCount} plays, {bplCount} bonus &middot; Avg HD cost: {avgCost}
						</div>
						<div class="roster-list">
							{#each plays as play, i}
								{@const cat = CATEGORIES[play.category] ?? CATEGORIES.utility}
								<div class="play-slot">
									<span class="play-cat-icon">{cat.icon}</span>
									<div class="play-info">
										<div class="play-name">
											{play.name}
											{#if play.type === 'BPL'}<span class="bpl-tag">BPL</span>{/if}
										</div>
										<div class="play-ability">{play.ability}</div>
									</div>
									<div class="play-cost-block">
										<div class="play-dbs">{play.dbs}</div>
										<div class="play-hd">{play.cost} 🌭</div>
									</div>
									<button class="remove-btn small" onclick={() => removePlay(i)}>&times;</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Add plays search -->
				<input
					class="search-input"
					type="text"
					placeholder="Search plays..."
					bind:value={searchPlay}
				/>
				<div class="add-list">
					{#each filteredPlays() as p}
						{@const cat = CATEGORIES[p.category] ?? CATEGORIES.utility}
						{@const wouldExceed = totalDbs + p.dbs > format.dbsCap}
						<button class="add-item" onclick={() => addPlay(p)}>
							<span class="play-cat-icon">{cat.icon}</span>
							<div class="add-item-info">
								<div class="add-item-name">
									{p.name}
									{#if p.type === 'BPL'}<span class="bpl-tag">BPL</span>{/if}
								</div>
								<div class="add-item-meta" style="color: #475569">{p.ability}</div>
							</div>
							<div class="add-item-right">
								{#if wouldExceed}<span class="warn-icon pulse">⚠️ OVER</span>{/if}
								<span class="play-add-dbs" style="color: {wouldExceed ? '#ef4444' : '#f59e0b'}">{p.dbs}</span>
								<span class="add-item-meta">{p.cost} 🌭</span>
							</div>
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- ════════ Analysis Tab ════════ -->
		{#if activeTab === 'analysis'}
			<div class="tab-anim sections">
				<!-- Validation -->
				<div class="panel">
					<div class="panel-title">{format.icon} {format.name} Validation</div>
					<div class="validation-list">
						<!-- DBS -->
						<div class="vbadge" class:pass={totalDbs <= format.dbsCap} class:fail={totalDbs > format.dbsCap}>
							<span class="vbadge-icon">{totalDbs <= format.dbsCap ? '✅' : '❌'}</span>
							<div class="vbadge-info">
								<div class="vbadge-label">DBS Budget</div>
								<div class="vbadge-detail">{totalDbs} / {format.dbsCap} DBS</div>
							</div>
						</div>
						<!-- Power cap -->
						{#if format.powerCap}
							{@const pcViolation = violations().find(v => v.type === 'power_cap')}
							<div class="vbadge" class:pass={!pcViolation} class:fail={!!pcViolation}>
								<span class="vbadge-icon">{!pcViolation ? '✅' : '❌'}</span>
								<div class="vbadge-info">
									<div class="vbadge-label">Power Cap ({format.powerCap})</div>
									<div class="vbadge-detail">{pcViolation ? `${pcViolation.heroes?.length ?? 0} heroes over cap` : 'All heroes within cap'}</div>
								</div>
							</div>
						{/if}
						<!-- Combined power -->
						{#if format.combinedPowerCap}
							<div class="vbadge" class:pass={totalPower <= format.combinedPowerCap} class:fail={totalPower > format.combinedPowerCap}>
								<span class="vbadge-icon">{totalPower <= format.combinedPowerCap ? '✅' : '❌'}</span>
								<div class="vbadge-info">
									<div class="vbadge-label">Combined Power ({format.combinedPowerCap})</div>
									<div class="vbadge-detail">{totalPower} total power</div>
								</div>
							</div>
						{/if}
						<!-- Standard plays -->
						<div class="vbadge" class:pass={plCount <= format.maxPlays} class:fail={plCount > format.maxPlays}>
							<span class="vbadge-icon">{plCount <= format.maxPlays ? '✅' : '❌'}</span>
							<div class="vbadge-info">
								<div class="vbadge-label">Standard Plays (max {format.maxPlays})</div>
								<div class="vbadge-detail">{plCount} plays selected</div>
							</div>
						</div>
						<!-- Bonus plays -->
						{#if format.bonusPlays !== 'unlimited'}
							<div class="vbadge" class:pass={bplCount <= format.bonusPlays} class:fail={bplCount > format.bonusPlays}>
								<span class="vbadge-icon">{bplCount <= format.bonusPlays ? '✅' : '❌'}</span>
								<div class="vbadge-info">
									<div class="vbadge-label">Bonus Plays (max {format.bonusPlays})</div>
									<div class="vbadge-detail">{bplCount} bonus plays</div>
								</div>
							</div>
						{/if}
					</div>
				</div>

				<!-- Strategy Mix -->
				<div class="panel">
					<div class="panel-title">Play Strategy Mix</div>
					{#if plays.length === 0}
						<div class="empty-msg">Add plays to see strategy analysis</div>
					{:else}
						<div class="sections-inner">
							{#each Object.entries(CATEGORIES) as [key, cat]}
								{@const count = catCounts()[key] ?? 0}
								{#if count > 0}
									{@const pct = Math.round((count / plays.length) * 100)}
									<div class="strategy-row">
										<span class="strategy-icon">{cat.icon}</span>
										<div class="strategy-bar-wrap">
											<div class="strategy-header">
												<span style="color: {cat.color}; font-weight: 600; font-size: 0.6875rem">{cat.label}</span>
												<span class="strategy-pct">{count} ({pct}%)</span>
											</div>
											<div class="strategy-track">
												<div class="strategy-fill" style="width: {pct}%; background: linear-gradient(90deg, {cat.color}88, {cat.color})"></div>
											</div>
										</div>
									</div>
								{/if}
							{/each}
						</div>
					{/if}
				</div>

				<!-- Weapon spread -->
				{#if heroes.length > 0}
					<div class="panel">
						<div class="panel-title">Hero Weapon Spread</div>
						<div class="weapon-chips">
							{#each Object.entries(deckWeaponCounts()).filter(([, c]) => c > 0).sort(([, a], [, b]) => b - a) as [key, count]}
								<div class="weapon-chip" style="background: {wColor(key)}15; border-color: {wColor(key)}33">
									<div class="wc-icon">{wIcon(key)}</div>
									<div class="wc-count" style="color: {wColor(key)}">{count}</div>
									<div class="wc-label">{wLabel(key)}</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- HD Economy -->
				{#if plays.length > 0}
					<div class="panel">
						<div class="panel-title">🌭 Hot Dog Economy</div>
						<div class="hd-grid">
							<div class="hd-stat">
								<div class="hd-value" style="color: #10b981">{freePlays}</div>
								<div class="hd-label">Free Plays</div>
							</div>
							<div class="hd-stat">
								<div class="hd-value" style="color: #f59e0b">{avgCost}</div>
								<div class="hd-label">Avg HD Cost</div>
							</div>
							<div class="hd-stat">
								<div class="hd-value" style="color: #ef4444">{plays.filter(p => p.cost >= 3).length}</div>
								<div class="hd-label">Expensive (3+)</div>
							</div>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<div class="footer">boba.cards &mdash; Tournament Deck Builder</div>
</div>

<style>
	/* ── Layout ───────────────────────────────── */
	.builder-page { max-width: 480px; margin: 0 auto; padding-bottom: 60px; }

	/* ── Header ───────────────────────────────── */
	.builder-header { padding: 1rem 1rem 0; }
	.header-label { font-size: 0.6875rem; color: #64748b; letter-spacing: 2px; text-transform: uppercase; }
	h1 { font-size: 1.375rem; font-weight: 900; margin: 2px 0 0.5rem; }

	.format-chips { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 0.5rem; }
	.format-chip {
		padding: 6px 10px; border-radius: 8px; border: none; cursor: pointer;
		font-size: 0.6875rem; font-weight: 700; white-space: nowrap;
	}
	.format-info {
		display: flex; gap: 8px; padding: 0.5rem 0; border-bottom: 1px solid #1e293b;
		flex-wrap: wrap; font-size: 0.625rem; color: #64748b;
	}
	.format-info strong { font-weight: 800; }

	/* ── DBS Gauge ────────────────────────────── */
	.gauge-wrap { padding: 0.75rem 1rem; }
	.gauge-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
	.gauge-label { font-size: 0.6875rem; color: #64748b; font-weight: 600; }
	.gauge-value { font-size: 0.6875rem; font-weight: 800; }
	.gauge-track { height: 10px; background: #1e293b; border-radius: 6px; overflow: hidden; position: relative; }
	.gauge-fill { height: 100%; border-radius: 6px; transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1); }
	.gauge-marker { position: absolute; top: 0; bottom: 0; width: 1px; background: #334155; }

	/* ── Quick Stats ──────────────────────────── */
	.quick-stats { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 6px; padding: 0 1rem 0.75rem; }
	.qs-card {
		background: #0f172a; border-radius: 10px; padding: 0.5rem 0.375rem;
		text-align: center; border: 1px solid #1e293b;
	}
	.qs-value { font-size: 1.125rem; font-weight: 900; }
	.qs-label { font-size: 0.5625rem; color: #475569; }

	/* ── Tabs ─────────────────────────────────── */
	.tabs { display: flex; gap: 4px; padding: 0 1rem 0.75rem; }
	.tab-btn {
		flex: 1; padding: 0.5rem 0.25rem; border-radius: 10px; border: none; cursor: pointer;
		font-size: 0.75rem; font-weight: 700;
	}
	.tab-content { padding: 0 1rem; }
	.tab-anim { animation: fadeUp 0.3s ease-out; }

	/* ── Shared ───────────────────────────────── */
	.panel { background: #0f172a; border-radius: 14px; padding: 0.875rem; border: 1px solid #1e293b; }
	.panel-title { font-size: 0.8125rem; font-weight: 700; color: #94a3b8; margin-bottom: 0.625rem; }
	.sections { display: flex; flex-direction: column; gap: 0.75rem; }
	.sections-inner { display: flex; flex-direction: column; gap: 6px; }
	.empty-msg { font-size: 0.75rem; color: #334155; text-align: center; padding: 1rem; }

	/* ── Roster / List ────────────────────────── */
	.roster-section { margin-bottom: 1rem; }
	.roster-label { font-size: 0.75rem; font-weight: 700; color: #94a3b8; margin-bottom: 0.5rem; }
	.roster-list { display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto; }

	/* ── Hero Slot ────────────────────────────── */
	.hero-slot {
		display: flex; align-items: center; gap: 8px;
		border-radius: 10px; padding: 0.5rem 0.625rem;
		border-width: 1px; border-style: solid; position: relative;
		transition: all 0.2s;
	}
	.hero-info { flex: 1; }
	.hero-name { font-size: 0.75rem; font-weight: 700; color: #e2e8f0; }
	.hero-meta { font-size: 0.5625rem; font-weight: 700; margin-top: 2px; }
	.hero-power-block { text-align: right; }
	.hero-power { font-size: 1.25rem; font-weight: 900; }
	.over-cap-label { font-size: 0.5rem; color: #ef4444; font-weight: 700; }

	/* ── Play Slot ────────────────────────────── */
	.play-slot {
		display: flex; align-items: center; gap: 8px;
		padding: 0.5rem 0.625rem; border-radius: 8px;
		background: #0f172a; border: 1px solid #1e293b; position: relative;
	}
	.play-cat-icon { font-size: 0.875rem; }
	.play-info { flex: 1; }
	.play-name { font-size: 0.6875rem; font-weight: 600; color: #e2e8f0; }
	.play-ability { font-size: 0.5625rem; color: #475569; }
	.bpl-tag { font-size: 0.5625rem; color: #a78bfa; margin-left: 4px; }
	.play-cost-block { text-align: right; }
	.play-dbs { font-size: 0.75rem; font-weight: 800; color: #f59e0b; }
	.play-hd { font-size: 0.5625rem; color: #64748b; }

	/* ── Remove button ────────────────────────── */
	.remove-btn {
		position: absolute; top: 4px; right: 4px; width: 18px; height: 18px;
		border-radius: 50%; border: none; background: #ef444433;
		color: #ef4444; font-size: 0.625rem; cursor: pointer;
		display: flex; align-items: center; justify-content: center;
	}
	.remove-btn.small { width: 16px; height: 16px; top: 3px; right: 3px; font-size: 0.5625rem; }

	/* ── Search & Add list ────────────────────── */
	.search-input {
		width: 100%; padding: 0.625rem 0.875rem; border-radius: 10px;
		border: 1px solid #1e293b; background: #0f172a;
		color: #e2e8f0; font-size: 0.8125rem; outline: none; margin-bottom: 0.5rem;
		box-sizing: border-box;
	}
	.search-input:focus { border-color: #334155; }
	.add-list { display: flex; flex-direction: column; gap: 4px; max-height: 300px; overflow-y: auto; }
	.add-item {
		display: flex; align-items: center; justify-content: space-between; gap: 8px;
		padding: 0.5rem 0.75rem; border-radius: 8px; border: 1px solid #1e293b;
		background: #0f172a; cursor: pointer; width: 100%; text-align: left;
	}
	.add-item-info { flex: 1; }
	.add-item-name { font-size: 0.75rem; font-weight: 600; color: #e2e8f0; }
	.add-item-meta { font-size: 0.625rem; }
	.add-item-right { display: flex; align-items: center; gap: 6px; }
	.add-item-power { font-size: 1rem; font-weight: 900; }
	.add-icon { font-size: 1rem; color: #334155; }
	.warn-icon { font-size: 0.5625rem; color: #ef4444; }
	.warn-icon.pulse { animation: pulse 1s infinite; }
	.play-add-dbs { font-size: 0.8125rem; font-weight: 800; }

	/* Collection awareness */
	.add-item.owned { border-left: 2px solid var(--success, #10b981); }
	.own-badge { font-size: 0.7rem; color: var(--success, #10b981); font-weight: 700; flex-shrink: 0; }
	.need-badge {
		font-size: 0.65rem; color: var(--text-muted, #475569);
		background: var(--bg-surface, #0d1524); padding: 2px 6px;
		border-radius: 4px; flex-shrink: 0;
	}

	/* ── Validation badges ────────────────────── */
	.validation-list { display: flex; flex-direction: column; gap: 6px; }
	.vbadge {
		display: flex; align-items: center; gap: 8px; padding: 0.5rem 0.75rem;
		border-radius: 8px; border: 1px solid;
	}
	.vbadge.pass { background: #10b98112; border-color: #10b98133; }
	.vbadge.fail { background: #ef444412; border-color: #ef444433; }
	.vbadge-icon { font-size: 1rem; }
	.vbadge-info { flex: 1; }
	.vbadge-label { font-size: 0.75rem; font-weight: 600; }
	.vbadge.pass .vbadge-label { color: #10b981; }
	.vbadge.fail .vbadge-label { color: #ef4444; }
	.vbadge-detail { font-size: 0.625rem; color: #64748b; }

	/* ── Strategy bars ────────────────────────── */
	.strategy-row { display: flex; align-items: center; gap: 8px; }
	.strategy-icon { font-size: 0.875rem; width: 20px; }
	.strategy-bar-wrap { flex: 1; }
	.strategy-header { display: flex; justify-content: space-between; margin-bottom: 2px; }
	.strategy-pct { font-size: 0.625rem; color: #64748b; }
	.strategy-track { height: 6px; background: #1e293b; border-radius: 3px; overflow: hidden; }
	.strategy-fill { height: 100%; border-radius: 3px; transition: width 0.5s ease; }

	/* ── Weapon chips ─────────────────────────── */
	.weapon-chips { display: flex; gap: 4px; flex-wrap: wrap; }
	.weapon-chip {
		border-radius: 8px; padding: 6px 10px; text-align: center;
		border-width: 1px; border-style: solid;
	}
	.wc-icon { font-size: 1rem; }
	.wc-count { font-size: 0.875rem; font-weight: 900; }
	.wc-label { font-size: 0.5625rem; color: #64748b; }

	/* ── HD Economy ───────────────────────────── */
	.hd-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
	.hd-stat { text-align: center; }
	.hd-value { font-size: 1.25rem; font-weight: 900; }
	.hd-label { font-size: 0.5625rem; color: #64748b; }

	/* ── Footer ───────────────────────────────── */
	.footer {
		position: fixed; bottom: 0; left: 0; right: 0;
		padding: 0.75rem 1rem;
		background: linear-gradient(transparent, #020617 30%);
		text-align: center; font-size: 0.625rem; color: #1e293b;
	}

	/* ── Keyframes ────────────────────────────── */
	@keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
	@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
</style>
