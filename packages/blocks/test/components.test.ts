import { describe, it, expect } from 'vitest';
import { COMPONENT_TYPES, componentTypesInSource, componentAssets, addComponentBlockMarkers } from '../src/components.js';

describe('addComponentBlockMarkers (pair data-sw-block with data-sw-component)', () => {
  it('adds the block marker for a BLOCK-KEYED component missing it (Carousel / Lightbox / Form)', () => {
    expect(addComponentBlockMarkers('<div data-sw-component="carousel" data-effect="fade"></div>')).toBe(
      '<div data-sw-component="carousel" data-sw-block="Carousel" data-effect="fade"></div>',
    );
    expect(addComponentBlockMarkers('<div data-sw-component="lightbox"></div>')).toBe(
      '<div data-sw-component="lightbox" data-sw-block="Lightbox"></div>',
    );
    expect(addComponentBlockMarkers('<form data-sw-component="form"></form>')).toBe(
      '<form data-sw-component="form" data-sw-block="Form"></form>',
    );
  });

  it('leaves COMPONENT-keyed components (Modal / Tabs / Banner) untouched — their CSS needs no block attr', () => {
    for (const name of ['modal', 'tabs', 'banner', 'datetimepicker', 'shader-bg']) {
      const tag = `<div data-sw-component="${name}"></div>`;
      expect(addComponentBlockMarkers(tag)).toBe(tag);
    }
  });

  it('is idempotent — leaves a tag that already has data-sw-block untouched, never doubles it', () => {
    const already = '<div data-sw-component="carousel" data-sw-block="Carousel"></div>';
    expect(addComponentBlockMarkers(already)).toBe(already);
    expect(addComponentBlockMarkers(addComponentBlockMarkers('<div data-sw-component="carousel"></div>'))).toBe(
      '<div data-sw-component="carousel" data-sw-block="Carousel"></div>',
    );
  });

  it('ignores unknown component names and component-free markup', () => {
    expect(addComponentBlockMarkers('<div data-sw-component="bogus"></div>')).toBe('<div data-sw-component="bogus"></div>');
    expect(addComponentBlockMarkers('<section class="hero"></section>')).toBe('<section class="hero"></section>');
    expect(addComponentBlockMarkers('')).toBe('');
  });

  it('pairs every block-keyed component in a multi-root fragment', () => {
    const out = addComponentBlockMarkers(
      '<div data-sw-component="carousel"><div data-sw-part="track"></div></div><div data-sw-component="lightbox"></div>',
    );
    expect(out).toContain('data-sw-component="carousel" data-sw-block="Carousel"');
    expect(out).toContain('data-sw-component="lightbox" data-sw-block="Lightbox"');
  });

  it('injects a block marker for EXACTLY the components whose CSS keys on data-sw-block', () => {
    // Guards the derived BLOCK_KEYED_TYPES set: a component injected iff its stylesheet uses [data-sw-block].
    const nameToType: Record<string, string> = {
      carousel: 'Carousel', lightbox: 'Lightbox', modal: 'Modal', banner: 'Banner',
      tabs: 'Tabs', form: 'Form', datetimepicker: 'DateTimePicker', 'shader-bg': 'ShaderBg',
    };
    for (const [name, type] of Object.entries(nameToType)) {
      const injected = addComponentBlockMarkers(`<div data-sw-component="${name}"></div>`).includes('data-sw-block');
      const keyed = componentAssets([type]).css.includes(`[data-sw-block="${type}"]`);
      expect(injected).toBe(keyed);
    }
  });
});

describe('componentTypesInSource (code-first detection)', () => {
  it('detects interactive components by their data-sw-component marker in rendered source', () => {
    const html =
      '<div data-sw-component="modal"><button data-sw-part="open">Open</button></div>' +
      '<div data-sw-component="tabs"></div>' +
      '<form data-sw-component="form"></form>';
    expect(componentTypesInSource(html).sort()).toEqual(['Form', 'Modal', 'Tabs']);
  });

  it('maps every emitted component name to a registered type (so its JS/CSS actually bundles)', () => {
    for (const name of ['carousel', 'lightbox', 'modal', 'banner', 'tabs', 'form', 'datetimepicker']) {
      const [type] = componentTypesInSource(`<div data-sw-component="${name}"></div>`);
      expect(type, name).toBeDefined();
      expect(COMPONENT_TYPES.has(type!), name).toBe(true);
      expect(componentAssets([type!]).js.length + componentAssets([type!]).css.length).toBeGreaterThan(0);
    }
  });

  it('dedupes repeats and ignores unknown / empty markers', () => {
    expect(componentTypesInSource('<a data-sw-component="modal"></a><b data-sw-component="modal"></b>')).toEqual(['Modal']);
    expect(componentTypesInSource('<div data-sw-component="bogus"></div>')).toEqual([]);
    expect(componentTypesInSource('')).toEqual([]);
    expect(componentTypesInSource(undefined)).toEqual([]);
    expect(componentTypesInSource(null)).toEqual([]);
  });

  it('ships nothing for a native-details accordion (DaisyUI collapse pattern, not a component)', () => {
    expect(componentTypesInSource('<details class="collapse collapse-plus"><summary class="collapse-title">Q</summary></details>')).toEqual([]);
    // legacy Accordion styling hooks no longer trigger a (removed) registry entry
    expect(componentTypesInSource('<div data-sw-block="Accordion"></div>')).toEqual([]);
  });

  it('detects a form embedded by REFERENCE — {{sw-form}} or data-sw-form (marker only exists post-render)', () => {
    expect(componentTypesInSource('<section>{{sw-form "contact"}}</section>')).toEqual(['Form']);
    expect(componentTypesInSource('<section>{{ sw-form "contact" }}</section>')).toEqual(['Form']);
    expect(componentTypesInSource('<form data-sw-form="contact"><input name="n" /></form>')).toEqual(['Form']);
    // anchored scan: prose mentions and would-be `sw-format` helpers do NOT over-ship Form assets
    expect(componentTypesInSource('<p>about sw-form</p>')).toEqual([]);
    expect(componentTypesInSource('{{sw-formation "x"}}')).toEqual([]);
  });
});

describe('component registry', () => {
  it('registers interactive components (container types; child blocks are plain)', () => {
    expect(COMPONENT_TYPES.has('Carousel')).toBe(true);
    expect(COMPONENT_TYPES.has('Lightbox')).toBe(true);
    expect(COMPONENT_TYPES.has('Modal')).toBe(true);
    expect(COMPONENT_TYPES.has('Banner')).toBe(true);
    expect(COMPONENT_TYPES.has('Notice')).toBe(false); // renamed to Banner
    expect(COMPONENT_TYPES.has('CookieConsent')).toBe(false); // retired → Consent Manager auto-injects
    expect(COMPONENT_TYPES.has('Tabs')).toBe(true);
    expect(COMPONENT_TYPES.has('DateTimePicker')).toBe(true);
    expect(COMPONENT_TYPES.has('Tab')).toBe(false); // a Tab is a plain child panel
    // child / plain blocks have no registry entry of their own
    expect(COMPONENT_TYPES.has('Slide')).toBe(false);
    expect(COMPONENT_TYPES.has('Accordion')).toBe(false); // removed — DaisyUI collapse covers it
    expect(COMPONENT_TYPES.has('LightboxItem')).toBe(false);
    expect(COMPONENT_TYPES.has('Section')).toBe(false);
  });

  it('Lightbox ships the vendored runtime + grid CSS under vendor-neutral class names', () => {
    const used = componentAssets(['Lightbox']);
    expect(used.css).toContain('[data-sw-part="grid"]'); // authored thumbnail grid
    expect(used.css).toContain('.sw-lightbox-nav'); // vendored viewer stylesheet, renamed to sw-lightbox-*
    expect(used.css).toContain('.sw-lightbox{z-index:999999'); // fullscreen viewer sits above site chrome (cookie banner z 9998)
    expect(used.css).not.toContain('.smartphoto'); // no third-party class name leaks into shipped CSS
    // CSP default-src 'self': the only url() refs are inline data: URIs (icons) — never an external
    // http(s):// or protocol-relative asset.
    expect(used.css).not.toMatch(/url\(\s*['"]?(?!data:)/i);
    expect(used.js).toContain('smartphoto@'); // license banner MUST keep attributing the bundled MIT package
    expect(used.js).toContain('data-sw-component="lightbox"');
    expect(used.js).toContain('data-thumbnails'); // the thumbnail-strip switch is read from data-*
    expect(used.js).toContain('data-full'); // minimal form: bare <img> wrapped with href = data-full || src
    expect(used.js).toContain('data-gallery'); // shared data-gallery merges roots into one combined gallery
    expect(used.js).toContain('sw-lightbox'); // runtime builds the viewer with the neutral class names
    expect(used.js).toContain('focus'); // a11y shim: focus restored to the trigger on close
    // The IE-only polyfills SmartPhoto ships are aliased away at bundle time (modern target).
    expect(used.js).not.toContain('es6-promise-polyfill');
    expect(used.js).not.toContain('custom-event-polyfill');
    expect(used.js).not.toMatch(/\beval\(/); // CSP: no eval in shipped runtime
  });

  it('ignores unknown/removed types when bundling', () => {
    expect(componentAssets(['Accordion']).css).toBe('');
    expect(componentAssets(['Accordion']).js).toBe('');
    expect(componentAssets(['Accordion', 'Lightbox']).js).toContain('lightbox');
  });

  it('bundles CSS + JS for used components, empty when none', () => {
    const used = componentAssets(['Carousel']);
    expect(used.css).toContain('[data-sw-block="Carousel"]');
    expect(used.css).toContain('scroll-snap-type'); // no-JS fallback stays a swipeable row
    expect(used.css).toContain('--sw-items'); // multi-item / peek layout knob
    expect(used.js).toContain('embla-carousel@'); // license banner names the bundled MIT packages
    expect(used.js).toContain('data-sw-component="carousel"');
    expect(used.js).toContain('data-sw-enhanced'); // progressive enhancement marker
    expect(used.js).toContain('removeAttribute'); // un-hides the dots for screen readers
    expect(used.js).not.toMatch(/\beval\(/); // CSP: no eval in shipped runtime

    const none = componentAssets([]);
    expect(none.css).toBe('');
    expect(none.js).toBe('');
  });

  it('Modal uses the native <dialog> API', () => {
    const modal = componentAssets(['Modal']);
    expect(modal.css).toContain('::backdrop');
    expect(modal.js).toContain('showModal');
    // Default panel width cap (author max-w-* overrides it — the :where default is zero-specificity).
    expect(modal.css).toContain('max-width:32rem');
    // The all-around safety gutter is the container's own padding (every screen size), so the panel
    // never touches the top/sides — replacing the old ≤36rem max-width:calc(100vw - 4rem) hack.
    expect(modal.css).toContain(';margin:0;padding:2rem;box-sizing:border-box');
  });

  it('Banner guards localStorage + keys on data-sw-component (no redundant data-sw-block)', () => {
    const bn = componentAssets(['Banner']);
    expect(bn.js).toContain('localStorage');
    expect(bn.js).toContain('try{'); // storage access is guarded (sandbox/disabled)
    expect(bn.js).toContain("'sw-banner:'"); // per-id dismissal key prefix
    expect(bn.css).toContain('[data-sw-component="banner"]');
    expect(bn.css).not.toContain('data-sw-block');
  });

  it('Modal fades in from the top / out to the top across the <dialog> display toggle', () => {
    const css = componentAssets(['Modal']).css;
    // The enter/exit transition needs a real duration on opacity+transform (not the default
    // 0s = instant), a translateY(-24px) offset (from the top), and the native-<dialog>
    // machinery that lets it animate across the display toggle (@starting-style +
    // allow-discrete). Dropping any of these collapses the animation to an instant show/hide.
    expect(css).toContain('transition:opacity .22s ease,transform .22s ease');
    expect(css).toContain('translateY(-24px)');
    expect(css).toContain('allow-discrete');
    expect(css).toContain('@starting-style');
    // Reduced-motion drops straight to a plain show/hide — INCLUDING the ::backdrop fade/blur.
    expect(css).toContain('prefers-reduced-motion:reduce');
    const rm = css.slice(css.indexOf('@media (prefers-reduced-motion:reduce)'));
    expect(rm).toContain('dialog[data-sw-component="modal"]::backdrop');
  });

  it('Modal <dialog> is a transparent full-viewport scroller; the panel is the centered box', () => {
    const css = componentAssets(['Modal']).css;
    // The <dialog> is ONLY a transparent, full-viewport scroll CONTAINER: position:fixed + inset:0 +
    // 100vw/100dvh + overflow-y:auto puts the scrollbar at the SCREEN edge (no inner-body scrollbar).
    // The visible box is a [data-sw-part="panel"] child (position:relative + the appearance live there).
    // The selector covers BOTH forms (dialog as a descendant of the marker, or the dialog IS it).
    expect(css).toContain(
      '[data-sw-component="modal"] dialog,dialog[data-sw-component="modal"]{position:fixed;inset:0;width:100vw;max-width:100vw;height:100vh;height:100dvh;max-height:100vh;max-height:100dvh;',
    );
    expect(css).toContain('background:transparent');
    expect(css).toContain('overflow-y:auto');
    // Reserve the scrollbar gutter on both edges so a tall modal's native scrollbar never overlaps the
    // overhanging close button and the centered panel stays symmetric.
    expect(css).toContain('scrollbar-gutter:stable both-edges');
    expect(css).toContain('[data-sw-part="panel"]{overflow:visible');
  });

  it('Modal styling keys on data-sw-component (works on a bare <dialog>, no data-sw-block)', () => {
    const css = componentAssets(['Modal']).css;
    // The lighter form puts the marker on the <dialog> itself; the legacy wrapper form has it on an
    // ancestor. Both are covered by data-sw-component selectors, so no parallel data-sw-block needed.
    expect(css).toContain('dialog[data-sw-component="modal"]');
    expect(css).not.toContain('data-sw-block');
  });

  it('Modal lighter form: a <dialog data-sw-component="modal" id> opened by href="#id" / data-sw-modal', () => {
    const js = componentAssets(['Modal']).js;
    // The runtime treats a marked <dialog> as the root and wires external triggers by id.
    expect(js).toContain("tagName==='DIALOG'");
    expect(js).toContain('a[href="#');
    expect(js).toContain('data-sw-modal');
    // Anchor triggers get preventDefault so the fragment nav doesn't fire; the legacy
    // data-sw-part="open" trigger still works.
    expect(js).toContain("t.tagName==='A'");
    expect(js).toContain('[data-sw-part="open"]');
    // The marked dialog is still detected by the source scanner (asset shipping).
    expect(componentTypesInSource('<dialog id="m" data-sw-component="modal"></dialog>')).toContain('Modal');
  });

  it('Modal locks page scroll while open and restores it on close', () => {
    const js = componentAssets(['Modal']).js;
    // Lock on open, release on the dialog 'close' event (covers Escape / button / backdrop).
    expect(js).toContain("docEl.style.overflow='hidden'");
    expect(js).toContain("addEventListener('close',unlock)");
    // Scrollbar-width compensation so removing the bar doesn't shift the layout.
    expect(js).toContain('window.innerWidth-docEl.clientWidth');
    expect(js).toContain('paddingRight');
    // Ref-counted so nested/sequential modals don't unlock early.
    expect(js).toContain('locks');
    // Guard against double-lock if the open button is clicked while already open.
    expect(js).toContain('if(dialog.open)return');
  });

  it('Modal auto-injects a styled close button and honours data-closebutton / data-backdrop-close', () => {
    const { css, js } = componentAssets(['Modal']);
    // The runtime builds a top-right close button (brand-primary square, white icon) and reads the
    // two opt-out switches off the root.
    expect(js).toContain("setAttribute('data-sw-part','autoclose')");
    expect(js).toContain("getAttribute('data-closebutton')!=='false'");
    expect(js).toContain("getAttribute('data-backdrop-close')!=='false'");
    // Authored close buttons (any number) are wired too.
    expect(js).toContain("querySelectorAll('[data-sw-part=\"close\"]')");
    // The auto close button's aria-label localizes from the CSP-safe <html data-sw-i18n> attribute
    // (data-close-label override wins), flooring to 'Close'.
    expect(js).toContain('data-sw-i18n');
    expect(js).toContain("swt('close','Close')");
    // The close button's appearance: primary background, white icon, hover zoom + 180° spin.
    expect(css).toContain('[data-sw-part="autoclose"]');
    expect(css).toContain('var(--sw-color-primary');
    expect(css).toContain('rotate(180deg)');
    expect(css).toContain('scale(1.1)');
    // Overhangs the corner (needs the dialog's overflow:visible) at the agreed geometry.
    expect(css).toContain('top:-1rem;right:-1.5rem');
    expect(css).toContain('width:3.25rem;height:2.25rem');
  });

  it('Modal PAINT lives on the BODY (zero-specificity), the PANEL is neutral, and the backdrop blurs', () => {
    const css = componentAssets(['Modal']).css;
    // The PANEL is neutral LAYOUT only (no paint): position/margin:auto/width/max-width, at :where() so
    // the author's moved WIDTH utilities win. It must NOT carry background/padding/box-shadow anymore.
    expect(css).toContain(
      ':where([data-sw-component="modal"] dialog>[data-sw-part="panel"],dialog[data-sw-component="modal"]>[data-sw-part="panel"]){position:relative;margin:auto;width:100%;max-width:32rem}',
    );
    // All PAINT moved to the BODY, wrapped in :where() (specificity 0) → the author's non-width utilities
    // (bg-*/text-*/p-*/rounded-*/shadow-*/overflow-*) override without !important; bg/text from the global
    // theme vars; 1.5rem default padding (author p-0 / p-8 wins); overflow:visible default so `overflow-
    // hidden` can clip the card. Scoped as panel>body so it can't leak onto a nested component's body.
    expect(css).toContain(
      ':where([data-sw-component="modal"] dialog>[data-sw-part="panel"]>[data-sw-part="body"],dialog[data-sw-component="modal"]>[data-sw-part="panel"]>[data-sw-part="body"]){width:100%;background:var(--sw-color-base-100,#fff);color:var(--sw-color-base-content,#0f172a);border-radius:.75rem;padding:1.5rem;box-shadow:0 10px 40px rgba(0,0,0,.2);overflow:visible}',
    );
    // Backdrop dims AND blurs.
    expect(css).toContain('backdrop-filter:blur(5px)');
    // The scrim derives from --sw-color-base-content (with the slate rgba fallback) so it INVERTS
    // with the palette: a dark dim on a light site, a lighter scrim on a dark site.
    expect(css).toContain('background:rgba(15,23,42,.45)');
    expect(css).toContain('background:color-mix(in srgb,var(--sw-color-base-content,#0f172a) 45%,transparent)');
  });

  it('an INACTIVE (closed) modal is display:none so it never intercepts clicks/scroll', () => {
    // Regression: a closed <dialog> is display:none via the UA stylesheet, but an AUTHOR rule beats the
    // UA at equal specificity — so the base modal rule MUST set display:none. If it sets display:flex
    // (the bug), the closed, fixed, centered box stays laid out (just opacity:0) and swallows clicks +
    // scroll over the middle of the page. display lives on [open]; the allow-discrete transition still
    // animates the none↔flex toggle for the exit.
    const { css } = componentAssets(['Modal']);
    // The base (closed) CONTAINER rule is display:none (asserted with unique surrounding context so it
    // can't match the [open] rule) — a closed <dialog> that stayed laid out would swallow clicks/scroll.
    expect(css).toContain('background:transparent;box-shadow:none;display:none;overflow-x:hidden');
    // The OPEN state lays it out as a flex container (the panel's margin:auto centers it, top-aligning a
    // too-tall panel without clipping).
    expect(css).toContain('[data-sw-component="modal"][open]{display:flex}');
    // …and the display toggle is animated discretely so the exit animation plays.
    expect(css).toContain('display .22s allow-discrete');
  });

  it('Modal grows past the viewport and scrolls at the SCREEN edge (no inner-body scroll); close never clipped', () => {
    const { css, js } = componentAssets(['Modal']);
    // Scrolling happens on the CONTAINER (the transparent full-viewport <dialog>) so the scrollbar is at
    // the SCREEN edge — NOT an inner body scrollbar. No max-height cap, no flex-column body scroll region.
    expect(css).toContain('overflow-y:auto');
    expect(css).not.toContain('max-height:calc(100dvh - 4rem)');
    expect(css).not.toContain('[data-sw-part="body"]{flex:1 1 auto');
    // The all-around SAFETY GUTTER is the container's padding, so the panel never touches the top/sides
    // on any screen (only the bottom can meet the edge when a tall panel scrolls).
    expect(css).toContain(';margin:0;padding:2rem;box-sizing:border-box');
    // The panel GROWS with content (max-height:none) and is never its own scroll box (overflow:visible)
    // — normal specificity so a moved author `overflow-*`/`max-h-*` can't re-break it. This is the
    // guarantee that the overhanging close is never clipped.
    expect(css).toContain('[data-sw-part="panel"]{overflow:visible;max-height:none;outline:none}');
    // A too-tall panel top-aligns instead of clipping its top: the panel's margin:auto in the flex
    // container centers it when it fits and degrades to top-aligned (no clip) when it overflows.
    expect(css).toContain(
      ':where([data-sw-component="modal"] dialog>[data-sw-part="panel"],dialog[data-sw-component="modal"]>[data-sw-part="panel"]){position:relative;margin:auto;',
    );
    // The runtime builds the panel + body and MOVES the authored content in (appendChild, not innerHTML,
    // so listeners / form state survive). The author's class is SPLIT: WIDTH utilities size the panel,
    // everything else paints the body; the bare-<dialog> authoring is unchanged.
    expect(js).toContain("setAttribute('data-sw-part','panel')");
    expect(js).not.toContain('panel.className=dialog.className'); // no longer moves the WHOLE class to panel
    expect(js).toContain('(?:w|max-w|min-w)-'); // width-utility test → panel
    expect(js).toContain('panel.className=wtoks.join');
    expect(js).toContain("body.className=body.className?body.className+' '+otoks.join(' '):otoks.join(' ')");
    expect(js).toContain("dialog.removeAttribute('class')");
    // With an author-supplied body part, ALL dialog children move into the panel (no orphaned siblings);
    // without one, the children are wrapped in a generated body — both preserving order via appendChild.
    expect(js).toContain('while(dialog.firstChild){panel.appendChild(dialog.firstChild);}');
    expect(js).toContain('while(dialog.firstChild){body.appendChild(dialog.firstChild);}');
    expect(js).not.toContain('body.innerHTML');
    // The close is APPENDED LAST (position:absolute → visually unchanged) so it is not the first focusable.
    expect(js).toContain('panel.appendChild(x)');
    expect(js).not.toContain('panel.insertBefore(x,panel.firstChild)');
    // The dialog's open-focus is anchored to the TOP (the panel, tabindex=-1 + autofocus) unless the author
    // set their own autofocus — so a tall modal opens at its top, not scrolled to a deep focusable.
    expect(js).toContain("dialog.querySelector('[autofocus]')");
    expect(js).toContain("panel.setAttribute('tabindex','-1');panel.setAttribute('autofocus','')");
    // The panel is built before the close button is injected.
    expect(js.indexOf("setAttribute('data-sw-part','panel')")).toBeLessThan(
      js.indexOf("setAttribute('data-sw-part','autoclose')"),
    );
  });

  it('Tabs builds an ARIA tablist with keyboard nav', () => {
    const tabs = componentAssets(['Tabs']);
    expect(tabs.css).toContain('[data-sw-part="tab"]');
    expect(tabs.js).toContain("role','tab'");
    expect(tabs.js).toContain('ArrowRight'); // keyboard navigation
    expect(tabs.js).toContain('Home'); // + Home/End (APG)
    expect(tabs.js).toContain('aria-controls');
    expect(tabs.js).not.toContain('innerHTML'); // tab labels via textContent, not innerHTML
  });

  it('Tabs styling keys on the component marker (data-sw-block not required) + bold labels', () => {
    const tabs = componentAssets(['Tabs']);
    // Every CSS rule targets the component marker, not data-sw-block — so authored markup
    // needs only data-sw-component="tabs".
    expect(tabs.css).toContain('[data-sw-component="tabs"]');
    expect(tabs.css).not.toContain('[data-sw-block="Tabs"]');
    // Bold tab labels.
    expect(tabs.css).toContain('font-weight:700');
    // Active tab text uses the on-primary content token over the pill; inactive inherits the default.
    expect(tabs.css).toContain('[aria-selected="true"]');
    expect(tabs.css).toMatch(/\[aria-selected="true"\][^{]*\{color:var\(--sw-color-primary-content,#fff\)\}/);
  });

  it('Tabs has a floating "magic" selector pill that transitions to the active tab', () => {
    const tabs = componentAssets(['Tabs']);
    // The indicator part exists, uses the primary colour, and is animated (non-zero duration).
    expect(tabs.css).toContain('[data-sw-part="tabindicator"]');
    expect(tabs.css).toContain('var(--sw-color-primary');
    expect(tabs.css).toMatch(/\[data-sw-part="tabindicator"\][^}]*transition:transform \.3s/);
    expect(tabs.css).not.toContain('transition:transform 0s');
    // The runtime positions it from the active tab's box (inline transform/width/height).
    expect(tabs.js).toContain('tabindicator');
    expect(tabs.js).toContain('offsetLeft');
    expect(tabs.js).toContain('offsetWidth');
  });

  it('Tabs panels get an automatic + repeatable fade-in (non-zero, restarts on data-active)', () => {
    const tabs = componentAssets(['Tabs']);
    // Keyframe-on-[data-active]: the attribute flip restarts it on every selection.
    expect(tabs.css).toContain('@keyframes sw-tab-in');
    expect(tabs.css).toMatch(/\[data-active\]\{animation:sw-tab-in \.3s/);
    expect(tabs.css).not.toContain('animation:sw-tab-in 0s');
    // Reduced-motion users opt out of the fade.
    expect(tabs.css).toContain('prefers-reduced-motion:reduce');
  });

  it('Tabs buttons get a press ripple (self-contained, reduced-motion safe, no markup injection)', () => {
    const tabs = componentAssets(['Tabs']);
    expect(tabs.css).toContain('.sw-ripple');
    // Uniquely-named keyframe so it never collides with the Carousel's sw-ripple keyframe.
    expect(tabs.css).toContain('@keyframes sw-tab-ripple');
    expect(tabs.css).not.toContain('@keyframes sw-ripple{');
    // Ripple is spawned on pointerdown and gated behind reduced motion.
    expect(tabs.js).toContain('pointerdown');
    expect(tabs.js).toContain('prefers-reduced-motion');
    expect(tabs.js).toContain("createElement('span')");
  });

  it('Tabs supports a rich tabtitle by MOVING nodes into the button (never innerHTML a string)', () => {
    const tabs = componentAssets(['Tabs']);
    // The runtime reads a data-sw-part="tabtitle" child and moves its nodes into the button.
    expect(tabs.js).toContain('tabtitle');
    expect(tabs.js).toContain('appendChild(title.firstChild)'); // node MOVE, not innerHTML
    expect(tabs.js).toContain("setAttribute('aria-label'"); // data-sw-title becomes the a11y name
    expect(tabs.js).not.toContain('innerHTML'); // still no string→HTML sink (XSS-safe)
    // The tabtitle part is styled to lay out icon + text inline.
    expect(tabs.css).toContain('[data-sw-part="tabtitle"]');
  });

  it('Tabs places the selector pill instantly on load (no slide-in) and uses a scoped resize observer', () => {
    const tabs = componentAssets(['Tabs']);
    // Initial placement disables the transition, then a double-rAF restores the CSS glide.
    expect(tabs.js).toContain("pill.style.transition='none'");
    expect(tabs.js).toContain('requestAnimationFrame');
    // No leaked global per-instance resize listener — ResizeObserver scoped to the tablist.
    expect(tabs.js).toContain('ResizeObserver');
  });

  it('Tabs runtime creates the tablist mount + ARIA roles when the author omits them', () => {
    const tabs = componentAssets(['Tabs']);
    // The tablist is created if absent and roles are added by the runtime, so authored
    // markup needs neither an empty tablist nor role="…" attributes.
    expect(tabs.js).toContain("createElement('div')");
    expect(tabs.js).toContain("setAttribute('data-sw-part','tablist')");
    expect(tabs.js).toContain("setAttribute('role','tablist')");
    expect(tabs.js).toContain("setAttribute('role','tabpanel')");
  });

  it('DateTimePicker ships the vendored Vanilla Calendar Pro runtime (dual-panel range)', () => {
    const used = componentAssets(['DateTimePicker']);
    // The runtime is bundled with its first-party wiring; the marker query + mode switch are present.
    expect(used.js).toContain('vanilla-calendar-pro@'); // license banner MUST keep attributing the MIT package
    expect(used.js).toContain('data-sw-component="datetimepicker"');
    expect(used.js).toContain('data-sw-enhanced'); // progressive-enhancement idempotency guard
    expect(used.js).toContain('data-mode'); // the variant switch is read from data-*
    expect(used.js).toContain('displayMonthsCount'); // range mode shows two months side by side
    expect(used.js).toContain('multiple-ranged'); // the range selection mode
    expect(used.js).toContain('selectedTheme'); // light/dark theme chosen at runtime (see below)
    // Light or DARK theme is picked from the site's background luminance (no pinned theme).
    expect(used.js).toContain('--sw-color-base-100'); // the probed surface colour
    expect(used.js).toMatch(/\.2126/); // relative-luminance coefficient (esbuild may drop the leading 0)
    // CSP default-src 'self' (no 'unsafe-eval'): none of the eval-equivalents in the shipped runtime.
    expect(used.js).not.toMatch(/\beval\(/);
    expect(used.js).not.toMatch(/\bnew\s+Function\s*\(/);
    expect(used.js).not.toMatch(/setTimeout\s*\(\s*['"]/);
    expect(used.js).not.toMatch(/setInterval\s*\(\s*['"]/);
    // We ship the vendor's POLISHED index.css with BOTH the light and dark themes (both are used).
    expect(used.css).toContain('[data-vc-date-btn]'); // structure
    expect(used.css).toContain('[data-vc-theme=light]');
    expect(used.css).toContain('[data-vc-theme=dark]');
    // CSP: any url() in the bundled CSS must be an inline data: URI, never external.
    expect(used.css).not.toMatch(/url\(\s*(?!['"]?data:)/i);
  });

  it('DateTimePicker recolours the vendor theme onto the CI primary + animates the popup', () => {
    const css = componentAssets(['DateTimePicker']).css;
    // The cyan accent is recoloured to the site primary with broad !important rules (they beat the
    // vendor's non-important theme rules regardless of its deep compound selector specificity).
    expect(css).toMatch(/\[data-vc-date-selected\][^{]*\.vc-date__btn\{[^}]*var\(--sw-color-primary[^}]*!important/);
    expect(css).toContain('[data-vc-date-today]'); // today recoloured to primary
    expect(css).toContain('[data-vc-date-selected="middle"]'); // range middle band
    expect(css).toContain('color-mix(in srgb,var(--sw-color-primary'); // brand range tint
    // The vendor's red weekends are neutralised in BOTH themes: headers per theme (light #64748b /
    // dark #fff), weekend day numbers via `inherit` so they take the calendar's theme text colour.
    expect(css).toContain('[data-vc-theme=light] .vc-week__day[data-vc-week-day-off]{color:#64748b');
    expect(css).toContain('[data-vc-theme=dark] .vc-week__day[data-vc-week-day-off]{color:#fff');
    expect(css).toMatch(/data-vc-date-weekend\][^{]*\.vc-date__btn\{color:inherit!important/);
    // TIME-ONLY mode: the time block (popup's first child) drops the calendar-separator border + spacing.
    expect(css).toContain('[data-vc=time]:first-child{margin-top:0;padding-top:0;border-width:0}');
    // Body font adopted; popup lifted above sticky chrome.
    expect(css).toContain('.vc{font-family:var(--sw-font-body');
    expect(css).toContain('.vc[data-vc-input]{z-index:1000');
    // OPEN ANIMATION: the vendor hides via opacity, so a transition on the shown/hidden state animates
    // it (fade + rise + scale); dropped under reduced motion.
    expect(css).toContain('.vc[data-vc-input]{transition:opacity');
    expect(css).toMatch(/data-vc-calendar-hidden\]\{transform:translateY/);
    expect(css).toContain('prefers-reduced-motion:reduce');
  });

  it('ignores unknown component types', () => {
    expect(componentAssets(['Nope', 'AlsoNope'])).toEqual({ css: '', js: '' });
  });
});
