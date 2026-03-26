/**
 * Card Auto-Crop Service
 *
 * Crops the captured camera frame to the card region based on the
 * scanner guide overlay position. Shows a clean cropped card to the
 * user while sending the full frame to the AI for better recognition.
 */

export interface CropRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Compute the crop region in video-frame coordinates from the guide overlay's
 * position relative to the video element.
 *
 * The guide overlay is a CSS-positioned element centered over the video feed.
 * This function maps its screen-space rect to the actual video resolution.
 */
export function cropToCardRegion(
	videoWidth: number,
	videoHeight: number,
	guideRect: DOMRect,
	videoRect: DOMRect
): CropRegion {
	// The video element uses object-fit: cover, so it may be clipped.
	// Calculate the actual displayed region of the video.
	const videoAspect = videoWidth / videoHeight;
	const elemAspect = videoRect.width / videoRect.height;

	let displayedWidth: number;
	let displayedHeight: number;
	let offsetX: number;
	let offsetY: number;

	if (videoAspect > elemAspect) {
		// Video is wider — clipped on left/right
		displayedHeight = videoRect.height;
		displayedWidth = videoRect.height * videoAspect;
		offsetX = (displayedWidth - videoRect.width) / 2;
		offsetY = 0;
	} else {
		// Video is taller — clipped on top/bottom
		displayedWidth = videoRect.width;
		displayedHeight = videoRect.width / videoAspect;
		offsetX = 0;
		offsetY = (displayedHeight - videoRect.height) / 2;
	}

	const scaleX = videoWidth / displayedWidth;
	const scaleY = videoHeight / displayedHeight;

	// Map guide position from screen coords to video frame coords
	const relativeX = guideRect.left - videoRect.left + offsetX;
	const relativeY = guideRect.top - videoRect.top + offsetY;

	// Add 8% padding on each side for a slight border effect
	const paddingX = guideRect.width * 0.08;
	const paddingY = guideRect.height * 0.08;

	const x = Math.max(0, (relativeX - paddingX) * scaleX);
	const y = Math.max(0, (relativeY - paddingY) * scaleY);
	const width = Math.min(videoWidth - x, (guideRect.width + paddingX * 2) * scaleX);
	const height = Math.min(videoHeight - y, (guideRect.height + paddingY * 2) * scaleY);

	return { x, y, width, height };
}

/**
 * Crop a video frame to a specified region and return as data URL.
 */
export function cropFrame(
	video: HTMLVideoElement,
	region: CropRegion,
	maxWidth: number = 800
): string {
	const canvas = document.createElement('canvas');
	const scale = Math.min(1, maxWidth / region.width);
	canvas.width = region.width * scale;
	canvas.height = region.height * scale;

	const ctx = canvas.getContext('2d')!;

	// Subtle rounded corners
	const radius = 12 * scale;
	ctx.beginPath();
	ctx.moveTo(radius, 0);
	ctx.lineTo(canvas.width - radius, 0);
	ctx.quadraticCurveTo(canvas.width, 0, canvas.width, radius);
	ctx.lineTo(canvas.width, canvas.height - radius);
	ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - radius, canvas.height);
	ctx.lineTo(radius, canvas.height);
	ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - radius);
	ctx.lineTo(0, radius);
	ctx.quadraticCurveTo(0, 0, radius, 0);
	ctx.closePath();
	ctx.clip();

	ctx.drawImage(
		video,
		region.x, region.y, region.width, region.height,
		0, 0, canvas.width, canvas.height
	);

	return canvas.toDataURL('image/jpeg', 0.9);
}
