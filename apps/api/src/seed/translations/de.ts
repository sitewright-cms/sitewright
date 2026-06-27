import type { PageTranslationSeed } from '../pages/variants.js';
import { translationsDeContent } from './de-content.js';

// ---------------------------------------------------------------- GERMAN translations
// One seed per English page (keyed by OWNER id): the localized slug, titles, and the variant's
// complete `page.data` — every data-sw-text/html key the inherited code binds, the data-sw-href
// link targets (pointing at the GERMAN routes — the publish link-rebase does not locale-prefix),
// and the tier-2 attribute/config keys (alt/aria/refs — these exist in EVERY locale, incl. en).
// Long-form content (blog articles, legal bodies) lives in de-content.ts.
export function translationsDe(assets: Record<string, string>): Record<string, PageTranslationSeed> {
  return {
  home: {
    title: 'Northwind Web Studio — Websites, die Geschäft bringen',
    navTitle: 'Start',
    description: 'Boutique-Webstudio in San Francisco: Strategie, Design und handgebaute statische Websites, die Ihnen mehr Geschäft bringen.',
    data: {
      stat1_n: '120+',
      stat2_n: '9',
      stat3_n: '100',
      stat4_n: '38%',
      spotlight: 'proj-harbor-de',
      href_contact: '/de/kontakt',
      href_work: '/de/arbeiten',
    },
  },
  work: {
    path: 'arbeiten',
    title: 'Unsere Arbeiten',
    navTitle: 'Arbeiten',
    description: 'Aktuelle Websites aus Handel, Gesundheit, Finanzen und Kultur — jede handgebaut und schnell.',
    data: {
    },
  },
  services: {
    path: 'leistungen',
    title: 'Leistungen',
    navTitle: 'Leistungen',
    description: 'Strategie, Design, Entwicklung, Marke, SEO und Wartung — durchgängig oder pro Phase.',
    data: {
      href_contact: '/de/kontakt',
    },
  },
  'service-web-design': {
    path: 'webdesign',
    title: 'Webdesign',
    description: 'Unverwechselbare, markengerechte Oberflächen — pixelgenau für jedes Display.',
    data: {
      svc_ref: 'svc-design-de',
      href_contact: '/de/kontakt',
    },
  },
  'service-seo': {
    path: 'seo',
    title: 'SEO & Performance',
    description: 'Technisches SEO, Core Web Vitals und Analytics — von Tag eins verdrahtet.',
    data: {
      svc_ref: 'svc-seo-de',
      href_contact: '/de/kontakt',
    },
  },
  'service-pricing': {
    path: 'preise',
    title: 'Preise',
    description: 'Ehrliche Festpreise für Projektarbeit und monatliche Wartungspakete.',
    data: {
      href_contact: '/de/kontakt',
      href_faq: '/de/faq',
    },
  },
  about: {
    path: 'ueber-uns',
    title: 'Über uns',
    navTitle: 'Über uns',
    description: 'Ein kleines, erfahrenes Team aus Designern und Entwicklern — mit Absicht.',
    data: {
      gallery_folder: 'Studio',
    },
  },
  careers: {
    path: 'karriere',
    title: 'Karriere',
    description: 'Offene Stellen bei Northwind — kleines Team, anspruchsvolle Arbeit, kein Unsinn.',
    data: {
      href_contact: '/de/kontakt',
    },
  },
  contact: {
    path: 'kontakt',
    title: 'Kontakt',
    navTitle: 'Kontakt',
    description: 'Erzählen Sie uns von Ihrem Projekt — wir antworten innerhalb eines Werktags.',
    data: {
      c_modal_b: '<p>Wir fragen nach Ihren Zielen, Ihrem Zeitplan und danach, wie „funktioniert“ in einem Jahr aussieht. Sie fragen uns, was immer Sie wollen.</p><p>Passt es, bekommen Sie binnen zwei Tagen ein Festpreisangebot. Passt es nicht, sagen wir das ehrlich — und empfehlen Ihnen jemand Gutes.</p>',
    },
  },
  components: {
    path: 'komponenten',
    title: 'Komponenten',
    navTitle: 'Komponenten',
    description:
      'Die interaktiven First-Party-Komponenten dieser Website — Slider und Lightbox-Galerien — jeweils in allen Varianten, die die Plattform mitbringt.',
    data: {
    },
  },
  'comp-slider': {
    path: 'slider',
    title: 'Slider',
    navTitle: 'Slider',
    description:
      'Das Carousel in jedem Modus — Hero, Fade, Slide, Mehrkarten-Peek, Ausrichtung, Auto-Scroll-Ticker, Mausrad + automatische Höhe und Klick-zum-Blättern.',
    data: {
    },
  },
  'comp-lightbox': {
    path: 'lightbox',
    title: 'Lightbox',
    navTitle: 'Lightbox',
    description:
      'Der bildschirmfüllende Galerie-Viewer — eine Thumbnail-Leiste, eine Vergrößern-aus-dem-Thumbnail-Animation beim Öffnen, ein Bildzähler + Bildunterschrift, Tastatur + Wischen + Pinch-Zoom, plus Schalter für Leiste, Pfeile, Anpassung und mehr.',
    data: {
      aria_single: 'Ausgewähltes Bild',
    },
  },
  'comp-tabs': {
    path: 'tabs',
    title: 'Tabs',
    navTitle: 'Tabs',
    description:
      'Inhalts-Panels hinter einer barrierefreien Tableiste — Navigation per Pfeiltasten, die Schaltflächen aus jedem Panel-Titel erzeugt, und ein No-JS-Fallback, der alle Panels untereinander stapelt.',
    data: {
      rstat1_n: '0',
      rstat2_n: '100 %',
    },
  },
  'comp-modal': {
    path: 'modal',
    title: 'Modal',
    navTitle: 'Modal',
    description:
      'Eine Schaltfläche, die einen nativen Dialog öffnet — Fokusfalle, Escape, Backdrop und das Inaktivschalten des Hintergrunds liefert der Browser; die Größe bestimmt eine einzige Klasse.',
    data: {
    },
  },
  'comp-cookie': {
    path: 'cookie-consent',
    title: 'Cookie-Hinweis',
    navTitle: 'Cookie-Hinweis',
    description:
      'Ein Einwilligungsbanner, das in localStorage gespeichert wird — verborgen ausgeliefert, beim ersten Besuch einmal eingeblendet und nach der Zustimmung endgültig ausgeblendet. Eine Skeleton-Slot-Komponente, die site-weit läuft.',
    data: {
    },
  },
  'comp-parallax': {
    path: 'parallax',
    title: 'Parallax',
    navTitle: 'Parallax',
    description:
      'Bewegung, Blende, Skalierung und Unschärfe aus dem Scrollen — eine winzige Laufzeit, gesteuert über data-sw-parallax-Attribute. Jeder Effekt ist an sein eigenes Fenster des Viewport-Durchlaufs verankert (mit optionaler Aus-Phase), und Tiefenszenen stapeln absolut positionierte Ebenen. Standardmäßig dezent und bei reduzierter Bewegung abgeschaltet.',
    data: {
      px_intro:
        'Bewegung aus dem Scrollen. Füge einem beliebigen Element ein data-sw-parallax-*-Attribut hinzu, und die Plattform liefert eine winzige Laufzeit, die es beim Durchlaufen des Viewports verschiebt, ein-/ausblendet, skaliert oder weichzeichnet — jeder Effekt an sein eigenes Fenster verankert, kombinierbar, begrenzt und für Besucher mit reduzierter Bewegung vollständig abgeschaltet. Scroll nach unten.',
      hero_t: 'Tiefenszene',
      hero_d: 'Ein beschnittener Container gestapelter Ebenen — Hintergrund und Überschrift bewegen sich unterschiedlich schnell.',
      depth_t: 'Tiefe — eine von→bis-Bewegung',
      depth_d:
        'data-sw-parallax-translate="von,bis" verschiebt ein Element beim Durchlaufen des Viewports zwischen zwei Pixel-Offsets. Größere Offsets wirken näher; gegenläufige Richtungen erzeugen Tiefe. Beobachte, wie die Karten unterschiedlich schnell wandern.',
      c1: 'Vordergrund',
      c2: 'statisch',
      c3: 'Hintergrund',
      fx_t: 'Blende · Skalierung · Unschärfe',
      fx_d:
        'Jeder zusätzliche Kanal interpoliert von,bis über sein Fenster — data-sw-parallax-opacity, -scale und -blur — und sie lassen sich auf einem Element kombinieren.',
      t_fade: 'Blendet beim Aufsteigen ein',
      t_scale: 'Wächst beim Hochscrollen',
      t_blur: 'Kommt in den Fokus',
      anchor_t: 'Das Fenster verankern — und wieder ausblenden',
      anchor_d:
        'Standardmäßig läuft ein Effekt über den gesamten Durchlauf, erreicht seinen Höhepunkt also erst beim Verlassen oben. Füge -<effekt>-range="0,0.5" hinzu, um ihn zu beenden, während das Element zentriert ist; ein kürzeres Fenster lässt Raum für eine -<effekt>-out-Phase, die es wieder ausblendet.',
      t_window: 'Volle Deckkraft bis zur Mitte (-opacity-range="0,0.5")',
      t_inout: 'Blendet bis zur Mitte ein, dann wieder aus',
      nojs_t: 'Ohne JavaScript (oder bei reduzierter Bewegung)',
      nojs_d:
        'Jedes Element bleibt genau dort, wo es im Dokument steht — die Laufzeit fügt nur eine Transformation/Deckkraft/Filter darüber hinzu, sodass nichts verrutscht, überlappt oder verschwindet. Parallax ist Dekoration, niemals Struktur.',
    },
  },
  'comp-forms': {
    path: 'forms',
    title: 'Formulare',
    navTitle: 'Formulare',
    description:
      'Bette ein konfiguriertes Formular mit einem einzigen Tag überall ein — Felder, Validierung, Spam-Schutz und Inline-Erfolg werden für dich erzeugt, und die richtige Sprache wird automatisch gewählt.',
    data: {
    },
  },
  'comp-datetimepicker': {
    path: 'datetimepicker',
    title: 'Datums- & Zeitauswahl',
    navTitle: 'Datumsauswahl',
    description:
      'Ein CI-gestylter Kalender mit Schieberegler-Zeitauswahl auf einem einfachen Textfeld — Datum, ein zweimonatiger Zeitraum mit Doppelpanel, Datum+Zeit und Uhrzeit, alle aus einem Attribut, mit voller data-*-Kontrolle und einem No-JS-Fallback.',
    data: {
    },
  },
  faq: {
    path: 'faq',
    title: 'FAQ',
    navTitle: 'FAQ',
    description: 'Antworten auf die Fragen, mit denen jedes Projekt beginnt: Zeitplan, Kosten, Bearbeitung, Hosting.',
    data: {
      href_contact: '/de/kontakt',
    },
  },
  shop: {
    path: 'shop',
    title: 'Studio-Merch — Northwind-Shop',
    navTitle: 'Shop',
    description: 'Studio-Merch für Web-Nerds — in den Warenkorb legen und per WhatsApp, E-Mail oder Zahlungslink bestellen.',
    data: {
      heading: 'Studio-Merch',
      intro: 'Eine Kleinigkeit für Web-Nerds. In den Warenkorb legen und per WhatsApp, E-Mail oder Zahlungslink bestellen.',
    },
  },
  'nav-audit': {
    title: '<span class="inline-flex items-center gap-1.5 font-semibold text-accent">{{sw-icon "sparkles" "h-4 w-4"}} Gratis Site-Check</span>',
  },
  ...translationsDeContent(assets),
  };
}
