/**
 * Queries for controls that carry a DaisyUI tooltip.
 *
 * The editor's hover hints moved off the native `title` attribute onto the <Tooltip> wrapper
 * (`<span class="tooltip" data-tip="…">`), so `getByTitle` no longer finds them. `title` is still the
 * right query for the places it remains a real accessible name — notably `<iframe title>`.
 */

import { waitFor } from '@testing-library/react';

/** The tip attached to `el` — the wrapper is an ANCESTOR, so this walks up rather than reading `el`. */
export function tipOf(el: Element): string | null {
  return el.closest('[data-tip]')?.getAttribute('data-tip') ?? null;
}

/**
 * The control a tooltip wraps. Returns the wrapped CHILD, not the wrapper: the click handlers live on
 * the control, and React events bubble up — firing on the wrapper would reach nothing.
 */
export function byTip(tip: string | RegExp, scope: ParentNode = document.body): HTMLElement {
  const host = Array.from(scope.querySelectorAll<HTMLElement>('[data-tip]')).find((h) => {
    const t = h.getAttribute('data-tip') ?? '';
    return typeof tip === 'string' ? t === tip : tip.test(t);
  });
  if (!host) throw new Error(`byTip: no element with data-tip matching ${String(tip)}`);
  return (host.firstElementChild as HTMLElement | null) ?? host;
}

/** Every control whose wrapper carries `tip`, in DOM order. */
export function allByTip(tip: string | RegExp, scope: ParentNode = document.body): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('[data-tip]'))
    .filter((h) => {
      const t = h.getAttribute('data-tip') ?? '';
      return typeof tip === 'string' ? t === tip : tip.test(t);
    })
    .map((h) => (h.firstElementChild as HTMLElement | null) ?? h);
}

/** {@link byTip}, but waits for the control to appear (the async lists render after a fetch). */
export async function findByTip(tip: string | RegExp, scope: ParentNode = document.body, timeout = 1000): Promise<HTMLElement> {
  let found: HTMLElement | undefined;
  await waitFor(() => { found = byTip(tip, scope); }, { timeout });
  return found!;
}
