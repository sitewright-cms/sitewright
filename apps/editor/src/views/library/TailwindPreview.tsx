// Live previews for the Tailwind reference.
//
// ★ The obvious implementation does not work. Putting `class="text-sm"` on a div here would render
// NOTHING for most classes: this SPA's stylesheet is compiled by scanning the editor's own source, so
// a utility only has a rule if the editor's chrome happens to use it. That was measured on the
// rich-text toolbars — 14 of 44 emittable classes had no rule at all, and the ones that worked did so
// by accident. A reference that silently previewed the wrong thing would be worse than none.
//
// So a preview never uses a class. It applies the DECLARATIONS the design system generated for that
// exact class, which the dataset already carries verbatim, as inline style on a plain element.
//
// It renders inside a SHADOW ROOT for the second half of the same problem: the editor rebinds theme
// variables for its own readability (`--text-xs` is lifted from 12px to 14px so no UI text renders
// below ~14px), and it loads DaisyUI. Inheriting either would make the preview a lie about what the
// class does on a published page. The shadow root gets Tailwind's own `@theme` variables instead.
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { isSafeCssTokenValue } from '@sitewright/schema';
import { declCondition, declValue, type ClassDecl, type PreviewKind } from '@sitewright/tailwind-reference/meta';

/**
 * The subset of Tailwind's theme variables a preview can need, at their STOCK values.
 *
 * Only the families that a previewable declaration can reference (`var(--text-sm)`,
 * `var(--radius-lg)`, `var(--spacing)`, …). Colour classes resolve to a literal in the dataset, so
 * the palette does not need to be repeated here.
 *
 * These are stock Tailwind values on purpose — the preview answers "what does this class do", which
 * is a platform fact. Project brand tokens are shown in their own section, where they are labelled
 * as the project's.
 */
const PREVIEW_THEME = `
  --spacing: 0.25rem;
  --text-xs: 0.75rem; --text-xs--line-height: calc(1 / 0.75);
  --text-sm: 0.875rem; --text-sm--line-height: calc(1.25 / 0.875);
  --text-base: 1rem; --text-base--line-height: calc(1.5 / 1);
  --text-lg: 1.125rem; --text-lg--line-height: calc(1.75 / 1.125);
  --text-xl: 1.25rem; --text-xl--line-height: calc(1.75 / 1.25);
  --text-2xl: 1.5rem; --text-2xl--line-height: calc(2 / 1.5);
  --text-3xl: 1.875rem; --text-3xl--line-height: calc(2.25 / 1.875);
  --text-4xl: 2.25rem; --text-4xl--line-height: calc(2.5 / 2.25);
  --text-5xl: 3rem; --text-5xl--line-height: 1;
  --text-6xl: 3.75rem; --text-6xl--line-height: 1;
  --text-7xl: 4.5rem; --text-7xl--line-height: 1;
  --text-8xl: 6rem; --text-8xl--line-height: 1;
  --text-9xl: 8rem; --text-9xl--line-height: 1;
  --font-weight-thin: 100; --font-weight-extralight: 200; --font-weight-light: 300;
  --font-weight-normal: 400; --font-weight-medium: 500; --font-weight-semibold: 600;
  --font-weight-bold: 700; --font-weight-extrabold: 800; --font-weight-black: 900;
  --tracking-tighter: -0.05em; --tracking-tight: -0.025em; --tracking-normal: 0em;
  --tracking-wide: 0.025em; --tracking-wider: 0.05em; --tracking-widest: 0.1em;
  --leading-tight: 1.25; --leading-snug: 1.375; --leading-normal: 1.5;
  --leading-relaxed: 1.625; --leading-loose: 2;
  --radius-xs: 0.125rem; --radius-sm: 0.25rem; --radius-md: 0.375rem; --radius-lg: 0.5rem;
  --radius-xl: 0.75rem; --radius-2xl: 1rem; --radius-3xl: 1.5rem; --radius-4xl: 2rem;
  --font-sans: ui-sans-serif, system-ui, sans-serif;
  --font-serif: ui-serif, Georgia, serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --blur-xs: 4px; --blur-sm: 8px; --blur-md: 12px; --blur-lg: 16px;
  --blur-xl: 24px; --blur-2xl: 40px; --blur-3xl: 64px;
  --perspective-dramatic: 100px; --perspective-near: 300px;
  --perspective-normal: 500px; --perspective-midrange: 800px; --perspective-distant: 1200px;
  --ease-in: cubic-bezier(0.4, 0, 1, 1); --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --animate-spin: spin 1s linear infinite;
  --animate-ping: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
  --animate-pulse: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  --animate-bounce: bounce 1s infinite;
`;

/** Keyframes for the `animate-*` previews — a shadow root does not inherit the document's. */
const PREVIEW_KEYFRAMES = `
  @keyframes spin { to { transform: rotate(360deg) } }
  @keyframes ping { 75%, 100% { transform: scale(2); opacity: 0 } }
  @keyframes pulse { 50% { opacity: 0.5 } }
  @keyframes bounce {
    0%, 100% { transform: translateY(-25%); animation-timing-function: cubic-bezier(0.8, 0, 1, 1) }
    50% { transform: none; animation-timing-function: cubic-bezier(0, 0, 0.2, 1) }
  }
`;

/** The demo element's class and its text content, per preview kind. `none` renders nothing. */
const DEMO: Record<Exclude<PreviewKind, 'none'>, { cls: string; text?: string; box: boolean }> = {
  // A swatch showing the colour as painted. `currentColor`-based props (fill/stroke/color) also get
  // the value on `background-color`, so a one-property swatch is visible whatever the property is.
  color: { cls: 'swatch', box: true },
  text: { cls: 'specimen', text: 'The quick brown fox', box: false },
  box: { cls: 'demo-box', box: true },
  size: { cls: 'bar', box: true },
  cursor: { cls: 'cursor-patch', text: 'hover', box: false },
};

/**
 * The declarations to paint, as `[prop, value]` pairs.
 *
 * Reads the class's OWN declaration list rather than zipping the topic's `props` against a parallel
 * values array — `props` is the deduped signature, so `container` is a 2-property topic with 6
 * declarations and the zip silently stopped at the second.
 *
 * CONDITIONAL declarations are skipped: `container`'s `max-width: 40rem` only applies above a
 * breakpoint, and painting it unconditionally would show a swatch that no viewport ever renders.
 */
function declarations(decls: readonly ClassDecl[]): [string, string][] {
  const out: [string, string][] = [];
  for (const decl of decls) {
    if (declCondition(decl) !== null) continue;
    // A `var(--x)` that the generator resolved is painted at its RESOLVED value: the shadow root
    // carries the common theme vars, but not every one, and an unresolved var silently paints nothing.
    const value = declValue(decl);
    if (!isSafeCssTokenValue(value)) continue;
    out.push([decl[0], value]);
  }
  return out;
}

/**
 * Build the demo element and paint the declarations onto it.
 *
 * Styles go on through the CSSOM (`style.setProperty`), never by assembling a `style="…"` string and
 * handing it to `innerHTML`. That is a security property, not a preference: a value written into an
 * attribute inside an HTML string can close the attribute and open a tag, whereas `setProperty` only
 * ever parses its argument as a CSS value — an unparseable one is dropped, not escalated. It also
 * makes the earlier bug structurally impossible, where a colour's `background-color` fallback was
 * concatenated in AFTER the value filter and so skipped it entirely.
 *
 * `isSafeCssTokenValue` (the schema's single predicate, shared with the brand-CSS emitter and the
 * importer) is the belt to that braces: it additionally blocks `url()`/`image()`/`@import`, so a
 * value can never turn a preview into a network fetch.
 */
function buildDemo(kind: PreviewKind, decls: readonly [string, string][], colour: string | null): HTMLElement | null {
  if (kind === 'none') return null;
  const spec = DEMO[kind];
  const el = document.createElement('span');
  el.className = spec.cls;
  if (spec.text) el.textContent = spec.text;
  if (spec.box) {
    el.style.setProperty('display', 'block');
    el.style.setProperty('box-sizing', 'border-box');
  }
  for (const [prop, value] of decls) el.style.setProperty(prop, value);
  if (colour !== null) el.style.setProperty('background-color', colour);
  return el;
}

/** Base styling for the demo elements, inside the shadow root. */
const PREVIEW_BASE = `
  :host { display: inline-flex; align-items: center; }
  .swatch {
    width: 1.75rem; height: 1.75rem; border-radius: 0.375rem;
    border: 1px solid rgba(100, 116, 139, 0.35);
    background-image: linear-gradient(45deg, #cbd5e1 25%, transparent 25%, transparent 75%, #cbd5e1 75%),
                      linear-gradient(45deg, #cbd5e1 25%, transparent 25%, transparent 75%, #cbd5e1 75%);
    background-size: 8px 8px; background-position: 0 0, 4px 4px;
  }
  .specimen { color: inherit; white-space: nowrap; }
  .demo-box {
    width: 3rem; height: 1.75rem;
    background: linear-gradient(135deg, #6366f1, #a855f7);
    border-color: #6366f1;
  }
  .bar { height: 0.75rem; min-width: 1px; background: #6366f1; border-radius: 9999px; }
  .cursor-patch {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 3.5rem; padding: 0.125rem 0.5rem; font-size: 0.6875rem;
    border: 1px dashed rgba(100, 116, 139, 0.5); border-radius: 0.375rem;
  }
`;

interface TailwindPreviewProps {
  kind: PreviewKind;
  /** The class's own generated declarations. */
  decls: readonly ClassDecl[];
  /** The class name, for the preview's accessible label. */
  name: string;
}

/**
 * A single class's live preview, isolated in a shadow root.
 *
 * Returns null for `none` — the categories where a demo would need an invented scene (layout,
 * flex/grid, interactivity) show only their generated CSS, which is exact and needs no staging.
 */
export function TailwindPreview({ kind, decls, name }: TailwindPreviewProps): ReactNode {
  const hostRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<ShadowRoot | null>(null);

  const paint = useMemo(() => {
    if (kind === 'none') return null;
    const painted = declarations(decls);
    if (painted.length === 0) return null;
    // A colour preview paints whichever property the class actually sets (`fill`, `border-color`, …)
    // onto `background-color` too. It reads the value back out of the FILTERED list — never out of
    // the raw input — so it cannot pick up an entry the filter rejected. Reaching past the filter for
    // the raw value is exactly the bug this shape prevents.
    const colour = kind === 'color' ? (painted[0]?.[1] ?? null) : null;
    return { decls: painted, colour };
  }, [kind, decls]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !paint) return;
    // `attachShadow` throws if called twice on the same host, so reuse the root across re-renders.
    rootRef.current ??= host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const root = rootRef.current;
    const style = document.createElement('style');
    // The only interpolations here are in-repo constants; no dataset value reaches this stylesheet.
    style.textContent = `:host{${PREVIEW_THEME}}${PREVIEW_BASE}${kind === 'box' ? PREVIEW_KEYFRAMES : ''}`;
    const demo = buildDemo(kind, paint.decls, paint.colour);
    root.replaceChildren(style, ...(demo ? [demo] : []));
  }, [paint, kind]);

  if (!paint) return null;
  return <span ref={hostRef} aria-label={`${name} preview`} role="img" className="shrink-0" />;
}
