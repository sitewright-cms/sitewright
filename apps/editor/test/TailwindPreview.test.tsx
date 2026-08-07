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
      <TailwindPreview kind="none" props={['display']} values={[['flex']]} name="flex" />,
    );
    expect(container.querySelector('span[role="img"]')).toBeNull();
  });

  it('paints the RESOLVED theme value, never the var() — a var the shadow root lacks paints nothing', () => {
    const { container } = render(
      <TailwindPreview
        kind="text"
        props={['font-size', 'line-height']}
        values={[['var(--text-sm)', '0.875rem'], ['var(--text-sm--line-height)', '1.25rem']]}
        name="text-sm"
      />,
    );
    const el = demo(container);
    // The style attribute must carry the number, not the variable reference.
    expect(el?.getAttribute('style')).toContain('font-size: 0.875rem');
    expect(el?.getAttribute('style')).not.toContain('var(--text-sm)');
  });

  it('never applies the class itself — the editor sheet has no rule for most utilities', () => {
    // This is the whole reason the component exists. A preview that set class="text-sm" would show
    // nothing at all for the 2/3 of utilities the editor's own chrome never uses.
    const { container } = render(
      <TailwindPreview kind="text" props={['font-size']} values={[['var(--text-4xl)', '2.25rem']]} name="text-4xl" />,
    );
    expect(demo(container)?.className).not.toContain('text-4xl');
  });

  it('isolates the demo in a shadow root, so the editor’s own theme cannot leak in', () => {
    // The editor lifts --text-xs from 12px to 14px for UI readability. Inheriting that would make
    // the text-xs preview a lie about what the class does on a published page.
    const { container } = render(
      <TailwindPreview kind="text" props={['font-size']} values={[['var(--text-xs)', '0.75rem']]} name="text-xs" />,
    );
    const host = container.querySelector('span[role="img"]');
    expect(host?.shadowRoot).toBeTruthy();
    expect(host?.shadowRoot?.querySelector('style')?.textContent).toContain('--text-xs: 0.75rem');
  });

  it('paints a colour swatch with the colour as its background, whatever property the class sets', () => {
    const { container } = render(
      <TailwindPreview kind="color" props={['border-color']} values={[['oklch(63.7% 0.237 25.331)']]} name="border-red-500" />,
    );
    const style = demo(container)?.getAttribute('style') ?? '';
    expect(style).toContain('border-color: oklch(63.7% 0.237 25.331)');
    // …and on background-color too, so a one-property swatch is visible for any property.
    expect(style).toContain('background-color:oklch(63.7% 0.237 25.331)');
  });

  it('ships keyframes with an animation preview, since a shadow root inherits none', () => {
    const { container } = render(
      <TailwindPreview kind="box" props={['animation']} values={[['var(--animate-spin)', 'spin 1s linear infinite']]} name="animate-spin" />,
    );
    const host = container.querySelector('span[role="img"]');
    expect(host?.shadowRoot?.querySelector('style')?.textContent).toContain('@keyframes spin');
  });

  it('refuses a declaration value that could break out of the rule', () => {
    // Defence in depth: values come from Tailwind's own output, but they are written into a
    // stylesheet, so a brace or comment opener must never survive to be painted.
    const { container } = render(
      <TailwindPreview kind="box" props={['color']} values={[['red} .x{color:blue']]} name="evil" />,
    );
    expect(container.querySelector('span[role="img"]')).toBeNull();
  });

  it('labels the preview for assistive technology', () => {
    const { container } = render(
      <TailwindPreview kind="color" props={['color']} values={[['#ff0000']]} name="text-red-500" />,
    );
    expect(container.querySelector('span[role="img"]')?.getAttribute('aria-label')).toBe('text-red-500 preview');
  });
});
