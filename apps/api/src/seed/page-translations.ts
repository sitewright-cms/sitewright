// SCOPED page-content translations for the example. The flagship pages bind their prominent strings
// (hero eyebrow / headline / subhead / CTA) via `data-sw-translate="<scope>.<key>"` — the inline-editable
// global catalog — so the whole site (chrome AND page heroes) is translated from ONE Translations table,
// grouped by scope (home.*, services.*, …). The ENGLISH value is the element's inline fallback in the page
// source; only the non-default locales live here. Merged into `website.translations` alongside
// CHROME_TRANSLATIONS (see seed/website.ts). Every key carries de AND es (parity-checked in seed-content).
//
// KEY-FIRST (`scope.key → { locale → value }`), matching the catalog's stored shape.
export const PAGE_TRANSLATIONS: Record<string, Record<string, string>> = {
  // HOME
  'home.eyebrow': { de: 'Boutique-Webstudio · San Francisco', es: 'Estudio web boutique · San Francisco' },
  'home.headline': { de: 'Websites, die Ihnen mehr Geschäft bringen.', es: 'Webs que le traen más negocio.' },
  'home.subhead': {
    de: 'Wir gestalten und bauen schnelle, schöne Websites für ambitionierte Marken — Strategie, Design und Entwicklung aus einer Hand.',
    es: 'Diseñamos y construimos webs rápidas y hermosas para marcas ambiciosas — estrategia, diseño y desarrollo bajo un mismo techo.',
  },
  'home.cta_work': { de: 'Arbeiten ansehen', es: 'Ver nuestro trabajo' },

  // SERVICES
  'services.eyebrow': { de: 'Was wir tun', es: 'Qué hacemos' },
  'services.headline': { de: 'Leistungen, die Ihr Geschäft wachsen lassen', es: 'Servicios que hacen crecer su negocio' },
  'services.intro': {
    de: 'Buchen Sie uns durchgängig oder für eine einzelne Phase. So oder so arbeiten Sie direkt mit den Menschen, die die Arbeit machen.',
    es: 'Contrátenos de principio a fin o para una sola fase. En cualquier caso trabaja directamente con quienes hacen el trabajo.',
  },

  // ABOUT
  'about.eyebrow': { de: 'Über uns', es: 'Sobre nosotros' },
  'about.headline': { de: 'Ein kleines, erfahrenes Team — mit Absicht', es: 'Un equipo pequeño y sénior — a propósito' },
  'about.intro': {
    de: 'Northwind ist ein Boutique-Studio aus Designern und Entwicklern, die lieber wenige Projekte brillant machen als viele mittelmäßig. Keine Junioren, die auf Ihre Kosten lernen, keine Schichten von Account-Managern — nur die Menschen, die die Arbeit machen.',
    es: 'Northwind es un estudio boutique de diseñadores e ingenieros que prefieren hacer pocos proyectos de forma brillante antes que muchos de forma correcta. Sin juniors aprendiendo a su costa, sin capas de gestores de cuenta — solo las personas que hacen el trabajo.',
  },

  // WORK
  'work.eyebrow': { de: 'Portfolio', es: 'Portfolio' },
  'work.headline': { de: 'Arbeiten, auf die wir stolz sind', es: 'Trabajo del que estamos orgullosos' },
  'work.intro': {
    de: 'Eine Auswahl aktueller Websites aus Handel, Gesundheit, Finanzen und Kultur — jede handgebaut und schnell. Klicken Sie ein Bild für die Großansicht.',
    es: 'Una selección de webs recientes de comercio, salud, finanzas y cultura — todas artesanales y rápidas. Haga clic en cualquier imagen para verla a pantalla completa.',
  },

  // CONTACT
  'contact.headline': { de: 'Lassen Sie uns etwas Großes bauen', es: 'Construyamos algo grande' },
  'contact.subhead': {
    de: 'Erzählen Sie uns von Ihrem Projekt — wir melden uns innerhalb eines Werktags. Lieber per E-Mail? Schreiben Sie uns direkt, wir lesen jede Nachricht.',
    es: 'Cuéntenos su proyecto y le responderemos en un día laborable. ¿Prefiere el correo? Escríbanos directamente — leemos cada mensaje.',
  },

  // FAQ
  'faq.eyebrow': { de: 'Gut zu wissen', es: 'Conviene saberlo' },
  'faq.headline': { de: 'Häufige Fragen', es: 'Preguntas frecuentes' },
  'faq.intro': {
    de: 'Die Fragen, mit denen jedes Projekt beginnt — klar beantwortet. Fehlt etwas? Fragen Sie einfach.',
    es: 'Las preguntas con las que empieza todo proyecto — respondidas con claridad. ¿Falta algo? Pregunte sin más.',
  },
};
