import sharp from 'sharp';

/**
 * Shrink an image to what a model API will accept alongside other images.
 *
 * A request carrying several images caps each one at 2000px on its LONGEST edge. Full-page screenshots
 * routinely blow past that — the capture caps are 8000-12000px by design so a long page is captured
 * whole, and the widest breakpoint is 2560px before you even consider height. The failure is not a
 * degraded image: the entire request is REJECTED mid-conversation with "An image in the conversation
 * exceeds the dimension limit for many-image requests (2000px). Start a new session with fewer images."
 * That killed a clone agent outright at turn 124, 37 minutes and $18.82 in, and it was unrecoverable by
 * construction — the agent could not know which of its earlier tool results was the poison.
 *
 * A tall page therefore comes back narrow but COMPLETE, which is what a full-page overview is for;
 * detailed judgement uses region crops, which are viewport-sized and unaffected. Downscaling loses
 * detail. Not answering loses the session.
 */

/** The model API's per-image ceiling when a request carries several images. */
export const MODEL_IMAGE_MAX_EDGE = 2000;

/** True when an image would be rejected as part of a many-image request. */
export function exceedsModelImageLimit(width: number, height: number): boolean {
  return Math.max(width, height) > MODEL_IMAGE_MAX_EDGE;
}

/** The size an image is reduced to — aspect preserved, longest edge at the cap. */
export function clampedImageSize(width: number, height: number): { width: number; height: number } {
  if (!exceedsModelImageLimit(width, height)) return { width, height };
  const scale = MODEL_IMAGE_MAX_EDGE / Math.max(width, height);
  return {
    // At extreme aspect ratios the short edge can round to 0, which sharp rejects — floor it at 1px.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Resize JPEG bytes to the cap. Returns `null` when nothing needed doing OR when the resize failed —
 * both mean "use what you already had". A too-large image is a probable rejection; a thrown error is a
 * certain one, so this never throws.
 */
export async function clampImageForModel(
  jpegBytes: Buffer,
  width: number,
  height: number,
): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  if (!exceedsModelImageLimit(width, height)) return null;
  const size = clampedImageSize(width, height);
  try {
    const buffer = await sharp(jpegBytes).resize(size.width, size.height, { fit: 'fill' }).jpeg({ quality: 78 }).toBuffer();
    return { buffer, ...size };
  } catch {
    return null;
  }
}
