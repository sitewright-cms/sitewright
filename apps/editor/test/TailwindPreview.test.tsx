import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { TailwindPreview } from '../src/views/library/TailwindPreview';

/** The rendered demo element inside the preview's shadow root. */
function demo(container: HTMLElement): HTMLElement | null {
  const host = container.querySelector('span[role="img"]');
  return (host?.shadowRoot?.querySelector('.swatch, .specimen, .demo-box, .bar, .cursor-patch') ??
    null) as HTMLElement | null;
}

describe('TailwindPreview', () => {
  it('renders nothing for a topic whose effect needs an invented scene', () => {
    const { container } = render(
      <TailwindPreview kind="none" decls={[['display', 'flex']]} name="flex" />,
    );
    expect(container.querySelector('span[role="img"]')).toBeNull();
  });

  it('paints the RESOLVED theme value, never the var() — a var the shadow root lacks paints nothing', () => {
    const { container } = render(
      <TailwindPreview
        kind="text"
        decls={[
          ['font-size', 'var(--text-sm)', '0.875rem'],
          ['line-height', 'var(--text-sm--line-height)', '1.25rem'],
        ]}
        name="text-sm"
      />,
    );
    const el = demo(container);
    // Read it back off the CSSOM: the number landed, not the variable reference.
    expect(el?.style.getPropertyValue('font-size')).toBe('0.875rem');
    expect(el?.style.getPropertyValue('line-height')).toBe('1.25rem');
  });

  it('never applies the class itself — the editor sheet has no rule for most utilities', () => {
    // This is the whole reason the component exists. A preview that set class="text-sm" would show
    // nothing at all for the 2/3 of utilities the editor's own chrome never uses.
    const { container } = render(
      <TailwindPreview kind="text" decls={[['font-size', 'var(--text-4xl)', '2.25rem']]} name="text-4xl" />,
    );
    expect(demo(container)?.className).not.toContain('text-4xl');
  });

  it('isolates the demo in a shadow root, so the editor’s own theme cannot leak in', () => {
    // The editor lifts --text-xs from 12px to 14px for UI readability. Inheriting that would make
    // the text-xs preview a lie about what the class does on a published page.
    const { container } = render(
      <TailwindPreview kind="text" decls={[['font-size', 'var(--text-xs)', '0.75rem']]} name="text-xs" />,
    );
    const host = container.querySelector('span[role="img"]');
    expect(host?.shadowRoot).toBeTruthy();
    expect(host?.shadowRoot?.querySelector('style')?.textContent).toContain('--text-xs: 0.75rem');
  });

  it('paints a colour swatch with the colour as its background, whatever property the class sets', () => {
    const { container } = render(
      <TailwindPreview kind="color" decls={[['border-color', 'oklch(63.7% 0.237 25.331)']]} name="border-red-500" />,
    );
    const el = demo(container);
    // Assert the property, not the byte sequence: the CSSOM canonicalises `63.7%` to `0.637`, which
    // is the value being ACCEPTED and painted. Pinning the literal string would test the serialiser.
    const border = el?.style.getPropertyValue('border-color') ?? '';
    expect(border).toMatch(/^oklch\(/);
    // …and background-color carries the same colour, so a one-property swatch is visible for any
    // property the class happens to set.
    expect(el?.style.getPropertyValue('background-color')).toBe(border);
  });

  it('ships keyframes with an animation preview, since a shadow root inherits none', () => {
    const { container } = render(
      <TailwindPreview kind="box" decls={[['animation', 'var(--animate-spin)', 'spin 1s linear infinite']]} name="animate-spin" />,
    );
    const host = container.querySelector('span[role="img"]');
    expect(host?.shadowRoot?.querySelector('style')?.textContent).toContain('@keyframes spin');
  });

  it('refuses a declaration value that could break out of the rule', () => {
    // Defence in depth: values come from Tailwind's own output, but a brace or comment opener must
    // never survive to be painted.
    const { container } = render(
      <TailwindPreview kind="box" decls={[['color', 'red} .x{color:blue']]} name="evil" />,
    );
    expect(container.querySelector('span[role="img"]')).toBeNull();
  });

  it('refuses a value that would turn a preview into a network fetch', () => {
    // The canonical guard blocks url()/image()/@import; the previous ad-hoc regex did not.
    const { container } = render(
      <TailwindPreview kind="box" decls={[['background-image', 'url(https://evil.example/x.png)']]} name="bg-evil" />,
    );
    expect(container.querySelector('span[role="img"]')).toBeNull();
  });

  it('never lets the colour fallback smuggle a rejected value past the filter', () => {
    // ★ Regression guard for a real defect. The colour swatch used to append `background-color:` from
    // the RAW values array, AFTER the filter had run — so a multi-declaration colour topic whose
    // FIRST value was unsafe (and whose second was fine, keeping the element alive) wrote that value
    // straight into a style attribute that was then parsed as HTML. It created a live <img onerror>.
    const { container } = render(
      <TailwindPreview
        kind="color"
        decls={[
          ['--tw-gradient-from', '"><img src=x onerror=alert(1)>'],
          ['--tw-gradient-stops', 'var(--tw-gradient-stops)', 'red, blue'],
        ]}
        name="from-evil"
      />,
    );
    const host = container.querySelector('span[role="img"]');
    // The element still renders (its second declaration is legitimate)…
    expect(host).not.toBeNull();
    // …but no markup was ever parsed, so no injected node exists…
    expect(host?.shadowRoot?.querySelector('img')).toBeNull();
    // …and the rejected value reached neither the property it came from nor the colour fallback.
    const el = demo(container);
    expect(el?.style.getPropertyValue('--tw-gradient-from')).toBe('');
    expect(el?.style.getPropertyValue('background-color')).not.toContain('<img');
  });

  it('builds the demo through the CSSOM, so no value is ever parsed as markup', () => {
    const { container } = render(
      <TailwindPreview kind="box" decls={[['border-radius', 'var(--radius-lg)', '0.5rem']]} name="rounded-lg" />,
    );
    const el = demo(container);
    expect(el?.style.getPropertyValue('border-radius')).toBe('0.5rem');
    // A CSSOM-built element has no stray descendants — nothing was ever handed to innerHTML.
    expect(el?.children.length).toBe(0);
  });

  it('does not paint a declaration that only applies inside a media query', () => {
    // ★ `container`'s max-width steps are breakpoint-scoped. Painting one unconditionally would show
    // a swatch no viewport actually renders — and, before the parser tracked at-rules, that is
    // exactly what the data claimed they were.
    const { container } = render(
      <TailwindPreview
        kind="size"
        decls={[
          ['width', '100%'],
          ['max-width', '40rem', '', '@media (width >= 40rem)'],
        ]}
        name="container"
      />,
    );
    const el = demo(container);
    expect(el?.style.getPropertyValue('width')).toBe('100%');
    expect(el?.style.getPropertyValue('max-width')).toBe('');
  });

  it('renders nothing when every declaration is conditional', () => {
    const { container } = render(
      <TailwindPreview kind="box" decls={[['outline', '2px solid transparent', '', '@media (forced-colors: active)']]} name="outline-hidden" />,
    );
    expect(container.querySelector('span[role="img"]')).toBeNull();
  });

  it('labels the preview for assistive technology', () => {
    const { container } = render(
      <TailwindPreview kind="color" decls={[['color', '#ff0000']]} name="text-red-500" />,
    );
    expect(container.querySelector('span[role="img"]')?.getAttribute('aria-label')).toBe('text-red-500 preview');
  });
});
