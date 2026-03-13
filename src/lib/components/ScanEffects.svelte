<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { CardRarity } from '$lib/types';

	let {
		scanning = false,
		revealed = false,
		rarity = null,
		weaponType = null
	}: {
		scanning?: boolean;
		revealed?: boolean;
		rarity?: CardRarity | null;
		weaponType?: string | null;
	} = $props();

	// ── Rarity config ──
	const RARITY_CONFIG: Record<string, { count: number; colors: string[]; sizeMin: number; sizeMax: number; life: number; velocity: number; trail: boolean }> = {
		common:     { count: 8,  colors: ['#ffffff', '#d1d5db', '#9ca3af'], sizeMin: 2, sizeMax: 3, life: 0.4, velocity: 80,  trail: false },
		uncommon:   { count: 15, colors: ['#22c55e', '#4ade80', '#86efac'], sizeMin: 2, sizeMax: 4, life: 0.6, velocity: 110, trail: false },
		rare:       { count: 25, colors: ['#3b82f6', '#60a5fa', '#22d3ee'], sizeMin: 3, sizeMax: 5, life: 0.8, velocity: 140, trail: true },
		ultra_rare: { count: 40, colors: ['#a855f7', '#c084fc', '#e879f9', '#ffffff'], sizeMin: 3, sizeMax: 6, life: 1.0, velocity: 160, trail: true },
		legendary:  { count: 60, colors: ['#f59e0b', '#fbbf24', '#fcd34d', '#ffffff'], sizeMin: 4, sizeMax: 8, life: 1.2, velocity: 190, trail: true }
	};

	// ── Weapon accent configs ──
	const WEAPON_COLORS: Record<string, string[]> = {
		Fire:  ['#ef4444', '#f97316', '#fbbf24'],
		Ice:   ['#67e8f9', '#a5f3fc', '#ffffff'],
		Steel: ['#94a3b8', '#cbd5e1', '#ffffff'],
		Hex:   ['#7c3aed', '#a855f7', '#6d28d9'],
		Glow:  ['#fef3c7', '#fde68a', '#ffffff']
	};

	interface Particle {
		x: number; y: number;
		prevX: number; prevY: number;
		vx: number; vy: number;
		color: string; alpha: number;
		size: number; life: number; maxLife: number;
		active: boolean;
		type: 'burst' | 'ring' | 'ember' | 'crystal' | 'sheen' | 'rune' | 'glow';
	}

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let ctx: CanvasRenderingContext2D | null = null;
	let particles: Particle[] = [];
	let animFrame = 0;
	let lastTime = 0;
	let running = false;
	let showVignette = $state(false);

	// Weapon accent state
	let weaponAccentTimer = 0;
	let weaponAccentActive = false;
	let sheenProgress = 0;
	let glowProgress = 0;

	// Track previous revealed state to detect edges
	let prevRevealed = false;
	let prevScanning = false;

	function resizeCanvas() {
		if (!canvasEl) return;
		const parent = canvasEl.parentElement;
		if (!parent) return;
		const rect = parent.getBoundingClientRect();
		canvasEl.width = rect.width;
		canvasEl.height = rect.height;
	}

	let resizeObserver: ResizeObserver | null = null;

	onMount(() => {
		if (!canvasEl) return;
		ctx = canvasEl.getContext('2d');
		resizeCanvas();
		resizeObserver = new ResizeObserver(() => resizeCanvas());
		if (canvasEl.parentElement) {
			resizeObserver.observe(canvasEl.parentElement);
		}
	});

	onDestroy(() => {
		if (animFrame) cancelAnimationFrame(animFrame);
		resizeObserver?.disconnect();
		running = false;
	});

	function startLoop() {
		if (running) return;
		running = true;
		lastTime = performance.now();
		animFrame = requestAnimationFrame(tick);
	}

	function stopLoop() {
		running = false;
		if (animFrame) {
			cancelAnimationFrame(animFrame);
			animFrame = 0;
		}
	}

	function tick(now: number) {
		if (!running || !ctx || !canvasEl) return;
		const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms
		lastTime = now;

		ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

		// Update & draw particles
		let anyAlive = false;
		for (const p of particles) {
			if (!p.active) continue;
			p.life -= dt;
			if (p.life <= 0) { p.active = false; continue; }
			anyAlive = true;

			p.prevX = p.x;
			p.prevY = p.y;
			p.x += p.vx * dt;
			p.y += p.vy * dt;

			// Gravity for embers (upward drift)
			if (p.type === 'ember') {
				p.vy -= 30 * dt;
				p.alpha = 0.5 + 0.5 * Math.sin(p.life * 12); // flicker
			}

			// Crystal growth
			if (p.type === 'crystal') {
				const progress = 1 - (p.life / p.maxLife);
				p.size = p.size * (progress < 0.5 ? progress * 2 : 1);
				p.alpha = progress < 0.7 ? 1 : (1 - progress) / 0.3;
			}

			// Rune spin
			if (p.type === 'rune') {
				p.alpha = Math.min(1, (1 - p.life / p.maxLife) * 3) * (p.life > 0.2 ? 1 : p.life / 0.2);
			}

			// Default fade
			if (p.type === 'burst' || p.type === 'ring') {
				const lifeRatio = p.life / p.maxLife;
				p.alpha = lifeRatio > 0.3 ? 1 : lifeRatio / 0.3;
				// Decelerate
				p.vx *= (1 - 1.5 * dt);
				p.vy *= (1 - 1.5 * dt);
			}

			drawParticle(p);
		}

		// Weapon accent: sheen sweep (Steel)
		if (weaponAccentActive && weaponType === 'Steel') {
			sheenProgress += dt * 1.2;
			if (sheenProgress <= 1) {
				drawSheenSweep(sheenProgress);
				anyAlive = true;
			}
		}

		// Weapon accent: glow pulse (Glow)
		if (weaponAccentActive && weaponType === 'Glow') {
			glowProgress += dt * 1.5;
			if (glowProgress <= 1) {
				drawGlowPulse(glowProgress);
				anyAlive = true;
			}
		}

		// Weapon accent timer
		if (weaponAccentTimer > 0) {
			weaponAccentTimer -= dt;
			if (weaponAccentTimer <= 0 && weaponType) {
				weaponAccentActive = true;
				spawnWeaponParticles(weaponType);
			}
			anyAlive = true;
		}

		if (anyAlive || weaponAccentTimer > 0) {
			animFrame = requestAnimationFrame(tick);
		} else {
			running = false;
			weaponAccentActive = false;
		}
	}

	function drawParticle(p: Particle) {
		if (!ctx || p.alpha <= 0) return;

		ctx.globalAlpha = p.alpha;

		// Trail effect for rare+
		if ((p.type === 'burst' || p.type === 'ring') && p.size >= 3) {
			ctx.globalAlpha = p.alpha * 0.25;
			ctx.fillStyle = p.color;
			ctx.beginPath();
			ctx.arc(p.prevX, p.prevY, p.size * 0.7, 0, Math.PI * 2);
			ctx.fill();
			ctx.globalAlpha = p.alpha;
		}

		if (p.type === 'rune') {
			// Draw a small stroked circle with a cross
			ctx.strokeStyle = p.color;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
			ctx.stroke();
			// Inner cross
			const s = p.size * 0.5;
			ctx.beginPath();
			ctx.moveTo(p.x - s, p.y); ctx.lineTo(p.x + s, p.y);
			ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x, p.y + s);
			ctx.stroke();
		} else {
			// Standard circle particle
			ctx.fillStyle = p.color;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
			ctx.fill();

			// Glow for larger particles
			if (p.size >= 4) {
				ctx.globalAlpha = p.alpha * 0.3;
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
				ctx.fill();
			}
		}

		ctx.globalAlpha = 1;
	}

	function drawSheenSweep(progress: number) {
		if (!ctx || !canvasEl) return;
		const w = canvasEl.width;
		const h = canvasEl.height;
		const x = progress * (w + 100) - 50;

		const grad = ctx.createLinearGradient(x - 40, 0, x + 40, 0);
		grad.addColorStop(0, 'rgba(148,163,184,0)');
		grad.addColorStop(0.3, 'rgba(203,213,225,0.15)');
		grad.addColorStop(0.5, 'rgba(255,255,255,0.3)');
		grad.addColorStop(0.7, 'rgba(203,213,225,0.15)');
		grad.addColorStop(1, 'rgba(148,163,184,0)');

		ctx.fillStyle = grad;
		ctx.fillRect(x - 40, 0, 80, h);
	}

	function drawGlowPulse(progress: number) {
		if (!ctx || !canvasEl) return;
		const cx = canvasEl.width / 2;
		const cy = canvasEl.height / 2;
		const maxR = Math.max(canvasEl.width, canvasEl.height) * 0.4;
		const r = maxR * progress;
		const alpha = progress < 0.3 ? progress / 0.3 : (1 - progress) / 0.7;

		const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
		grad.addColorStop(0, `rgba(254,243,199,${alpha * 0.2})`);
		grad.addColorStop(0.5, `rgba(253,230,138,${alpha * 0.1})`);
		grad.addColorStop(1, 'rgba(255,255,255,0)');

		ctx.fillStyle = grad;
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fill();
	}

	function spawnBurstParticles(r: CardRarity) {
		if (!canvasEl) return;
		const config = RARITY_CONFIG[r] || RARITY_CONFIG.common;
		const cx = canvasEl.width / 2;
		const cy = canvasEl.height / 2;

		// Clear previous
		particles = [];

		for (let i = 0; i < config.count; i++) {
			const angle = (Math.PI * 2 * i) / config.count + (Math.random() - 0.5) * 0.4;
			const speed = config.velocity * (0.6 + Math.random() * 0.8);
			const size = config.sizeMin + Math.random() * (config.sizeMax - config.sizeMin);
			const color = config.colors[Math.floor(Math.random() * config.colors.length)];

			particles.push({
				x: cx, y: cy, prevX: cx, prevY: cy,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				color, alpha: 1, size,
				life: config.life * (0.7 + Math.random() * 0.6),
				maxLife: config.life,
				active: true,
				type: 'burst'
			});
		}

		// Ultra rare: secondary ring burst at delay
		if (r === 'ultra_rare' || r === 'legendary') {
			const ringCount = r === 'legendary' ? 20 : 12;
			for (let i = 0; i < ringCount; i++) {
				const angle = (Math.PI * 2 * i) / ringCount;
				const speed = config.velocity * 0.4;
				const color = config.colors[Math.floor(Math.random() * config.colors.length)];
				particles.push({
					x: cx, y: cy, prevX: cx, prevY: cy,
					vx: Math.cos(angle) * speed,
					vy: Math.sin(angle) * speed,
					color, alpha: 0, size: config.sizeMax,
					life: config.life * 0.8,
					maxLife: config.life * 0.8,
					active: true,
					type: 'ring'
				});
			}
			// Delayed activation for ring particles
			setTimeout(() => {
				for (const p of particles) {
					if (p.type === 'ring') p.alpha = 1;
				}
			}, 300);
		}

		// Legendary: radial lines
		if (r === 'legendary' && ctx) {
			for (let i = 0; i < 8; i++) {
				const angle = (Math.PI * 2 * i) / 8;
				const speed = config.velocity * 1.4;
				particles.push({
					x: cx, y: cy, prevX: cx, prevY: cy,
					vx: Math.cos(angle) * speed,
					vy: Math.sin(angle) * speed,
					color: '#fcd34d', alpha: 1, size: 2,
					life: 0.6, maxLife: 0.6,
					active: true,
					type: 'burst'
				});
			}
		}
	}

	function spawnWeaponParticles(weapon: string) {
		if (!canvasEl) return;
		const w = canvasEl.width;
		const h = canvasEl.height;
		const colors = WEAPON_COLORS[weapon];
		if (!colors) return;

		sheenProgress = 0;
		glowProgress = 0;

		if (weapon === 'Fire') {
			for (let i = 0; i < 12; i++) {
				const x = w * (0.15 + Math.random() * 0.7);
				const color = colors[Math.floor(Math.random() * colors.length)];
				particles.push({
					x, y: h * (0.85 + Math.random() * 0.15),
					prevX: x, prevY: h,
					vx: (Math.random() - 0.5) * 20,
					vy: -(40 + Math.random() * 60),
					color, alpha: 0.8, size: 2 + Math.random() * 3,
					life: 0.8 + Math.random() * 0.5,
					maxLife: 1.2,
					active: true, type: 'ember'
				});
			}
		} else if (weapon === 'Ice') {
			const corners = [[w * 0.12, h * 0.17], [w * 0.88, h * 0.17], [w * 0.12, h * 0.83], [w * 0.88, h * 0.83]];
			for (const [cx, cy] of corners) {
				for (let i = 0; i < 2; i++) {
					const color = colors[Math.floor(Math.random() * colors.length)];
					particles.push({
						x: cx + (Math.random() - 0.5) * 20,
						y: cy + (Math.random() - 0.5) * 20,
						prevX: cx, prevY: cy,
						vx: 0, vy: 0,
						color, alpha: 0, size: 4 + Math.random() * 4,
						life: 1.0, maxLife: 1.0,
						active: true, type: 'crystal'
					});
				}
			}
		} else if (weapon === 'Hex') {
			for (let i = 0; i < 6; i++) {
				const edge = Math.floor(Math.random() * 4);
				let x: number, y: number, vx: number, vy: number;
				if (edge === 0)      { x = Math.random() * w; y = -10; vx = 0; vy = 30; }
				else if (edge === 1) { x = Math.random() * w; y = h + 10; vx = 0; vy = -30; }
				else if (edge === 2) { x = -10; y = Math.random() * h; vx = 30; vy = 0; }
				else                 { x = w + 10; y = Math.random() * h; vx = -30; vy = 0; }
				const color = colors[Math.floor(Math.random() * colors.length)];
				particles.push({
					x, y, prevX: x, prevY: y,
					vx, vy,
					color, alpha: 0, size: 8 + Math.random() * 4,
					life: 1.2, maxLife: 1.2,
					active: true, type: 'rune'
				});
			}
		}
		// Steel and Glow are handled in the draw loop via sheenProgress/glowProgress
	}

	// ── Reactive effect triggers ──
	$effect(() => {
		// Detect scanning start
		if (scanning && !prevScanning) {
			// Scan line is CSS-only, but start the loop for potential future use
		}
		prevScanning = scanning;

		// Detect reveal edge (revealed goes true)
		if (revealed && !prevRevealed) {
			const r = rarity || 'common';
			spawnBurstParticles(r as CardRarity);

			// Legendary vignette
			showVignette = r === 'legendary';
			if (showVignette) {
				setTimeout(() => { showVignette = false; }, 1500);
			}

			// Schedule weapon accent
			if (weaponType && WEAPON_COLORS[weaponType]) {
				weaponAccentTimer = 0.3;
			}

			startLoop();
		}
		if (!revealed && prevRevealed) {
			showVignette = false;
		}
		prevRevealed = revealed;
	});
</script>

<!-- Scan line (CSS-driven) -->
{#if scanning}
	<div class="scan-line"></div>
{/if}

<!-- Particle canvas -->
<canvas
	bind:this={canvasEl}
	class="effects-canvas"
></canvas>

<!-- Legendary vignette -->
{#if showVignette}
	<div class="legendary-vignette"></div>
{/if}

<style>
	.effects-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 10;
	}

	/* ── Scan Line ── */
	.scan-line {
		position: absolute;
		left: 10%;
		right: 10%;
		height: 2px;
		background: linear-gradient(90deg, transparent 0%, #22d3ee 20%, #ffffff 50%, #22d3ee 80%, transparent 100%);
		box-shadow: 0 0 8px 2px rgba(34, 211, 238, 0.5), 0 0 20px 4px rgba(34, 211, 238, 0.2);
		pointer-events: none;
		z-index: 11;
		animation: scan-sweep 2.5s ease-in-out infinite, scan-fade-in 0.3s ease-out;
	}

	@keyframes scan-sweep {
		0%   { top: 15%; }
		50%  { top: 85%; }
		100% { top: 15%; }
	}

	@keyframes scan-fade-in {
		from { opacity: 0; }
		to   { opacity: 1; }
	}

	/* ── Legendary Vignette ── */
	.legendary-vignette {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 12;
		background: radial-gradient(ellipse at center, transparent 45%, rgba(245, 158, 11, 0.25) 100%);
		animation: vignette-pulse 1.5s ease-out forwards;
	}

	@keyframes vignette-pulse {
		0%   { opacity: 0; }
		20%  { opacity: 1; }
		70%  { opacity: 1; }
		100% { opacity: 0; }
	}
</style>
