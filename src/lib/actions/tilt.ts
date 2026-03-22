/**
 * Card tilt action — CSS 3D perspective effect on hover/touch/gyroscope
 * with holographic shimmer overlay, weapon-type coloring, and specular highlight.
 *
 * Usage: <div use:tilt>...</div>
 *        <div use:tilt={{ gyro: true, weaponType: 'Fire', specular: true }}>...</div>
 */

import type { ActionReturn } from 'svelte/action';

interface TiltOptions {
	maxTilt?: number;
	perspective?: number;
	scale?: number;
	shimmer?: boolean;
	gyro?: boolean;
	weaponType?: string | null;
	specular?: boolean;
}

// ── Weapon-specific holographic gradients ────────────────────────
const WEAPON_SHIMMER_GRADIENTS: Record<string, string> = {
	Fire: `linear-gradient(
		105deg,
		transparent 40%,
		rgba(239, 68, 68, 0.3) 45%,
		rgba(249, 115, 22, 0.25) 50%,
		rgba(251, 191, 36, 0.2) 55%,
		transparent 60%
	)`,
	Ice: `linear-gradient(
		105deg,
		transparent 40%,
		rgba(103, 232, 249, 0.3) 45%,
		rgba(165, 243, 252, 0.25) 50%,
		rgba(255, 255, 255, 0.2) 55%,
		transparent 60%
	)`,
	Steel: `linear-gradient(
		105deg,
		transparent 40%,
		rgba(148, 163, 184, 0.3) 45%,
		rgba(203, 213, 225, 0.25) 50%,
		rgba(255, 255, 255, 0.2) 55%,
		transparent 60%
	)`,
	Hex: `linear-gradient(
		105deg,
		transparent 40%,
		rgba(124, 58, 237, 0.3) 45%,
		rgba(168, 85, 247, 0.25) 50%,
		rgba(109, 40, 217, 0.2) 55%,
		transparent 60%
	)`,
	Glow: `linear-gradient(
		105deg,
		transparent 40%,
		rgba(254, 243, 199, 0.3) 45%,
		rgba(253, 230, 138, 0.25) 50%,
		rgba(255, 255, 255, 0.2) 55%,
		transparent 60%
	)`,
	Brawl: `linear-gradient(
		105deg,
		transparent 40%,
		rgba(239, 68, 68, 0.25) 45%,
		rgba(220, 38, 38, 0.2) 50%,
		rgba(185, 28, 28, 0.15) 55%,
		transparent 60%
	)`,
	Gum: `linear-gradient(
		105deg,
		transparent 40%,
		rgba(236, 72, 153, 0.3) 45%,
		rgba(244, 114, 182, 0.25) 50%,
		rgba(251, 191, 36, 0.2) 55%,
		transparent 60%
	)`,
	Super: `linear-gradient(
		105deg,
		transparent 40%,
		rgba(255, 219, 112, 0.35) 45%,
		rgba(132, 50, 255, 0.25) 50%,
		rgba(50, 180, 255, 0.25) 55%,
		transparent 60%
	)`
};

const DEFAULT_SHIMMER_GRADIENT = `linear-gradient(
	105deg,
	transparent 40%,
	rgba(255, 219, 112, 0.3) 45%,
	rgba(132, 50, 255, 0.2) 50%,
	rgba(50, 180, 255, 0.2) 55%,
	transparent 60%
)`;

export function tilt(node: HTMLElement, options: TiltOptions = {}): ActionReturn {
	const {
		maxTilt = 8,
		perspective = 800,
		scale = 1.02,
		shimmer = true,
		gyro = false,
		weaponType = null,
		specular: specularOpt
	} = options;

	// Respect prefers-reduced-motion
	const prefersReducedMotion =
		typeof window !== 'undefined' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	if (prefersReducedMotion) {
		return { destroy() {} };
	}

	const enableSpecular = specularOpt ?? gyro;

	// Save original styles to restore on destroy
	const originalTransformStyle = node.style.transformStyle;
	const originalTransition = node.style.transition;
	const originalPosition = node.style.position;
	const originalOverflow = node.style.overflow;

	node.style.transformStyle = 'preserve-3d';
	node.style.transition = 'transform 0.15s ease';

	// Ensure the node can contain overlays
	const computedPosition = getComputedStyle(node).position;
	if (computedPosition === 'static') {
		node.style.position = 'relative';
	}
	node.style.overflow = 'hidden';

	// Create holographic shimmer overlay
	let shimmerEl: HTMLDivElement | null = null;
	if (shimmer) {
		const gradient = (weaponType && WEAPON_SHIMMER_GRADIENTS[weaponType]) || DEFAULT_SHIMMER_GRADIENT;
		shimmerEl = document.createElement('div');
		shimmerEl.style.cssText = `
			position: absolute;
			inset: 0;
			pointer-events: none;
			mix-blend-mode: overlay;
			opacity: 0;
			border-radius: inherit;
			background: ${gradient};
			background-size: 200% 200%;
			transition: opacity 0.3s ease;
			z-index: 1;
		`;
		node.appendChild(shimmerEl);
	}

	// Create specular highlight overlay
	let specularEl: HTMLDivElement | null = null;
	if (enableSpecular) {
		specularEl = document.createElement('div');
		specularEl.style.cssText = `
			position: absolute;
			inset: 0;
			pointer-events: none;
			border-radius: inherit;
			opacity: 0;
			transition: opacity 0.3s ease;
			z-index: 2;
			background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.35) 0%, transparent 50%);
		`;
		node.appendChild(specularEl);
	}

	// ── Gyroscope state ─────────────────────────────────────────
	let gyroStarted = false;
	let smoothBeta = 0;
	let smoothGamma = 0;

	function handleOrientation(event: DeviceOrientationEvent) {
		if (event.beta === null || event.gamma === null) return;

		// Normalize beta: 90 is neutral (phone upright)
		const betaNorm = Math.max(-1, Math.min(1, (event.beta - 90) / 45));
		// Normalize gamma: 0 is neutral
		const gammaNorm = Math.max(-1, Math.min(1, event.gamma / 45));

		// Exponential moving average for smoothing
		smoothBeta = smoothBeta * 0.7 + betaNorm * 0.3;
		smoothGamma = smoothGamma * 0.7 + gammaNorm * 0.3;

		const rotateY = smoothGamma * maxTilt;
		const rotateX = -smoothBeta * maxTilt;

		node.style.transform =
			`perspective(${perspective}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`;

		// Position shimmer gradient
		if (shimmerEl) {
			const xPct = (smoothGamma + 1) * 50;
			const yPct = (smoothBeta + 1) * 50;
			shimmerEl.style.backgroundPosition = `${xPct}% ${yPct}%`;
			shimmerEl.style.opacity = '0.6';
		}

		// Position specular highlight (opposite to tilt direction)
		if (specularEl) {
			const specX = (1 - (smoothGamma + 1) / 2) * 100;
			const specY = (1 - (smoothBeta + 1) / 2) * 100;
			specularEl.style.background =
				`radial-gradient(circle at ${specX}% ${specY}%, rgba(255,255,255,0.35) 0%, transparent 50%)`;
			specularEl.style.opacity = '0.7';
		}
	}

	async function requestGyroPermission() {
		if (gyroStarted) return;

		// iOS requires explicit permission request
		if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
			try {
				const permission = await (DeviceOrientationEvent as any).requestPermission();
				if (permission !== 'granted') return;
			} catch {
				return;
			}
		}

		window.addEventListener('deviceorientation', handleOrientation);
		gyroStarted = true;
	}

	function onFirstInteraction() {
		requestGyroPermission();
		node.removeEventListener('click', onFirstInteraction);
		node.removeEventListener('touchstart', onFirstInteraction);
	}

	const hasGyro = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;

	if (gyro && hasGyro) {
		node.addEventListener('click', onFirstInteraction);
		node.addEventListener('touchstart', onFirstInteraction, { passive: true });
	}

	// ── Mouse/touch handlers ────────────────────────────────────
	function handleMove(clientX: number, clientY: number) {
		if (gyroStarted) return;

		const rect = node.getBoundingClientRect();
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		const centerX = rect.width / 2;
		const centerY = rect.height / 2;

		const rotateY = ((x - centerX) / centerX) * maxTilt;
		const rotateX = -((y - centerY) / centerY) * maxTilt;

		node.style.transform = `perspective(${perspective}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`;

		// Move shimmer gradient to follow cursor position
		if (shimmerEl) {
			const xPct = (x / rect.width) * 100;
			const yPct = (y / rect.height) * 100;
			shimmerEl.style.backgroundPosition = `${xPct}% ${yPct}%`;
			shimmerEl.style.opacity = '0.5';
		}

		// Position specular highlight (inverted)
		if (specularEl) {
			const xPct = (x / rect.width) * 100;
			const yPct = (y / rect.height) * 100;
			const specX = 100 - xPct;
			const specY = 100 - yPct;
			specularEl.style.background =
				`radial-gradient(circle at ${specX}% ${specY}%, rgba(255,255,255,0.35) 0%, transparent 50%)`;
			specularEl.style.opacity = '0.5';
		}
	}

	function handleLeave() {
		if (gyroStarted) return;

		node.style.transform = '';
		if (shimmerEl) {
			shimmerEl.style.opacity = '0';
		}
		if (specularEl) {
			specularEl.style.opacity = '0';
		}
	}

	function onMouseMove(e: MouseEvent) {
		handleMove(e.clientX, e.clientY);
	}

	function onTouchMove(e: TouchEvent) {
		const touch = e.touches[0];
		if (touch) handleMove(touch.clientX, touch.clientY);
	}

	node.addEventListener('mousemove', onMouseMove);
	node.addEventListener('mouseleave', handleLeave);
	node.addEventListener('touchmove', onTouchMove, { passive: true });
	node.addEventListener('touchend', handleLeave);

	return {
		destroy() {
			// Remove mouse/touch listeners
			node.removeEventListener('mousemove', onMouseMove);
			node.removeEventListener('mouseleave', handleLeave);
			node.removeEventListener('touchmove', onTouchMove);
			node.removeEventListener('touchend', handleLeave);

			// Remove gyro listeners
			if (gyroStarted) {
				window.removeEventListener('deviceorientation', handleOrientation);
			}
			node.removeEventListener('click', onFirstInteraction);
			node.removeEventListener('touchstart', onFirstInteraction);

			// Reset styles
			node.style.transform = '';
			node.style.transformStyle = originalTransformStyle;
			node.style.transition = originalTransition;
			node.style.position = originalPosition;
			node.style.overflow = originalOverflow;

			// Remove overlay elements
			if (shimmerEl) {
				shimmerEl.remove();
				shimmerEl = null;
			}
			if (specularEl) {
				specularEl.remove();
				specularEl = null;
			}
		}
	};
}
