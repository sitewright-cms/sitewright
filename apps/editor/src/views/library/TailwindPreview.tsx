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
import type { ClassValue, PreviewKind } from '@sitewright/tailwind-reference/meta';

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

/**
 * Whether a raw declaration value is safe to place in a style attribute.
 *
 * The values come from the design system's own output, not from user input, so this is a belt-and-
 * braces check rather than the primary defence — but the preview writes them into a stylesheet, and
 * `}` or a comment opener there could break out of the rule. Anything rejected simply does not
 * preview; the CSS text beside it still shows the author exactly what the class does.
 */
function isSafeDeclarationValue(value: string): boolean {
  return !/[{}<>;]/.test(value) && !value.includes('/*') && !value.includes('*/');
}

/** The declarations to paint, as `prop: value` pairs — resolved values preferred over `var(…)`. */
function declarations(props: readonly string[], values: readonly ClassValue[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < props.length && i < values.length; i++) {
    const prop = props[i];
    const raw = values[i];
    if (!prop || !raw) continue;
    // A `var(--x)` that the generator resolved is painted at its RESOLVED value: the shadow root
    // carries the common theme vars, but not every one, and an unresolved var silently paints nothing.
    const value = raw[1] ?? raw[0];
    if (!isSafeDeclarationValue(value)) continue;
    out.push(`${prop}: ${value}`);
  }
  return out;
}

/** The demo markup for each preview kind. Kept tiny — a preview illustrates, it does not simulate. */
function demoFor(kind: PreviewKind, css: string): string {
  const box = `display:block;box-sizing:border-box;${css}`;
  switch (kind) {
    case 'color':
      // A swatch showing the colour as painted. `currentColor`-based props (fill/stroke/color) need
      // the value on `color` too, which the caller already put in `css`.
      return `<span class="swatch" style="${box}"></span>`;
    case 'text':
      return `<span class="specimen" style="${css}">The quick brown fox</span>`;
    case 'box':
      return `<span class="demo-box" style="${box}"></span>`;
    case 'size':
      return `<span class="bar" style="${box}"></span>`;
    case 'cursor':
      return `<span class="cursor-patch" style="${css}">hover</span>`;
    default:
      return '';
  }
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
  props: readonly string[];
  values: readonly ClassValue[];
  /** The class name, for the preview's accessible label. */
  name: string;
}

/**
 * A single class's live preview, isolated in a shadow root.
 *
 * Returns null for `none` — the categories where a demo would need an invented scene (layout,
 * flex/grid, interactivity) show only their generated CSS, which is exact and needs no staging.
 */
export function TailwindPreview({ kind, props, values, name }: TailwindPreviewProps): ReactNode {
  const hostRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<ShadowRoot | null>(null);

  const html = useMemo(() => {
    if (kind === 'none') return '';
    const decls = declarations(props, values);
    if (decls.length === 0) return '';
    // A colour preview paints whichever property the class actually sets (`fill`, `border-color`, …)
    // onto `background-color` as well, so a one-property swatch is visible whatever the property is.
    const css =
      kind === 'color'
        ? `${decls.join(';')};background-color:${values[0]?.[1] ?? values[0]?.[0] ?? 'transparent'}`
        : decls.join(';');
    return demoFor(kind, css);
  }, [kind, props, values]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !html) return;
    // `attachShadow` throws if called twice on the same host, so reuse the root across re-renders.
    rootRef.current ??= host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const root = rootRef.current;
    const style = document.createElement('style');
    style.textContent = `:host{${PREVIEW_THEME}}${PREVIEW_BASE}${kind === 'box' ? PREVIEW_KEYFRAMES : ''}`;
    const holder = document.createElement('span');
    // Trusted content: `html` is assembled here from the design system's own declaration values,
    // every one of which passed `isSafeDeclarationValue`. No dataset field reaches it as markup.
    holder.innerHTML = html;
    root.replaceChildren(style, holder);
  }, [html, kind]);

  if (!html) return null;
  return <span ref={hostRef} aria-label={`${name} preview`} role="img" className="shrink-0" />;
}
