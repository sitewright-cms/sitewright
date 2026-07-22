// Generates src/icon-aliases.ts — a Lucide-name -> Phosphor-name map so authored/agent-written Lucide
// names resolve to the Phosphor glyph. Run AFTER gen-phosphor-icons + gen-lucide-icons:
//   node scripts/gen-icon-aliases.mjs
// Strategy (SAFE — every alias target is verified to EXIST in Phosphor, so we never emit a broken alias;
// unmapped names fall back to the Lucide outline at render, never invisible):
//   1. exact name matches need no alias (same name in both sets).
//   2. verified transform rules (chevron->caret, chevrons->caret-double, alert->warning, arrow-X-circle
//      -> arrow-circle-X, …) — the candidate is accepted ONLY if it exists in Phosphor.
//   3. a hand-curated synonym dictionary of the common renames — each entry verified the same way.
// A coverage report + a list of DROPPED (unverified) curated entries is printed so the dict can be fixed.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const { ICON_NAMES } = await import('../dist/icons.js');
const { PHOSPHOR_NAMES } = await import('../dist/phosphor-icons.js');
const PH = new Set(PHOSPHOR_NAMES);

// Hand-curated Lucide -> Phosphor renames (the common icons). Verified against PH below; a miss is logged.
const CURATED = {
  settings: 'gear', 'settings-2': 'gear-six', search: 'magnifying-glass', mail: 'envelope', menu: 'list',
  home: 'house', edit: 'pencil-simple', 'edit-2': 'pencil-simple', 'edit-3': 'pencil-line', pencil: 'pencil',
  'trash-2': 'trash', 'file-text': 'file-text', download: 'download-simple', upload: 'upload-simple',
  calendar: 'calendar-blank', 'help-circle': 'question', 'alert-triangle': 'warning', 'alert-circle': 'warning-circle',
  'alert-octagon': 'warning-octagon', 'eye-off': 'eye-slash', unlock: 'lock-open', 'more-horizontal': 'dots-three',
  'more-vertical': 'dots-three-vertical', 'message-circle': 'chat-circle', 'message-square': 'chat', send: 'paper-plane-tilt',
  share: 'share-network', 'share-2': 'share-network', filter: 'funnel', grid: 'grid-four', 'layout-grid': 'squares-four',
  zap: 'lightning', sparkles: 'sparkle', map: 'map-trifold', building: 'buildings', 'building-2': 'buildings',
  'dollar-sign': 'currency-dollar', 'external-link': 'arrow-square-out', 'link-2': 'link', rocket: 'rocket-launch',
  award: 'medal', 'refresh-cw': 'arrows-clockwise', 'refresh-ccw': 'arrows-counter-clockwise', 'rotate-cw': 'arrow-clockwise',
  'rotate-ccw': 'arrow-counter-clockwise', 'volume-2': 'speaker-high', volume: 'speaker-high', 'volume-x': 'speaker-x',
  mic: 'microphone', 'mic-off': 'microphone-slash', wifi: 'wifi-high', battery: 'battery-full', video: 'video-camera',
  'life-buoy': 'lifebuoy', maximize: 'arrows-out', 'maximize-2': 'arrows-out-simple', minimize: 'arrows-in',
  'minimize-2': 'arrows-in-simple', gem: 'diamond', 'pen-tool': 'pen-nib', 'heart-handshake': 'handshake',
  loader: 'circle-notch', 'loader-2': 'circle-notch', 'log-in': 'sign-in', 'log-out': 'sign-out', 'shopping-cart': 'shopping-cart',
  'thumbs-up': 'thumbs-up', 'thumbs-down': 'thumbs-down', bookmark: 'bookmark-simple', flag: 'flag', tag: 'tag',
  'trending-up': 'trend-up', 'trending-down': 'trend-down', activity: 'pulse', 'zap-off': 'lightning-slash',
  'pie-chart': 'chart-pie', 'bar-chart': 'chart-bar', 'bar-chart-2': 'chart-bar', 'line-chart': 'chart-line',
  smartphone: 'device-mobile', tablet: 'device-tablet', monitor: 'monitor', server: 'hard-drives', database: 'database',
  cpu: 'cpu', 'hard-drive': 'hard-drive', save: 'floppy-disk', printer: 'printer', 'shopping-bag': 'shopping-bag',
  'credit-card': 'credit-card', percent: 'percent', 'help-circle': 'question', 'check-circle': 'check-circle',
  'check-circle-2': 'check-circle', 'x-circle': 'x-circle', 'plus-circle': 'plus-circle', 'minus-circle': 'minus-circle',
  'user-plus': 'user-plus', 'user-minus': 'user-minus', 'user-check': 'user-check', 'user-x': 'user-minus',
  lightbulb: 'lightbulb', globe: 'globe', 'globe-2': 'globe', briefcase: 'briefcase', 'graduation-cap': 'graduation-cap',
  book: 'book', 'book-open': 'book-open', newspaper: 'newspaper', 'file-plus': 'file-plus', 'folder-plus': 'folder-plus',
  'log-in': 'sign-in', 'toggle-left': 'toggle-left', 'toggle-right': 'toggle-right', 'chevrons-up-down': 'caret-up-down',
  headphones: 'headphones', 'shield-check': 'shield-check', 'shield-alert': 'shield-warning', crown: 'crown',
  'align-left': 'text-align-left', 'align-center': 'text-align-center', 'align-right': 'text-align-right',
  'align-justify': 'text-align-justify', bold: 'text-b', italic: 'text-italic', underline: 'text-underline',
  'wand-2': 'magic-wand', wand: 'magic-wand', 'sparkles': 'sparkle', 'square-pen': 'pencil-simple-line',
  'circle-check': 'check-circle', 'circle-x': 'x-circle', 'circle-plus': 'plus-circle', 'circle-alert': 'warning-circle',
  'circle-help': 'question', 'circle-user': 'user-circle', 'square-arrow-out-up-right': 'arrow-square-out',
  clock: 'clock', 'map-pin': 'map-pin', phone: 'phone', 'phone-call': 'phone-call', headset: 'headset',
};

// Verified transform rules: fn(name) -> candidate | undefined. Accepted only if candidate ∈ Phosphor.
const RULES = [
  (n) => n.replace(/^chevrons-(up|down|left|right)$/, 'caret-double-$1'),
  (n) => n.replace(/^chevron-(up|down|left|right)$/, 'caret-$1'),
  (n) => n.replace(/^arrow-(up|down|left|right)-circle$/, 'arrow-circle-$1'),
  (n) => n.replace(/^arrow-(up|down|left|right)-square$/, 'arrow-square-$1'),
  (n) => n.replace(/^alert-(.+)$/, 'warning-$1'),
  (n) => n.replace(/-2$/, ''), // lucide's numbered variant → base (verified)
  (n) => n.replace(/^circle-(.+)$/, '$1-circle'), // lucide circle-check → phosphor check-circle
  (n) => n.replace(/^square-(.+)$/, '$1-square'),
];

const alias = {};
const dropped = [];
let exact = 0;

for (const name of ICON_NAMES) {
  if (PH.has(name)) { exact++; continue; } // no alias needed
  // curated first
  if (name in CURATED) {
    if (PH.has(CURATED[name])) { alias[name] = CURATED[name]; continue; }
    dropped.push(`${name} -> ${CURATED[name]} (curated target missing in Phosphor)`);
  }
  // then rules
  let mapped;
  for (const r of RULES) {
    const cand = r(name);
    if (cand !== name && PH.has(cand)) { mapped = cand; break; }
  }
  if (mapped) alias[name] = mapped;
}

const aliased = Object.keys(alias).length;
const fallback = ICON_NAMES.length - exact - aliased;

const entries = Object.entries(alias).sort(([a], [b]) => a.localeCompare(b));
const out = `// AUTO-GENERATED by scripts/gen-icon-aliases.mjs. DO NOT EDIT BY HAND.
// Lucide-name -> Phosphor-name, so a familiar/agent-written Lucide name renders as the Phosphor glyph.
// Exact-name matches are omitted (they resolve directly). Names absent here fall back to the Lucide outline.
const ICON_ALIASES = new Map<string, string>([
${entries.map(([l, p]) => `  ["${l}", "${p}"],`).join('\n')}
]);

/** The Phosphor name a Lucide name maps to, or undefined (→ try Phosphor directly, then Lucide fallback). */
export function aliasToPhosphor(name: string): string | undefined {
  return ICON_ALIASES.get(name);
}
`;
writeFileSync(join(HERE, '../src/icon-aliases.ts'), out);

console.log(`gen-icon-aliases: Lucide ${ICON_NAMES.length} → exact ${exact}, aliased ${aliased}, fallback ${fallback}`);
console.log(`  Phosphor-resolvable: ${exact + aliased} (${Math.round(((exact + aliased) / ICON_NAMES.length) * 100)}%); Lucide fallback: ${fallback}`);
if (dropped.length) {
  console.log(`  DROPPED curated (target missing — fix these ${dropped.length}):`);
  for (const d of dropped) console.log(`    ${d}`);
}
