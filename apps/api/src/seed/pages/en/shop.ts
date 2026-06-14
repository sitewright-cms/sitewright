import type { Page } from '@sitewright/schema';


// ---------------------------------------------------------------- SHOP (MINI SHOP demo)
// global:shop loops the `products` dataset (auto-resolved per locale), each card with a
// {{sw-add-to-cart}} button + the {{sw-cart}} mount. The cart drawer's strings + the add-to-cart label
// auto-localize from the translation catalog (reserved cart_* keys in website.translations), so the
// German/Spanish shops get their own drawer from the SAME template code with no per-page wiring.
export function pageShop(): Page {
  return {
    id: 'shop',
    path: 'shop',
    title: 'Studio merch — Northwind shop',
    parent: 'home',
    nav: { title: 'Shop', slots: ['header'], order: 7 },
    template: 'global:shop',
    description: 'Studio merch for fellow web nerds — add to cart and order via WhatsApp, email, or a payment link.',
    data: {
      heading: 'Studio merch',
      intro: 'A little something for fellow web nerds. Add to cart and check out via WhatsApp, email, or a payment link.',
    },
  };
}
