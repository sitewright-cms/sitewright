import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTextureName } from '@sitewright/blocks';

/**
 * The committed transparent-texture PNG set (from transparenttextures.com), served at
 * `/authoring/textures/<name>.png`. Resolved relative to this module so it works in dev
 * (`apps/api/src` → `apps/api/assets/textures`) AND in the built runtime image
 * (`dist/textures.js` → `/app/assets/textures`, COPY'd by the Dockerfile as a sibling of `dist/`,
 * exactly like `example_projects` / `drizzle`). Metadata (names/search) lives in `@sitewright/blocks`.
 */
export const TEXTURES_DIR = fileURLToPath(new URL('../assets/textures', import.meta.url));

/** Absolute path to a texture PNG, or null when `name` is not a real texture (allowlist — blocks path traversal). */
export function texturePath(name: string): string | null {
  return isTextureName(name) ? join(TEXTURES_DIR, `${name}.png`) : null;
}

/** Read a texture PNG's bytes, or null if the name is unknown or the file is missing. */
export async function readTexture(name: string): Promise<Buffer | null> {
  const path = texturePath(name);
  if (!path) return null;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `name` is catalog-allowlisted by texturePath (isTextureName)
  return readFile(path).catch(() => null);
}
