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

  // HOME (secondary sections: why-us, services preview, spotlight, selected work, testimonials, CTA)
  'home.why_eyebrow': { de: 'Warum Northwind', es: 'Por qué Northwind' },
  'home.why_title': { de: 'Erfahrene Leute, keine Übergaben, keine Überraschungen', es: 'Gente sénior, sin traspasos, sin sorpresas' },
  'home.why_sub': { de: 'Sie arbeiten direkt mit den Designern und Entwicklern, die Ihre Website bauen — von Anfang bis Ende.', es: 'Trabaja directamente con los diseñadores e ingenieros que construyen su web — de principio a fin.' },
  'home.why1': { de: 'Fester Umfang & Zeitplan', es: 'Alcance y plazos cerrados' },
  'home.why2': { de: 'Perfekte Lighthouse-Werte', es: 'Lighthouse perfecto' },
  'home.why3': { de: 'Inhalte selbst bearbeiten', es: 'Edite el contenido usted mismo' },
  'home.why4': { de: 'Barrierearm & SEO-bereit', es: 'Accesible y listo para SEO' },
  'home.why5': { de: 'Portabler statischer Export', es: 'Exportación estática portable' },
  'home.why6': { de: 'Laufende Wartungspakete', es: 'Mantenimiento continuo' },
  'home.svc_title': { de: 'Alles aus einer Hand', es: 'Todo bajo un mismo techo' },
  'home.svc_sub': { de: 'Strategie, Design und Entwicklung — keine Übergaben, keine Agentur-Ketten.', es: 'Estrategia, diseño y desarrollo — sin traspasos ni cadenas de agencias.' },
  'home.spot_eyebrow': { de: 'Fallstudie', es: 'Caso de estudio' },
  'home.spot_link': { de: 'Zum ganzen Portfolio', es: 'Ver todo el portfolio' },
  'home.work_title': { de: 'Ausgewählte Arbeiten', es: 'Trabajos seleccionados' },
  'home.work_link': { de: 'Alle Projekte ansehen', es: 'Ver todos los proyectos' },
  'home.tst_title': { de: 'Geschätzt von den Marken, für die wir bauen', es: 'Las marcas para las que construimos nos quieren' },
  'home.cta_title': { de: 'Sie haben ein Projekt im Kopf?', es: '¿Tiene un proyecto en mente?' },
  'home.cta_sub': { de: 'Sagen Sie uns, wo Sie in zwölf Monaten stehen wollen — wir zeigen Ihnen, wie die richtige Website Sie dorthin bringt.', es: 'Cuéntenos dónde quiere estar dentro de doce meses — le mostraremos cómo la web adecuada le lleva hasta allí.' },
  'home.cta_btn': { de: 'Kennenlern-Termin buchen', es: 'Reservar una llamada' },
  // SHOP — checkout channel + order-field LABELS (the cart resolves `shop.<key>` from a channel/field's
  // stable key). These carry EN too (the cart falls back to the bare key, not an inline default).
  'shop.whatsapp': { en: 'Order on WhatsApp', de: 'Per WhatsApp bestellen', es: 'Pedir por WhatsApp' },
  'shop.email': { en: 'Order by email', de: 'Per E-Mail bestellen', es: 'Pedir por correo' },
  'shop.pay': { en: 'Pay with PayPal', de: 'Mit PayPal zahlen', es: 'Pagar con PayPal' },
  'shop.name': { en: 'Your name', de: 'Ihr Name', es: 'Su nombre' },
  'shop.address': { en: 'Delivery address', de: 'Lieferadresse', es: 'Dirección de entrega' },
  'shop.phone': { en: 'Phone', de: 'Telefon', es: 'Teléfono' },
};
