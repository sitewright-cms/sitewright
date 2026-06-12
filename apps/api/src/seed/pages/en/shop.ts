import type { Page } from '@sitewright/schema';


// ---------------------------------------------------------------- SHOP (MINI SHOP demo)
// global:shop loops the `products` dataset (auto-resolved per locale), each card with a
// {{sw-add-to-cart}} button + the {{sw-cart}} mount. The cart drawer's strings come from
// `website.shop` site-wide; a locale variant overrides them per page through the template's
// {{sw-cart}} hash hooks — wired below via page.data (cart_* keys), so the German shop gets a
// German drawer from the SAME template code.
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
      cart_title: 'Your cart',
      cart_note: 'Prices are indicative. This sends an order request — the seller confirms availability and final price.',
      cart_added: 'Added',
      cart_empty: 'Your cart is empty.',
      cart_subtotal: 'Subtotal',
      cart_clear: 'Clear cart',
      cart_sent: 'Order sent — we will be in touch.',
    },
  };
}
