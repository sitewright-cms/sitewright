/**
 * Animation Examples — complete, animated SVGs that open IN the Studio.
 *
 * These replace the four copy-paste directive snippets this shelf used to hold. A snippet showed one
 * attribute on one shape, which is the part of the model that is already documented; what it could
 * not show is the thing people actually want to build — a MARK or a SCENE where a dozen elements
 * arrive on one choreographed timeline. So each entry here is a finished composition, and the
 * affordance is "View", which imports it into the Studio where every element, effect and delay is
 * inspectable and editable. Reading the markup is still one click away (the Studio's code view), but
 * it is no longer the only thing on offer.
 *
 * AUTHORING RULES, learned from the engine (packages/blocks/src/svg-anim.ts):
 *  - The scene lives on an INNER `<g data-sw-svg-scene>`, never on the root `<svg>`: a scene is found
 *    with `querySelectorAll`, which does not match the root element itself when the engine is handed
 *    a freshly-inlined `<svg>` as its subtree root. A `<g>` is found on every path.
 *  - Stagger is ADDITIVE: a member's delay is `data-sw-delay + stagger * index`, so a per-element
 *    delay layers on top of the cascade instead of replacing it. That is how these get a shape to
 *    land on a beat while the rest keep marching.
 *  - A scene honours `data-sw-svg-click` and `data-sw-svg-loop` itself, so those go on the `<g>` too
 *    — a global root unit would find every element already claimed by the scene and animate nothing.
 *  - The SVG engine plays ONCE by default; `data-sw-once="false"` is what makes a scene replay.
 *  - EVERY boolean directive needs the literal string `"true"`: the engine reads them with
 *    `getAttribute(name) === 'true'`, so a bare HTML-style `data-sw-svg-click` is inert — and it
 *    is not even well-formed XML, which is what `parseSvg` parses these as.
 *  - Colours are literal, not `currentColor`/CI classes: an example has to look the same in the
 *    Studio canvas, on a page, and in a downloaded file.
 */
export interface SvgAnimExample {
  id: string;
  name: string;
  /** One line on what it demonstrates — shown under the name in the shelf. */
  description: string;
  /** The effects/directives it uses, for the shelf's chips and for search. */
  uses: string[];
  /** Complete, self-contained SVG markup; imported verbatim by the Studio. */
  svg: string;
}

const ORBIT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180" data-sw-svg-responsive="true">
  <g data-sw-svg-scene="true" data-sw-svg-stagger="130" data-sw-svg-click="true" data-sw-svg-loop="7000" data-sw-once="false">
    <circle data-sw-svg="draw" data-sw-duration="1400" data-sw-easing="ease-out"
      cx="90" cy="90" r="62" fill="none" stroke="#6366f1" stroke-width="3" />
    <ellipse data-sw-svg="draw" data-sw-duration="1200" data-sw-svg-draw-dir="reverse"
      cx="90" cy="90" rx="62" ry="24" fill="none" stroke="#a5b4fc" stroke-width="2"
      transform="rotate(-24 90 90)" />
    <circle data-sw-svg="scale-c" data-sw-duration="520" data-sw-easing="back" cx="90" cy="28" r="9" fill="#f97316" />
    <circle data-sw-svg="scale-c" data-sw-duration="520" data-sw-easing="back" cx="145" cy="112" r="7" fill="#22d3ee" />
    <circle data-sw-svg="scale-c" data-sw-duration="520" data-sw-easing="back" cx="36" cy="118" r="6" fill="#f472b6" />
    <circle data-sw-svg="zoom-in" data-sw-duration="600" data-sw-delay="120" cx="90" cy="90" r="17" fill="#4338ca" />
    <path data-sw-svg="draw" data-sw-duration="700" data-sw-delay="180"
      d="M82 90 L88 97 L99 84" fill="none" stroke="#ffffff" stroke-width="4"
      stroke-linecap="round" stroke-linejoin="round" />
  </g>
</svg>`;

const BADGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 190" width="160" height="190" data-sw-svg-responsive="true">
  <g data-sw-svg-scene="true" data-sw-svg-stagger="150" data-sw-svg-click="true" data-sw-svg-loop="7500" data-sw-once="false">
    <path data-sw-svg="draw" data-sw-duration="1600" data-sw-svg-fill="true" data-sw-svg-draw-color="#0f766e"
      d="M80 10 L146 36 V96 C146 136 116 164 80 180 C44 164 14 136 14 96 V36 Z"
      fill="#99f6e4" stroke="#0f766e" stroke-width="4" stroke-linejoin="round" />
    <path data-sw-svg="draw" data-sw-duration="900"
      d="M56 118 L80 56 L104 118" fill="none" stroke="#0f766e" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
    <path data-sw-svg="draw" data-sw-duration="600"
      d="M66 98 H94" fill="none" stroke="#0f766e" stroke-width="7" stroke-linecap="round" />
    <path data-sw-svg="zoom-in" data-sw-duration="520" data-sw-easing="back"
      d="M126 44 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4 Z" fill="#fbbf24" />
    <path data-sw-svg="zoom-in" data-sw-duration="520" data-sw-easing="back" data-sw-delay="90"
      d="M30 70 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 Z" fill="#fbbf24" />
    <rect data-sw-svg="expand-x" data-sw-duration="700" data-sw-svg-origin="center"
      x="40" y="140" width="80" height="6" rx="3" fill="#0f766e" />
  </g>
</svg>`;

const NETWORK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 170" width="260" height="170" data-sw-svg-responsive="true">
  <g data-sw-svg-scene="true" data-sw-svg-stagger="90" data-sw-svg-click="true" data-sw-svg-loop="8000" data-sw-once="false">
    <path data-sw-svg="draw" data-sw-duration="700" d="M40 130 L108 60" fill="none" stroke="#cbd5e1" stroke-width="3" />
    <path data-sw-svg="draw" data-sw-duration="700" d="M108 60 L178 96" fill="none" stroke="#cbd5e1" stroke-width="3" />
    <path data-sw-svg="draw" data-sw-duration="700" d="M178 96 L228 40" fill="none" stroke="#cbd5e1" stroke-width="3" />
    <path data-sw-svg="draw" data-sw-duration="700" d="M40 130 L178 96" fill="none" stroke="#e2e8f0" stroke-width="2" />
    <circle data-sw-svg="scale-c" data-sw-duration="480" data-sw-easing="back" cx="40" cy="130" r="13" fill="#2563eb" />
    <circle data-sw-svg="scale-c" data-sw-duration="480" data-sw-easing="back" cx="108" cy="60" r="16" fill="#7c3aed" />
    <circle data-sw-svg="scale-c" data-sw-duration="480" data-sw-easing="back" cx="178" cy="96" r="13" fill="#0ea5e9" />
    <circle data-sw-svg="scale-c" data-sw-duration="480" data-sw-easing="back" cx="228" cy="40" r="10" fill="#14b8a6" />
    <circle data-sw-svg="along-path" data-sw-duration="2400" data-sw-delay="300"
      data-sw-svg-path="M40 130 L108 60 L178 96 L228 40" r="5" fill="#f59e0b" />
  </g>
</svg>`;

const DASHBOARD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 180" width="280" height="180" data-sw-svg-responsive="true">
  <g data-sw-svg-scene="true" data-sw-svg-stagger="100" data-sw-svg-click="true" data-sw-svg-loop="8000" data-sw-once="false">
    <rect data-sw-svg="fade-up" data-sw-duration="600" x="8" y="8" width="264" height="164" rx="14" fill="#f8fafc" stroke="#e2e8f0" stroke-width="2" />
    <rect data-sw-svg="expand-r" data-sw-duration="520" x="26" y="28" width="92" height="9" rx="4" fill="#94a3b8" />
    <rect data-sw-svg="expand-t" data-sw-duration="700" data-sw-easing="ease-out" x="30" y="92" width="22" height="52" rx="5" fill="#60a5fa" />
    <rect data-sw-svg="expand-t" data-sw-duration="700" data-sw-easing="ease-out" x="64" y="72" width="22" height="72" rx="5" fill="#3b82f6" />
    <rect data-sw-svg="expand-t" data-sw-duration="700" data-sw-easing="ease-out" x="98" y="104" width="22" height="40" rx="5" fill="#60a5fa" />
    <rect data-sw-svg="expand-t" data-sw-duration="700" data-sw-easing="ease-out" x="132" y="58" width="22" height="86" rx="5" fill="#2563eb" />
    <path data-sw-svg="draw" data-sw-duration="1300" data-sw-delay="200"
      d="M176 120 L198 92 L220 104 L248 62" fill="none" stroke="#f97316" stroke-width="4"
      stroke-linecap="round" stroke-linejoin="round" />
    <circle data-sw-svg="zoom-in" data-sw-duration="420" data-sw-easing="back" data-sw-delay="420" cx="248" cy="62" r="7" fill="#f97316" />
    <rect data-sw-svg="reveal-right" data-sw-duration="600" x="26" y="156" width="228" height="4" rx="2" fill="#e2e8f0" />
  </g>
</svg>`;

const SUNRISE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 170" width="280" height="170" data-sw-svg-responsive="true">
  <g data-sw-svg-scene="true" data-sw-svg-stagger="100" data-sw-svg-click="true" data-sw-svg-loop="9000" data-sw-once="false">
    <rect data-sw-svg="fade" data-sw-duration="900" x="0" y="0" width="280" height="170" rx="12" fill="#fff7ed" />
    <circle data-sw-svg="zoom-in" data-sw-duration="900" data-sw-easing="back" cx="140" cy="104" r="34" fill="#fbbf24" />
    <path data-sw-svg="scale-c" data-sw-duration="480" d="M140 60 v-14" stroke="#f59e0b" stroke-width="5" stroke-linecap="round" fill="none" />
    <path data-sw-svg="scale-c" data-sw-duration="480" d="M171 73 l10 -10" stroke="#f59e0b" stroke-width="5" stroke-linecap="round" fill="none" />
    <path data-sw-svg="scale-c" data-sw-duration="480" d="M109 73 l-10 -10" stroke="#f59e0b" stroke-width="5" stroke-linecap="round" fill="none" />
    <path data-sw-svg="scale-c" data-sw-duration="480" d="M181 87 l13 -5" stroke="#f59e0b" stroke-width="5" stroke-linecap="round" fill="none" />
    <path data-sw-svg="scale-c" data-sw-duration="480" d="M99 87 l-13 -5" stroke="#f59e0b" stroke-width="5" stroke-linecap="round" fill="none" />
    <path data-sw-svg="reveal-up" data-sw-duration="900" data-sw-delay="120"
      d="M0 170 L58 116 L112 152 L170 104 L224 140 L280 100 V170 Z" fill="#fb923c" />
    <path data-sw-svg="reveal-up" data-sw-duration="900" data-sw-delay="220"
      d="M0 170 L72 134 L136 166 L198 132 L280 164 V170 Z" fill="#ea580c" />
    <path data-sw-svg="fade-left" data-sw-duration="700" data-sw-delay="300"
      d="M54 44 q8 -8 16 0 q8 -8 16 0" fill="none" stroke="#9a3412" stroke-width="3" stroke-linecap="round" />
    <path data-sw-svg="fade-left" data-sw-duration="700" data-sw-delay="420"
      d="M202 52 q7 -7 14 0 q7 -7 14 0" fill="none" stroke="#9a3412" stroke-width="3" stroke-linecap="round" />
  </g>
</svg>`;

/**
 * Ordered simple → elaborate: the first entry should be the one that makes the model click.
 * Each is ORIGINAL artwork drawn for this shelf — nothing here is lifted from an icon set or a
 * third-party mark, because these ship inside the product and get copied into customer sites.
 */
export const SVG_ANIM_EXAMPLES: SvgAnimExample[] = [
  {
    id: 'orbit-mark',
    name: 'Orbit mark',
    description: 'A logo that builds itself: two rings draw on (one in reverse), three satellites pop in on the beat, then the core and its checkmark land.',
    uses: ['scene + stagger', 'draw', 'reverse draw', 'scale-c', 'zoom-in', 'loop'],
    svg: ORBIT,
  },
  {
    id: 'crest-badge',
    name: 'Crest badge',
    description: 'Draw-then-fill on the shield outline, a monogram drawn stroke by stroke, sparks on a back-eased pop, and a rule that expands from its centre.',
    uses: ['scene + stagger', 'draw-then-fill', 'draw colour', 'zoom-in', 'expand-x'],
    svg: BADGE,
  },
  {
    id: 'network-scene',
    name: 'Network scene',
    description: 'Links draw between nodes that scale in behind them, and a packet then travels the whole route along a motion path.',
    uses: ['scene + stagger', 'draw', 'scale-c', 'along-path'],
    svg: NETWORK,
  },
  {
    id: 'dashboard-scene',
    name: 'Dashboard scene',
    description: 'A card fades up, bars grow from their baseline one after another, a trend line draws across and its marker pops at the end.',
    uses: ['scene + stagger', 'expand-t', 'expand-r', 'draw', 'reveal-right', 'zoom-in'],
    svg: DASHBOARD,
  },
  {
    id: 'sunrise-scene',
    name: 'Sunrise scene',
    description: 'A pictorial scene: the sun zooms in, five rays scale out around it, two ridges wipe upward on staggered delays and the birds drift in last.',
    uses: ['scene + stagger', 'zoom-in', 'scale-c', 'reveal-up', 'fade-left'],
    svg: SUNRISE,
  },
];
