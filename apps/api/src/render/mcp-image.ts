import { clampImageForModel, exceedsModelImageLimit } from '@sitewright/image-pipeline';
import type { Shot } from './screenshot.js';

/**
 * Clamp screenshots to the model API's many-image dimension limit before they are handed to an agent.
 *
 * The maths and the sharp call live in @sitewright/image-pipeline (see `model-image.ts` there, which
 * documents why this exists — a full-page capture over 2000px on its long edge does not degrade the
 * response, it REJECTS the whole request and kills the session). This is the thin adapter that applies
 * it to a `Shot`.
 */

export { MODEL_IMAGE_MAX_EDGE, exceedsModelImageLimit, clampedImageSize } from '@sitewright/image-pipeline';

/**
 * Resize a shot if it is over the limit; otherwise hand back the SAME object so the common
 * (already-small) case costs nothing.
 */
export async function clampShotForModel<T extends Shot>(shot: T): Promise<T> {
  if (!exceedsModelImageLimit(shot.width, shot.height)) return shot;
  const out = await clampImageForModel(Buffer.from(shot.base64, 'base64'), shot.width, shot.height);
  if (!out) return shot;
  return { ...shot, base64: out.buffer.toString('base64'), width: out.width, height: out.height };
}

/** Clamp a map of named shots (the shape `captureUrlShots` returns). Undefined entries pass through. */
export async function clampShots<T extends Shot>(
  shots: Partial<Record<string, T>>,
): Promise<Partial<Record<string, T>>> {
  const entries = await Promise.all(
    Object.entries(shots).map(async ([k, v]) => [k, v ? await clampShotForModel(v) : v] as const),
  );
  return Object.fromEntries(entries);
}
