import type { Entry } from '@sitewright/schema';
import { pub } from './helpers.js';

export function exampleEntries(assetMap: Record<string, string>): Entry[] {
  // Missing keys → '' (e.g. unit tests that seed without generating images) so no field ever
  // becomes the literal string "undefined".
  const assets = new Proxy(assetMap, {
    // Named string keys → the URL or '' (so a missing image is never the literal "undefined");
    // symbol keys (coercion/inspection) pass straight through to the target.
    get: (t, k) => (typeof k === 'symbol' ? Reflect.get(t, k) : k in t ? Reflect.get(t, k) : ''),
  }) as Record<string, string>;
  return [
  // --- services ---
  pub('services', 'svc-strategy', { icon: '🧭', title: 'Strategy & UX', summary: 'Research, positioning, and user journeys that turn visitors into customers.', price: 'from $4k' }),
  pub('services', 'svc-design', { icon: '🎨', title: 'Web Design', summary: 'Distinctive, on-brand interfaces designed pixel-perfect for every screen.', price: 'from $8k' }),
  pub('services', 'svc-build', { icon: '⚡', title: 'Development', summary: 'Hand-built, lightning-fast static sites with top Lighthouse scores.', price: 'from $10k' }),
  pub('services', 'svc-brand', { icon: '✨', title: 'Brand Identity', summary: 'Logos, type systems, and visual languages that scale across every touchpoint.', price: 'from $6k' }),
  pub('services', 'svc-seo', { icon: '📈', title: 'SEO & Performance', summary: 'Technical SEO, Core Web Vitals, and analytics wired in from day one.', price: 'from $3k' }),
  pub('services', 'svc-care', { icon: '🛟', title: 'Care Plans', summary: 'Ongoing edits, monitoring, and improvements so your site keeps earning.', price: '$450/mo' }),
  // --- services-de (German variant; auto-resolved on /de pages via `data.services`) ---
  pub('services-de', 'svc-strategy-de', { icon: '🧭', title: 'Strategie & UX', summary: 'Recherche, Positionierung und Nutzerführung, die Besucher zu Kunden machen.', price: 'ab 4.000 €' }),
  pub('services-de', 'svc-design-de', { icon: '🎨', title: 'Webdesign', summary: 'Unverwechselbare, markengerechte Oberflächen – pixelgenau für jedes Display.', price: 'ab 8.000 €' }),
  pub('services-de', 'svc-build-de', { icon: '⚡', title: 'Entwicklung', summary: 'Handgebaute, blitzschnelle statische Websites mit Top-Lighthouse-Werten.', price: 'ab 10.000 €' }),
  pub('services-de', 'svc-brand-de', { icon: '✨', title: 'Markenidentität', summary: 'Logos, Schriftsysteme und Bildsprachen, die über jeden Kanal skalieren.', price: 'ab 6.000 €' }),
  pub('services-de', 'svc-seo-de', { icon: '📈', title: 'SEO & Performance', summary: 'Technisches SEO, Core Web Vitals und Analytics – von Tag eins verdrahtet.', price: 'ab 3.000 €' }),
  pub('services-de', 'svc-care-de', { icon: '🛟', title: 'Wartungspakete', summary: 'Laufende Pflege, Monitoring und Verbesserungen, damit Ihre Website weiter liefert.', price: '450 €/Monat' }),
  // --- projects / work (images are LOCAL assets, seeded into the Projects/ media folder) ---
  pub('projects', 'proj-harbor', { title: 'Harbor & Co.', client: 'Harbor Coffee Roasters', category: 'E-commerce', summary: 'A flavour-led storefront that lifted online orders by 38%.', image: assets['proj-harbor'], year: '2025' }),
  pub('projects', 'proj-vela', { title: 'Vela Health', client: 'Vela', category: 'Healthcare', summary: 'A calm, accessible patient portal and marketing site.', image: assets['proj-vela'], year: '2025' }),
  pub('projects', 'proj-lumen', { title: 'Lumen Capital', client: 'Lumen', category: 'Finance', summary: 'A trustworthy, data-rich site for a boutique investment firm.', image: assets['proj-lumen'], year: '2024' }),
  pub('projects', 'proj-terra', { title: 'Terra Studio', client: 'Terra Architects', category: 'Portfolio', summary: 'An immersive, image-first showcase for an award-winning practice.', image: assets['proj-terra'], year: '2024' }),
  pub('projects', 'proj-flint', { title: 'Flint & Steel', client: 'Flint BBQ', category: 'Hospitality', summary: 'A mouth-watering site with online booking for a fast-growing chain.', image: assets['proj-flint'], year: '2024' }),
  pub('projects', 'proj-aria', { title: 'Aria Festival', client: 'Aria', category: 'Events', summary: 'A bold, high-energy festival site built to survive launch-day traffic.', image: assets['proj-aria'], year: '2023' }),
  // --- team ---
  pub('team', 'team-mara', { name: 'Mara Whitfield', role: 'Founder & Design Director', photo: assets['team-mara'], bio: 'Twelve years shaping brands for studios and startups.' }),
  pub('team', 'team-dev', { name: 'Devon Park', role: 'Lead Engineer', photo: assets['team-devon'], bio: 'Performance obsessive; ships sites that score 100.' }),
  pub('team', 'team-ines', { name: 'Inés Romero', role: 'UX Strategist', photo: assets['team-ines'], bio: 'Turns fuzzy goals into journeys that convert.' }),
  pub('team', 'team-sol', { name: 'Sol Nakamura', role: 'Brand Designer', photo: assets['team-sol'], bio: 'Builds type systems and logos with staying power.' }),
  // --- testimonials ---
  pub('testimonials', 'tst-1', { quote: 'Northwind rebuilt our site in six weeks and our enquiries doubled. They are the rare studio that gets both design and engineering right.', author: 'Priya Anand', role: 'CEO, Harbor Coffee' }),
  pub('testimonials', 'tst-2', { quote: 'The fastest, most thoughtful team we have worked with. Our Lighthouse scores went from the 40s to a perfect 100.', author: 'Marcus Lee', role: 'CMO, Lumen Capital' }),
  pub('testimonials', 'tst-3', { quote: 'They treated our brand like their own. The new site finally looks like the company we are becoming.', author: 'Elena Fischer', role: 'Founder, Terra Architects' }),
  // --- products (MINI SHOP demo: studio merch; `price` is a number, the cart formats it) ---
  pub('products', 'prod-tee', { sku: 'TEE-01', name: 'Studio Tee', price: 29, image: assets['proj-aria'], description: 'Soft heavyweight cotton tee with a subtle Northwind mark.' }),
  pub('products', 'prod-mug', { sku: 'MUG-01', name: 'Ceramic Mug', price: 14, image: assets['proj-flint'], description: 'A 12oz mug for late-night deploys.' }),
  pub('products', 'prod-notebook', { sku: 'NB-01', name: 'Dot-grid Notebook', price: 18, image: assets['proj-terra'], description: 'Lay-flat A5 notebook for sketching layouts.' }),
  pub('products', 'prod-poster', { sku: 'POS-01', name: 'Type Poster', price: 35, image: assets['proj-vela'], description: 'Risograph type-specimen print, A2.' }),
  pub('products', 'prod-stickers', { sku: 'STK-01', name: 'Sticker Pack', price: 8, image: assets['proj-harbor'], description: 'Six die-cut vinyl stickers for your laptop.' }),
  pub('products', 'prod-cap', { sku: 'CAP-01', name: 'Dad Cap', price: 24, image: assets['proj-lumen'], description: 'Low-profile six-panel cap with an embroidered mark.' }),
  ];
}
