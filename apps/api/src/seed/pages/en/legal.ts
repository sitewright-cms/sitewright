import type { Page } from '@sitewright/schema';


// ---------------------------------------------------------------- LEGAL (privacy + imprint)
// Corporate must-haves on the global:text template: `noindex` keeps them out of the sitemap +
// robots, the `footer` nav slot lists them in the chrome's Legal column, and the whole body is
// page.data (heading + richtext body) — so the locale variants are fully translated documents.
export function pagesLegal(): Page[] {
  return [
  {
    id: 'privacy',
    path: 'privacy',
    title: 'Privacy policy',
    parent: 'home',
    template: 'global:text',
    noindex: true,
    nav: { slots: ['footer'], order: 2 },
    data: {
      heading: 'Privacy policy',
      body:
        'We keep this simple: we collect only what the contact form sends us (your name, email, and message), use it solely to reply, and never sell or share it. ' +
        'Our hosting provider stores standard access logs (IP address, time, page) for 14 days for security. ' +
        'This site sets one cookie — the consent choice itself — and uses privacy-friendly, cookieless analytics. ' +
        'You can ask us to show or delete everything we hold about you at any time: hello@northwindstudio.com.',
    },
  },
  {
    id: 'imprint',
    path: 'imprint',
    title: 'Imprint',
    parent: 'home',
    template: 'global:text',
    noindex: true,
    nav: { slots: ['footer'], order: 3 },
    data: {
      heading: 'Imprint',
      body:
        'Northwind Web Studio Ltd. · 548 Market Street, Suite 200 · San Francisco, CA 94104 · USA. ' +
        'Represented by Mara Whitfield (Founder & Design Director). ' +
        'Contact: hello@northwindstudio.com · +1 (415) 555-0142. ' +
        'Responsible for content: Mara Whitfield, address as above.',
    },
  },
  ];
}
