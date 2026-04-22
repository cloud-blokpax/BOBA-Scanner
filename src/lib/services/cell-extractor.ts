/**
 * Divides a captured frame into per-cell sub-bitmaps for binder-mode
 * scanning. Each cell becomes its own independent OCR session.
 */

export type GridSize = '2x2' | '3x3' | '4x4';

export interface CellRegion {
	row: number;
	col: number;
	gridSize: GridSize;
	x: number;
	y: number;
	w: number;
	h: number;
}

export function parseGridSize(size: GridSize): { rows: number; cols: number } {
	switch (size) {
		case '2x2':
			return { rows: 2, cols: 2 };
		case '3x3':
			return { rows: 3, cols: 3 };
		case '4x4':
			return { rows: 4, cols: 4 };
	}
}

/**
 * Compute per-cell pixel rects for a frame. `pageInsetPct` is a small
 * margin peeled off the outside of the frame so the top/bottom/side
 * edges of the binder page don't leak into corner cells.
 */
export function computeCellRegions(
	frameWidth: number,
	frameHeight: number,
	gridSize: GridSize,
	pageInsetPct = 0.02
): CellRegion[] {
	const { rows, cols } = parseGridSize(gridSize);
	const insetPx = Math.floor(Math.min(frameWidth, frameHeight) * pageInsetPct);
	const usableW = frameWidth - 2 * insetPx;
	const usableH = frameHeight - 2 * insetPx;
	const cellW = Math.floor(usableW / cols);
	const cellH = Math.floor(usableH / rows);

	const regions: CellRegion[] = [];
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			regions.push({
				row,
				col,
				gridSize,
				x: insetPx + col * cellW,
				y: insetPx + row * cellH,
				w: cellW,
				h: cellH
			});
		}
	}
	return regions;
}

export async function extractCellBitmap(
	source: ImageBitmap,
	region: CellRegion
): Promise<ImageBitmap> {
	const canvas = new OffscreenCanvas(region.w, region.h);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D context unavailable');
	ctx.drawImage(source, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
	return canvas.transferToImageBitmap();
}

/**
 * Per-cell resolution estimate. Used to warn users when a 4×4 grid on
 * a low-resolution camera will push per-cell OCR below reliable limits.
 */
export function estimateCellResolution(
	captureWidth: number,
	captureHeight: number,
	gridSize: GridSize
): { cellW: number; cellH: number; longEdge: number } {
	const { rows, cols } = parseGridSize(gridSize);
	const cellW = Math.floor(captureWidth / cols);
	const cellH = Math.floor(captureHeight / rows);
	return { cellW, cellH, longEdge: Math.max(cellW, cellH) };
}
