/**
 * Share Card Image Generator
 *
 * Creates a branded 1080x1920 card reveal graphic and shares it via
 * the Web Share API. Falls back to download when sharing isn't supported.
 *
 * Canvas layout (top to bottom):
 *   - Card image (centered, scaled to fit with padding)
 *   - Gradient overlay (bottom 40% of canvas)
 *   - Hero name (large)
 *   - Card number + Weapon type + Set code (smaller metadata line)
 *   - Rarity badge (colored pill matching the rarity color system)
 *   - "Scanned with BOBA Scanner" watermark (small, bottom)
 */

import type { Card } from '$lib/types';

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;

const RARITY_COLORS: Record<string, string> = {
	common: '#9CA3AF',
	uncommon: '#22C55E',
	rare: '#3B82F6',
	ultra_rare: '#A855F7',
	legendary: '#F59E0B'
};

const RARITY_LABELS: Record<string, string> = {
	common: 'COMMON',
	uncommon: 'UNCOMMON',
	rare: 'RARE',
	ultra_rare: 'ULTRA RARE',
	legendary: 'LEGENDARY'
};

export async function generateShareImage(
	card: Card,
	capturedImageUrl: string | null
): Promise<Blob> {
	const canvas = new OffscreenCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
	const ctx = canvas.getContext('2d')!;

	// Background: dark gradient
	const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
	bgGrad.addColorStop(0, '#0a0e1a');
	bgGrad.addColorStop(1, '#070b14');
	ctx.fillStyle = bgGrad;
	ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

	// Card image (if available)
	if (capturedImageUrl) {
		try {
			const response = await fetch(capturedImageUrl);
			const blob = await response.blob();
			const bitmap = await createImageBitmap(blob);

			// Scale to fit within the top 60% of the canvas with padding
			const maxW = CANVAS_WIDTH - 160;
			const maxH = CANVAS_HEIGHT * 0.55;
			const scale = Math.min(maxW / bitmap.width, maxH / bitmap.height);
			const drawW = bitmap.width * scale;
			const drawH = bitmap.height * scale;
			const drawX = (CANVAS_WIDTH - drawW) / 2;
			const drawY = 120;

			// Subtle card shadow
			ctx.save();
			ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
			ctx.shadowBlur = 40;
			ctx.shadowOffsetY = 20;

			// Rounded corners via clip path
			const cornerRadius = 16;
			ctx.beginPath();
			ctx.roundRect(drawX, drawY, drawW, drawH, cornerRadius);
			ctx.clip();
			ctx.drawImage(bitmap, drawX, drawY, drawW, drawH);
			ctx.restore();

			bitmap.close();
		} catch {
			// Image load failed — continue without card image
		}
	}

	// Bottom gradient overlay for text readability
	const textGrad = ctx.createLinearGradient(0, CANVAS_HEIGHT * 0.6, 0, CANVAS_HEIGHT);
	textGrad.addColorStop(0, 'rgba(7, 11, 20, 0)');
	textGrad.addColorStop(0.3, 'rgba(7, 11, 20, 0.8)');
	textGrad.addColorStop(1, 'rgba(7, 11, 20, 1)');
	ctx.fillStyle = textGrad;
	ctx.fillRect(0, CANVAS_HEIGHT * 0.6, CANVAS_WIDTH, CANVAS_HEIGHT * 0.4);

	// Rarity glow line
	const rarityColor = RARITY_COLORS[card.rarity ?? 'common'] || RARITY_COLORS.common;
	const glowY = CANVAS_HEIGHT * 0.68;
	const glowGrad = ctx.createLinearGradient(0, glowY, CANVAS_WIDTH, glowY);
	glowGrad.addColorStop(0, 'transparent');
	glowGrad.addColorStop(0.3, rarityColor);
	glowGrad.addColorStop(0.7, rarityColor);
	glowGrad.addColorStop(1, 'transparent');
	ctx.strokeStyle = glowGrad;
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(0, glowY);
	ctx.lineTo(CANVAS_WIDTH, glowY);
	ctx.stroke();

	// Hero name (large) — use system fonts (OffscreenCanvas may not have custom fonts)
	ctx.textAlign = 'center';
	ctx.fillStyle = '#e2e8f0';
	ctx.font = 'bold 72px -apple-system, "Segoe UI", sans-serif';
	const heroName = card.hero_name || card.name || 'Unknown Hero';
	ctx.fillText(heroName, CANVAS_WIDTH / 2, CANVAS_HEIGHT * 0.75, CANVAS_WIDTH - 120);

	// Metadata line (card number + weapon + set)
	const metaParts: string[] = [];
	if (card.card_number) metaParts.push(card.card_number);
	if (card.weapon_type) metaParts.push(card.weapon_type);
	if (card.set_code) metaParts.push(card.set_code);
	if (metaParts.length > 0) {
		ctx.font = '500 36px -apple-system, "Segoe UI", sans-serif';
		ctx.fillStyle = '#94a3b8';
		ctx.fillText(metaParts.join('  \u00B7  '), CANVAS_WIDTH / 2, CANVAS_HEIGHT * 0.8);
	}

	// Rarity badge
	const rarityLabel = RARITY_LABELS[card.rarity ?? 'common'] || 'COMMON';
	ctx.font = 'bold 28px -apple-system, "Segoe UI", sans-serif';
	const badgeMetrics = ctx.measureText(rarityLabel);
	const badgeW = badgeMetrics.width + 48;
	const badgeH = 48;
	const badgeX = (CANVAS_WIDTH - badgeW) / 2;
	const badgeY = CANVAS_HEIGHT * 0.84;

	ctx.fillStyle = rarityColor;
	ctx.beginPath();
	ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 24);
	ctx.fill();

	ctx.fillStyle = card.rarity === 'legendary' ? '#0d1524' : '#ffffff';
	ctx.textBaseline = 'middle';
	ctx.fillText(rarityLabel, CANVAS_WIDTH / 2, badgeY + badgeH / 2);
	ctx.textBaseline = 'alphabetic';

	// Watermark
	ctx.font = '400 24px -apple-system, "Segoe UI", sans-serif';
	ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
	ctx.fillText('Scanned with BOBA Scanner', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 60);

	return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
}

/**
 * Check if the browser supports file sharing via the Web Share API.
 */
export function canShareFiles(): boolean {
	if (!('share' in navigator) || !('canShare' in navigator)) return false;
	try {
		return navigator.canShare({
			files: [new File([''], 'test.png', { type: 'image/png' })]
		});
	} catch {
		return false;
	}
}

/**
 * Share the generated card image via the native share sheet.
 * Falls back to downloading the image if sharing isn't supported.
 */
export async function shareCardImage(card: Card, capturedImageUrl: string | null): Promise<void> {
	const blob = await generateShareImage(card, capturedImageUrl);
	const heroSlug = (card.hero_name || card.name || 'card').toLowerCase().replace(/\s+/g, '-');
	const filename = `boba-${heroSlug}-${card.card_number || 'scan'}.jpg`;
	const file = new File([blob], filename, { type: 'image/jpeg' });

	if (canShareFiles()) {
		// On iOS Safari, pass ONLY files — including title/text alongside files
		// can cause the share to fail silently.
		await navigator.share({ files: [file] });
	} else {
		// Fallback: download the image
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 10000);
	}
}
