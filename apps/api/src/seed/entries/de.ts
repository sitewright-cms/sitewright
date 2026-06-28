import type { Entry } from '@sitewright/schema';
import { pub } from '../helpers.js';

// German dataset entries — the `_de` twins auto-resolved on `/de` pages (`{{#each dataset.services}}`
// → `services_de`). Dataset slugs use underscore (a Handlebars path); entry ids may still be hyphenated
// (`svc-strategy-de`). `roles_de` manager references point at `team-de` entry ids so the keyed
// `{{item.team.…}}` lookup resolves. Prices stay in USD for the shop; service/plan prices are localized.
export function entriesDe(assets: Record<string, string>): Entry[] {
  return [
  // --- services-de ---
  pub('services_de', 'svc_strategy_de', { icon: 'compass', title: 'Strategie & UX', summary: 'Recherche, Positionierung und Nutzerführung, die Besucher zu Kunden machen.', price: 'ab 4.000 $' }),
  pub('services_de', 'svc_design_de', { icon: 'palette', title: 'Webdesign', summary: 'Unverwechselbare, markengerechte Oberflächen – pixelgenau für jedes Display.', price: 'ab 8.000 $' }),
  pub('services_de', 'svc_build_de', { icon: 'code', title: 'Entwicklung', summary: 'Handgebaute, blitzschnelle statische Websites mit Top-Lighthouse-Werten.', price: 'ab 10.000 $' }),
  pub('services_de', 'svc_brand_de', { icon: 'pen-tool', title: 'Markenidentität', summary: 'Logos, Schriftsysteme und Bildsprachen, die über jeden Kanal skalieren.', price: 'ab 6.000 $' }),
  pub('services_de', 'svc_seo_de', { icon: 'trending-up', title: 'SEO & Performance', summary: 'Technisches SEO, Core Web Vitals und Analytics – von Tag eins verdrahtet.', price: 'ab 3.000 $' }),
  pub('services_de', 'svc_care_de', { icon: 'life-buoy', title: 'Wartungspakete', summary: 'Laufende Pflege, Monitoring und Verbesserungen, damit Ihre Website weiter liefert.', price: '450 $/Monat' }),
  // --- projects-de (titles/clients shared; categories + summaries localized) ---
  pub('projects_de', 'proj_harbor_de', { title: 'Harbor & Co.', client: 'Harbor Coffee Roasters', category: 'E-Commerce', summary: 'Ein genussgetriebener Shop, der die Online-Bestellungen um 38 % steigerte.', image: assets['proj-harbor'], year: '2025' }),
  pub('projects_de', 'proj_vela_de', { title: 'Vela Health', client: 'Vela', category: 'Gesundheit', summary: 'Ein ruhiges, barrierearmes Patientenportal samt Marketing-Site.', image: assets['proj-vela'], year: '2025' }),
  pub('projects_de', 'proj_lumen_de', { title: 'Lumen Capital', client: 'Lumen', category: 'Finanzen', summary: 'Eine vertrauenswürdige, datenreiche Website für eine Investment-Boutique.', image: assets['proj-lumen'], year: '2024' }),
  pub('projects_de', 'proj_terra_de', { title: 'Terra Studio', client: 'Terra Architects', category: 'Portfolio', summary: 'Eine immersive, bildstarke Werkschau für ein preisgekröntes Büro.', image: assets['proj-terra'], year: '2024' }),
  pub('projects_de', 'proj_flint_de', { title: 'Flint & Steel', client: 'Flint BBQ', category: 'Gastronomie', summary: 'Eine appetitanregende Website mit Online-Reservierung für eine wachsende Kette.', image: assets['proj-flint'], year: '2024' }),
  pub('projects_de', 'proj_aria_de', { title: 'Aria Festival', client: 'Aria', category: 'Events', summary: 'Eine mutige, energiegeladene Festival-Site, die dem Launch-Ansturm standhält.', image: assets['proj-aria'], year: '2023' }),
  // --- team-de (names shared; roles + bios localized) ---
  pub('team_de', 'team_mara_de', { name: 'Mara Whitfield', role: 'Gründerin & Design-Direktorin', photo: assets['team-mara'], bio: 'Zwölf Jahre Markenarbeit für Studios und Start-ups.' }),
  pub('team_de', 'team_dev_de', { name: 'Devon Park', role: 'Leitender Entwickler', photo: assets['team-devon'], bio: 'Performance-besessen; liefert Websites mit glatten 100 Punkten.' }),
  pub('team_de', 'team_ines_de', { name: 'Inés Romero', role: 'UX-Strategin', photo: assets['team-ines'], bio: 'Macht aus vagen Zielen Nutzerwege, die konvertieren.' }),
  pub('team_de', 'team_sol_de', { name: 'Sol Nakamura', role: 'Brand-Designer', photo: assets['team-sol'], bio: 'Baut Schriftsysteme und Logos mit Bestand.' }),
  // --- testimonials-de ---
  pub('testimonials_de', 'tst_1_de', { quote: 'Northwind hat unsere Website in sechs Wochen neu gebaut – und unsere Anfragen haben sich verdoppelt. Das seltene Studio, das Design und Technik gleichermaßen beherrscht.', author: 'Priya Anand', role: 'CEO, Harbor Coffee' }),
  pub('testimonials_de', 'tst_2_de', { quote: 'Das schnellste, umsichtigste Team, mit dem wir je gearbeitet haben. Unsere Lighthouse-Werte stiegen von 40 auf glatte 100.', author: 'Marcus Lee', role: 'CMO, Lumen Capital' }),
  pub('testimonials_de', 'tst_3_de', { quote: 'Sie haben unsere Marke behandelt wie ihre eigene. Die neue Website sieht endlich aus wie das Unternehmen, das wir werden.', author: 'Elena Fischer', role: 'Gründerin, Terra Architects' }),
  // --- products-de (USD prices shared — one merchant currency) ---
  pub('products_de', 'prod_tee_de', { sku: 'TEE-01', name: 'Studio-Shirt', price: 29, image: assets['prod-tee'], description: 'Weiches Heavyweight-Baumwollshirt mit dezentem Northwind-Zeichen.' }),
  pub('products_de', 'prod_mug_de', { sku: 'MUG-01', name: 'Keramiktasse', price: 14, image: assets['prod-mug'], description: 'Eine 350-ml-Tasse für nächtliche Deploys.' }),
  pub('products_de', 'prod_notebook_de', { sku: 'NB-01', name: 'Punktraster-Notizbuch', price: 18, image: assets['prod-notebook'], description: 'Flach aufliegendes A5-Notizbuch für Layout-Skizzen.' }),
  pub('products_de', 'prod_poster_de', { sku: 'POS-01', name: 'Typo-Poster', price: 35, image: assets['prod-poster'], description: 'Risographie-Schriftmusterdruck, A2.' }),
  pub('products_de', 'prod_stickers_de', { sku: 'STK-01', name: 'Sticker-Set', price: 8, image: assets['prod-stickers'], description: 'Sechs gestanzte Vinyl-Sticker für Ihren Laptop.' }),
  pub('products_de', 'prod_cap_de', { sku: 'CAP-01', name: 'Cap', price: 24, image: assets['prod-cap'], description: 'Flache Sechs-Panel-Cap mit gesticktem Zeichen.' }),
  // --- faq-de ---
  pub('faq_de', 'faq_timeline_de', { question: 'Wie lange dauert ein typisches Projekt?', answer: '<p>Die meisten Marketing-Websites gehen <strong>4–8 Wochen</strong> nach Kick-off live: ein bis zwei Wochen Strategie und Design, zwei bis vier für Umsetzung und Inhalte, eine letzte Woche für Feinschliff, QA und Launch.</p>' }),
  pub('faq_de', 'faq_cost_de', { question: 'Was kostet eine Website?', answer: '<p>Projekte beginnen bei rund <strong>5.000 $</strong> für einen fokussierten One-Pager und reichen bis 25.000 $+ für größere Auftritte — ehrliche Festpreise finden Sie unter <a href="/de/leistungen/preise">Preise</a>.</p>' }),
  pub('faq_de', 'faq_editing_de', { question: 'Können wir die Website selbst bearbeiten?', answer: '<p>Ja — jede Website kommt mit einem Editor, den Ihr Team ohne Code nutzt: Texte, Bilder, Blogbeiträge, Produkte und Datensätze gehören Ihnen.</p>' }),
  pub('faq_de', 'faq_hosting_de', { question: 'Wo wird die Website gehostet?', answer: '<p>Wo Sie möchten. Wir exportieren portable statische Dateien — sie laufen auf jedem Host oder CDN, ganz ohne Vendor-Lock-in.</p><ul><li>Ihr bestehendes Hosting</li><li>Ein globales CDN, das wir einrichten</li><li>Sogar ein einfacher SFTP-Webspace</li></ul>' }),
  pub('faq_de', 'faq_after_de', { question: 'Was passiert nach dem Launch?', answer: '<p>Entweder übernehmen Sie die Schlüssel, oder ein <strong>Wartungspaket</strong> hält uns an Bord — für Änderungen, Monitoring und stetige Verbesserung. Monatlich kündbar.</p>' }),
  // --- plans-de ---
  pub('plans_de', 'plan_launch_de', { name: 'Launch', price: 4800, display: '4.800 $', period: 'pro Projekt', monthly: false, featured: false, blurb: 'Ein fokussierter One-Pager, der Sie schnell live bringt.', features: ['One-Page-Website', 'Textfeinschliff', 'Launch in 3 Wochen', 'Technische SEO-Basis'] }),
  pub('plans_de', 'plan_growth_de', { name: 'Growth', price: 9800, display: '9.800 $', period: 'pro Projekt', monthly: false, featured: true, blurb: 'Die vollständige Marketing-Website, die die meisten brauchen.', features: ['Bis zu 10 Seiten', 'Designsystem', 'Blog + CMS-Datensätze', 'Analytics & SEO', '30 Tage Support'] }),
  pub('plans_de', 'plan_flagship_de', { name: 'Flagship', price: 24000, display: '24.000 $', period: 'pro Projekt', monthly: false, featured: false, blurb: 'Strategiegeführt, mehrsprachig, shop-bereit.', features: ['Unbegrenzte Seiten', 'Markenidentität', 'Mehrsprachigkeit', 'Shop & Formulare', 'Prioritäts-Team'] }),
  pub('plans_de', 'plan_care_de', { name: 'Care', price: 450, display: '450 $', period: 'pro Monat', monthly: true, featured: false, blurb: 'Hält die Website gesund und aktuell.', features: ['Monatliche Änderungen', 'Uptime- & Speed-Monitoring', 'Dependency-Updates'] }),
  pub('plans_de', 'plan_care_plus_de', { name: 'Care Plus', price: 950, display: '950 $', period: 'pro Monat', monthly: true, featured: true, blurb: 'Stetige Verbesserung statt bloßer Pflege.', features: ['Alles aus Care', 'A/B-Experimente', 'Quartalsweises UX-Review', 'Fixes am selben Tag'] }),
  // --- roles-de (manager → team-de entry ids) ---
  pub('roles_de', 'role_designer_de', { title: 'Senior Product Designer (m/w/d)', dept: 'Design', location: 'San Francisco', remote: true, posted: '2026-05-18', manager: 'team_mara_de', description: '<p>Sie verantworten Design vom ersten Entwurf bis zur ausgelieferten Website — Systemdenken, präzise Typografie und das Urteilsvermögen, es einfach zu halten.</p><ul><li>5+ Jahre Webdesign-Erfahrung</li><li>Portfolio ausgelieferter Marketing-Websites</li><li>Direkte Zusammenarbeit mit Kunden gewohnt</li></ul>' }),
  pub('roles_de', 'role_engineer_de', { title: 'Front-end Engineer (m/w/d)', dept: 'Engineering', location: 'San Francisco', remote: true, posted: '2026-05-02', manager: 'team_dev_de', description: '<p>Sie kämpfen um die letzten 100 ms. Semantisches HTML, modernes CSS und ein gesundes Misstrauen gegenüber unnötigem JavaScript.</p><ul><li>Starke HTML/CSS-Grundlagen</li><li>Performance-Budgets als Gewohnheit</li><li>Barrierefreiheit ist für Sie nicht verhandelbar</li></ul>' }),
  pub('roles_de', 'role_strategist_de', { title: 'Content-Stratege (m/w/d)', dept: 'Strategy', location: 'San Francisco', remote: false, posted: '2026-04-20', manager: 'team_ines_de', description: '<p>Sie übersetzen unscharfe Positionierung in Seiten, die klar lesen und konvertieren — Sitemaps, Messaging und Textregie.</p><ul><li>3+ Jahre Content- oder Markenstrategie</li><li>Schreibproben, die verkaufen, ohne zu schreien</li></ul>' }),
  ];
}
