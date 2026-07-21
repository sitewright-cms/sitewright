// Build-time minifiers for the platform's OWN generated assets (the first-party runtime JS bundles and
// the inline platform CSS). Uses esbuild (already a dependency) synchronously — the publish build is not
// a hot path. Both are DEFENSIVE: minification is cosmetic (byte savings only) and must NEVER fail a
// publish, so any esbuild edge case falls back to the original source unchanged.
import { transformSync, version as esbuildVersion } from 'esbuild';

/**
 * The minifier identity, folded into the published asset cache-bust (`?v=`) hash so a minifier/esbuild
 * version bump re-versions `immutable`-cached assets — otherwise a routine dep bump could change the
 * served bytes for an unchanged source without changing the URL. See build.ts's `assetVer`.
 */
export const MINIFIER_VERSION = `esbuild-${esbuildVersion}`;

// `legalComments: 'eof'` KEEPS the `/*! … */` license banners (modern-normalize + the vendored runtime
// attributions) — collecting them at end-of-file — while still stripping everything else. Do NOT use
// 'none': it deletes the MIT attribution notices the codebase deliberately ships (see base-css.ts).
export function minifyJs(code: string): string {
  if (!code) return code;
  try {
    // esbuild appends a trailing newline; drop it so the emitted asset has no pointless trailing bytes.
    return transformSync(code, { loader: 'js', minify: true, legalComments: 'eof' }).code.trimEnd();
  } catch {
    return code;
  }
}

/** Minify platform CSS (inline `<style>` blocks), keeping bang-prefixed license banners. Falls back on error. */
export function minifyCss(css: string): string {
  if (!css) return css;
  try {
    return transformSync(css, { loader: 'css', minify: true, legalComments: 'eof' }).code.trimEnd();
  } catch {
    return css;
  }
}
