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
// pass (whitespace + comment stripping). Those optimizations mangle/DROP modern CSS clean-css 5.x can't
// model — in particular the `transition: display/overlay … allow-discrete` shorthand on the cart-drawer /
// component-modal rules (dropped → the drawer can't animate). The base pass still gives ~all the byte
// win; the skipped structural rewrites cost <1% on real CSS. (The platform CSS uses no CSS nesting, which
// clean-css 5.x also can't parse.) The `-l1all0` marker above re-busts `?v=` for the changed output.
const cleanCss = new CleanCSS({ level: { 1: { all: false } } });

function cleanCssMinify(css: string): string {
  const out = cleanCss.minify(css);
  return out.errors.length ? css : out.styles;
}

/**
 * A nesting-SAFE whitespace/comment collapse used ONLY for `@starting-style{…}` blocks (see minifyCss):
 * clean-css 5.x can't parse a nested-rule at-rule and would strip its body to an empty `@starting-style{}`,
 * killing the drawer/modal ENTRY state. This is a light textual minify — safe here because the platform's
 * `@starting-style` bodies are plain selector+declaration blocks with no strings/urls containing `{};:,`.
 */
function lightMinifyCss(css: string): string {
  return css
    .replace(/\/\*(?!!)[\s\S]*?\*\//g, '') // drop comments except /*! … */ license banners
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>~+])\s*/g, '$1') // collapse space around structural tokens (keeps descendant spaces)
    .replace(/;}/g, '}')
    .trim();
}

/**
 * Minify the platform's OWN inline CSS. SYNC (it's the renderDocument `minifyCss` hook, and renderDocument
 * is synchronous). Falls back to the source on any error or when clean-css reports a parse error.
 *
 * `@starting-style{…}` blocks are split OUT first: clean-css 5.x parses the nested inner rule as a bogus
 * property and empties the block (verified against the real cart CSS), which removes the transition ENTRY
 * state so the cart drawer / modals "pop" instead of sliding. We minify those blocks with a nesting-safe
 * textual pass and the rest with clean-css, preserving order. Balanced-brace scan handles the nesting.
 */
export function minifyCss(css: string): string {
  if (!css) return css;
  try {
    if (!css.includes('@starting-style')) return cleanCssMinify(css);
    // Match only a REAL at-rule: the literal followed by optional whitespace then `{`. This skips a
    // stray `@starting-style` substring inside a comment/selector/string (e.g. `/* see @starting-style
    // */`), which a raw indexOf would mis-split — hunting for a later unrelated `{` and corrupting the
    // rules in between.
    const re = /@starting-style\s*\{/g;
    let out = '';
    let i = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
      const start = m.index;
      const open = start + m[0].length - 1; // index of the matched `{`
      let depth = 0;
      let j = open;
      for (; j < css.length; j++) {
        const c = css[j];
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) {
          j++;
          break;
        }
      }
      // The part before the at-rule is a complete set of rules → clean-css it; the @starting-style block
      // (start…j, braces balanced) → the nesting-safe pass. Resume scanning AFTER the block.
      out += cleanCssMinify(css.slice(i, start)) + lightMinifyCss(css.slice(start, j));
      i = j;
      re.lastIndex = j;
    }
    out += cleanCssMinify(css.slice(i));
    return out;
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
