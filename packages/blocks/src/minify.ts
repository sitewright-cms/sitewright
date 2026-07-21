// Build-time minifiers for the platform's OWN generated assets (the first-party runtime JS bundles and
// the inline platform CSS). Uses esbuild (already a dependency) synchronously — the publish build is not
// a hot path. Both are DEFENSIVE: minification is cosmetic (byte savings only) and must NEVER fail a
// publish, so any esbuild edge case falls back to the original source unchanged.
import { transformSync } from 'esbuild';

/** Minify first-party runtime JavaScript. Falls back to the input on any esbuild error. */
export function minifyJs(code: string): string {
  if (!code) return code;
  try {
    // esbuild appends a trailing newline; drop it so the emitted asset has no pointless trailing bytes.
    return transformSync(code, { loader: 'js', minify: true, legalComments: 'none' }).code.trimEnd();
  } catch {
    return code;
  }
}

/** Minify platform CSS (inline `<style>` blocks). Falls back to the input on any esbuild error. */
export function minifyCss(css: string): string {
  if (!css) return css;
  try {
    return transformSync(css, { loader: 'css', minify: true, legalComments: 'none' }).code.trimEnd();
  } catch {
    return css;
  }
}
