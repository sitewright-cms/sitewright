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

  // home (migrated from page.data)
  'home.stat1_l': { de: 'Websites ausgeliefert', es: 'Webs entregadas' },
  'home.stat2_l': { de: 'Jahre am Markt', es: 'Años en el mercado' },
  'home.stat3_l': { de: 'Ø Lighthouse-Score', es: 'Lighthouse medio' },
  'home.stat4_l': { de: 'Ø mehr Anfragen', es: 'Más consultas de media' },

  // contact (migrated from page.data)
  'contact.c_hours': { de: 'Mo–Fr, 9–18 Uhr (PT)', es: 'Lun–Vie, 9–18 h (PT)' },
  'contact.c_modal_btn': { de: 'Was passiert im Kennenlern-Gespräch?', es: '¿Qué pasa en la llamada inicial?' },
  'contact.c_modal_t': { de: 'Ein 20-Minuten-Gespräch, kein Pitch', es: 'Una conversación de 20 minutos, sin discurso de ventas' },
  'contact.c_form_t': { de: 'Projektanfrage', es: 'Consulta de proyecto' },

  // faq (migrated from page.data)
  'faq.faq_cta_t': { de: 'Noch Fragen?', es: '¿Sigue con dudas?' },
  'faq.faq_cta': { de: 'Fragen Sie uns alles', es: 'Pregúntenos lo que sea' },

  // components (migrated from page.data)
  'components.comp_eyebrow': { de: 'Showcase', es: 'Showcase' },
  'components.comp_h1': { de: 'Interaktive Komponenten', es: 'Componentes interactivos' },
  'components.comp_intro': { de: 'Die First-Party-Komponenten, mit denen diese Website gebaut ist — jede in allen Konfigurationen, erst die Standardeinstellungen, dann jede Option. Alles funktioniert mit Tastatur, Touch und ohne JavaScript.', es: 'Los componentes propios con los que está construido este sitio, cada uno en todas sus configuraciones — primero los valores por defecto, después cada opción. Todo funciona con teclado, táctil y sin JavaScript.' },

  // services (migrated from page.data)
  'services.proc_title': { de: 'Ein einfacher, bewährter Ablauf', es: 'Un proceso simple y probado' },
  'services.p1_t': { de: 'Entdecken', es: 'Descubrir' },
  'services.p1_b': { de: 'Ziele, Zielgruppe und die Kennzahlen, die zählen.', es: 'Objetivos, audiencia y las métricas que importan.' },
  'services.p2_t': { de: 'Gestalten', es: 'Diseñar' },
  'services.p2_b': { de: 'Oberflächen und ein Markensystem, gemeinsam abgestimmt.', es: 'Interfaces y un sistema de marca, revisados juntos.' },
  'services.p3_t': { de: 'Bauen', es: 'Construir' },
  'services.p3_b': { de: 'Schnell, barrierearm, pflegbar, SEO-bereit.', es: 'Rápido, accesible, gestionable, listo para SEO.' },
  'services.p4_t': { de: 'Launch & Pflege', es: 'Lanzar y cuidar' },
  'services.p4_b': { de: 'Wir veröffentlichen, messen und verbessern weiter.', es: 'Publicamos, medimos y seguimos mejorando.' },
  'services.srv_cta': { de: 'Projekt starten', es: 'Empezar un proyecto' },

  // service_web_design (migrated from page.data)
  'service_web_design.wd_eyebrow': { de: 'Leistung', es: 'Servicio' },
  'service_web_design.wd_h1': { de: 'Webdesign', es: 'Diseño web' },
  'service_web_design.wd_intro': { de: 'Unverwechselbare, markengerechte Oberflächen, pixelgenau für jedes Display — vom ersten Wireframe bis zur polierten, barrierearmen UI.', es: 'Interfaces distintivas y fieles a la marca, al píxel en cualquier pantalla — del primer wireframe a una UI pulida y accesible.' },
  'service_web_design.wd_price_l': { de: 'Typischer Rahmen:', es: 'Rango habitual:' },
  'service_web_design.wd_1t': { de: 'Designsysteme', es: 'Sistemas de diseño' },
  'service_web_design.wd_1b': { de: 'Wiederverwendbare Komponenten und Tokens, die mit Ihrer Marke skalieren.', es: 'Componentes y tokens reutilizables que escalan con su marca.' },
  'service_web_design.wd_2t': { de: 'Responsiv von Haus aus', es: 'Responsivo por defecto' },
  'service_web_design.wd_2b': { de: 'Jedes Layout ist für Mobil, Tablet und Desktop gestaltet.', es: 'Cada layout se trabaja para móvil, tablet y escritorio.' },
  'service_web_design.wd_cta': { de: 'Projekt starten', es: 'Empezar un proyecto' },

  // service_seo (migrated from page.data)
  'service_seo.seo_eyebrow': { de: 'Leistung', es: 'Servicio' },
  'service_seo.seo_h1': { de: 'SEO & Performance', es: 'SEO y rendimiento' },
  'service_seo.seo_intro': { de: 'Technisches SEO, Core Web Vitals und Analytics von Tag eins — damit die schnelle, schöne Website, die Sie launchen, auch die ist, die Google belohnt.', es: 'SEO técnico, Core Web Vitals y analítica desde el primer día — para que la web rápida y hermosa que lanza sea la que Google premia.' },
  'service_seo.seo_price_l': { de: 'Typischer Rahmen:', es: 'Rango habitual:' },
  'service_seo.seo_1t': { de: 'Core Web Vitals', es: 'Core Web Vitals' },
  'service_seo.seo_1b': { de: 'Wir tunen LCP, CLS und INP, bis alle Werte grün sind.', es: 'Afinamos LCP, CLS e INP hasta que todo esté en verde.' },
  'service_seo.seo_2t': { de: 'Technisches SEO', es: 'SEO técnico' },
  'service_seo.seo_2b': { de: 'Strukturierte Daten, Sitemaps und sauberes, crawlbares Markup.', es: 'Datos estructurados, sitemaps y marcado limpio y rastreable.' },
  'service_seo.seo_cta': { de: 'Projekt starten', es: 'Empezar un proyecto' },

  // service_pricing (migrated from page.data)
  'service_pricing.pr_h1': { de: 'Ehrliche Festpreise', es: 'Precios honestos, a alcance cerrado' },
  'service_pricing.pr_intro': { de: 'Keine Schätzungen, die sich mitten im Projekt verdoppeln. Paket wählen, Zahl kennen, Website bekommen.', es: 'Nada de estimaciones que se duplican a mitad de proyecto. Elija un paquete, conozca la cifra, reciba la web.' },
  'service_pricing.pr_note': { de: 'Alle Preise in USD, zzgl. Steuern. Größere Vorhaben kalkulieren wir individuell — sprechen Sie uns an.', es: 'Precios en USD, impuestos no incluidos. Los proyectos mayores se presupuestan a medida — consúltenos.' },
  'service_pricing.pr_cta': { de: 'Projekt starten', es: 'Empezar un proyecto' },
  'service_pricing.pr_faq': { de: 'FAQ lesen', es: 'Leer las preguntas frecuentes' },

  // about (migrated from page.data)
  'about.ab_p2': { de: 'Wir glauben: Eine großartige Website ist das fleißigste Mitglied Ihres Teams — schnell, klar und leise überzeugend. Diese Überzeugung prägt jede unserer Entscheidungen.', es: 'Creemos que una gran web es el miembro más trabajador de su equipo: rápida, clara y discretamente persuasiva. Esa convicción guía cada decisión que tomamos.' },
  'about.val_title': { de: 'Was uns wichtig ist', es: 'Lo que valoramos' },
  'about.v1_t': { de: 'Handwerk statt Fließband', es: 'Oficio antes que volumen' },
  'about.v1_b': { de: 'Wir feilen an den Details, die andere überspringen — denn Details sind das, was Menschen spüren.', es: 'Cuidamos los detalles que otros se saltan — porque los detalles son lo que la gente siente.' },
  'about.v2_t': { de: 'Tempo ist ein Feature', es: 'La velocidad es una funcionalidad' },
  'about.v2_b': { de: 'Jede Website, die wir ausliefern, ist statisch, optimiert und lädt sofort.', es: 'Cada web que entregamos es estática, optimizada y carga al instante.' },
  'about.v3_t': { de: 'Klare Worte', es: 'Hablar claro' },
  'about.v3_b': { de: 'Feste Umfänge, klare Zeitpläne und ehrlicher Rat — auch wenn er uns das Upselling kostet.', es: 'Alcances cerrados, plazos claros y consejo honesto — aunque nos cueste la venta adicional.' },
  'about.team_title': { de: 'Die Menschen, mit denen Sie arbeiten', es: 'Las personas con las que trabajará' },
  'about.gal_title': { de: 'Einblicke ins Studio', es: 'Dentro del estudio' },
  'about.gal_empty': { de: 'Noch keine Fotos — legen Sie welche in den Studio-Ordner.', es: 'Aún no hay fotos — suba algunas a la carpeta Studio.' },

  // careers (migrated from page.data)
  'careers.ca_h1': { de: 'Machen Sie die beste Arbeit Ihrer Laufbahn', es: 'Venga a hacer el mejor trabajo de su carrera' },
  'careers.ca_intro': { de: 'Ein kleines Team heißt: Ihre Arbeit geht live, Ihr Name steht darauf, und niemand managt den Manager. Diese Stellen sind gerade offen.', es: 'Un equipo pequeño significa que su trabajo se publica, lleva su nombre y nadie gestiona al gestor. Estas vacantes están abiertas ahora mismo.' },
  'careers.ca_empty': { de: 'Gerade keine offenen Stellen — aber ein starkes Portfolio lesen wir immer.', es: 'Ahora mismo no hay vacantes — pero un buen portfolio lo leemos siempre.' },
  'careers.ca_cta_t': { de: 'Ihre Rolle ist nicht dabei?', es: '¿No ve su puesto?' },
  'careers.ca_cta_b': { de: 'Überzeugen Sie uns. Die besten Leute passen selten in eine Vorlage.', es: 'Convénzanos. La mejor gente rara vez encaja en una plantilla.' },
  'careers.ca_cta': { de: 'Kontakt aufnehmen', es: 'Escríbanos' },
};
