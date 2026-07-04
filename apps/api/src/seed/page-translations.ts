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

  // home (migrated from page.data)
  'home.hero_alt': { en: 'A recent Northwind website', de: 'Eine aktuelle Northwind-Website', es: 'Una web reciente de Northwind' },
  'home.aria_prev': { en: 'Previous testimonial', de: 'Vorherige Stimme', es: 'Testimonio anterior' },
  'home.aria_next': { en: 'Next testimonial', de: 'Nächste Stimme', es: 'Testimonio siguiente' },

  // work (migrated from page.data)
  'work.aria_caption': { en: 'Project gallery', de: 'Projektgalerie', es: 'Galería de proyectos' },

  // contact (migrated from page.data)
  'contact.c_close': { en: 'Close', de: 'Schließen', es: 'Cerrar' },

  // components (migrated from page.data)
  'components.a_view': { en: 'Explore', de: 'Ansehen', es: 'Explorar' },

  // service_pricing (migrated from page.data)
  'service_pricing.tab_projects': { en: 'Project work', de: 'Projektarbeit', es: 'Proyectos' },
  'service_pricing.tab_care': { en: 'Care plans', de: 'Wartungspakete', es: 'Mantenimiento' },
  'service_pricing.pr_badge': { en: 'Most popular', de: 'Am beliebtesten', es: 'El más elegido' },

  // about (migrated from page.data)
  'about.ab_img_alt': { en: 'The Northwind studio', de: 'Das Northwind-Studio', es: 'El estudio Northwind' },
  'about.aria_gallery': { en: 'Studio photos', de: 'Studiofotos', es: 'Fotos del estudio' },

  // careers (migrated from page.data)
  'careers.badge_remote': { en: 'Remote OK', de: 'Remote möglich', es: 'Remoto posible' },
  'careers.posted_l': { en: 'Posted', de: 'Ausgeschrieben', es: 'Publicado' },

  // comp_slider (migrated from page.data)
  'comp_slider.a_prev': { en: 'Previous slide', de: 'Vorherige Folie', es: 'Diapositiva anterior' },
  'comp_slider.a_next': { en: 'Next slide', de: 'Nächste Folie', es: 'Diapositiva siguiente' },
  'comp_slider.sld_intro': { de: 'Eine Komponente, alle Konfigurationen. Jeder Slider unten ist reines deklaratives Markup — ein data-sw-component-Root, data-sw-part-Slots und data-*-Optionen.', es: 'Un componente, todas las configuraciones. Cada slider de abajo es marcado declarativo puro — un root data-sw-component, slots data-sw-part y opciones data-*.' },
  'comp_slider.sec_hero_t': { de: 'Hero-Slider — ein einziges Include', es: 'Slider hero — un solo include' },
  'comp_slider.sec_hero_d': { de: 'Der klassische Startseiten-Auftakt: Folien mit fester Höhe, Hintergrundbildern, abwechselndem Ken-Burns-Effekt und hereingleitenden Captions. Dieser ganze Block ist das hero-slider-Widget — einsetzen, dann seine Folien (Bilder + Captions) als Daten bearbeiten. Kein eigenes CSS.', es: 'La apertura clásica de portada: diapositivas de altura fija con imágenes de fondo, un efecto Ken Burns alternante y captions que entran. Todo este bloque es el Widget hero-slider — insértalo y luego edita sus diapositivas (imágenes + captions) como datos. Sin CSS propio.' },
  'comp_slider.sec_fade_t': { de: 'Slider — die Standardeinstellungen', es: 'Slider — los valores por defecto' },
  'comp_slider.sec_fade_d': { de: 'Ganz ohne Optionen: Die Folien überblenden sanft, die Pfeile liegen mittig links und rechts, die Indikatoren zentriert am unteren Rand.', es: 'Sin opciones: las diapositivas se funden, las flechas se superponen a media altura y los indicadores quedan centrados abajo.' },
  'comp_slider.aria_fade': { en: 'Project slideshow (fade)', de: 'Projekt-Slideshow (Fade)', es: 'Presentación de proyectos (fundido)' },
  'comp_slider.sec_slide_t': { de: 'Slide-Effekt, Endlosschleife, Autoplay', es: 'Efecto slide, bucle y autoplay' },
  'comp_slider.sec_slide_d': { de: 'Die schiebende Leiste statt Überblendung — läuft endlos und wechselt von selbst; Hover oder Fokus pausiert.', es: 'La banda deslizante en lugar del fundido, en bucle sin fin y avanzando sola — se pausa al pasar el cursor o recibir el foco.' },
  'comp_slider.aria_slide': { en: 'Project slideshow (slide)', de: 'Projekt-Slideshow (Slide)', es: 'Presentación de proyectos (deslizante)' },
  'comp_slider.sec_items_t': { de: 'Mehrere Karten mit Peek', es: 'Varias tarjetas con asomo' },
  'comp_slider.sec_items_d': { de: 'Die Variable --sw-items bestimmt die Karten pro Ansicht; ein Bruchwert lässt eine Karte hereinschauen. data-item-align="center" zentriert die aktive Karte mit einem Ausblick auf beiden Seiten — erste und letzte rasten am Rand ein. Ziehen, wischen oder die Pfeile nutzen.', es: 'La variable --sw-items fija las tarjetas por vista; un valor fraccionario deja asomar una tarjeta. data-item-align="center" centra la tarjeta activa con un asomo a ambos lados — la primera y la última se ajustan a los bordes. Arrastra, desliza o usa las flechas.' },
  'comp_slider.aria_items': { en: 'Project cards', de: 'Projektkarten', es: 'Tarjetas de proyectos' },
  'comp_slider.sec_align_t': { de: 'Eine nicht volle Reihe ausrichten', es: 'Alinear una fila incompleta' },
  'comp_slider.sec_align_d': { de: 'Werden weniger Elemente gezeigt, als die Reihe füllen, verteilt data-item-align sie horizontal — Anfang (Standard), Mitte oder Ende — statt sie links kleben zu lassen.', es: 'Cuando se muestran menos elementos de los que llenan la fila, data-item-align los distribuye horizontalmente — inicio (por defecto), centro o final — en lugar de dejarlos pegados a la izquierda.' },
  'comp_slider.aria_align': { en: 'Featured tools (centered)', de: 'Ausgewählte Werkzeuge (zentriert)', es: 'Herramientas destacadas (centradas)' },
  'comp_slider.sec_scroll_t': { de: 'Kontinuierlicher Auto-Scroll', es: 'Desplazamiento automático continuo' },
  'comp_slider.sec_scroll_d': { de: 'Ein gleichmäßiger Ticker statt einzelner Schritte — gemacht für Logoleisten und Bildbänder. Pausiert bei Hover oder Fokus.', es: 'Un ticker constante en lugar de pasos — pensado para muros de logos y tiras de imágenes. Se pausa con el cursor o el foco.' },
  'comp_slider.aria_scroll': { en: 'Project ticker', de: 'Projekt-Ticker', es: 'Ticker de proyectos' },
  'comp_slider.sec_wheel_t': { de: 'Mausrad-Gesten & automatische Höhe', es: 'Gestos de rueda y altura automática' },
  'comp_slider.sec_wheel_d': { de: 'Mausrad oder Trackpad über dem Slider bewegt ihn; die Leiste passt ihre Höhe animiert an jedes Zitat an.', es: 'Mueve la rueda del ratón o el trackpad sobre el slider para avanzar; la banda anima su altura para ajustarse a cada cita.' },
  'comp_slider.aria_wheel': { en: 'Client quotes', de: 'Kundenstimmen', es: 'Opiniones de clientes' },
  'comp_slider.sec_click_t': { de: 'Klicken zum Weiterblättern', es: 'Clic para avanzar' },
  'comp_slider.sec_click_d': { de: 'Ganz ohne Pfeile: Ein Klick oder Tipp irgendwo auf die Folie blättert weiter — jeder Druck antwortet mit einem Ripple. Links in der Folie bleiben Links, Ziehen wischt weiterhin, und die Pfeiltasten funktionieren, sobald der Slider den Fokus hat.', es: 'Sin flechas: un clic o un toque en cualquier punto de la diapositiva avanza — cada pulsación responde con una onda. Los enlaces dentro de la diapositiva siguen siendo enlaces, arrastrar sigue deslizando y las flechas del teclado funcionan en cuanto el slider tiene el foco.' },
  'comp_slider.aria_click': { en: 'Project highlights (click to advance)', de: 'Projekt-Highlights (Klick blättert weiter)', es: 'Proyectos destacados (clic para avanzar)' },

  // comp_lightbox (migrated from page.data)
  'comp_lightbox.lb_intro': { de: 'Ein Fotoraster, das sich beim Klick bildschirmfüllend öffnet — das Bild vergrößert sich aus seiner Kachel, eine Thumbnail-Leiste und ein Bildzähler kommen mit, und Wischen / Pinch-Zoom / Tastatur funktionieren alle. Der Fokus kehrt beim Schließen zur Kachel zurück.', es: 'Una cuadrícula de fotos que se abre a pantalla completa al hacer clic — la imagen se amplía desde su mosaico, una tira de miniaturas y un contador la acompañan, y el deslizamiento / pinch-zoom / teclado funcionan. El foco vuelve al mosaico al cerrar.' },
  'comp_lightbox.sec_lb_t': { de: 'Lightbox — die Standardeinstellungen', es: 'Lightbox — los valores por defecto' },
  'comp_lightbox.sec_lb_d': { de: 'Klicke auf ein Foto: Es vergrößert sich aus seiner Kachel in einen bildschirmfüllenden Viewer mit Thumbnail-Leiste, Bildzähler und Bildunterschrift. Wischen oder Pinch auf Touch, Pfeiltasten am Rechner, Escape zum Schließen.', es: 'Haz clic en cualquier foto: se amplía desde su mosaico a un visor a pantalla completa con tira de miniaturas, contador de imágenes y leyenda. Desliza o pellizca en táctil, flechas en el teclado, Escape para cerrar.' },
  'comp_lightbox.aria_gallery': { en: 'Studio gallery', de: 'Studio-Galerie', es: 'Galería del estudio' },
  'comp_lightbox.sec_lbfx_t': { de: 'Lightbox — reduziert', es: 'Lightbox — versión reducida' },
  'comp_lightbox.sec_lbfx_d': { de: 'Dieselbe Galerie mit ausgeschalteter Thumbnail-Leiste und Pfeilen — ein klarerer Viewer, allein per Wischen, Tastatur und Zähler gesteuert.', es: 'La misma galería con la tira de miniaturas y las flechas desactivadas — un visor más limpio, gobernado solo por el deslizamiento, el teclado y el contador.' },
  'comp_lightbox.aria_gallery2': { en: 'Project gallery', de: 'Projektgalerie', es: 'Galería de proyectos' },
  'comp_lightbox.sec_lb3_t': { de: 'Lightbox — bildschirmfüllend', es: 'Lightbox — llenar la pantalla' },
  'comp_lightbox.sec_lb3_d': { de: 'Die Anpassung kann den Viewport füllen statt das ganze Bild zu zeigen, die Öffnen-Animation lässt sich abschalten, und das geöffnete Bild kann in der URL gespiegelt werden. Auf dem Smartphone kann das gezoomte Bild per Geräteneigung schwenken.', es: 'El ajuste puede llenar el viewport en vez de mostrar la imagen completa, la animación de apertura puede desactivarse y la imagen abierta puede reflejarse en la URL. En el móvil, la imagen ampliada puede desplazarse con la inclinación del dispositivo.' },
  'comp_lightbox.aria_gallery3': { en: 'Studio gallery, fill mode', de: 'Studio-Galerie, bildschirmfüllend', es: 'Galería del estudio, modo llenar' },
  'comp_lightbox.sec_single_t': { de: 'Lightbox — ein einzelnes Bild (eine Zeile)', es: 'Lightbox — una sola imagen (una línea)' },
  'comp_lightbox.sec_single_d': { de: 'Kein Raster-Gerüst nötig: Setze data-sw-component="lightbox" direkt auf ein <img>, und dieses eine Bild öffnet sich beim Klick bildschirmfüllend — die ganze Lightbox in einer einzigen Zeile.', es: 'Sin estructura de cuadrícula: pon data-sw-component="lightbox" directamente en un <img> y esa única imagen se abre a pantalla completa al hacer clic — toda la lightbox en una sola línea.' },
  'comp_lightbox.sec_masonry_t': { de: 'Lightbox — Masonry-Raster', es: 'Lightbox — cuadrícula masonry' },
  'comp_lightbox.sec_masonry_d': { de: 'Bilder unterschiedlicher Seitenverhältnisse — Hochformate, Querformate und breite Cover — versetzt in ausgewogene CSS-Spalten, ohne Beschnitt. Das Attribut steht direkt auf dem Spalten-Container; die Bilder werden zu einer Galerie.', es: 'Imágenes de proporciones variadas — verticales, horizontales y portadas anchas — escalonadas en columnas CSS equilibradas, sin recorte. El atributo va directamente en el contenedor de columnas; las imágenes forman una galería.' },
  'comp_lightbox.aria_masonry': { en: 'Masonry gallery', de: 'Masonry-Galerie', es: 'Galería masonry' },
  'comp_lightbox.sec_group_t': { de: 'Lightbox — eine Galerie aus getrennten Bildern', es: 'Lightbox — una galería desde imágenes separadas' },
  'comp_lightbox.sec_group_d': { de: 'Diese Bilder sind eigenständige Elemente in eigenen Karten, aber ein gemeinsamer data-gallery-Name fasst sie zu einer Lightbox zusammen — klicke auf eines und blättere durch beide. Das funktioniert auch über verschiedene Abschnitte der Seite hinweg.', es: 'Estas imágenes son elementos independientes en sus propias tarjetas, pero un mismo nombre data-gallery las une en una sola lightbox — haz clic en cualquiera y pasa por ambas. Lo mismo funciona entre distintas secciones de la página.' },

  // comp_tabs (migrated from page.data)
  'comp_tabs.tab_intro': { de: 'Eine Komponente, beliebiger Inhalt. Ein Tabs-Root mit einem Tablist-Slot und einem Panel pro Tab — die Runtime liest den Titel jedes Panels, erzeugt die Schaltflächen, verdrahtet die Pfeiltasten und stapelt ohne JavaScript alles lesbar untereinander.', es: 'Un componente, cualquier contenido. Una raíz de pestañas con un slot de lista y un panel por pestaña — el runtime lee el título de cada panel, construye los botones, cablea las flechas y, sin JavaScript, apila todo de forma legible.' },
  'comp_tabs.sec_basic_t': { de: 'Tab-Beschriftungen — schlicht oder mit Markup', es: 'Etiquetas de pestaña — simples o con HTML' },
  'comp_tabs.sec_basic_d': { de: 'Jedes Panel bekommt eine Beschriftung: ein einfaches data-sw-title oder ein optionales data-sw-part="tabtitle"-Kind für ein Icon oder anderes HTML. Das gilt pro Tab, du kannst also mischen — hier sind die ersten beiden Tabs mit Markup und der dritte schlicht. Auf einen Tab klicken oder einen fokussieren und die Pfeiltasten nutzen.', es: 'Cada panel recibe una etiqueta: un data-sw-title simple, o un elemento opcional data-sw-part="tabtitle" para un icono u otro HTML. Es por pestaña, así que puedes mezclarlas — aquí las dos primeras pestañas son enriquecidas y la tercera es simple. Haz clic en una pestaña, o enfócala y usa las flechas.' },
  'comp_tabs.tab1': { en: 'Overview', de: 'Überblick', es: 'Resumen' },
  'comp_tabs.body1': { de: 'Tabs bündeln zusammengehörige Inhalte auf engem Raum — der Besucher sieht jeweils ein Panel und wechselt dazwischen, ohne die Seite zu verlassen.', es: 'Las pestañas agrupan contenido relacionado en un área compacta — el visitante ve un panel a la vez y cambia entre ellos sin salir de la página.' },
  'comp_tabs.tab2': { en: 'How it works', de: 'So funktioniert’s', es: 'Cómo funciona' },
  'comp_tabs.body2': { de: 'Gib jedem Panel einen Titel und seinen Inhalt. Die Runtime erzeugt die barrierefreie Tableiste, verknüpft jede Schaltfläche mit ihrem Panel und bewegt den Fokus mit den Pfeiltasten (Pos1 und Ende springen zum ersten und letzten).', es: 'Da a cada panel un título y su contenido. El runtime genera la lista de pestañas accesible, enlaza cada botón con su panel y mueve el foco con las flechas (Inicio y Fin saltan al primero y al último).' },
  'comp_tabs.tab3': { en: 'Accessibility', de: 'Barrierefreiheit', es: 'Accesibilidad' },
  'comp_tabs.body3': { de: 'Das Markup folgt dem WAI-ARIA-Tabs-Muster: eine Tableiste aus Schaltflächen, die je ein beschriftetes Tabpanel steuern. Roving tabindex bedeutet, dass Tab in das aktive Panel führt, statt durch jede Schaltfläche zu wandern.', es: 'El marcado sigue el patrón de pestañas de WAI-ARIA: una lista de botones que controlan cada uno un panel etiquetado. El roving tabindex hace que Tab entre en el panel activo en vez de recorrer cada botón.' },
  'comp_tabs.sec_rich_t': { de: 'Panels nehmen beliebiges Markup auf', es: 'Los paneles admiten cualquier marcado' },
  'comp_tabs.sec_rich_d': { de: 'Ein Panel ist nur ein Container — setze eine Liste, ein Kennzahlenraster, ein Bild oder einen Call-to-Action hinein. Hier ist ein Panel eine Checkliste und das nächste eine Reihe von Zahlen.', es: 'Un panel es solo un contenedor — pon dentro una lista, una cuadrícula de cifras, una imagen o una llamada a la acción. Aquí un panel es una lista de verificación y el siguiente, un conjunto de cifras.' },
  'comp_tabs.rtab1': { en: 'What’s included', de: 'Inklusive', es: 'Qué incluye' },
  'comp_tabs.rli1': { de: 'Beliebig viele Panels, jedes mit eigenem Titel und Inhalt', es: 'Paneles ilimitados, cada uno con su propio título y contenido' },
  'comp_tabs.rli2': { de: 'Tastatur-, Touch- und Screenreader-Unterstützung von Haus aus', es: 'Compatibilidad con teclado, táctil y lector de pantalla de serie' },
  'comp_tabs.rli3': { de: 'Kein eigenes JavaScript — nur deklaratives Markup', es: 'Sin JavaScript propio — solo marcado declarativo' },
  'comp_tabs.rtab2': { en: 'By the numbers', de: 'In Zahlen', es: 'En cifras' },
  'comp_tabs.rstat1_l': { de: 'Zeilen JavaScript, die du schreibst', es: 'líneas de JavaScript que escribes' },
  'comp_tabs.rstat2_l': { de: 'allein mit der Tastatur bedienbar', es: 'utilizable solo con el teclado' },
  'comp_tabs.sec_nojs_t': { de: 'Ohne JavaScript', es: 'Sin JavaScript' },
  'comp_tabs.sec_nojs_d': { de: 'Laufen keine Skripte, bleibt die Tableiste verborgen und jedes Panel wird untereinander gestapelt gerendert — der gesamte Inhalt bleibt vorhanden und lesbar. Verstecke nie wesentliche Inhalte hinter einem Tab, der nur mit JS erscheint.', es: 'Si los scripts no se ejecutan, la lista de pestañas queda oculta y cada panel se muestra apilado, uno tras otro — todo el contenido sigue ahí y es legible. Nunca ocultes contenido esencial tras una pestaña que solo aparece con JS.' },

  // comp_modal (migrated from page.data)
  'comp_modal.mod_intro': { de: 'Eine Schaltfläche und ein nativer Dialog. Der Browser liefert die Fokusfalle, Escape zum Schließen, das abgedunkelte ::backdrop und das Inaktivschalten der Seite dahinter — die Komponente verdrahtet nur die Öffnen- und Schließen-Schaltflächen. Die Größe bestimmst du mit einer max-w-*-Klasse.', es: 'Un botón y un diálogo nativo. El navegador aporta la trampa de foco, Escape para cerrar, el ::backdrop atenuado y la inactivación de la página detrás — el componente solo cablea los botones de abrir y cerrar. El tamaño lo decides con una clase max-w-*.' },
  'comp_modal.mod_close': { en: 'Close', de: 'Schließen', es: 'Cerrar' },
  'comp_modal.sec_basic_t': { de: 'Modal — die Standardeinstellungen', es: 'Modal — los valores por defecto' },
  'comp_modal.sec_basic_d': { de: 'Ein Auslöser und ein Dialog — die gestaltete Schließen-Schaltfläche (oben rechts) wird automatisch hinzugefügt. Ein Dialog ohne Klassen nutzt die Hintergrund- und Textfarben deiner Website, abgerundete Ecken und angenehmen Innenabstand. Escape, die Schließen-Schaltfläche oder ein Klick auf den Hintergrund schließen ihn.', es: 'Un disparador y un diálogo: el botón de cerrar con estilo (arriba a la derecha) se añade automáticamente. Un diálogo sin clases usa los colores de fondo y de texto de tu sitio, esquinas redondeadas y un relleno cómodo. Escape, el botón de cerrar o un clic en el fondo lo descartan.' },
  'comp_modal.mod1_open': { de: 'Wie geht es weiter?', es: '¿Qué pasa después?' },
  'comp_modal.mod1_title': { de: 'Wie geht es weiter?', es: '¿Qué pasa después?' },
  'comp_modal.mod1_body': { de: 'Nach deiner Anfrage vereinbaren wir ein kurzes Gespräch, stecken den Umfang gemeinsam ab und senden innerhalb von zwei Werktagen ein Festpreisangebot — unverbindlich.', es: 'Tras tu consulta concertamos una llamada breve, definimos juntos el alcance y enviamos un presupuesto cerrado en dos días hábiles — sin compromiso.' },
  'comp_modal.sec_wide_t': { de: 'Ein breiterer Dialog mit reichem Inhalt', es: 'Un diálogo más ancho con contenido rico' },
  'comp_modal.sec_wide_d': { de: 'Dieselbe Komponente, mit max-w-2xl vergrößert. Utility-Klassen am Dialog überschreiben jede Vorgabe — Hintergrund, Text, Innenabstand, Radius. Du kannst außerdem die automatische Schließen-Schaltfläche mit data-closebutton="false" ausblenden und den Dialog bei einem Klick auf den Hintergrund mit data-backdrop-close="false" geöffnet lassen; hier ist beides gesetzt, daher ist die Schaltfläche unten der einzige Ausweg.', es: 'El mismo componente, ampliado con max-w-2xl. Las clases de utilidad en el diálogo anulan cualquier valor por defecto — fondo, texto, relleno, radio. También puedes ocultar el botón de cerrar automático con data-closebutton="false" y mantener el modal abierto al hacer clic en el fondo con data-backdrop-close="false"; aquí están ambos, así que el botón de abajo es la única salida.' },
  'comp_modal.mod2_open': { de: 'Den ganzen Ablauf ansehen', es: 'Ver todo el proceso' },
  'comp_modal.mod2_title': { de: 'So arbeiten wir', es: 'Cómo trabajamos' },
  'comp_modal.mod2_step1': { de: 'Entdecken — wir lernen Ziele, Zielgruppe und Rahmenbedingungen kennen.', es: 'Descubrimiento — conocemos tus objetivos, tu público y tus restricciones.' },
  'comp_modal.mod2_step2': { de: 'Design & Umsetzung — wöchentliche Vorschauen, dein Feedback fließt ein.', es: 'Diseño y desarrollo — vistas previas semanales, con tu feedback integrado.' },
  'comp_modal.mod2_step3': { de: 'Launch & Pflege — wir gehen live, messen und verbessern weiter.', es: 'Lanzamiento y cuidado — publicamos, medimos y seguimos mejorando.' },
  'comp_modal.sec_form_t': { de: 'Ein Modal mit einem Formular', es: 'Un modal con un formulario' },
  'comp_modal.sec_form_d': { de: 'Setze das eingebettete Kontaktformular direkt in den Dialog — es sendet, validiert und zeigt seine Erfolgsmeldung, ohne dass die Seite verlassen wird.', es: 'Coloca el formulario de contacto incrustado directamente en el diálogo — envía, valida y muestra su mensaje de éxito sin salir nunca de la página.' },
  'comp_modal.mod3_open': { de: 'Kontakt aufnehmen', es: 'Ponte en contacto' },
  'comp_modal.mod3_title': { de: 'Schreib uns eine Nachricht', es: 'Envíanos un mensaje' },
  'comp_modal.mod3_body': { de: 'Wir antworten meist innerhalb eines Tages.', es: 'Solemos responder en un día.' },
  'comp_modal.sec_nojs_t': { de: 'Ohne JavaScript & globale Modals', es: 'Sin JavaScript y modales globales' },
  'comp_modal.sec_nojs_d': { de: 'Ohne JS tut der Auslöser einfach nichts und die Seite bleibt voll nutzbar — leg also nie wesentliche Inhalte allein in ein Modal. Ein Navigations-Platzhalter, der auf eine #dialog-id zeigt, kann ein Modal auch aus dem Menü öffnen.', es: 'Sin JS el disparador simplemente no hace nada y la página sigue siendo plenamente usable — así que nunca pongas contenido esencial solo dentro de un modal. Un marcador de navegación que apunte a un #dialog-id también puede abrir uno desde el menú.' },

  // comp_banner (a free-content dismissible banner — NOT the consent banner)
  'comp_banner.bn_intro': { de: 'Ein frei gestaltbares Banner, das du überall platzierst — die Runtime blendet es ein und merkt sich die Schließung in localStorage, damit es nicht nervt. Du schreibst den Inhalt und die Aktions-Schaltflächen; Position, Häufigkeit, Schlummern, Verzögerung und Eingangsanimation sind alles Attribut-Schalter. Es ist NICHT das Cookie-Banner — das ist der automatisch eingefügte Consent Manager.', es: 'Un banner de contenido libre que colocas donde quieras — el runtime lo muestra y recuerda el cierre en localStorage para que no moleste. Tú escribes el cuerpo y los botones de acción; la posición, la frecuencia, el aplazamiento, el retardo y la animación de entrada son todos interruptores de atributo. NO es el banner de cookies — ese es el Consent Manager autoinyectado.' },
  'comp_banner.sec_layouts_t': { de: 'Layouts', es: 'Diseños' },
  'comp_banner.sec_layouts_d': { de: 'Dieselbe Komponente, jede Form. Eine Leiste über die volle Breite, eine Eck-Karte oder eine zentrierte Karte — Inhalt + data-position bestimmen das Aussehen. Die drei Aktions-Parts sind dismiss (folgt der Häufigkeit), dismiss-forever („nicht mehr anzeigen“) und remind (schlummern).', es: 'El mismo componente, cualquier forma. Una barra a todo el ancho, una tarjeta de esquina o una tarjeta centrada — el contenido + data-position deciden el aspecto. Las tres partes de acción son dismiss (sigue la frecuencia), dismiss-forever («no volver a mostrar») y remind (posponer).' },
  'comp_banner.sec_place_t': { de: 'Platzierungen', es: 'Ubicaciones' },
  'comp_banner.sec_place_d': { de: 'data-position heftet es an jede Kante, Ecke oder die Mitte — oder inline, in den Seitenfluss. (Standard: bottom-right.)', es: 'data-position lo fija a cualquier borde, esquina o el centro — o inline, en el flujo de la página. (Por defecto: bottom-right.)' },
  'comp_banner.sec_freq_t': { de: 'Wie oft es zurückkommt', es: 'Con qué frecuencia vuelve' },
  'comp_banner.sec_freq_d': { de: 'Ein einfaches dismiss respektiert data-frequency; dismiss-forever blendet dauerhaft aus; remind schlummert für data-remind-days. Gib jedem Banner eine EINDEUTIGE data-sw-banner-id, damit Schließungen getrennt verfolgt werden.', es: 'Un dismiss normal respeta data-frequency; dismiss-forever lo oculta para siempre; remind lo pospone durante data-remind-days. Da a cada banner un data-sw-banner-id ÚNICO para que los cierres se registren por separado.' },
  'comp_banner.sec_entrance_t': { de: 'Eingang & Bewegung', es: 'Entrada y movimiento' },
  'comp_banner.sec_entrance_d': { de: 'Standardmäßig blendet ein Banner mit Einblenden + Aufsteigen ein (und blendet beim Schließen aus). Füge einen data-sw-animation-Effekt hinzu — fade-up, zoom-in, flip-left, … mit data-sw-delay/-duration/-easing — und es nutzt diesen für den Eingang; das Schließen kehrt den jeweils genutzten um. data-delay blendet es nach N ms oder beim ersten Scrollen ein.', es: 'Por defecto un banner aparece con fundido + ascenso (y se desvanece al cerrarse). Añade un efecto data-sw-animation — fade-up, zoom-in, flip-left, … con data-sw-delay/-duration/-easing — y lo usa para la entrada; el cierre invierte el que se haya usado. data-delay lo muestra tras N ms o el primer desplazamiento.' },
  'comp_banner.sec_bg_t': { de: 'Reichhaltige Hintergründe', es: 'Fondos enriquecidos' },
  'comp_banner.sec_bg_d': { de: 'Lege ein absolut positioniertes Medien-Element + einen Schleier unter den Inhalt für ein randloses Foto, einen CSS-Verlauf oder einen Live-WebGL-Shader (eine verschachtelte data-sw-component="shader-bg"). Die drei unten sind live — schließe eines und lade neu.', es: 'Coloca un elemento multimedia absoluto + un velo bajo el contenido para una foto a sangre, un degradado CSS o un shader WebGL en vivo (un data-sw-component="shader-bg" anidado). Los tres de abajo están en vivo — cierra uno y recarga.' },
  'comp_banner.sec_nojs_t': { de: 'Ohne JavaScript', es: 'Sin JavaScript' },
  'comp_banner.sec_nojs_d': { de: 'Es erscheint gar kein Banner — es wird mit dem hidden-Attribut ausgeliefert und erst die Runtime blendet es ein, ohne Skripte wird die Seite also einfach unverändert ausgeliefert.', es: 'No aparece ningún banner — se entrega con el atributo hidden y es el runtime el que lo muestra, así que sin scripts la página se sirve tal cual.' },

  // comp_consent (Consent Manager — GDPR / ePrivacy gating of third-party embeds)
  'comp_consent.cn_intro': { de: 'Der Consent Manager hilft dir, die DSGVO und die ePrivacy-„Cookie-Richtlinie“ einzuhalten: Drittanbieter-Einbettungen und -Skripte, die Cookies setzen oder Besucher tracken (YouTube, Maps, Analytics, Chat-Widgets, …), werden BLOCKIERT, bis der Besucher eine VORHERIGE, informierte, freiwillige und granulare Einwilligung gibt — pro Kategorie. Aktiviere ihn einmal (Website → Einwilligung) und das Banner wird auf jeder Seite automatisch eingefügt; er leitet außerdem die Content-Security-Policy jeder Seite aus den erlaubten Einbettungen ab.', es: 'El Consent Manager te ayuda a cumplir el RGPD y la «Ley de Cookies» de ePrivacy: las incrustaciones y scripts de terceros que ponen cookies o rastrean a los visitantes (YouTube, Maps, analítica, widgets de chat, …) se BLOQUEAN hasta que el visitante da un consentimiento PREVIO, informado, libre y granular — por categoría. Actívalo una vez (Sitio web → Consentimiento) y el banner se inyecta en cada página; además deriva la Content-Security-Policy de cada página a partir de las incrustaciones permitidas.' },
  'comp_consent.sec_embed_t': { de: 'Eine gesperrte YouTube-Einbettung', es: 'Una incrustación de YouTube bloqueada' },
  'comp_consent.sec_embed_d': { de: 'Das Video unten ist ein normales <iframe>, aber weil die Einwilligung aktiv ist, wird es ZURÜCKGEHALTEN: Bis du es erlaubst, wird keine Anfrage an YouTube gesendet und kein Cookie gesetzt — diese Regel der vorherigen Einwilligung ist der Kern der ePrivacy-Richtlinie. Du siehst einen Platzhalter mit der URL und „Einmal erlauben“ / „Immer erlauben“. Es trägt data-sw-consent="marketing" und gehört damit zur Kategorie Marketing.', es: 'El vídeo de abajo es un <iframe> normal, pero como el consentimiento está activo se RETIENE: hasta que lo permitas, no se hace ninguna petición a YouTube ni se ponen cookies — esa regla de consentimiento previo es el núcleo de la Directiva ePrivacy. Verás un marcador de posición con la URL y «Permitir una vez» / «Permitir siempre». Lleva data-sw-consent="marketing", así que pertenece a la categoría Marketing.' },
  'comp_consent.cn_reopen_t': { de: 'Jederzeit widerrufbar', es: 'Cámbialo cuando quieras' },
  'comp_consent.cn_reopen_d': { de: 'Die DSGVO verlangt, dass der Widerruf der Einwilligung so einfach ist wie ihre Erteilung. Diese Schaltfläche öffnet den Manager erneut, damit ein Besucher jede Kategorie jederzeit prüfen oder widerrufen kann.', es: 'El RGPD exige que retirar el consentimiento sea tan fácil como darlo. Este botón vuelve a abrir el gestor para que un visitante pueda revisar o revocar cada categoría cuando quiera.' },
  'comp_consent.cn_reopen_btn': { de: 'Cookie-Einstellungen', es: 'Configuración de cookies' },
  'comp_consent.sec_test_t': { de: 'So testest du es', es: 'Cómo probarlo' },
  'comp_consent.cn_test_1': { de: 'Erster Besuch (noch keine Einwilligung): Das Video wird zurückgehalten — ein Platzhalter, kein Player. Öffne das Netzwerk-Panel des Browsers und lade neu: Es gibt NULL Anfragen an youtube.com und es werden keine Cookies gesetzt. Das ist die DSGVO/ePrivacy-Garantie — nichts von Dritten lädt vor der Einwilligung.', es: 'Primera visita (sin consentimiento aún): el vídeo se retiene — un marcador, no el reproductor. Abre el panel de Red del navegador y recarga: hay CERO peticiones a youtube.com y no se ponen cookies. Esa es la garantía del RGPD/ePrivacy: nada de terceros carga antes del consentimiento.' },
  'comp_consent.cn_test_2': { de: 'Erlauben: Klicke „Einmal erlauben“ auf dem Platzhalter, um das Video für diesen Besuch zu laden, oder „Immer erlauben“, um es zu merken — oder „Alle akzeptieren“ im Cookie-Banner. Da die Einbettung in der Kategorie Marketing liegt, bleibt sie zurückgehalten, wenn nur Funktional akzeptiert wird — das ist granulare Einwilligung.', es: 'Permitir: pulsa «Permitir una vez» en el marcador para cargar el vídeo en esta visita, o «Permitir siempre» para recordarlo — o «Aceptar todo» en el banner de cookies. Como la incrustación está en la categoría Marketing, si solo aceptas Funcional sigue retenida — eso es consentimiento granular.' },
  'comp_consent.cn_test_3': { de: 'Widerrufen: Klicke oben auf „Cookie-Einstellungen“, wähle „Alle ablehnen“ und lade neu — das Video wird wieder zurückgehalten, und die Cookies des Players werden nicht mehr geladen.', es: 'Retirar: pulsa «Configuración de cookies» arriba, elige «Rechazar todo» y recarga — el vídeo vuelve a retenerse y las cookies del reproductor ya no se cargan.' },

  // comp_forms (migrated from page.data)
  'comp_forms.frm_intro': { de: 'Baue ein Formular einmal im Formulare-Tab und bette es dann überall ein — {{sw-form "id"}} oder data-sw-form="id" expandiert das Ganze beim Rendern: Felder, Labels, Validierung, einen Honeypot und eine Inline-Erfolgsmeldung. Es gibt kein Markup von Hand und nichts zu verdrahten.', es: 'Crea un formulario una vez en la pestaña Formularios y luego incrústalo donde quieras — {{sw-form "id"}} o data-sw-form="id" lo expande al renderizar: campos, etiquetas, validación, un honeypot y un mensaje de éxito en línea. No hay marcado que escribir a mano ni nada que cablear.' },
  'comp_forms.sec_helper_t': { de: 'Mit dem Helper einbetten', es: 'Incrustar con el helper' },
  'comp_forms.sec_helper_d': { de: 'Das einfachste Formular: ein Helper-Aufruf expandiert die gespeicherte „contact“-Definition. Mit class= gestaltest du den Wrapper.', es: 'El formulario más simple: una llamada al helper expande la definición «contact» guardada. Añade class= para dar estilo al contenedor.' },
  'comp_forms.sec_attr_t': { de: 'Per Attribut einbetten, in deinem eigenen Layout', es: 'Incrustar por atributo, en tu propio diseño' },
  'comp_forms.sec_attr_d': { de: 'Lieber von Hand platzieren? Ein leeres Element mit data-sw-form="contact" wird mit demselben Markup gefüllt — setze es in jeden Container, den du gestaltet hast, etwa diese Karte.', es: '¿Prefieres colocarlo a mano? Un elemento vacío con data-sw-form="contact" se rellena con el mismo marcado — ponlo en cualquier contenedor con estilo, como esta tarjeta.' },
  'comp_forms.sec_about_t': { de: 'Spam-Schutz, sprachbewusst, ohne JS', es: 'Antispam, según el idioma, sin JS' },
  'comp_forms.sec_about_d': { de: 'Jede Einbettung erhält einen versteckten Honeypot, eine Zeitfalle beim Absenden und optional hCaptcha; sie sendet JSON an den eingefügten Endpunkt und zeigt Erfolg oder Fehler inline. Auf einer übersetzten Seite löst „contact“ automatisch das passende lokalisierte Formular auf. Ohne JavaScript hat das Formular kein action-Attribut und sendet nicht — Spam-Schutz by design.', es: 'Cada incrustación recibe un honeypot oculto, una trampa de tiempo al enviar y hCaptcha opcional; envía JSON al endpoint inyectado y muestra el éxito o el error en línea. En una página traducida, «contact» resuelve automáticamente al formulario localizado correspondiente. Sin JavaScript el formulario no tiene atributo action y no se envía — antispam por diseño.' },

  // comp_datetimepicker (migrated from page.data)
  'comp_datetimepicker.dtp_intro': { de: 'Ein Attribut auf ein Textfeld und es wird zu einem gebrandeten Kalender mit Schieberegler-Zeitauswahl. Datum, Zeitraum, Datum+Zeit und Uhrzeit — jeweils ein einziger data-mode-Wert, und Farben und Schrift stammen automatisch aus der CI deiner Website. Ein Zeitraum öffnet sich als zwei Monate nebeneinander, sodass monatsübergreifende Spannen leichtfallen.', es: 'Pon un atributo en un campo de texto y se convierte en un calendario con la marca del sitio y un selector de hora con deslizador. Fecha, rango, fecha y hora, y solo hora — cada uno es un único valor data-mode, y los colores y la tipografía provienen automáticamente de la identidad visual de tu sitio. Un rango se abre como dos meses uno al lado del otro, así que los tramos que cruzan de mes son fáciles.' },
  'comp_datetimepicker.sec_basic_t': { de: 'Eine Zeile für den Normalfall', es: 'Una línea para el caso común' },
  'comp_datetimepicker.sec_basic_d': { de: 'Eine Datumsauswahl ist nur data-sw-component="datetimepicker" auf einem Textfeld — ohne Konfiguration. Ins Feld klicken, der Kalender öffnet sich; der gewählte Tag nutzt deine Primärfarbe.', es: 'Un selector de fecha es solo data-sw-component="datetimepicker" en un campo de texto — sin configuración. Haz clic en el campo para abrir el calendario; el día seleccionado usa tu color primario.' },
  'comp_datetimepicker.lbl_date': { de: 'Termindatum', es: 'Fecha de la cita' },
  'comp_datetimepicker.ph_date': { en: 'Select a date…', de: 'Datum wählen…', es: 'Selecciona una fecha…' },
  'comp_datetimepicker.sec_modes_t': { de: 'Vier Modi, ein Attribut', es: 'Cuatro modos, un atributo' },
  'comp_datetimepicker.sec_modes_d': { de: 'data-mode wechselt die Auswahl: ein einzelnes Datum, ein über zwei Monate gezeigter Start–Ende-Zeitraum, ein Datum mit Zeit-Schieberegler oder nur die Uhrzeit. Alles andere bleibt automatisch.', es: 'data-mode cambia el selector: una sola fecha, un rango inicio–fin mostrado en dos meses, una fecha con deslizador de hora, o solo la hora. Todo lo demás permanece automático.' },
  'comp_datetimepicker.lbl_range': { de: 'Zeitraum (zwei Monate)', es: 'Rango de fechas (dos meses)' },
  'comp_datetimepicker.ph_range': { en: 'Check-in – Check-out', de: 'Anreise – Abreise', es: 'Entrada – Salida' },
  'comp_datetimepicker.lbl_datetime': { de: 'Datum & Zeit', es: 'Fecha y hora' },
  'comp_datetimepicker.ph_datetime': { en: 'Pick a day and time…', de: 'Tag und Uhrzeit wählen…', es: 'Elige un día y una hora…' },
  'comp_datetimepicker.lbl_time': { de: 'Nur Uhrzeit', es: 'Solo hora' },
  'comp_datetimepicker.ph_time': { en: 'Pick a time…', de: 'Uhrzeit wählen…', es: 'Elige una hora…' },
  'comp_datetimepicker.sec_full_t': { de: 'Volle Kontrolle, wenn nötig', es: 'Control total cuando lo necesitas' },
  'comp_datetimepicker.sec_full_d': { de: 'Für die übrigen Fälle gibt es data-*-Attribute: Grenzen (data-min / data-max), Wochenstart, mehrere Daten, Minutenschritt, 12-/24-Stunden-Format, Sprache und data-months zum Verbreitern des Panels. Setze die Markierung statt auf ein Eingabefeld auf ein Block-Element für einen dauerhaft geöffneten Kalender — hier ein Doppelpanel-Zeitraum:', es: 'Para los demás casos hay atributos data-*: límites (data-min / data-max), inicio de semana, varias fechas, paso de minutos, formato de 12/24 horas, idioma y data-months para ampliar el panel. Pon la marca en un elemento de bloque en lugar de un campo para un calendario siempre abierto — aquí un rango con panel doble:' },
  'comp_datetimepicker.lbl_inline': { de: 'Dauerhaft geöffneter Doppelpanel-Kalender', es: 'Calendario de panel doble siempre abierto' },
  'comp_datetimepicker.sec_nojs_t': { de: 'Ohne JavaScript', es: 'Sin JavaScript' },
  'comp_datetimepicker.sec_nojs_d': { de: 'Laufen keine Skripte, bleibt jedes Feld ein gewöhnliches Textfeld — der Besucher kann weiterhin einen Wert eingeben und er wird im Formular gesendet. Nur das Kalender-Popup steht nicht zur Verfügung.', es: 'Si los scripts no se ejecutan, cada campo sigue siendo un campo de texto normal — el visitante aún puede escribir un valor y se envía dentro de un formulario. Solo el calendario emergente no está disponible.' },
};
