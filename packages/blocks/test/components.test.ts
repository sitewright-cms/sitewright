import { describe, it, expect } from 'vitest';
import { COMPONENT_TYPES, componentTypesInSource, componentAssets } from '../src/components.js';

describe('componentTypesInSource (code-first detection)', () => {
  it('detects interactive components by their data-sw-component marker in rendered source', () => {
    const html =
      '<div data-sw-component="modal"><button data-sw-part="open">Open</button></div>' +
      '<div data-sw-component="tabs"></div>' +
      '<form data-sw-component="form"></form>';
    expect(componentTypesInSource(html).sort()).toEqual(['Form', 'Modal', 'Tabs']);
  });

  it('maps every emitted component name to a registered type (so its JS/CSS actually bundles)', () => {
    for (const name of ['carousel', 'lightbox', 'modal', 'cookie-consent', 'tabs', 'form', 'datetimepicker']) {
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
    expect(COMPONENT_TYPES.has('CookieConsent')).toBe(true);
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

  it('Modal uses the native <dialog> API; CookieConsent guards localStorage', () => {
    const modal = componentAssets(['Modal']);
    expect(modal.css).toContain('::backdrop');
    expect(modal.js).toContain('showModal');
    const cc = componentAssets(['CookieConsent']);
    expect(cc.js).toContain('localStorage');
    expect(cc.js).toContain('try{'); // storage access is guarded (sandbox/disabled)
    // The storage key is overridable per-root via data-cookiename (default sw-cookie-consent),
    // so independent banners track consent separately.
    expect(cc.js).toContain("getAttribute('data-cookiename')");
    expect(cc.js).toContain("'sw-cookie-consent'"); // the default when the attribute is absent
  });

  it('CookieConsent styling keys on data-sw-component (no redundant data-sw-block)', () => {
    // The banner already carries data-sw-component="cookie-consent" for the JS + asset scan;
    // its CSS keys on the same marker so authors need not also write a parallel data-sw-block.
    const cc = componentAssets(['CookieConsent']);
    expect(cc.css).toContain('[data-sw-component="cookie-consent"]');
    expect(cc.css).not.toContain('data-sw-block');
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

  it('Modal is viewport-centered (position:fixed) so opening never scrolls the page', () => {
    const css = componentAssets(['Modal']).css;
    // position:fixed + inset:0 + margin:auto centers in the viewport; position:relative would put
    // the dialog in document flow and let showModal() scroll-into-view jump the page to it. The
    // selector covers BOTH forms (the dialog as a descendant of the marker, or the dialog IS it).
    // The rule fires for both forms via a combined selector (descendant dialog OR the dialog itself).
    expect(css).toContain('[data-sw-component="modal"] dialog,dialog[data-sw-component="modal"]{position:fixed;margin:auto;inset:0;');
    expect(css).not.toContain('position:relative');
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

  it('Modal dialog defaults are zero-specificity so dialog classes win, and the backdrop blurs', () => {
    const css = componentAssets(['Modal']).css;
    // Appearance defaults wrapped in :where() (specificity 0) → utility classes on the dialog
    // override them without !important; bg/text come from the global theme vars; 1.5rem padding.
    expect(css).toContain(':where([data-sw-component="modal"] dialog,dialog[data-sw-component="modal"])');
    expect(css).toContain('var(--sw-color-base-100');
    expect(css).toContain('var(--sw-color-base-content');
    expect(css).toContain('padding:1.5rem');
    expect(css).toContain('overflow:visible'); // lets the close button overhang the corner
    // Backdrop dims AND blurs.
    expect(css).toContain('backdrop-filter:blur(5px)');
    // The scrim derives from --sw-color-base-content (with the slate rgba fallback) so it INVERTS
    // with the palette: a dark dim on a light site, a lighter scrim on a dark site.
    expect(css).toContain('background:rgba(15,23,42,.45)');
    expect(css).toContain('background:color-mix(in srgb,var(--sw-color-base-content,#0f172a) 45%,transparent)');
  });

  it('Modal taller than the viewport scrolls its body (overhanging close button kept)', () => {
    const { css, js } = componentAssets(['Modal']);
    // The dialog is height-capped to the viewport less 4rem (normal specificity so it beats the UA's
    // own dialog{max-height}; the 4rem keeps the overhanging close button on-screen) and laid out as a
    // flex column so the body scroll region fills the remaining height.
    expect(css).toContain('max-height:calc(100dvh - 4rem)');
    expect(css).toContain('display:flex;flex-direction:column');
    // box-sizing:border-box keeps the padding inside that cap so the overhang math holds regardless
    // of the ambient reset.
    expect(css).toContain('box-sizing:border-box');
    // The injected body wrapper scrolls; flex:1 + min-height:0 is what lets it shrink and scroll.
    expect(css).toContain('[data-sw-part="body"]{flex:1 1 auto;min-height:0;overflow:auto');
    // The dialog itself stays overflow:visible so the close button still overhangs (not clipped).
    expect(css).toContain('overflow:visible');
    // The runtime MOVES the authored content into the body wrapper (appendChild, not innerHTML, so
    // listeners / form state survive), and only when the author hasn't already supplied one.
    expect(js).toContain("setAttribute('data-sw-part','body')");
    expect(js).toContain('while(dialog.firstChild){body.appendChild(dialog.firstChild);}');
    expect(js).not.toContain('body.innerHTML');
    // The content MUST be wrapped before the close button is injected, so the close button stays a
    // direct child of the dialog (overhanging) rather than getting swept into the scroll region.
    expect(js.indexOf("setAttribute('data-sw-part','body')")).toBeLessThan(
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
    // Active tab text is white over the pill; inactive inherits the default colour.
    expect(tabs.css).toContain('[aria-selected="true"]');
    expect(tabs.css).toMatch(/\[aria-selected="true"\][^{]*\{color:#fff\}/);
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
