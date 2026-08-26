// Is this a phone-sized viewport?
//
// ★ This is deliberately NOT a styling helper. Tailwind's `sm:` prefix already covers "lay this out
// differently when narrow", and anything that is only a layout difference should keep using it. This
// hook exists for the cases a CSS breakpoint cannot express: whether a component MOUNTS AT ALL.
//
// The editor's heavy surfaces are heavy because of what they run, not how they look — CodeMirror, the
// System Library, the Widgets and Snippets rails. Hiding those with `hidden sm:block` would still
// construct them, still fetch their data, and still hold their memory on the device least able to
// spare any of it. Gating the mount is what actually makes mobile stop paying for a desktop feature.
//
// It also decides genuine BEHAVIOUR: which rail edge a panel docks to, whether the page editor offers
// a mode switch at all. Those are one-or-the-other choices, not two stylesheets.
import { useEffect, useState } from 'react';

/**
 * Below 1000px.
 *
 * ★ DELIBERATELY NOT Tailwind's `sm` (640px), which this started as. The breakpoint that matters here
 * is not "is this a phone" but "does the desktop chrome still fit", and the answer arrives well before
 * 640px: the header alone wants ~560px for its controls before the project name gets a pixel, and the
 * page editor's toolbar is six 44px targets. A 900px tablet was being handed a layout that technically
 * fits and is miserable to use.
 *
 * The consequence is that this line and the `sm:` prefix no longer coincide, so the two are not
 * interchangeable: anything that must agree with THIS decision (which rails mount, how the header is
 * laid out) reads this hook, and `sm:` is left to the purely cosmetic choices — where a form collapsing
 * to one column at 640px is still the right call.
 */
export const MOBILE_QUERY = '(max-width: 999.98px)';

/**
 * True while the viewport is phone-sized, re-rendering when that changes (rotation, a resized
 * desktop window, a tablet keyboard opening).
 *
 * FALSE wherever `matchMedia` is unavailable — jsdom does not implement it, so every unit test sees
 * the desktop UI it was written against, and a browser too old to answer gets the full app rather
 * than a stripped one. Same guard as ContextMenu's `hasHoverPointer`.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(matchMobile);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    // Read once on mount too: the query can already have flipped between the initial render and the
    // effect (a rotation during hydration), and the listener alone would never report that.
    setMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

function matchMobile(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}
