/**
 * Card tilt action — CSS 3D perspective effect on hover/touch.
 *
 * Usage: <div use:tilt>...</div>
 * Replaces legacy src/ui/card-tilt.js.
 */

import type { ActionReturn } from 'svelte/action';

interface TiltOptions {
	maxTilt?: number;
	perspective?: number;
	scale?: number;
}

export function tilt(node: HTMLElement, options: TiltOptions = {}): ActionReturn {
	const { maxTilt = 8, perspective = 800, scale = 1.02 } = options;

	node.style.transformStyle = 'preserve-3d';
	node.style.transition = 'transform 0.15s ease';

	function handleMove(clientX: number, clientY: number) {
		const rect = node.getBoundingClientRect();
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		const centerX = rect.width / 2;
		const centerY = rect.height / 2;

		const rotateY = ((x - centerX) / centerX) * maxTilt;
		const rotateX = -((y - centerY) / centerY) * maxTilt;

		node.style.transform = `perspective(${perspective}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`;
	}

	function handleLeave() {
		node.style.transform = '';
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
		}
	};
}
