// Shared overlay primitives for Modal + Drawer, so they cooperate as ONE stack: later-opened
// overlays render above earlier ones, and the global Escape shortcut acts on the TOP overlay only
// (Esc unwinds one at a time — a dialog over a drawer over the page closes innermost-first).

/** Tab-cycle selector for the focus trap. */
export const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open-overlay stack (top = last pushed = the shortcut owner). Shared by Modal and Drawer. */
export const OVERLAY_STACK: object[] = [];
