import { describe, it, expect } from 'vitest';
import { CART_CSS, CART_JS, usesCart, resolveShopChannels } from '../src/cart.js';

describe('cart stylesheet', () => {
  it('hides the cart until the runtime marks it enhanced (PE: no inert UI pre-JS)', () => {
    expect(CART_CSS).toContain('[data-sw-cart]{display:none}');
    expect(CART_CSS).toContain('[data-sw-cart][data-sw-enhanced="true"]{display:block}');
  });

  it('brand-themes the toggle + channel buttons via --sw-color-primary', () => {
    expect(CART_CSS).toContain('var(--sw-color-primary,#0a7a5a)');
  });

  it('pulses the toggle (expanding halo) on every add', () => {
    expect(CART_CSS).toContain('@keyframes sw-cart-pulse'); // the halo keyframe
    expect(CART_CSS).toContain('[data-sw-part="toggle"][data-sw-pulse]::after'); // ring behind the toggle
    expect(CART_CSS).toContain('prefers-reduced-motion:no-preference'); // gated for reduced-motion
    expect(CART_JS).toContain("setAttribute('data-sw-pulse'"); // add() triggers it
    expect(CART_JS).toContain('void toggle.offsetWidth'); // reflow restart so rapid adds re-pulse
  });

  it('keeps the toggle fixed + badge-visible under .waves-effect, and lays the drawer out as a flex column with a bottom-pinned footer', () => {
    expect(CART_CSS).toContain('position:fixed !important'); // .waves-effect must not unpin the floating toggle
    expect(CART_CSS).toContain('overflow:visible !important'); // …nor clip its count badge
    expect(CART_CSS).toContain('display:flex;flex-direction:column'); // drawer is a vertical flex container
    // The list flexes to fill (no magic-number max-height) so the foot pins to the bottom via the layout,
    // not a margin hack; head + foot are fixed-size (flex:none).
    expect(CART_CSS).toContain('[data-sw-part="items"]{list-style:none;margin:0;padding:.5rem 1.25rem;flex:1 1 auto;min-height:0;overflow-y:auto}');
    expect(CART_CSS).toContain('[data-sw-part="foot"]{flex:none');
    expect(CART_CSS).not.toContain('max-height:calc(100% - 16rem)'); // the fragile magic constant is gone
  });

  it('overrides the <dialog> UA max-height so the drawer fills the full viewport height (not ~38px short)', () => {
    // Chromium's UA sheet clamps a <dialog> to max-height:calc(100% - 6px - 2em); without our override the
    // drawer renders ~38px shorter than the viewport despite height:100vh. dvh tracks the visible viewport.
    expect(CART_CSS).toContain('max-height:100vh;max-height:100dvh');
    expect(CART_CSS).toContain('height:100vh;height:100dvh'); // [open] full height, dvh-aware
  });

  it('cannot break out of a <style> block', () => {
    expect(CART_CSS.toLowerCase()).not.toContain('</style');
  });
});

describe('cart runtime', () => {
  it('is a syntactically valid IIFE', () => {
    expect(CART_JS.trim().startsWith('(function(){')).toBe(true);
    // Compiles without throwing (does not execute it).
    expect(() => new Function(CART_JS)).not.toThrow();
  });

  it('wires the {{sw-cart}} mount and {{sw-add-to-cart}} buttons', () => {
    expect(CART_JS).toContain('[data-sw-cart]');
    expect(CART_JS).toContain('[data-sw-cart-add]');
    expect(CART_JS).toContain("data-sw-enhanced");
  });

  it('builds UI via createElement + textContent — never innerHTML of cart data', () => {
    expect(CART_JS).toContain('createElement');
    expect(CART_JS).not.toContain('innerHTML');
  });

  it('guards localStorage access (sandboxed preview / disabled storage)', () => {
    expect(CART_JS).toContain('localStorage');
    expect(CART_JS).toContain('try{');
  });

  it('namespaces the storage key per site (derived from the script URL)', () => {
    expect(CART_JS).toContain("'sw-cart:'");
    expect(CART_JS).toContain('document.currentScript');
  });

  it('bounds distinct lines and per-line quantity', () => {
    expect(CART_JS).toContain('MAX_LINES=50');
    expect(CART_JS).toContain('MAX_QTY=99');
  });

  it('reads the localizable drawer strings from mount attrs, with the previous literals as defaults', () => {
    expect(CART_JS).toContain("mount.getAttribute('data-empty-label')||'Your cart is empty.'");
    expect(CART_JS).toContain("mount.getAttribute('data-total-label')||'Total'"); // footer label (cart_total)
    expect(CART_JS).toContain("mount.getAttribute('data-clear-label')||'Clear cart'");
    expect(CART_JS).toContain("mount.getAttribute('data-sent-label')||'Order sent \\u2014 we will be in touch.'");
    // the previously-hardcoded literals are now sourced from cfg at every call site
    expect(CART_JS).toContain("part('p','empty',cfg.emptyLabel)");
    expect(CART_JS).toContain('cfg.totalLabel');
    expect(CART_JS).toContain("part('button','clear',cfg.clearLabel)");
    expect(CART_JS).toContain("part('p','sent-msg',cfg.sentLabel)");
  });

  it('builds a WhatsApp deep link with an encoded order text', () => {
    expect(CART_JS).toContain('https://wa.me/');
    expect(CART_JS).toContain('encodeURIComponent');
    // wa.me wants digits only — the leading + (and any separators) are stripped.
    expect(CART_JS).toContain("replace(/[^0-9]/g,'')");
  });

  it('builds a mailto link with an encoded subject + body', () => {
    expect(CART_JS).toContain("'mailto:'");
    // the body is the composed order message (greeting + order + fields), URL-encoded
    expect(CART_JS).toContain('encodeURIComponent(orderMessage(ch,items,cfg');
  });

  it('substitutes {total}/{currency}/{items} and re-checks https before opening a payment link', () => {
    expect(CART_JS).toContain('{total}');
    expect(CART_JS).toContain('{currency}');
    expect(CART_JS).toContain('{items}');
    // Defence-in-depth: the substituted URL must still be https before window.open.
    expect(CART_JS).toContain('https:');
    expect(CART_JS).toContain("'noopener'");
  });

  it('opens the native <dialog> drawer (focus trap + Esc for free)', () => {
    expect(CART_JS).toContain('showModal');
  });

  it('cannot break out of a <script> block', () => {
    expect(CART_JS.toLowerCase()).not.toContain('</script');
  });
});

describe('cart drawer UI (solid neutral scheme + optimized line)', () => {
  it('locks page scroll while the drawer is open and restores it on close', () => {
    expect(CART_JS).toContain('function lockScroll()');
    expect(CART_JS).toContain('function unlockScroll()');
    expect(CART_JS).toContain("document.documentElement.style.overflow='hidden'"); // lock
    expect(CART_JS).toContain("dialog.addEventListener('close',unlockScroll)"); // Esc/close restores
    expect(CART_JS).toContain('lockScroll();'); // wired on the open path
  });

  it('uses a SOLID default surface (white bg + explicit dark text) — no transparent chrome neutrals', () => {
    expect(CART_CSS).toContain('background:#fff;color:#1f2937;color-scheme:light'); // dialog default scheme
    // The structural neutrals (dividers, borders, muted text, fills) are all solid hex, not rgba(0,0,0,*).
    expect(CART_CSS).not.toContain('border-bottom:1px solid rgba(0,0,0');
    expect(CART_CSS).not.toContain('border-top:1px solid rgba(0,0,0');
    expect(CART_CSS).not.toContain('color:rgba(0,0,0'); // no semi-transparent text
    // Shadows / backdrop / ripple legitimately stay alpha (overlays, not "neutral" chrome colors).
    expect(CART_CSS).toContain('box-shadow:-8px 0 32px rgba(0,0,0,.25)');
    expect(CART_CSS).toContain('dialog::backdrop{background:rgba(0,0,0,.35)');
  });

  it('renders the product image (when present) in a padded, rounded, neutral thumbnail tile', () => {
    expect(CART_JS).toContain('if(it.image){'); // only when an image URL is present
    expect(CART_JS).toContain("part('div','thumb')");
    expect(CART_JS).toContain('img.src=it.image'); // src via property, never innerHTML
    expect(CART_JS).toContain("img.referrerPolicy='no-referrer'"); // no page-URL leak on a 3rd-party image load
    expect(CART_JS).toContain('img.onerror='); // a broken image drops its tile (no broken-image glyph)
    expect(CART_CSS).toContain('[data-sw-part="thumb"]{flex:none;width:3.5rem;height:3.5rem;padding:.25rem;border:1px solid #e5e7eb;border-radius:.5rem;background:#f3f4f6');
    expect(CART_CSS).toContain('[data-sw-part="thumb"] img{width:100%;height:100%;object-fit:cover');
  });

  it('lays base price, qty stepper, remove, and the line subtotal in one row under the name (no "each")', () => {
    expect(CART_JS).toContain("part('div','line-body')");
    expect(CART_JS).toContain("part('div','line-controls')");
    expect(CART_JS).toContain("part('span','line-price',money(it.price,cfg))"); // base price, NOT "+ ' each'"
    expect(CART_JS).not.toContain("' each'");
    expect(CART_JS).toContain("part('span','line-subtotal',money(lineTotal(it,cfg),cfg))"); // per-line subtotal
    expect(CART_CSS).toContain('[data-sw-part="line-subtotal"]{margin-left:auto'); // pushed to the right
  });

  it('renders the qty stepper as a COMPACT pill button group (Lucide icons, 1.5rem buttons) with a bigger gap to the base price', () => {
    // A PILL outer border (border-radius:2rem) on the group container; borderless 1.5rem buttons; the value flanked by dividers.
    expect(CART_CSS).toContain('[data-sw-part="qty"]{display:inline-flex;align-items:stretch;margin-left:.35rem;border:1px solid #d1d5db;border-radius:2rem;overflow:hidden}');
    expect(CART_CSS).toContain('[data-sw-part="qty"] button{display:flex;align-items:center;justify-content:center;width:1.5rem;height:1.5rem;border:0;');
    expect(CART_CSS).toContain('[data-sw-part="qty"] button svg{width:.875rem;height:.875rem}'); // icon sizing
    expect(CART_CSS).toContain('[data-sw-part="qty"]>span{display:flex;align-items:center;justify-content:center;min-width:1.5rem;padding:0 .25rem;border-left:1px solid #d1d5db;border-right:1px solid #d1d5db;');
    // The +/- buttons use inline Lucide minus/plus SVGs, not text glyphs.
    expect(CART_JS).toContain('function signIcon(isPlus)');
    expect(CART_JS).toContain("bar.setAttribute('d','M5 12h14')"); // minus bar
    expect(CART_JS).toContain("v.setAttribute('d','M12 5v14')"); // plus vertical
    expect(CART_JS).toContain('minus.appendChild(signIcon(false))');
    expect(CART_JS).toContain('plus.appendChild(signIcon(true))');
    expect(CART_JS).not.toContain("mk('button',null,'+')"); // old text glyph gone
  });

  it('names the footer grand-total row data-sw-part="total" and reads the cart_total label', () => {
    expect(CART_JS).toContain("part('div','total')"); // footer total row (was 'subtotal')
    expect(CART_JS).not.toContain("part('div','subtotal')");
    expect(CART_CSS).toContain('[data-sw-part="total"]{display:flex;justify-content:space-between');
    expect(CART_JS).toContain("mount.getAttribute('data-total-label')"); // carried via data-total-label
  });

  it('shows remove as a red trash icon button (not the word "Remove")', () => {
    expect(CART_JS).toContain('function trashIcon()');
    expect(CART_JS).toContain("part('button','remove')"); // no text label arg
    expect(CART_JS).toContain('rm.appendChild(trashIcon())');
    expect(CART_JS).toContain("rm.setAttribute('aria-label','Remove')"); // a11y name preserved
    expect(CART_JS).not.toContain("part('button','remove','Remove')"); // the old text button is gone
    expect(CART_CSS).toContain('[data-sw-part="remove"] svg{width:1.125rem;height:1.125rem}');
    expect(CART_CSS).toContain('color:#dc2626'); // red
  });

  it('uses a centered Lucide "x" close icon in a flex-centered square so the hover rotate() pivots dead-centre', () => {
    expect(CART_JS).toContain('function closeIcon()');
    expect(CART_JS).toContain("part('button','close')"); // no text glyph arg
    expect(CART_JS).not.toContain("part('button','close','\\\\u00d7')"); // the old × glyph button is gone
    expect(CART_JS).toContain('close.appendChild(closeIcon())');
    expect(CART_JS).toContain("close.setAttribute('aria-label','Close cart')"); // a11y name preserved
    // The button is a flex-centered fixed square (icon at the box centre) and the icon is sized via svg rule.
    expect(CART_CSS).toContain('[data-sw-part="close"]{display:flex;align-items:center;justify-content:center;width:2rem;height:2rem;border:0;background:none;cursor:pointer}');
    expect(CART_CSS).toContain('[data-sw-part="close"] svg{width:1.25rem;height:1.25rem}');
    expect(CART_CSS).toContain('[data-sw-part="close"]:hover{color:#b00020;transform:rotate(90deg)}'); // rotation kept
  });

  it('still builds the line UI without innerHTML of cart data', () => {
    expect(CART_JS).not.toContain('innerHTML');
  });
});

describe('cart detection', () => {
  it('detects the rendered mount/button markers AND the source-level helper calls', () => {
    // rendered markers (raw Html embed / future Shop block)
    expect(usesCart('<div data-sw-cart data-currency-symbol="€"></div>')).toBe(true);
    expect(usesCart('<button data-sw-cart-add data-sku="x" data-price="9.9">Add</button>')).toBe(true);
    // code-first SOURCE: the helper name (the marker attribute appears only AFTER render)
    expect(usesCart('<footer>{{sw-cart}}</footer>')).toBe(true);
    expect(usesCart('{{#each dataset.products}}{{sw-add-to-cart sku=id name=title price=price}}{{/each}}')).toBe(true);
    expect(usesCart('<div class="card">plain</div>')).toBe(false);
    expect(usesCart(undefined)).toBe(false);
    expect(usesCart(null)).toBe(false);
  });

});

describe('cart form channel', () => {
  it('CART_JS submits the order form to the endpoint with cart + spam-guard fields', () => {
    expect(CART_JS).toContain("'order-submit'");
    expect(CART_JS).toContain('cart_json');
    expect(CART_JS).toContain('cart_text');
    expect(CART_JS).toContain('_elapsed'); // time-trap
    expect(CART_JS).toContain('_hpt'); // honeypot (sent empty)
    expect(CART_JS).toContain("method:'POST'");
    expect(CART_JS).toContain('ch.endpoint');
    // contact values flow through input .value (and JSON) — never innerHTML.
    expect(CART_JS).not.toContain('innerHTML');
  });

  it('CART_JS shows a confirmation panel on success (kept out of the foot so it survives the empty render)', () => {
    expect(CART_JS).toContain("'sent-msg'");
    expect(CART_JS).toContain('sent=true');
    expect(CART_CSS).toContain('[data-sw-part="sent-msg"]');
  });

  it('CART_CSS slides the right-side drawer in/out and blurs + fades the backdrop', () => {
    expect(CART_CSS).toContain('inset:0 0 0 auto'); // pinned to the RIGHT edge (overrides the dialog UA inset:0)
    expect(CART_CSS).toContain('translateX(100%)'); // off-screen start → slides in
    expect(CART_CSS).toContain('allow-discrete'); // animate across the <dialog> display toggle (close too)
    expect(CART_CSS).toContain('@starting-style');
    expect(CART_CSS).toContain('backdrop-filter:blur'); // blurred backdrop
    expect(CART_CSS).toContain('dialog[open]::backdrop{opacity:1}'); // backdrop fades in
  });

  it('CART_JS closes only on the backdrop (rect check) — not on the drawer body — reads an editable note, and ripples its controls', () => {
    expect(CART_JS).toContain('getBoundingClientRect'); // distinguishes backdrop from in-panel empty space
    expect(CART_JS).toContain('if(e.target!==dialog){return;}'); // child clicks never close
    expect(CART_JS).toContain("getAttribute('data-note')"); // the editable cart note
    expect(CART_JS).toContain('waves-effect'); // self-contained ripple ("waves-effect")
    expect(CART_JS).toContain('waves-rippling');
    expect(CART_JS).toContain("addEventListener('pointerdown'");
    expect(CART_JS).not.toContain('innerHTML');
  });
});

describe('cart channel order fields (whatsapp/mailto)', () => {
  it('reads the merchant brand from the mount (data-brand) for the email greeting', () => {
    expect(CART_JS).toContain("mount.getAttribute('data-brand')");
    // the greeting prefixes the brand, with a graceful no-brand fallback
    expect(CART_JS).toContain('Hi ');
    expect(CART_JS).toContain('like to order:');
    expect(CART_JS).toContain('cfg.brand');
  });

  it('composes the order message: mailto greeting / whatsapp intro, the order, then Label: value field lines', () => {
    // a deep-link channel builds one message via orderMessage(ch,items,cfg,values)
    expect(CART_JS).toContain('function orderMessage(ch,items,cfg,values)');
    // collected fields become "Label: value" lines appended below the order
    expect(CART_JS).toContain('function fieldLines(values)');
    expect(CART_JS).toContain("v.label+': '+v.value");
    // whatsapp keeps its optional intro lead; mailto uses the brand greeting
    expect(CART_JS).toContain('ch.intro');
  });

  it('renders a collapsible input form for a fielded channel and validates required fields before sending', () => {
    expect(CART_JS).toContain('function buildChannelForm(ch,toggleBtn)');
    expect(CART_JS).toContain("'channel-form'");
    expect(CART_JS).toContain("'channel-submit'");
    expect(CART_JS).toContain("'channel-status'");
    expect(CART_JS).toContain('Please fill in: ');
    // the toggle exposes its state for a11y
    expect(CART_JS).toContain("setAttribute('aria-expanded'");
    // values reach the link via input .value — never innerHTML
    expect(CART_JS).not.toContain('innerHTML');
    // the form is styled + hidden until toggled open
    expect(CART_CSS).toContain('[data-sw-part="channel-form"]');
    expect(CART_CSS).toContain('[data-sw-part="channel-form"][hidden]{display:none}');
  });
});

describe('resolveShopChannels', () => {
  const ep = (id: string): string => `/f/p1/${id}`;
  it('fills the endpoint for a form channel and leaves others untouched', () => {
    const shop = { currency: { decimals: 2 }, channels: [{ kind: 'form', key: 'order_form', formId: 'order' }, { kind: 'mailto', key: 'email', email: 'a@b.test' }] };
    const out = resolveShopChannels(shop, ep) as { channels: Array<Record<string, unknown>> };
    expect(out.channels[0]).toMatchObject({ kind: 'form', key: 'order_form', formId: 'order', endpoint: '/f/p1/order' });
    expect(out.channels[1]).toEqual({ kind: 'mailto', key: 'email', email: 'a@b.test' });
  });
  it('is a no-op for an absent shop or one without channels', () => {
    expect(resolveShopChannels(undefined, ep)).toBeUndefined();
    expect(resolveShopChannels({ currency: { decimals: 2 } }, ep)).toEqual({ currency: { decimals: 2 } });
  });
});
