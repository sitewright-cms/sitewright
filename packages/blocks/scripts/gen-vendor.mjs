#!/usr/bin/env node
// Bundles the vendor-src/*.entry.js component runtimes (first-party wiring + the MIT libraries
// they import) into checked-in src/vendor/*-runtime.ts modules, the same generate-and-check-in
// discipline as gen-brand-icons/gen-lucide-icons: reproducible builds, no build-time network,
// auditable diffs on upgrades. CI runs `gen:vendor:check` (regenerate + git diff --exit-code).
//
// Each generated module exports the bundled, minified runtime as a STRING constant that
// components.ts ships through the regular only-used-ships pipeline (same-origin components.js,
// CSP `default-src 'self'` — no CDN, no eval). A license banner with every bundled package's
// name@version (all MIT) is embedded in the shipped JS itself.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// Resolves a (possibly transitive) dependency's package.json through Node's resolver — pnpm
// only exposes transitive deps (wheel-gestures) via the dependent package's own node_modules.
const requireFrom = (fromDir) => createRequire(join(fromDir, 'noop.js'));
function resolvePkgJson(name) {
  // Resolve the package's ENTRY (always exported), then cut back to its root dir — `exports`
  // maps routinely omit "./package.json", so it can't be resolved directly.
  const marker = join('node_modules', ...name.split('/'));
  // Extra dirs: TRANSITIVE deps are only reachable through their parent package under pnpm's
  // isolated layout. `wheel-gestures` resolves from embla-carousel-wheel-gestures; `a-template`
  // resolves from smartphoto; and `morphdom`/`delegate` are a-template's own deps, resolved from
  // a-template's real path. If any parent is bumped so it inlines or drops a dep, update libs + this path.
  for (const dir of [
    pkgRoot,
    join(pkgRoot, 'node_modules', 'embla-carousel-wheel-gestures'),
    join(pkgRoot, 'node_modules', 'smartphoto'),
    join(pkgRoot, 'node_modules', 'a-template'),
  ]) {
    let entry;
    try {
      // realpath first: transitive deps are only visible from the package's REAL (.pnpm)
      // location — createRequire on the symlinked path can't see its siblings.
      entry = requireFrom(realpathSync(dir)).resolve(name);
    } catch {
      continue;
    }
    const i = entry.lastIndexOf(marker);
    if (i !== -1) return join(entry.slice(0, i + marker.length), 'package.json');
  }
  throw new Error(`gen-vendor: cannot locate package.json for "${name}"`);
}

const TARGETS = [
  {
    entry: 'vendor-src/carousel.entry.js',
    out: 'src/vendor/carousel-runtime.ts',
    jsConst: 'CAROUSEL_RUNTIME_JS',
    libs: [
      'embla-carousel',
      'embla-carousel-autoplay',
      'embla-carousel-auto-scroll',
      'embla-carousel-auto-height',
      'embla-carousel-fade',
      'embla-carousel-wheel-gestures',
      'wheel-gestures',
    ],
  },
  // SmartPhoto is the ACTIVE lightbox (thumbnail strip, enlarge-from-thumbnail open, header
  // counter/caption). a-template (+ morphdom/delegate) is its templating engine; the IE-only
  // polyfills it ships are aliased away below (modern-browser target). See lightbox-smartphoto.entry.js.
  {
    entry: 'vendor-src/lightbox-smartphoto.entry.js',
    out: 'src/vendor/lightbox-smartphoto-runtime.ts',
    jsConst: 'LIGHTBOX_SMARTPHOTO_RUNTIME_JS',
    libs: ['smartphoto', 'a-template', 'morphdom', 'delegate'],
    css: { from: 'node_modules/smartphoto/css/smartphoto.css', cssConst: 'LIGHTBOX_SMARTPHOTO_VENDOR_CSS' },
    // SmartPhoto's core imports its viewer DOM as raw HTML (fed to a-template).
    loader: { '.html': 'text' },
    // Drop the IE-only polyfills: native CustomEvent / Array.find (→ empty), native Promise
    // (→ a one-line re-export). Keeps the bundle to modern code without forking SmartPhoto.
    alias: {
      'custom-event-polyfill': 'vendor-src/stubs/empty.js',
      'ie-array-find-polyfill': 'vendor-src/stubs/empty.js',
      'es6-promise-polyfill': 'vendor-src/stubs/native-promise.js',
    },
    // Vendor-neutral class names in the shipped DOM/CSS: the entry overrides SmartPhoto's
    // classNames to "sw-lightbox-*"; here we rewrite the stylesheet to match (global) and the one
    // hard-coded "smartphoto-sr-only" template class in the JS. The "smartphoto@x" license banner
    // is preserved (the JS rewrite is scoped to that single sr-only class).
    renameClasses: true,
  },
  // GLightbox lightbox — RETAINED as a revertible fallback (not wired into components.ts). To
  // switch back, re-import LIGHTBOX_RUNTIME_JS/LIGHTBOX_VENDOR_CSS there. Kept here so the
  // fallback runtime stays buildable + drift-checked.
  {
    entry: 'vendor-src/lightbox.entry.js',
    out: 'src/vendor/lightbox-runtime.ts',
    jsConst: 'LIGHTBOX_RUNTIME_JS',
    libs: ['glightbox'],
    css: { from: 'node_modules/glightbox/dist/css/glightbox.min.css', cssConst: 'LIGHTBOX_VENDOR_CSS' },
  },
  // Air Datepicker — date / range / datetime / time picker. The library builds its own popup DOM
  // with "air-datepicker*" classes; renamePrefix rewrites those to a vendor-neutral "sw-datepicker*"
  // in both the bundled JS (which constructs them) and the stylesheet, so no vendor name reaches the
  // published DOM/CSS. The "air-datepicker@x (MIT)" license banner is left intact (the rename's
  // negative lookahead skips the "@" that only the banner has). See datetimepicker.entry.js.
  {
    entry: 'vendor-src/datetimepicker.entry.js',
    out: 'src/vendor/datetimepicker-runtime.ts',
    jsConst: 'DATETIMEPICKER_RUNTIME_JS',
    libs: ['air-datepicker'],
    css: { from: 'node_modules/air-datepicker/air-datepicker.css', cssConst: 'DATETIMEPICKER_VENDOR_CSS' },
    renamePrefix: { from: 'air-datepicker', to: 'sw-datepicker' },
  },
];

function libBanner(libs) {
  const lines = libs.map((name) => {
    const pkg = JSON.parse(readFileSync(resolvePkgJson(name), 'utf8'));
    // Hard gate: these bundles ship on customer sites, so every vendored package MUST be MIT.
    // A dep that relicenses (the easepick/Flickity trap) fails generation, not human review.
    if (pkg.license !== 'MIT') {
      throw new Error(`gen-vendor: ${pkg.name}@${pkg.version} is licensed "${pkg.license}" — only MIT may be vendored`);
    }
    return `${pkg.name}@${pkg.version} (${pkg.license})`;
  });
  return `/*! Sitewright component runtime. Bundles: ${lines.join(', ')}. See each package for its MIT license text. */`;
}

for (const t of TARGETS) {
  const banner = libBanner(t.libs);
  const result = await build({
    entryPoints: [join(pkgRoot, t.entry)],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2018',
    write: false,
    banner: { js: banner },
    legalComments: 'none',
    ...(t.loader ? { loader: t.loader } : {}),
    // Alias values are repo-relative paths → resolve to absolute for esbuild.
    ...(t.alias
      ? { alias: Object.fromEntries(Object.entries(t.alias).map(([k, v]) => [k, join(pkgRoot, v)])) }
      : {}),
  });
  let js = result.outputFiles[0].text.trimEnd();
  // Rewrite only the single hard-coded template class (NOT classNames-driven) so no vendor name
  // leaks into the DOM. Scoped to "smartphoto-sr-only" → the "smartphoto@version" license banner
  // and any (classNames-overridden, never-rendered) default strings are left untouched.
  if (t.renameClasses) js = js.replace(/smartphoto-sr-only/g, 'sw-lightbox-sr-only');
  // Vendor-neutral class prefix: rewrite "<from>*" → "<to>*" in the bundled JS (which constructs
  // the classes). The negative lookahead on "@" preserves the "<from>@version (MIT)" license
  // banner — the only place the bare prefix is followed by "@". `from` is regex-escaped so a future
  // prefix containing metacharacters can't corrupt the rewrite.
  if (t.renamePrefix) {
    const from = t.renamePrefix.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line security/detect-non-literal-regexp -- `from` is a build-time TARGETS constant, regex-escaped above
    js = js.replace(new RegExp(from + '(?!@)', 'g'), t.renamePrefix.to);
  }

  const parts = [
    '// AUTO-GENERATED by scripts/gen-vendor.mjs — DO NOT EDIT BY HAND.',
    `// Bundled from ${t.entry} + ${t.libs.join(', ')} (all MIT; banner embedded in the JS).`,
    '// Regenerate: pnpm --filter @sitewright/blocks gen:vendor',
    '',
    `export const ${t.jsConst}: string = ${JSON.stringify(js)};`,
  ];
  if (t.css) {
    let css = readFileSync(join(pkgRoot, t.css.from), 'utf8').trim();
    // Match the entry's classNames override: every "smartphoto" selector/keyframe → "sw-lightbox".
    if (t.renameClasses) css = css.replace(/smartphoto/g, 'sw-lightbox');
    // Vendor-neutral class prefix in the stylesheet (mirrors the JS rewrite above).
    if (t.renamePrefix) {
      const from = t.renamePrefix.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // eslint-disable-next-line security/detect-non-literal-regexp -- `from` is a build-time TARGETS constant, regex-escaped above
      css = css.replace(new RegExp(from, 'g'), t.renamePrefix.to);
    }
    parts.push('', `export const ${t.css.cssConst}: string = ${JSON.stringify(css)};`);
  }
  parts.push('');

  const outPath = join(pkgRoot, t.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, parts.join('\n'), 'utf8');
  const kb = (Buffer.byteLength(js) / 1024).toFixed(1);
  process.stderr.write(`gen-vendor: wrote ${t.out} (js ${kb} KB${t.css ? ' + vendor css' : ''})\n`);
}
