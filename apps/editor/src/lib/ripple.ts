// Delegated ripple ("waves") runtime for the admin UI: one document-level listener; on pointerdown
// we walk up to the nearest `.waves-effect` and spawn the ripple there — so React SPA buttons/rows
// that mount and unmount constantly need no re-bind. The published-site runtime
// (packages/blocks/src/ripple.ts) now uses the SAME delegated model; this stays a separate copy only
// because the editor bundle doesn't ship blocks' runtime strings. Same visual + class protocol.
//
// Invariants (mirroring the publish runtime):
// - The ripple span is built with createElement and positioned via inline numeric styles only
//   — never innerHTML — so no markup can be injected.
// - Motion sits behind `prefers-reduced-motion: no-preference`; reduced motion = no ripple
//   (the install becomes a no-op, and the CSS clip/overflow rules also don't apply).

function spawn(el: HTMLElement, clientX: number, clientY: number): void {
  const rect = el.getBoundingClientRect();
  const x = (Number.isFinite(clientX) ? clientX : rect.left + rect.width / 2) - rect.left;
  const y = (Number.isFinite(clientY) ? clientY : rect.top + rect.height / 2) - rect.top;
  const size = Math.max(rect.width, rect.height) * 2;
  const span = document.createElement('span');
  span.className = 'waves-ripple waves-rippling';
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.style.left = `${x - size / 2}px`;
  span.style.top = `${y - size / 2}px`;
  el.appendChild(span);
  const remove = () => span.parentNode?.removeChild(span);
  span.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, 800); // fallback if animationend never fires (tab hidden, etc.)
}

/**
 * Installs the delegated ripple listener on `document`. Returns a cleanup function. A no-op
 * (returning a no-op cleanup) when the user prefers reduced motion.
 */
export function installRipple(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const onDown = (e: PointerEvent) => {
    const target = e.target as HTMLElement | null;
    const el = target?.closest<HTMLElement>('.waves-effect');
    // Skip disabled controls (they shouldn't show feedback).
    if (!el || el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') return;
    spawn(el, e.clientX, e.clientY);
  };
  document.addEventListener('pointerdown', onDown);
  return () => document.removeEventListener('pointerdown', onDown);
}
