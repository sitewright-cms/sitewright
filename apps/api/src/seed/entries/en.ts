import type { Entry } from '@sitewright/schema';
import { pub } from '../helpers.js';

// English (default-locale) dataset entries. The `assets` map resolves seeded image keys → local
// `/media/…` URLs ('' when an image failed to generate — see entries/index.ts).
export function entriesEn(assets: Record<string, string>): Entry[] {
  return [
  // --- services ---
  pub('services', 'svc-strategy', { icon: '🧭', title: 'Strategy & UX', summary: 'Research, positioning, and user journeys that turn visitors into customers.', price: 'from $4k' }),
  pub('services', 'svc-design', { icon: '🎨', title: 'Web Design', summary: 'Distinctive, on-brand interfaces designed pixel-perfect for every screen.', price: 'from $8k' }),
  pub('services', 'svc-build', { icon: '⚡', title: 'Development', summary: 'Hand-built, lightning-fast static sites with top Lighthouse scores.', price: 'from $10k' }),
  pub('services', 'svc-brand', { icon: '✨', title: 'Brand Identity', summary: 'Logos, type systems, and visual languages that scale across every touchpoint.', price: 'from $6k' }),
  pub('services', 'svc-seo', { icon: '📈', title: 'SEO & Performance', summary: 'Technical SEO, Core Web Vitals, and analytics wired in from day one.', price: 'from $3k' }),
  pub('services', 'svc-care', { icon: '🛟', title: 'Care Plans', summary: 'Ongoing edits, monitoring, and improvements so your site keeps earning.', price: '$450/mo' }),
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
  // --- testimonials (the home Carousel slides) ---
  pub('testimonials', 'tst-1', { quote: 'Northwind rebuilt our site in six weeks and our enquiries doubled. They are the rare studio that gets both design and engineering right.', author: 'Priya Anand', role: 'CEO, Harbor Coffee' }),
  pub('testimonials', 'tst-2', { quote: 'The fastest, most thoughtful team we have worked with. Our Lighthouse scores went from the 40s to a perfect 100.', author: 'Marcus Lee', role: 'CMO, Lumen Capital' }),
  pub('testimonials', 'tst-3', { quote: 'They treated our brand like their own. The new site finally looks like the company we are becoming.', author: 'Elena Fischer', role: 'Founder, Terra Architects' }),
  // --- products (MINI SHOP demo: studio merch; `price` is a number, the cart formats it) ---
  pub('products', 'prod-tee', { sku: 'TEE-01', name: 'Studio Tee', price: 29, image: assets['prod-tee'], description: 'Soft heavyweight cotton tee with a subtle Northwind mark.' }),
  pub('products', 'prod-mug', { sku: 'MUG-01', name: 'Ceramic Mug', price: 14, image: assets['prod-mug'], description: 'A 12oz mug for late-night deploys.' }),
  pub('products', 'prod-notebook', { sku: 'NB-01', name: 'Dot-grid Notebook', price: 18, image: assets['prod-notebook'], description: 'Lay-flat A5 notebook for sketching layouts.' }),
  pub('products', 'prod-poster', { sku: 'POS-01', name: 'Type Poster', price: 35, image: assets['prod-poster'], description: 'Risograph type-specimen print, A2.' }),
  pub('products', 'prod-stickers', { sku: 'STK-01', name: 'Sticker Pack', price: 8, image: assets['prod-stickers'], description: 'Six die-cut vinyl stickers for your laptop.' }),
  pub('products', 'prod-cap', { sku: 'CAP-01', name: 'Dad Cap', price: 24, image: assets['prod-cap'], description: 'Low-profile six-panel cap with an embroidered mark.' }),
  // --- faq (native-details Accordion; answers are RICHTEXT — sanitized at render) ---
  pub('faq', 'faq-timeline', { question: 'How long does a typical project take?', answer: '<p>Most marketing sites launch in <strong>4–8 weeks</strong> from kick-off: one to two weeks of strategy and design, two to four of build and content, and a final week of polish, QA, and launch.</p>' }),
  pub('faq', 'faq-cost', { question: 'What does a website cost?', answer: '<p>Projects start around <strong>$5k</strong> for a focused one-pager and run to $25k+ for larger sites — see our <a href="/services/pricing">pricing</a> for honest, fixed-scope numbers.</p>' }),
  pub('faq', 'faq-editing', { question: 'Can we edit the site ourselves?', answer: '<p>Yes — every site ships with an editor your team can use without touching code: text, images, blog posts, products, and datasets are all yours to change.</p>' }),
  pub('faq', 'faq-hosting', { question: 'Where is the site hosted?', answer: '<p>Anywhere you like. We export plain, portable static files — they run on any host or CDN, with no vendor lock-in.</p><ul><li>Your existing hosting</li><li>A global CDN we set up for you</li><li>Even a simple SFTP webspace</li></ul>' }),
  pub('faq', 'faq-after', { question: 'What happens after launch?', answer: '<p>Either you take the keys, or a <strong>Care plan</strong> keeps us on board for edits, monitoring, and continuous improvement — cancel any month.</p>' }),
  // --- plans (pricing Tabs: project work vs monthly care; `features` is a JSON array) ---
  pub('plans', 'plan-launch', { name: 'Launch', price: 4800, period: 'per project', monthly: false, featured: false, blurb: 'A focused one-pager that gets you live fast.', features: ['One-page site', 'Copy polish', 'Launch in 3 weeks', 'Technical SEO basics'] }),
  pub('plans', 'plan-growth', { name: 'Growth', price: 9800, period: 'per project', monthly: false, featured: true, blurb: 'The full marketing site most clients need.', features: ['Up to 10 pages', 'Design system', 'Blog + CMS datasets', 'Analytics & SEO', '30 days of support'] }),
  pub('plans', 'plan-flagship', { name: 'Flagship', price: 24000, period: 'per project', monthly: false, featured: false, blurb: 'Strategy-led, multi-language, e-commerce-ready.', features: ['Unlimited pages', 'Brand identity', 'Multi-language', 'Shop & forms', 'Priority team'] }),
  pub('plans', 'plan-care', { name: 'Care', price: 450, period: 'per month', monthly: true, featured: false, blurb: 'Keep the site healthy and current.', features: ['Monthly edits', 'Uptime & speed monitoring', 'Dependency updates'] }),
  pub('plans', 'plan-care-plus', { name: 'Care Plus', price: 950, period: 'per month', monthly: true, featured: true, blurb: 'Continuous improvement, not just upkeep.', features: ['Everything in Care', 'A/B experiments', 'Quarterly UX review', 'Same-day fixes'] }),
  // --- roles (careers: select/boolean/date/richtext + a REFERENCE to the hiring manager) ---
  pub('roles', 'role-designer', { title: 'Senior Product Designer', dept: 'Design', location: 'San Francisco', remote: true, posted: '2026-05-18', manager: 'team-mara', description: '<p>You will own design from first sketch to shipped site — systems thinking, sharp typography, and the judgment to keep things simple.</p><ul><li>5+ years designing for the web</li><li>Portfolio of shipped marketing sites</li><li>Comfortable working directly with clients</li></ul>' }),
  pub('roles', 'role-engineer', { title: 'Front-end Engineer', dept: 'Engineering', location: 'San Francisco', remote: true, posted: '2026-05-02', manager: 'team-dev', description: '<p>You sweat the last 100ms. Semantic HTML, modern CSS, and a deep suspicion of unnecessary JavaScript.</p><ul><li>Strong HTML/CSS fundamentals</li><li>Performance budgets as a habit</li><li>Accessibility is non-negotiable to you</li></ul>' }),
  pub('roles', 'role-strategist', { title: 'Content Strategist', dept: 'Strategy', location: 'San Francisco', remote: false, posted: '2026-04-20', manager: 'team-ines', description: '<p>You turn fuzzy positioning into pages that read clearly and convert — sitemaps, messaging, and copy direction.</p><ul><li>3+ years in content or brand strategy</li><li>Writing samples that sell without shouting</li></ul>' }),
  ];
}
