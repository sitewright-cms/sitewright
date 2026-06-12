import type { PageTranslationSeed } from '../pages/variants.js';

// German LONG-FORM content: the fully translated blog (overview + 3 articles — content-only
// pages whose entire body is page.data) and the legal documents. Article dates/images carry
// over from the English originals (same asset, same date).
export function translationsDeContent(assets: Record<string, string>): Record<string, PageTranslationSeed> {
  return {
  blog: {
    path: 'blog',
    title: 'Blog',
    navTitle: 'Blog',
    description: 'Notizen zu Webdesign, Performance und Websites, die ihr Geld verdienen.',
    data: { heading: 'Aus dem Studio', intro: 'Notizen zu Webdesign, Performance und Websites, die ihr Geld verdienen.' },
  },
  'blog-static-speed': {
    path: 'warum-statische-websites-gewinnen',
    title: 'Warum statische Websites beim Tempo gewinnen',
    description: 'Ein statischer Aufbau hält Ihre Website schnell, günstig im Hosting und mühelos in der Pflege.',
    data: {
      article_kicker: 'Performance',
      article_title: 'Warum statische Websites beim Tempo gewinnen',
      article_excerpt: 'Ein statischer Aufbau hält Ihre Website schnell, günstig im Hosting und mühelos in der Pflege.',
      article_date: '2026-05-28',
      article_image: assets['blog-speed'] ?? '',
      article_body:
        '<p>Jede Millisekunde Ladezeit kostet Besucher. Eine vorgerenderte, statische Website liefert pures HTML, CSS und einen Hauch JS — kein Server, auf den man warten muss, die Seite erscheint fast sofort.</p>' +
        '<h2>Weniger bewegliche Teile</h2>' +
        '<p>Keine Datenbank, keine Laufzeitumgebung, kein Patchen. Die ganze Website ist ein Ordner voller Dateien, den jeder Host von einer CDN-Edge nahe Ihren Besuchern ausliefern kann.</p>' +
        '<ul><li>Top Core Web Vitals ab Werk</li><li>Günstiges, einfaches Hosting</li><li>Eine kleinere Angriffsfläche</li></ul>',
    },
  },
  'blog-design-systems': {
    path: 'designsysteme-die-skalieren',
    title: 'Designsysteme, die skalieren',
    description: 'Tokens und wiederverwendbare Komponenten halten eine wachsende Website konsistent — und schnell gebaut.',
    data: {
      article_kicker: 'Design',
      article_title: 'Designsysteme, die skalieren',
      article_excerpt: 'Tokens und wiederverwendbare Komponenten halten eine wachsende Website konsistent — und schnell gebaut.',
      article_date: '2026-04-14',
      article_image: assets['blog-design'] ?? '',
      article_body:
        '<p>Ein Designsystem ist das gemeinsame Vokabular von Design und Code: Farb-Tokens, Schriftskalen, Abstände und eine Bibliothek von Komponenten, zu der alle greifen.</p>' +
        '<p>Der Effekt verzinst sich. Sobald die Bausteine existieren, entstehen neue Seiten in Stunden — und eine Markenänderung zieht sich von einer einzigen Stelle aus durch alles.</p>',
    },
  },
  'blog-seo-foundations': {
    path: 'seo-grundlagen',
    title: 'SEO-Grundlagen — vom ersten Tag an',
    description: 'Sauberes Markup, strukturierte Daten und schnelle Seiten sind die SEO-Basics, die Rankings wirklich bewegen.',
    data: {
      article_kicker: 'SEO',
      article_title: 'SEO-Grundlagen — vom ersten Tag an',
      article_excerpt: 'Sauberes Markup, strukturierte Daten und schnelle Seiten sind die Basics, die Rankings wirklich bewegen.',
      article_date: '2026-03-02',
      article_image: assets['blog-seo'] ?? '',
      article_body:
        '<p>SEO ist kein Nachrüstsatz. Die schnelle, barrierearme, semantisch ausgezeichnete Website, die Sie launchen, ist genau die, die Suchmaschinen belohnen.</p>' +
        '<h2>Die Grundlagen richtig machen</h2>' +
        '<ul><li>Aussagekräftige Titel und Meta-Beschreibungen</li><li>Eine saubere, crawlbare URL-Struktur</li><li>Strukturierte Daten und eine korrekte Sitemap</li></ul>',
    },
  },
  privacy: {
    path: 'datenschutz',
    title: 'Datenschutzerklärung',
    navTitle: 'Datenschutz',
    data: {
      heading: 'Datenschutzerklärung',
      body:
        'Wir halten es einfach: Wir erheben nur, was uns das Kontaktformular sendet (Name, E-Mail, Nachricht), nutzen es ausschließlich zur Antwort und verkaufen oder teilen es niemals. ' +
        'Unser Hosting-Anbieter speichert übliche Zugriffsprotokolle (IP-Adresse, Zeitpunkt, Seite) für 14 Tage zu Sicherheitszwecken. ' +
        'Diese Website setzt genau ein Cookie — die Consent-Entscheidung selbst — und nutzt datenschutzfreundliche, cookielose Statistik. ' +
        'Sie können jederzeit Auskunft oder Löschung aller zu Ihnen gespeicherten Daten verlangen: hello@northwindstudio.com.',
    },
  },
  imprint: {
    path: 'impressum',
    title: 'Impressum',
    navTitle: 'Impressum',
    data: {
      heading: 'Impressum',
      body:
        'Northwind Web Studio Ltd. · 548 Market Street, Suite 200 · San Francisco, CA 94104 · USA. ' +
        'Vertreten durch Mara Whitfield (Gründerin & Design-Direktorin). ' +
        'Kontakt: hello@northwindstudio.com · +1 (415) 555-0142. ' +
        'Verantwortlich für den Inhalt: Mara Whitfield, Anschrift wie oben.',
    },
  },
  };
}
