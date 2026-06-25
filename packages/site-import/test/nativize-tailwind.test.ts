import { describe, expect, it } from 'vitest';
import { space, dim, fontSizeClass, radiusClass, colorToken, colorValue, hexOf, spaceToken, graySnap, zIndexClass, opacityClass, leadingClass, normalizeColor, type NativizePalette, DEFAULT_FONT_MAP } from '../src/nativize/tokens.js';
import { emitGroups, mergeGroups, type EmitContext, type BreakpointGroups } from '../src/nativize/tailwind.js';

const palette: NativizePalette = {
  colors: { '11,74,119': 'primary', '57,193,240': 'secondary', '12,163,200': 'accent' },
  fonts: DEFAULT_FONT_MAP,
};
const ctx: EmitContext = { palette };

describe('tokens — px/color snapping', () => {
  it('snaps spacing px onto the Tailwind scale (loose + tight)', () => {
    expect(space('p', '16px')).toBe('p-4');
    expect(space('gap', '24px')).toBe('gap-6');
    expect(space('p', '0px')).toBe('p-0');
    expect(space('p', '17px')).toBe('p-4'); // within 6% tolerance
    expect(space('p', '500px')).toBe('p-[500px]'); // beyond the scale → arbitrary
    expect(dim('h', '16px')).toBe('h-4');
    expect(dim('w', '200px')).toBe('w-48'); // generous tol (≤10%) snaps 200→192 → w-48
    expect(spaceToken('16px')).toBe('4');
    expect(spaceToken('500px')).toBeNull();
  });

  it('snaps font-size + radius, falling back to arbitrary off-scale', () => {
    expect(fontSizeClass('16px')).toBe('text-base');
    expect(fontSizeClass('18px')).toBe('text-lg');
    expect(fontSizeClass('36px')).toBe('text-4xl');
    expect(fontSizeClass('42px')).toBe('text-4xl'); // generous tol (≤15%) snaps 42→36 → text-4xl
    expect(fontSizeClass('200px')).toBe('text-[200px]'); // far off-scale (no scale step within 15%) → arbitrary
    expect(radiusClass('8px')).toBe('rounded-lg');
    expect(radiusClass('0px')).toBe('rounded-none');
    expect(radiusClass('9999px')).toBe('rounded-full');
  });

  it('tokenizes colors against the project palette (brand → token, white/black, else hex)', () => {
    expect(colorToken('rgb(11, 74, 119)', palette)).toBe('primary');
    expect(colorToken('rgb(57, 193, 240)', palette)).toBe('secondary');
    expect(colorToken('rgb(255, 255, 255)', palette)).toBe('white');
    expect(colorToken('rgb(0, 0, 0)', palette)).toBe('black');
    expect(colorToken('rgb(50, 60, 70)', palette)).toBeNull();
    expect(colorToken('rgba(0, 0, 0, 0)', palette)).toBeNull(); // transparent → not 'black'
    expect(colorValue('rgb(11, 74, 119)', palette)).toBe('var(--sw-color-primary)');
    expect(colorValue('rgb(255, 255, 255)', palette)).toBe('#fff');
    expect(colorValue('rgb(50, 60, 70)', palette)).toBe('#323c46');
    expect(colorValue('rgb(0, 0, 0)', palette)).toBe('#000');
    expect(hexOf('rgb(12, 163, 200)')).toBe('#0ca3c8');
    expect(hexOf('transparent')).toBe('transparent'); // no rgb triple → passthrough
    expect(radiusClass('20px')).toBe('rounded-2xl'); // generous tol snaps 20→16 → rounded-2xl
    expect(radiusClass('50%')).toBe('rounded-full'); // percentage radius → pill/circle
    expect(fontSizeClass('abc')).toBe('text-[abc]'); // unparseable → arbitrary
  });

  it('snaps z-index / opacity / gray / line-height to canonical tokens', () => {
    expect(zIndexClass('998')).toBe('z-50');
    expect(zIndexClass('9')).toBe('z-10');
    expect(zIndexClass('-1')).toBe('z-[-1]'); // negative z (behind content) preserved, not snapped to z-0
    expect(opacityClass('0')).toBe('opacity-0');
    expect(opacityClass('0.5')).toBe('opacity-50');
    expect(graySnap('rgb(204, 204, 204)')).toBe('neutral-300'); // near-gray → neutral scale
    expect(graySnap('rgb(239, 239, 239)')).toBe('neutral-100');
    expect(graySnap('rgb(11, 74, 119)')).toBeNull(); // chromatic → keep hex
    expect(leadingClass('24px', '16px')).toBe('leading-normal'); // ratio 1.5
    expect(leadingClass('24px')).toBe('leading-6'); // px, no font-size → fixed scale
    expect(leadingClass('103px', '40px')).toBeNull(); // 2.6× → implausible, drop
  });
});

describe('emitGroups — computed style → keyed utility groups', () => {
  it('maps typography + brand colors to theme tokens', () => {
    expect(emitGroups({ 'background-color': 'rgb(11, 74, 119)' }, 'div', false, ctx).g.bg).toBe('bg-primary');
    expect(emitGroups({ color: 'rgb(50, 60, 70)' }, 'p', false, ctx).g.color).toBe('text-[#323c46]');
    // a floated element keeps its float (text wraps beside it) instead of dropping to a full-width block
    expect(emitGroups({ float: 'right' }, 'img', false, ctx).g.float).toBe('float-right ml-6 mb-4');
    expect(emitGroups({ float: 'left' }, 'img', false, ctx).g.float).toBe('float-left mr-6 mb-4');
    // oklab/oklch (Tailwind-v4) → sRGB so the class is Tailwind-parseable (an oklab arbitrary value's spaces break it → black text)
    expect(normalizeColor('oklab(0.999994 0.0000455677 0.0000200868 / 0.8)')).toBe('rgba(255, 255, 255, 0.8)');
    expect(normalizeColor('oklch(0.7 0.15 30)')).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(normalizeColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)'); // pass-through
    expect(emitGroups({ color: 'oklab(0.999994 0.0000455677 0.0000200868 / 0.8)' }, 'p', false, ctx).g.color).toBe('text-[rgba(255,255,255,0.8)]');
    // a SEMI-TRANSPARENT overlay keeps its alpha (must NOT collapse to opaque bg-black)
    expect(emitGroups({ 'background-color': 'rgba(0, 0, 0, 0.1)' }, 'div', false, ctx).g.bg).toBe('bg-[rgba(0,0,0,0.1)]');
    expect(emitGroups({ 'background-color': 'rgb(0, 0, 0)' }, 'div', false, ctx).g.bg).toBe('bg-black');
    expect(emitGroups({ 'font-size': '18px', 'font-weight': '700' }, 'h2', false, ctx).g).toMatchObject({ fsize: 'text-lg', fweight: 'font-bold' });
    expect(emitGroups({ 'text-transform': 'uppercase' }, 'span', false, ctx).g.ttransform).toBe('uppercase');
  });

  it('maps flex/grid layout', () => {
    expect(emitGroups({ display: 'flex', 'flex-direction': 'column' }, 'div', false, ctx).g).toMatchObject({ display: 'flex', flexdir: 'flex-col' });
    expect(emitGroups({ 'align-items': 'center', 'justify-content': 'space-between' }, 'div', false, ctx).g).toMatchObject({ items: 'items-center', justify: 'justify-between' });
    // equal col/row gap → one gap-N; different → gap-x + gap-y
    expect(emitGroups({ 'column-gap': '24px', 'row-gap': '24px' }, 'div', false, ctx).g.gap).toBe('gap-6');
    expect(emitGroups({ 'column-gap': '32px', 'row-gap': '48px' }, 'div', false, ctx).g).toMatchObject({ gapx: 'gap-x-8', gapy: 'gap-y-12' });
  });

  it('re-fluidizes grid tracks that getComputedStyle pinned to px', () => {
    expect(emitGroups({ 'grid-template-columns': '384px 384px' }, 'div', false, ctx).g.gridcols).toBe('grid-cols-2');
    expect(emitGroups({ 'grid-template-columns': '512px 256px' }, 'div', false, ctx).g.gridcols).toBe('grid-cols-[minmax(0,512fr)_minmax(0,256fr)]');
  });

  it('handles width: centered fixed → w-full+max-w+mx-auto; plain fixed → pin+max-w-full', () => {
    const centered = emitGroups({ width: '1200px', 'margin-left': '40px', 'margin-right': '40px' }, 'div', false, ctx).g;
    expect(centered).toMatchObject({ w: 'w-full', maxw: 'max-w-[1200px]', mx: 'mx-auto' });
    const plain = emitGroups({ width: '200px' }, 'div', false, ctx).g;
    expect(plain).toMatchObject({ w: 'w-48', maxw: 'max-w-full' });
    const wide = emitGroups({ width: '1280px' }, 'div', false, ctx).g; // non-centered viewport-wide block
    expect(wide.w).toBe('w-full');
    expect(emitGroups({}, 'img', false, ctx).g).toMatchObject({ h: 'h-auto', maxw: 'max-w-full' });
  });

  it('restores my-auto for a vertically-centered flex child (px from getComputedStyle)', () => {
    expect(emitGroups({ 'margin-top': '20px', 'margin-bottom': '20px' }, 'div', true, ctx).g.my).toBe('my-auto');
    // same margins but NOT a flex child → intentional spacing, keep px
    expect(emitGroups({ 'margin-top': '16px', 'margin-bottom': '16px' }, 'div', false, ctx).g.my).toBe('my-4');
  });

  it('emits inline-style fragments for non-responsive box-shadow / background-image', () => {
    expect(emitGroups({ 'box-shadow': '0 1px 3px rgba(0,0,0,0.1)' }, 'div', false, ctx).st).toContain('box-shadow:0 1px 3px rgba(0,0,0,0.1)');
    const bg = emitGroups({ 'background-image': 'url("x.jpg")', 'background-size': 'cover' }, 'div', false, ctx).st.join(';');
    expect(bg).toContain("background-image:url('x.jpg')");
  });

  it('emits borders as arbitrary utilities with token colors', () => {
    const g = emitGroups({ 'border-top-width': '2px', 'border-top-style': 'solid', 'border-top-color': 'rgb(11, 74, 119)' }, 'div', false, ctx).g;
    expect(g.bordertop).toBe('[border-top:2px_solid_var(--sw-color-primary)]');
  });

  it('covers the long tail of style props', () => {
    const { g, st } = emitGroups({
      'line-height': '24px', 'letter-spacing': '0.5px', 'text-align': 'center', 'white-space': 'nowrap',
      'font-style': 'italic', 'font-family': 'primary-font, sans-serif', position: 'absolute', 'z-index': '10',
      top: '8px', left: '16px', opacity: '0.5', transform: 'rotate(5deg)', overflow: 'hidden',
      'object-fit': 'cover', 'aspect-ratio': '16 / 9', 'flex-wrap': 'wrap', 'max-width': '600px',
      'border-radius': '10px / 20px',
    }, 'div', false, ctx);
    expect(g).toMatchObject({
      leading: 'leading-6', tracking: 'tracking-[0.5px]', talign: 'text-center', whitespace: 'whitespace-nowrap',
      fstyle: 'italic', fontfam: 'font-heading', position: 'absolute', zindex: 'z-10', top: 'top-2', left: 'left-4',
      opacity: 'opacity-50', transform: '[transform:rotate(5deg)]', overflow: 'overflow-hidden', objectfit: 'object-cover',
      aspect: 'aspect-[16/9]', flexwrap: 'flex-wrap', maxw: 'max-w-[600px]',
    });
    expect(st).toContain('border-radius:10px / 20px'); // elliptical radius → inline (can't be a utility)
  });

  it('handles gap shorthand, max-width:100%, and pinned heights by element role', () => {
    expect(emitGroups({ gap: '16px' }, 'div', false, ctx).g.gap).toBe('gap-4');
    expect(emitGroups({ gap: '16px 24px' }, 'div', false, ctx).g).toMatchObject({ gapy: 'gap-y-4', gapx: 'gap-x-6' });
    expect(emitGroups({ 'max-width': '100%' }, 'div', false, ctx).g.maxw).toBe('max-w-full');
    expect(emitGroups({ height: '384px' }, 'iframe', false, ctx).g.h).toBe('h-96'); // iframe → pin height
    expect(emitGroups({ height: '320px', overflow: 'hidden' }, 'div', false, ctx).g.h).toBe('h-80'); // clipping viewport → pin
    expect(emitGroups({ height: '500px', 'background-image': 'url(x.jpg)' }, 'div', false, ctx).g.minh).toBe('min-h-[500px]'); // band → floor
  });

  it('detects asymmetric auto margins on a flex child (ml-auto / mr-auto)', () => {
    expect(emitGroups({ 'margin-left': '100px' }, 'div', true, ctx).g.ml).toBe('ml-auto');
    expect(emitGroups({ 'margin-right': '100px' }, 'div', true, ctx).g.mr).toBe('mr-auto');
  });
});

describe('mergeGroups — mobile-first merge with breakpoint overrides + resets', () => {
  const bp = (b: string, g: Record<string, string>): BreakpointGroups => ({ bp: b, g, st: [] });

  it('keeps a stable value once (no redundant md:/lg:)', () => {
    expect(mergeGroups([bp('', { color: 'text-primary' }), bp('md:', { color: 'text-primary' }), bp('lg:', { color: 'text-primary' })])).toEqual(['text-primary']);
  });

  it('emits a breakpoint override when the value changes', () => {
    expect(mergeGroups([bp('', { display: 'flex' }), bp('md:', { display: 'flex' }), bp('lg:', { display: 'block' })])).toEqual(['flex', 'lg:block']);
  });

  it('RESETS a property that was set at base but absent at a larger breakpoint', () => {
    expect(mergeGroups([bp('', { gap: 'gap-4' }), bp('md:', {}), bp('lg:', {})])).toEqual(['gap-4', 'md:gap-0']);
  });

  it('round-trips emitGroups across 3 viewports (mobile flex-col → desktop flex-row)', () => {
    const mobile = emitGroups({ display: 'flex', 'flex-direction': 'column' }, 'div', false, ctx);
    const desktop = emitGroups({ display: 'flex' }, 'div', false, ctx); // flex-row is the default → not captured
    const classes = mergeGroups([{ bp: '', ...mobile }, { bp: 'md:', ...mobile }, { bp: 'lg:', ...desktop }]);
    expect(classes).toContain('flex');
    expect(classes).toContain('flex-col');
    expect(classes).toContain('lg:flex-row'); // reset to default at lg
  });
});
