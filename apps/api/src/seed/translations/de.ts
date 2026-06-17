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
      hero_alt: 'Eine aktuelle Northwind-Website',
      stat1_n: '120+',
      stat2_n: '9',
      stat3_n: '100',
      stat4_n: '38%',
      spotlight: 'proj-harbor-de',
      aria_prev: 'Vorherige Stimme',
      aria_next: 'Nächste Stimme',
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
      aria_caption: 'Projektgalerie',
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
      tab_projects: 'Projektarbeit',
      tab_care: 'Wartungspakete',
      pr_badge: 'Am beliebtesten',
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
      ab_img_alt: 'Das Northwind-Studio',
      gallery_folder: 'Studio',
      aria_gallery: 'Studiofotos',
    },
  },
  careers: {
    path: 'karriere',
    title: 'Karriere',
    description: 'Offene Stellen bei Northwind — kleines Team, anspruchsvolle Arbeit, kein Unsinn.',
    data: {
      badge_remote: 'Remote möglich',
      posted_l: 'Ausgeschrieben',
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
      c_close: 'Schließen',
    },
  },
  components: {
    path: 'komponenten',
    title: 'Komponenten',
    navTitle: 'Komponenten',
    description:
      'Die interaktiven First-Party-Komponenten dieser Website — Slider und Lightbox-Galerien — jeweils in allen Varianten, die die Plattform mitbringt.',
    data: {
      a_view: 'Ansehen',
    },
  },
  'comp-slider': {
    path: 'slider',
    title: 'Slider',
    navTitle: 'Slider',
    description:
      'Das Carousel in jedem Modus — Hero, Fade, Slide, Mehrkarten-Peek, Ausrichtung, Auto-Scroll-Ticker, Mausrad + automatische Höhe und Klick-zum-Blättern.',
    data: {
      a_prev: 'Vorherige Folie',
      a_next: 'Nächste Folie',
      sld_intro:
        'Eine Komponente, alle Konfigurationen. Jeder Slider unten ist reines deklaratives Markup — ein data-sw-component-Root, data-sw-part-Slots und data-*-Optionen.',
      sec_hero_t: 'Hero-Slider — ein einziges Include',
      sec_hero_d:
        'Der klassische Startseiten-Auftakt: Folien mit fester Höhe, Hintergrundbildern, abwechselndem Ken-Burns-Effekt und hereingleitenden Captions. Dieser ganze Block ist das hero-slider-Widget — einsetzen, dann seine Folien (Bilder + Captions) als Daten bearbeiten. Kein eigenes CSS.',
      sec_fade_t: 'Slider — die Standardeinstellungen',
      sec_fade_d: 'Ganz ohne Optionen: Die Folien überblenden sanft, die Pfeile liegen mittig links und rechts, die Indikatoren zentriert am unteren Rand.',
      aria_fade: 'Projekt-Slideshow (Fade)',
      sec_slide_t: 'Slide-Effekt, Endlosschleife, Autoplay',
      sec_slide_d: 'Die schiebende Leiste statt Überblendung — läuft endlos und wechselt von selbst; Hover oder Fokus pausiert.',
      aria_slide: 'Projekt-Slideshow (Slide)',
      sec_items_t: 'Mehrere Karten mit Peek',
      sec_items_d: 'Die Variable --sw-items bestimmt die Karten pro Ansicht; ein Bruchwert lässt eine Karte hereinschauen. data-item-align="center" zentriert die aktive Karte mit einem Ausblick auf beiden Seiten — erste und letzte rasten am Rand ein. Ziehen, wischen oder die Pfeile nutzen.',
      aria_items: 'Projektkarten',
      sec_align_t: 'Eine nicht volle Reihe ausrichten',
      sec_align_d: 'Werden weniger Elemente gezeigt, als die Reihe füllen, verteilt data-item-align sie horizontal — Anfang (Standard), Mitte oder Ende — statt sie links kleben zu lassen.',
      aria_align: 'Ausgewählte Werkzeuge (zentriert)',
      sec_scroll_t: 'Kontinuierlicher Auto-Scroll',
      sec_scroll_d: 'Ein gleichmäßiger Ticker statt einzelner Schritte — gemacht für Logoleisten und Bildbänder. Pausiert bei Hover oder Fokus.',
      aria_scroll: 'Projekt-Ticker',
      sec_wheel_t: 'Mausrad-Gesten & automatische Höhe',
      sec_wheel_d: 'Mausrad oder Trackpad über dem Slider bewegt ihn; die Leiste passt ihre Höhe animiert an jedes Zitat an.',
      aria_wheel: 'Kundenstimmen',
      sec_click_t: 'Klicken zum Weiterblättern',
      sec_click_d:
        'Ganz ohne Pfeile: Ein Klick oder Tipp irgendwo auf die Folie blättert weiter — jeder Druck antwortet mit einem Ripple. Links in der Folie bleiben Links, Ziehen wischt weiterhin, und die Pfeiltasten funktionieren, sobald der Slider den Fokus hat.',
      aria_click: 'Projekt-Highlights (Klick blättert weiter)',
    },
  },
  'comp-lightbox': {
    path: 'lightbox',
    title: 'Lightbox',
    navTitle: 'Lightbox',
    description:
      'Der bildschirmfüllende Galerie-Viewer — eine Thumbnail-Leiste, eine Vergrößern-aus-dem-Thumbnail-Animation beim Öffnen, ein Bildzähler + Bildunterschrift, Tastatur + Wischen + Pinch-Zoom, plus Schalter für Leiste, Pfeile, Anpassung und mehr.',
    data: {
      lb_intro:
        'Ein Fotoraster, das sich beim Klick bildschirmfüllend öffnet — das Bild vergrößert sich aus seiner Kachel, eine Thumbnail-Leiste und ein Bildzähler kommen mit, und Wischen / Pinch-Zoom / Tastatur funktionieren alle. Der Fokus kehrt beim Schließen zur Kachel zurück.',
      sec_lb_t: 'Lightbox — die Standardeinstellungen',
      sec_lb_d: 'Klicke auf ein Foto: Es vergrößert sich aus seiner Kachel in einen bildschirmfüllenden Viewer mit Thumbnail-Leiste, Bildzähler und Bildunterschrift. Wischen oder Pinch auf Touch, Pfeiltasten am Rechner, Escape zum Schließen.',
      aria_gallery: 'Studio-Galerie',
      sec_lbfx_t: 'Lightbox — reduziert',
      sec_lbfx_d: 'Dieselbe Galerie mit ausgeschalteter Thumbnail-Leiste und Pfeilen — ein klarerer Viewer, allein per Wischen, Tastatur und Zähler gesteuert.',
      aria_gallery2: 'Projektgalerie',
      sec_lb3_t: 'Lightbox — bildschirmfüllend',
      sec_lb3_d: 'Die Anpassung kann den Viewport füllen statt das ganze Bild zu zeigen, die Öffnen-Animation lässt sich abschalten, und das geöffnete Bild kann in der URL gespiegelt werden. Auf dem Smartphone kann das gezoomte Bild per Geräteneigung schwenken.',
      aria_gallery3: 'Studio-Galerie, bildschirmfüllend',
      sec_single_t: 'Lightbox — ein einzelnes Bild (eine Zeile)',
      sec_single_d:
        'Kein Raster-Gerüst nötig: Setze data-sw-component="lightbox" direkt auf ein <img>, und dieses eine Bild öffnet sich beim Klick bildschirmfüllend — die ganze Lightbox in einer einzigen Zeile.',
      aria_single: 'Ausgewähltes Bild',
      sec_masonry_t: 'Lightbox — Masonry-Raster',
      sec_masonry_d:
        'Bilder unterschiedlicher Seitenverhältnisse — Hochformate, Querformate und breite Cover — versetzt in ausgewogene CSS-Spalten, ohne Beschnitt. Das Attribut steht direkt auf dem Spalten-Container; die Bilder werden zu einer Galerie.',
      aria_masonry: 'Masonry-Galerie',
      sec_group_t: 'Lightbox — eine Galerie aus getrennten Bildern',
      sec_group_d:
        'Diese Bilder sind eigenständige Elemente in eigenen Karten, aber ein gemeinsamer data-gallery-Name fasst sie zu einer Lightbox zusammen — klicke auf eines und blättere durch beide. Das funktioniert auch über verschiedene Abschnitte der Seite hinweg.',
    },
  },
  'comp-tabs': {
    path: 'tabs',
    title: 'Tabs',
    navTitle: 'Tabs',
    description:
      'Inhalts-Panels hinter einer barrierefreien Tableiste — Navigation per Pfeiltasten, die Schaltflächen aus jedem Panel-Titel erzeugt, und ein No-JS-Fallback, der alle Panels untereinander stapelt.',
    data: {
      tab_intro:
        'Eine Komponente, beliebiger Inhalt. Ein Tabs-Root mit einem Tablist-Slot und einem Panel pro Tab — die Runtime liest den Titel jedes Panels, erzeugt die Schaltflächen, verdrahtet die Pfeiltasten und stapelt ohne JavaScript alles lesbar untereinander.',
      sec_basic_t: 'Tab-Beschriftungen — schlicht oder mit Markup',
      sec_basic_d:
        'Jedes Panel bekommt eine Beschriftung: ein einfaches data-sw-title oder ein optionales data-sw-part="tabtitle"-Kind für ein Icon oder anderes HTML. Das gilt pro Tab, du kannst also mischen — hier sind die ersten beiden Tabs mit Markup und der dritte schlicht. Auf einen Tab klicken oder einen fokussieren und die Pfeiltasten nutzen.',
      tab1: 'Überblick',
      body1:
        'Tabs bündeln zusammengehörige Inhalte auf engem Raum — der Besucher sieht jeweils ein Panel und wechselt dazwischen, ohne die Seite zu verlassen.',
      tab2: 'So funktioniert’s',
      body2:
        'Gib jedem Panel einen Titel und seinen Inhalt. Die Runtime erzeugt die barrierefreie Tableiste, verknüpft jede Schaltfläche mit ihrem Panel und bewegt den Fokus mit den Pfeiltasten (Pos1 und Ende springen zum ersten und letzten).',
      tab3: 'Barrierefreiheit',
      body3:
        'Das Markup folgt dem WAI-ARIA-Tabs-Muster: eine Tableiste aus Schaltflächen, die je ein beschriftetes Tabpanel steuern. Roving tabindex bedeutet, dass Tab in das aktive Panel führt, statt durch jede Schaltfläche zu wandern.',
      sec_rich_t: 'Panels nehmen beliebiges Markup auf',
      sec_rich_d:
        'Ein Panel ist nur ein Container — setze eine Liste, ein Kennzahlenraster, ein Bild oder einen Call-to-Action hinein. Hier ist ein Panel eine Checkliste und das nächste eine Reihe von Zahlen.',
      rtab1: 'Inklusive',
      rli1: 'Beliebig viele Panels, jedes mit eigenem Titel und Inhalt',
      rli2: 'Tastatur-, Touch- und Screenreader-Unterstützung von Haus aus',
      rli3: 'Kein eigenes JavaScript — nur deklaratives Markup',
      rtab2: 'In Zahlen',
      rstat1_n: '0',
      rstat1_l: 'Zeilen JavaScript, die du schreibst',
      rstat2_n: '100 %',
      rstat2_l: 'allein mit der Tastatur bedienbar',
      sec_nojs_t: 'Ohne JavaScript',
      sec_nojs_d:
        'Laufen keine Skripte, bleibt die Tableiste verborgen und jedes Panel wird untereinander gestapelt gerendert — der gesamte Inhalt bleibt vorhanden und lesbar. Verstecke nie wesentliche Inhalte hinter einem Tab, der nur mit JS erscheint.',
    },
  },
  'comp-modal': {
    path: 'modal',
    title: 'Modal',
    navTitle: 'Modal',
    description:
      'Eine Schaltfläche, die einen nativen Dialog öffnet — Fokusfalle, Escape, Backdrop und das Inaktivschalten des Hintergrunds liefert der Browser; die Größe bestimmt eine einzige Klasse.',
    data: {
      mod_intro:
        'Eine Schaltfläche und ein nativer Dialog. Der Browser liefert die Fokusfalle, Escape zum Schließen, das abgedunkelte ::backdrop und das Inaktivschalten der Seite dahinter — die Komponente verdrahtet nur die Öffnen- und Schließen-Schaltflächen. Die Größe bestimmst du mit einer max-w-*-Klasse.',
      mod_close: 'Schließen',
      sec_basic_t: 'Modal — die Standardeinstellungen',
      sec_basic_d:
        'Ein Auslöser und ein Dialog — die gestaltete Schließen-Schaltfläche (oben rechts) wird automatisch hinzugefügt. Ein Dialog ohne Klassen nutzt die Hintergrund- und Textfarben deiner Website, abgerundete Ecken und angenehmen Innenabstand. Escape, die Schließen-Schaltfläche oder ein Klick auf den Hintergrund schließen ihn.',
      mod1_open: 'Wie geht es weiter?',
      mod1_title: 'Wie geht es weiter?',
      mod1_body:
        'Nach deiner Anfrage vereinbaren wir ein kurzes Gespräch, stecken den Umfang gemeinsam ab und senden innerhalb von zwei Werktagen ein Festpreisangebot — unverbindlich.',
      sec_wide_t: 'Ein breiterer Dialog mit reichem Inhalt',
      sec_wide_d:
        'Dieselbe Komponente, mit max-w-2xl vergrößert. Utility-Klassen am Dialog überschreiben jede Vorgabe — Hintergrund, Text, Innenabstand, Radius. Du kannst außerdem die automatische Schließen-Schaltfläche mit data-closebutton="false" ausblenden und den Dialog bei einem Klick auf den Hintergrund mit data-backdrop-close="false" geöffnet lassen; hier ist beides gesetzt, daher ist die Schaltfläche unten der einzige Ausweg.',
      mod2_open: 'Den ganzen Ablauf ansehen',
      mod2_title: 'So arbeiten wir',
      mod2_step1: 'Entdecken — wir lernen Ziele, Zielgruppe und Rahmenbedingungen kennen.',
      mod2_step2: 'Design & Umsetzung — wöchentliche Vorschauen, dein Feedback fließt ein.',
      mod2_step3: 'Launch & Pflege — wir gehen live, messen und verbessern weiter.',
      sec_form_t: 'Ein Modal mit einem Formular',
      sec_form_d:
        'Setze das eingebettete Kontaktformular direkt in den Dialog — es sendet, validiert und zeigt seine Erfolgsmeldung, ohne dass die Seite verlassen wird.',
      mod3_open: 'Kontakt aufnehmen',
      mod3_title: 'Schreib uns eine Nachricht',
      mod3_body: 'Wir antworten meist innerhalb eines Tages.',
      sec_nojs_t: 'Ohne JavaScript & globale Modals',
      sec_nojs_d:
        'Ohne JS tut der Auslöser einfach nichts und die Seite bleibt voll nutzbar — leg also nie wesentliche Inhalte allein in ein Modal. Ein Navigations-Platzhalter, der auf eine #dialog-id zeigt, kann ein Modal auch aus dem Menü öffnen.',
    },
  },
  'comp-cookie': {
    path: 'cookie-consent',
    title: 'Cookie-Hinweis',
    navTitle: 'Cookie-Hinweis',
    description:
      'Ein Einwilligungsbanner, das in localStorage gespeichert wird — verborgen ausgeliefert, beim ersten Besuch einmal eingeblendet und nach der Zustimmung endgültig ausgeblendet. Eine Skeleton-Slot-Komponente, die site-weit läuft.',
    data: {
      cc_intro:
        'Ein kleines Einwilligungsbanner, das die Runtime nur einblendet, bis der Besucher zustimmt — die Wahl wird in localStorage gemerkt, also erscheint es einmal und nie wieder. Es lebt in einem Skeleton-Slot und ist damit auf jeder Seite vorhanden; das echte hast du beim ersten Besuch am unteren Rand gesehen.',
      sec_preview_t: 'So sieht es aus',
      sec_preview_d:
        'Eine statische Vorschau des Banners (hier gezeigt, damit es auch sichtbar ist, nachdem du das echte akzeptiert hast). Das Live-Banner ist am unteren Rand fixiert und gleitet beim ersten Besuch herein.',
      cc_text: 'Wir verwenden wenige notwendige Cookies für den Betrieb dieser Website und anonyme Statistiken zu ihrer Verbesserung.',
      cc_more: 'Mehr erfahren',
      cc_accept: 'Alles klar',
      sec_how_t: 'So funktioniert’s',
      sec_how_d:
        'Einmal in einem Skeleton-Slot anlegen (im Footer oder einem eigenen Slot). Der Server rendert es mit einem hidden-Attribut; die Runtime prüft localStorage und blendet es nur ein, wenn keine Wahl gespeichert ist, und blendet es nach Druck auf die Zustimmen-Schaltfläche dauerhaft aus. Das Verhalten trägt der Marker, nicht das ausgezeichnete HTML. Die Zustimmung wird standardmäßig unter dem Schlüssel sw-cookie-consent gespeichert — mit einem optionalen data-cookiename legst du einen eigenen Schlüssel fest, sodass zwei unabhängige Banner ihre Zustimmung getrennt verwalten.',
      sec_nojs_t: 'Ohne JavaScript',
      sec_nojs_d:
        'Es erscheint gar kein Banner — und ohne Skripte gibt es nichts zu setzen oder zu speichern, die Seite wird einfach unverändert ausgeliefert.',
    },
  },
  'comp-forms': {
    path: 'forms',
    title: 'Formulare',
    navTitle: 'Formulare',
    description:
      'Bette ein konfiguriertes Formular mit einem einzigen Tag überall ein — Felder, Validierung, Spam-Schutz und Inline-Erfolg werden für dich erzeugt, und die richtige Sprache wird automatisch gewählt.',
    data: {
      frm_intro:
        'Baue ein Formular einmal im Formulare-Tab und bette es dann überall ein — {{sw-form "id"}} oder data-sw-form="id" expandiert das Ganze beim Rendern: Felder, Labels, Validierung, einen Honeypot und eine Inline-Erfolgsmeldung. Es gibt kein Markup von Hand und nichts zu verdrahten.',
      sec_helper_t: 'Mit dem Helper einbetten',
      sec_helper_d:
        'Das einfachste Formular: ein Helper-Aufruf expandiert die gespeicherte „contact“-Definition. Mit class= gestaltest du den Wrapper.',
      sec_attr_t: 'Per Attribut einbetten, in deinem eigenen Layout',
      sec_attr_d:
        'Lieber von Hand platzieren? Ein leeres Element mit data-sw-form="contact" wird mit demselben Markup gefüllt — setze es in jeden Container, den du gestaltet hast, etwa diese Karte.',
      sec_about_t: 'Spam-Schutz, sprachbewusst, ohne JS',
      sec_about_d:
        'Jede Einbettung erhält einen versteckten Honeypot, eine Zeitfalle beim Absenden und optional hCaptcha; sie sendet JSON an den eingefügten Endpunkt und zeigt Erfolg oder Fehler inline. Auf einer übersetzten Seite löst „contact“ automatisch das passende lokalisierte Formular auf. Ohne JavaScript hat das Formular kein action-Attribut und sendet nicht — Spam-Schutz by design.',
    },
  },
  'comp-datetimepicker': {
    path: 'datetimepicker',
    title: 'Datums- & Zeitauswahl',
    navTitle: 'Datumsauswahl',
    description:
      'Ein CI-gestylter Kalender mit Schieberegler-Zeitauswahl auf einem einfachen Textfeld — Datum, ein zweimonatiger Zeitraum mit Doppelpanel, Datum+Zeit und Uhrzeit, alle aus einem Attribut, mit voller data-*-Kontrolle und einem No-JS-Fallback.',
    data: {
      dtp_intro:
        'Ein Attribut auf ein Textfeld und es wird zu einem gebrandeten Kalender mit Schieberegler-Zeitauswahl. Datum, Zeitraum, Datum+Zeit und Uhrzeit — jeweils ein einziger data-mode-Wert, und Farben und Schrift stammen automatisch aus der CI deiner Website. Ein Zeitraum öffnet sich als zwei Monate nebeneinander, sodass monatsübergreifende Spannen leichtfallen.',
      sec_basic_t: 'Eine Zeile für den Normalfall',
      sec_basic_d:
        'Eine Datumsauswahl ist nur data-sw-component="datetimepicker" auf einem Textfeld — ohne Konfiguration. Ins Feld klicken, der Kalender öffnet sich; der gewählte Tag nutzt deine Primärfarbe.',
      lbl_date: 'Termindatum',
      ph_date: 'Datum wählen…',
      sec_modes_t: 'Vier Modi, ein Attribut',
      sec_modes_d:
        'data-mode wechselt die Auswahl: ein einzelnes Datum, ein über zwei Monate gezeigter Start–Ende-Zeitraum, ein Datum mit Zeit-Schieberegler oder nur die Uhrzeit. Alles andere bleibt automatisch.',
      lbl_range: 'Zeitraum (zwei Monate)',
      ph_range: 'Anreise – Abreise',
      lbl_datetime: 'Datum & Zeit',
      ph_datetime: 'Tag und Uhrzeit wählen…',
      lbl_time: 'Nur Uhrzeit',
      ph_time: 'Uhrzeit wählen…',
      sec_full_t: 'Volle Kontrolle, wenn nötig',
      sec_full_d:
        'Für die übrigen Fälle gibt es data-*-Attribute: Grenzen (data-min / data-max), Wochenstart, mehrere Daten, Minutenschritt, 12-/24-Stunden-Format, Sprache und data-months zum Verbreitern des Panels. Setze die Markierung statt auf ein Eingabefeld auf ein Block-Element für einen dauerhaft geöffneten Kalender — hier ein Doppelpanel-Zeitraum:',
      lbl_inline: 'Dauerhaft geöffneter Doppelpanel-Kalender',
      sec_nojs_t: 'Ohne JavaScript',
      sec_nojs_d:
        'Laufen keine Skripte, bleibt jedes Feld ein gewöhnliches Textfeld — der Besucher kann weiterhin einen Wert eingeben und er wird im Formular gesendet. Nur das Kalender-Popup steht nicht zur Verfügung.',
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
