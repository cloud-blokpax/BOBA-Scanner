/**
 * Card tilt action — CSS 3D perspective effect on hover/touch
 * with holographic shimmer overlay.
 *
 * Usage: <div use:tilt>...</div>
 * Replaces legacy src/ui/card-tilt.js.
 */

import type { ActionReturn } from 'svelte/action';

interface TiltOptions {
	maxTilt?: number;
	perspective?: number;
	scale?: number;
	shimmer?: boolean;
}

export function tilt(node: HTMLElement, options: TiltOptions = {}): ActionReturn {
	const { maxTilt = 8, perspective = 800, scale = 1.02, shimmer = true } = options;

	node.style.transformStyle = 'preserve-3d';
	node.style.transition = 'transform 0.15s ease';

	// Ensure the node can contain the shimmer overlay
	const computedPosition = getComputedStyle(node).position;
	if (computedPosition === 'static') {
		node.style.position = 'relative';
	}
	node.style.overflow = 'hidden';

	// Create holographic shimmer overlay
	let shimmerEl: HTMLDivElement | null = null;
	if (shimmer) {
		shimmerEl = document.createElement('div');
		shimmerEl.style.cssText = `
			position: absolute;
			inset: 0;
			pointer-events: none;
			mix-blend-mode: overlay;
			opacity: 0;
			border-radius: inherit;
			background: linear-gradient(
				105deg,
				transparent 40%,
				rgba(255, 219, 112, 0.3) 45%,
				rgba(132, 50, 255, 0.2) 50%,
				rgba(50, 180, 255, 0.2) 55%,
				transparent 60%
			);
			background-size: 200% 200%;
			transition: opacity 0.3s ease;
			z-index: 1;
		`;
		node.appendChild(shimmerEl);
	}

	function handleMove(clientX: number, clientY: number) {
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
	}

	function handleLeave() {
		node.style.transform = '';
		if (shimmerEl) {
			shimmerEl.style.opacity = '0';
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
			node.removeEventListener('mousemove', onMouseMove);
			node.removeEventListener('mouseleave', handleLeave);
			node.removeEventListener('touchmove', onTouchMove);
			node.removeEventListener('touchend', handleLeave);
			node.style.transform = '';
			if (shimmerEl) {
				shimmerEl.remove();
			}
		}
	};
}
