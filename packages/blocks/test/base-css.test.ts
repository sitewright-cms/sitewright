import { describe, expect, it } from 'vitest';
import { baseStyles } from '../src/base-css.js';

describe('baseStyles — platform base stylesheet', () => {
  const css = baseStyles();

  describe('modern-normalize baseline', () => {
    it('embeds modern-normalize wrapped in the weakest cascade layer', () => {
      expect(css).toContain('@layer sw-normalize {');
      // a couple of signature normalize rules that PRESERVE (not reset) defaults
      expect(css).toContain('font-weight: bolder;'); // b, strong
      expect(css).toContain('vertical-align: baseline;'); // sub/sup, progress
      expect(css).toContain('-webkit-appearance: button;'); // clickable types
    });

    it('ships the MIT attribution banner in the emitted CSS', () => {
      expect(css).toContain('modern-normalize v3.0.1 | MIT License');
    });

    it('keeps the heading scale + list markers (not a FULL preflight reset)', () => {
      // We zero block MARGINS (see "deterministic block spacing" below), but unlike Tailwind
      // preflight we do NOT flatten the heading font-size scale or strip list markers — semantic
      // HTML still reads as structured content.
      expect(css).not.toMatch(/h1\s*,\s*h2[^}]*font-size:\s*inherit/);
      expect(css).not.toMatch(/\b(ul|ol)\b[^}]*list-style:\s*none/);
    });
  });

  describe('deterministic block spacing (zeroed margins + .prose)', () => {
    it('zeroes UA block margins on flow elements (in the weak layer)', () => {
      expect(css).toContain('h1, h2, h3, h4, h5, h6, p, blockquote, figure, dl, dd, pre, hr, ul, ol, fieldset { margin: 0; }');
    });
    it('ships a lightweight .prose rhythm that opts out of .not-prose subtrees', () => {
      expect(css).toContain('.prose :where(p, ul, ol, blockquote, figure, pre, table, hr, h1, h2, h3, h4, h5, h6):not(:where(.not-prose, .not-prose *))');
      expect(css).toContain('.prose > :where(:first-child):not(:where(.not-prose, .not-prose *)) { margin-top: 0; }');
    });
    it('tames the UA list indent to a sane 1.25rem (not the ~40px browser default)', () => {
      expect(css).toContain('ul, ol { padding-inline-start: 1.25rem; }');
      // It must sit in the weak layer so daisyUI .menu + author pl-* utilities still win.
      const ruleIdx = css.indexOf('ul, ol { padding-inline-start: 1.25rem; }');
      const layerOpen = css.lastIndexOf('@layer sw-normalize {', ruleIdx);
      expect(layerOpen).toBeGreaterThan(-1);
      expect(ruleIdx).toBeGreaterThan(layerOpen);
    });
    it('keeps both the reset and .prose inside the weak sw-normalize layer (utilities win)', () => {
      const resetIdx = css.indexOf('fieldset { margin: 0; }');
      const layerOpen = css.lastIndexOf('@layer sw-normalize {', resetIdx);
      expect(layerOpen).toBeGreaterThan(-1);
      expect(resetIdx).toBeGreaterThan(layerOpen);
    });
    // REGRESSION: a stray `*/` inside a comment (e.g. writing a Tailwind glob like "mt-<asterisk>/...")
    // closes the CSS comment EARLY, turning the rest into garbage that silently DROPS the next rule —
    // which is exactly why the margin reset never applied at first. Strip comments the way a browser
    // does (non-greedy /* */) and assert nothing leaks: no orphan markers, no comment prose, reset intact.
    it('has no comment that closes early and drops a following rule', () => {
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(stripped).not.toContain('*/'); // an orphan terminator = a comment closed early
      expect(stripped).not.toContain('/*');
      expect(stripped).not.toMatch(/Deterministic block|identical across browsers/); // comment prose stayed in comments
      expect(stripped).toContain('fieldset { margin: 0'); // the reset survives a real comment-strip
    });
  });

  describe('Sitewright platform defaults', () => {
    it('keeps a border-box foundation unlayered (always wins)', () => {
      // the platform copy lives OUTSIDE the @layer block (after the normalize layer)
      expect(css).toContain('/* Foundational box model');
      const platform = css.slice(css.indexOf('/* Foundational box model'));
      expect(platform).toMatch(/\*,\s*\*::before,\s*\*::after\s*{\s*box-sizing: border-box;/);
    });

    it('ships the content container + a full-bleed break-out utility (in the weak layer)', () => {
      expect(css).toContain('.sw-container { width: 100%; max-width: var(--sw-container, 1200px); margin-inline: auto; padding-inline: var(--sw-container-gutter, 2rem); }');
      // .sw-bleed cancels exactly the container gutter so a band spans the container edge-to-edge.
      expect(css).toContain('.sw-bleed { margin-inline: calc(var(--sw-container-gutter, 2rem) * -1); }');
      const bleedIdx = css.indexOf('.sw-bleed {');
      const layerOpen = css.lastIndexOf('@layer sw-normalize {', bleedIdx);
      expect(layerOpen).toBeGreaterThan(-1);
      expect(bleedIdx).toBeGreaterThan(layerOpen);
    });

    it('links inherit colour (never UA blue) AND carry no underline by default', () => {
      // global colour inherit + no underline — the universal default for a code-first CMS
      // and what modern designs ship; utilities (text-*, underline) still win per element.
      expect(css).toContain('a { color: inherit; text-decoration: none; }');
      // the old nav/menu/btn-only underline-drop is gone (now global) — must NOT reappear.
      expect(css).not.toContain(':is(nav, [role="navigation"]) a, .menu a, .btn { text-decoration: inherit; }');
    });

    it('keeps the link rules INSIDE the weak sw-normalize layer (regression: unlayered a{color:inherit} beat daisyUI .btn)', () => {
      // An UNLAYERED a{color:inherit} outranks every layered rule, so it silently
      // overrode daisyUI's layered .btn{color:var(--btn-fg)} — black-on-primary anchor
      // buttons on every published site. The rule must stay inside a layer block.
      const platform = css.slice(css.indexOf('/* Foundational box model'));
      const layerIdx = platform.indexOf('@layer sw-normalize {');
      expect(layerIdx).toBeGreaterThan(-1);
      const aRule = 'a { color: inherit; text-decoration: none; }';
      expect(platform.indexOf(aRule)).toBeGreaterThan(layerIdx);
      const layerBlockEnd = platform.indexOf('}', platform.indexOf(aRule));
      expect(platform.slice(layerIdx, layerBlockEnd + 1)).toContain(aRule);
    });

    it('removes the link underline globally by default (opt IN per element)', () => {
      // modern designs (the common clone target) ship no link underlines; the default is
      // no-underline, and components that WANT one (.btn-link, .sw-consent-link) re-add it
      // via unlayered / higher-specificity rules that outrank this weak layer.
      expect(css).toMatch(/(^|\s)a\s*{[^}]*text-decoration:\s*none/);
      expect(css).toContain('.btn-link'); // still carries its explicit underline
    });

    it('makes media responsive without forcing display on icons', () => {
      expect(css).toContain('img, video { max-width: 100%; height: auto; }');
      expect(css).not.toMatch(/svg[^}]*display:\s*block/);
    });

    describe('code / kbd / samp / pre chip styling', () => {
      it('gives bare code/kbd/samp/pre a THEME-AWARE chip that inverts on a dark palette', () => {
        const rule = css.slice(css.indexOf('code, kbd, samp, pre {'));
        expect(css).toContain('code, kbd, samp, pre {');
        // #EEE is the no-color-mix fallback; the adaptive bg/text come from the brand vars so the
        // chip inverts (light chip on light, dark chip on dark) instead of staying a light block.
        expect(rule).toMatch(/background:\s*#EEE;/);
        expect(rule).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--sw-color-base-content[^)]*\)\s*8%,\s*var\(--sw-color-base-100/);
        expect(rule).toMatch(/padding:\s*\.25rem;/);
        expect(rule).toMatch(/color:\s*var\(--sw-color-base-content,\s*#4a4a4a\);/);
        expect(rule).toMatch(/border-radius:\s*5px;/);
      });

      it('keeps the chip rule INSIDE the weak sw-normalize layer (regression: an unlayered bare kbd{} would beat daisyUI .kbd)', () => {
        // An UNLAYERED bare-element rule outranks any layered rule regardless of
        // specificity, so an unlayered `kbd{background:…}` would clobber daisyUI's
        // layered .kbd / .mockup-code on every site. Must stay layered.
        const idx = css.indexOf('code, kbd, samp, pre {');
        const layerOpen = css.lastIndexOf('@layer sw-normalize {', idx);
        const layerClose = css.indexOf('}', css.indexOf('pre code, pre kbd, pre samp'));
        expect(layerOpen).toBeGreaterThan(-1);
        expect(idx).toBeGreaterThan(layerOpen);
        expect(idx).toBeLessThan(layerClose);
      });

      it('resets a <code>/<kbd>/<samp> nested in a <pre> so it does not draw a chip-on-a-chip', () => {
        expect(css).toContain('pre code, pre kbd, pre samp { background: none; padding: 0; border-radius: 0; color: inherit; }');
      });
    });

    describe('text input / textarea / select styling', () => {
      it('gives bare text inputs a theme-aware look (surface, content, soft border, radius)', () => {
        expect(css).toMatch(/input\[type="text"\][^{]*textarea,\s*select\s*\{/);
        const rule = css.slice(css.indexOf('input[type="text"]'));
        expect(rule).toMatch(/background:\s*var\(--sw-color-base-100/);
        expect(rule).toMatch(/color:\s*var\(--sw-color-base-content/);
        expect(rule).toMatch(/border:\s*1px solid color-mix\(in srgb,\s*var\(--sw-color-base-content/);
        expect(rule).toMatch(/border-radius:\s*\.5rem;/);
      });

      it('drops the focus outline for a primary border + soft primary ring (no ugly default ring)', () => {
        const focus = css.slice(css.indexOf('input[type="text"]:focus'));
        expect(css).toContain('input[type="text"]:focus');
        expect(focus).toMatch(/outline:\s*none;/);
        expect(focus).toMatch(/border-color:\s*var\(--sw-color-primary/);
        expect(focus).toMatch(/box-shadow:\s*0 0 0 3px color-mix\(in srgb,\s*var\(--sw-color-primary/);
      });

      it('only styles text-like controls — NOT checkboxes / radios / range / buttons', () => {
        // The selector enumerates text-like types explicitly, so native controls keep their appearance.
        expect(css).not.toMatch(/input\[type="checkbox"\][^{]*\{[^}]*border-radius/);
        expect(css).not.toContain('input[type="range"]');
      });

      it('keeps the input styling INSIDE the weak sw-normalize layer (daisyUI .input / utilities still win)', () => {
        const idx = css.indexOf('input[type="text"], input[type="email"]');
        const layerOpen = css.lastIndexOf('@layer sw-normalize {', idx);
        const layerClose = css.indexOf('}', css.indexOf('select:focus {'));
        expect(layerOpen).toBeGreaterThan(-1);
        expect(idx).toBeGreaterThan(layerOpen);
        expect(idx).toBeLessThan(layerClose);
      });
    });

    describe('form validation affordances (native :invalid → visible cues)', () => {
      it('shows a small red dot at the trailing edge of an invalid text field (layered longhands over the surface)', () => {
        // the dot targets the same text-like controls the base rule styles, plus textarea, via :invalid
        expect(css).toMatch(/input\[type="text"\]:invalid[^{]*textarea:invalid\s*\{/);
        const rule = css.slice(css.indexOf('input[type="text"]:invalid'));
        expect(rule).toMatch(/background-image:\s*radial-gradient\(#cc0000 15%, transparent 16%\);/);
        expect(rule).toMatch(/background-position:\s*right center;/);
        expect(rule).toMatch(/background-size:\s*3rem 3rem;/);
        // LONGHANDS only (no `background:` shorthand — it would clear the field surface set above)
        const dot = rule.slice(0, rule.indexOf('}'));
        expect(dot).not.toMatch(/background:\s/);
      });

      it('keeps the dot off <select> (its chevron), checkbox / radio / range / color / file (native look)', () => {
        const dot = css.slice(css.indexOf('input[type="text"]:invalid'), css.indexOf('}', css.indexOf('background-size: 3rem 3rem;')));
        expect(dot).not.toContain('select:invalid');
        expect(dot).not.toContain('checkbox');
        expect(dot).not.toContain('type="radio"');
      });

      it('keeps the invalid-dot UNLAYERED so it persists through ordinary field styling (a MORE specific author rule still wins)', () => {
        // Unlayered like .btn — a weak-layer version would lose to any unlayered author input{background}.
        const idx = css.indexOf('input[type="text"]:invalid');
        const priorLayer = css.lastIndexOf('@layer sw-normalize {', idx);
        expect(priorLayer).toBeGreaterThan(-1);
        expect(css.slice(priorLayer, idx)).toContain('}\n}'); // the preceding layer is closed before the rule
      });

      it('greys the submit while the form is incomplete — UNLAYERED so it beats the .btn rules', () => {
        expect(css).toContain('form:invalid [type="submit"] {');
        const rule = css.slice(css.indexOf('form:invalid [type="submit"] {'), css.indexOf('}', css.indexOf('form:invalid [type="submit"] {')));
        expect(rule).toMatch(/opacity:\s*\.4;/);
        expect(rule).toMatch(/filter:\s*grayscale\(100%\);/);
        expect(rule).toMatch(/cursor:\s*not-allowed;/);
        expect(rule).toMatch(/transform:\s*none;/); // no hover lift on the disabled-looking submit
        // stays CLICKABLE (native prompt fires) — must NOT kill pointer events
        expect(rule).not.toContain('pointer-events');
        // UNLAYERED: the nearest preceding @layer must already be CLOSED before this rule (a layer-closing
        // brace between them) — else an unlayered .btn{cursor:pointer} would beat a layered version.
        const submitIdx = css.indexOf('form:invalid [type="submit"]');
        const priorLayer = css.lastIndexOf('@layer sw-normalize {', submitIdx);
        expect(priorLayer).toBeGreaterThan(-1);
        expect(css.slice(priorLayer, submitIdx)).toContain('}\n}'); // dot rule + its layer both closed
      });
    });

    describe('hover dropdowns (nav submenu pattern)', () => {
      const guard = '.dropdown-hover:not(.dropdown-top):not(.dropdown-left):not(.dropdown-right)';

      it('resets the inline margin so the submenu aligns under its trigger (kills daisyUI .menu indent leak)', () => {
        // The dropdown-content is also a .menu, so daisyUI's nested-submenu indent
        // leaks a margin-inline onto it and pushes it ~16px off its parent item.
        expect(css).toContain(`${guard} > .dropdown-content {`);
        const rule = css.slice(css.indexOf(`${guard} > .dropdown-content {`));
        expect(rule).toMatch(/margin-inline:\s*0;/);
      });

      it('bridges the trigger→submenu gap with an always-present ::after on the li (hover never drops)', () => {
        // The bridge MUST be on the .dropdown li (always rendered), NOT on
        // .dropdown-content (daisyUI removes that element when not hovered → it is
        // gone in the exact instant the pointer crosses the gap).
        expect(css).toContain(`${guard}::after {`);
        const after = css.slice(css.indexOf(`${guard}::after {`));
        expect(after).toMatch(/content:\s*"";/);
        expect(after).toMatch(/top:\s*100%;/);
      });

      it('drives the submenu offset AND the bridge height from ONE var so they cannot desync', () => {
        // both the content margin-block-start and the ::after height read --sw-dropdown-gap
        const contentRule = css.slice(css.indexOf(`${guard} > .dropdown-content {`));
        const afterRule = css.slice(css.indexOf(`${guard}::after {`));
        expect(contentRule).toMatch(/margin-block-start:\s*var\(--sw-dropdown-gap/);
        expect(afterRule).toMatch(/height:\s*var\(--sw-dropdown-gap/);
      });

      it('keeps the bridge hit-testable (pointer-events:none would reopen the dead zone)', () => {
        // The ::after IS the hover surface — making it pass-through breaks the bridge.
        const afterRule = css.slice(css.indexOf(`${guard}::after {`), css.indexOf('}', css.indexOf(`${guard}::after {`)));
        expect(afterRule).not.toContain('pointer-events');
      });

      it('only bridges DOWNWARD placements (a bottom bridge is wrong for top/left/right)', () => {
        // the bridge selector must EXCLUDE the non-downward placement variants
        expect(guard).toContain(':not(.dropdown-top)');
        expect(guard).toContain(':not(.dropdown-left)');
        expect(guard).toContain(':not(.dropdown-right)');
        expect(css).toContain(`${guard}::after {`);
      });
    });
  });

  describe('button Material z-depth shadow (raised default, grows on hover)', () => {
    it('publishes the resting + hover shadow tokens', () => {
      expect(css).toContain('--sw-btn-shadow: 0 2px 5px 0 rgba(0, 0, 0, .16), 0 2px 10px 0 rgba(0, 0, 0, .12);');
      expect(css).toContain('--sw-btn-shadow-hover: 0 8px 17px 0 rgba(0, 0, 0, .2), 0 6px 20px 0 rgba(0, 0, 0, .19);');
    });

    it('applies the shadow at ZERO specificity (:where) so a Tailwind shadow-* utility always wins', () => {
      // resting + hover depth live on :where() rules (0,0,0 / 0,1,0), NOT on the .btn block itself —
      // so a per-button shadow-none / shadow-lg (0,1,0, emitted later) overrides in BOTH states.
      expect(css).toContain(':where(.btn) { box-shadow: var(--sw-btn-shadow); }');
      expect(css).toContain(':where(.btn:not(.btn-link):not(.btn-disabled):not(:disabled)):hover { box-shadow: var(--sw-btn-shadow-hover); }');
      // the main .btn declaration block must NOT hardcode a box-shadow declaration (that would beat utilities)
      const btnBlock = css.slice(css.indexOf('.btn {\n'), css.indexOf('\n}', css.indexOf('.btn {\n')));
      expect(btnBlock).not.toContain('box-shadow:');
    });

    it('hover scales 1.05 with a .4s ease transition that keeps the focus outline instant (no `all`)', () => {
      expect(css).toContain('.btn { transition: transform .4s ease, box-shadow .4s ease, background-color .4s ease, color .4s ease, filter .4s ease; }');
      expect(css).not.toContain('.btn { transition: all'); // `all` would fade the :focus-visible outline
      const anchor = '.btn:where(:not(.btn-link):not(.btn-disabled):not(:disabled)):hover {';
      const hover = css.slice(css.indexOf(anchor), css.indexOf('}', css.indexOf(anchor)));
      expect(hover).toContain('transform: scale(1.05);');
    });

    it('flat variants (ghost / link) reset the RESTING shadow to none; ghost still lifts on hover', () => {
      const ghost = css.slice(css.indexOf('.btn-ghost {'), css.indexOf('}', css.indexOf('.btn-ghost {')));
      expect(ghost).toContain('--sw-btn-shadow: none;');
      expect(ghost).not.toContain('--sw-btn-shadow-hover'); // ghost is NOT excluded from the hover shadow (it fills + lifts)
      const link = css.slice(css.indexOf('.btn-link {'), css.indexOf('}', css.indexOf('.btn-link {')));
      expect(link).toContain('--sw-btn-shadow: none;');
      // the hover shadow rule intentionally excludes only link/disabled — ghost keeps its hover lift
      expect(css).toContain(':where(.btn:not(.btn-link):not(.btn-disabled):not(:disabled)):hover { box-shadow: var(--sw-btn-shadow-hover); }');
    });

    it('outline keeps its inset border AND gains the raised hover shadow', () => {
      expect(css).toContain('.btn-outline:not(.btn-link):not(.btn-disabled):not(:disabled):hover { box-shadow: inset 0 0 0 1.5px var(--sw-btn-face), var(--sw-btn-shadow-hover); }');
    });
  });

  describe('custom scrollbars', () => {
    it('gates webkit pseudos vs the standard props by browser (they are mutually exclusive)', () => {
      // WebKit/Blink path uses the pseudos; Firefox path uses the standard props.
      expect(css).toContain('@supports selector(::-webkit-scrollbar) {');
      expect(css).toContain('@supports not selector(::-webkit-scrollbar) {');
      // the standard scrollbar-* props MUST be confined to the Firefox branch, else
      // they disable the ::-webkit pseudos in Chrome 121+ (the original bug)
      const webkitBranch = css.slice(
        css.indexOf('@supports selector(::-webkit-scrollbar)'),
        css.indexOf('@supports not selector(::-webkit-scrollbar)'),
      );
      const fxBranch = css.slice(css.indexOf('@supports not selector(::-webkit-scrollbar)'));
      expect(fxBranch).toContain('scrollbar-width: thin;');
      expect(fxBranch).toContain('scrollbar-color: var(--sw-color-primary, #4f46e5) var(--sw-color-base-100, #ffffff);');
      // regression guard: the STANDARD props must NOT be in the webkit branch (only
      // the `auto` reset is) — else they re-disable the pseudos in Chrome.
      expect(webkitBranch).not.toContain('scrollbar-width: thin');
      expect(webkitBranch).not.toMatch(/scrollbar-color: var\(--sw-color-primary/);
    });

    it('resets the root back to auto in WebKit so daisyUI’s :root{scrollbar-color} cannot keep the page bar grey', () => {
      expect(css).toContain('html:root { scrollbar-color: auto; scrollbar-width: auto; }');
    });

    it('uses a SOLID track (page background, no transparency) and no arrows', () => {
      expect(css).toContain('*::-webkit-scrollbar { width: 8px; height: 8px; background: var(--sw-color-base-100, #ffffff); }');
      expect(css).toContain('*::-webkit-scrollbar-track,\n  *::-webkit-scrollbar-track-piece,\n  *::-webkit-scrollbar-corner { background: var(--sw-color-base-100, #ffffff); }');
      expect(css).toContain('*::-webkit-scrollbar-button { width: 0; height: 0; display: none; }');
      // NO transparency anywhere in the scrollbar CSS
      const sb = css.slice(css.indexOf('@supports selector(::-webkit-scrollbar)'));
      expect(sb).not.toContain('transparent');
      expect(sb).not.toMatch(/color-mix\([^)]*transparent/);
    });

    it('thumb is a SOLID brand primary, darker while grabbed, full-width (no inset)', () => {
      expect(css).toContain('*::-webkit-scrollbar-thumb { background-color: var(--sw-color-primary, #4f46e5); border-radius: 9999px; }');
      // darker (solid, mixed with black — not an alpha) while grabbed, with a
      // plain-primary fallback first for browsers without color-mix
      expect(css).toContain('*::-webkit-scrollbar-thumb:active { background-color: var(--sw-color-primary, #4f46e5); background-color: color-mix(in srgb, var(--sw-color-primary, #4f46e5) 82%, #000); }');
      const webkitBranch = css.slice(
        css.indexOf('@supports selector(::-webkit-scrollbar)'),
        css.indexOf('@supports not selector(::-webkit-scrollbar)'),
      );
      expect(webkitBranch).not.toContain('background-clip: padding-box');
      expect(webkitBranch).not.toMatch(/:hover::-webkit-scrollbar-thumb/);
    });
  });
});
