// Build-time minifiers for the platform's OWN generated assets (the first-party runtime JS bundles and
// the inline platform CSS). Uses terser (JS) + clean-css (CSS) — both PROD dependencies of this package,
// so they resolve in the slim production container (esbuild, the earlier choice, was a devDependency and
// absent at runtime). Both KEEP `/*! … */` license banners (MIT attribution: modern-normalize + the
// vendored runtimes) and are DEFENSIVE: minification is cosmetic (byte savings only) and must NEVER fail
// a publish, so any error/parse-warning falls back to the original source unchanged.
import { createRequire } from 'node:module';
import { minify as terserMinify } from 'terser';
import CleanCSS from 'clean-css';

const require = createRequire(import.meta.url);

function pkgVersion(name: string): string {
  try {
    return (require(`${name}/package.json`) as { version?: string }).version ?? '0';
  } catch {
    return '0';
  }
}

/**
 * Minifier identity, folded into the published-asset cache-bust (`?v=`) hash (see build.ts's `assetVer`).
 * The served bytes are minified, so a terser/clean-css version bump changes them for an unchanged source —
 * hashing the versions re-busts `?v=` instead of silently overwriting an `immutable`-cached URL.
 */
export const MINIFIER_VERSION = `terser-${pkgVersion('terser')}+cleancss-${pkgVersion('clean-css')}-l1all0`;

// clean-css keeps `/*! … */` banners by default (specialComments '*'); a single reusable instance is fine.
//
// `level: { 1: { all: false } }` DISABLES clean-css's structural optimizations while keeping the base
// pass (whitespace + comment stripping). Those optimizations SILENTLY DROP modern CSS clean-css 5.x
// can't model — `@starting-style` and the `transition: display/overlay … allow-discrete` rule that drive
// the slide-in of the cart drawer + component modals (a dropped rule → the drawer "pops" instead of
// sliding). The base pass still gives ~all the byte win (comments/whitespace are the bulk); the skipped
// structural rewrites cost <1% on real CSS. (The platform CSS uses no CSS nesting, which clean-css 5.x
// also can't parse — see minify.test.ts.) The `-l1all0` marker above re-busts `?v=` for the changed output.
const cleanCss = new CleanCSS({ level: { 1: { all: false } } });

/**
 * Minify the platform's OWN inline CSS. SYNC (it's the renderDocument `minifyCss` hook, and renderDocument
 * is synchronous). Falls back to the source on any error or when clean-css reports a parse error.
 */
export function minifyCss(css: string): string {
  if (!css) return css;
  try {
    const out = cleanCss.minify(css);
    return out.errors.length ? css : out.styles;
  } catch {
    return css;
  }
}

/** Minify a first-party runtime JS bundle. ASYNC (terser is async). Falls back to the source on any error. */
export async function minifyJs(code: string): Promise<string> {
  if (!code) return code;
  try {
    const out = await terserMinify(code, { format: { comments: /^!/ } });
    return out.code ?? code;
  } catch {
    return code;
  }
}
