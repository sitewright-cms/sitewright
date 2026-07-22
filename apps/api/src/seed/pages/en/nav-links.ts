import type { Page } from '@sitewright/schema';

// ---------------------------------------------------------------- NAV LINK PLACEHOLDER
// A `kind:'link'` entry: no route/HTML of its own — a nav item with a RICH label (inline HTML +
// {{sw-icon}}, rendered + sanitized into the menu) pointing at an internal target (rebased per
// page AND locale by the nav builder). The locale variants translate the label via `title`.
export function pageNavLinks(): Page[] {
  return [
    {
      id: 'nav-audit',
      path: '',
      title: '<span class="inline-flex items-center gap-1.5 font-semibold text-accent">{{sw-icon "sparkle" "h-4 w-4"}} Free site audit</span>',
      kind: 'link',
      link: { target: '/contact' },
      parent: 'home',
      nav: { slots: ['header'], order: 9 },
    },
  ];
}
