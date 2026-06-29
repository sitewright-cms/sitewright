import type { PageTranslationSeed } from '../pages/variants.js';
import { translationsEsContent } from './es-content.js';

// ---------------------------------------------------------------- SPANISH translations
// Mirror of de.ts — one seed per English page; see that file for the shape. `href_*` keys point
// at the SPANISH routes; tier-2 attribute/config keys included. Long-form content (blog, legal)
// lives in es-content.ts.
export function translationsEs(assets: Record<string, string>): Record<string, PageTranslationSeed> {
  return {
  home: {
    title: 'Northwind Web Studio — Webs que traen negocio',
    navTitle: 'Inicio',
    description: 'Estudio web boutique en San Francisco: estrategia, diseño y sitios estáticos artesanales que le traen más negocio.',
    data: {
      stat1_n: '120+',
      stat2_n: '9',
      stat3_n: '100',
      stat4_n: '38%',
      spotlight: 'proj-harbor-es',
      href_contact: '/es/contacto',
      href_work: '/es/trabajos',
    },
  },
  work: {
    path: 'trabajos',
    title: 'Nuestro trabajo',
    navTitle: 'Trabajos',
    description: 'Webs recientes de comercio, salud, finanzas y cultura — todas artesanales y rápidas.',
    data: {
    },
  },
  services: {
    path: 'servicios',
    title: 'Servicios',
    navTitle: 'Servicios',
    description: 'Estrategia, diseño, desarrollo, marca, SEO y mantenimiento — de principio a fin o por fases.',
    data: {
      href_contact: '/es/contacto',
    },
  },
  'service-web-design': {
    path: 'diseno-web',
    title: 'Diseño web',
    description: 'Interfaces distintivas y fieles a la marca — al píxel en cualquier pantalla.',
    data: {
      svc_ref: 'svc-design-es',
      href_contact: '/es/contacto',
    },
  },
  'service-seo': {
    path: 'seo',
    title: 'SEO y rendimiento',
    description: 'SEO técnico, Core Web Vitals y analítica — integrados desde el primer día.',
    data: {
      svc_ref: 'svc-seo-es',
      href_contact: '/es/contacto',
    },
  },
  'service-pricing': {
    path: 'precios',
    title: 'Precios',
    description: 'Precios honestos y cerrados para proyectos y planes de mantenimiento mensuales.',
    data: {
      href_contact: '/es/contacto',
      href_faq: '/es/preguntas-frecuentes',
    },
  },
  about: {
    path: 'nosotros',
    title: 'Nosotros',
    navTitle: 'Nosotros',
    description: 'Un equipo pequeño y sénior de diseñadores e ingenieros — a propósito.',
    data: {
      gallery_folder: 'Studio',
    },
  },
  careers: {
    path: 'empleo',
    title: 'Empleo',
    description: 'Vacantes en Northwind — equipo pequeño, trabajo exigente, cero tonterías.',
    data: {
      href_contact: '/es/contacto',
    },
  },
  contact: {
    path: 'contacto',
    title: 'Contacto',
    navTitle: 'Contacto',
    description: 'Cuéntenos su proyecto — respondemos en un día laborable.',
    data: {
      c_modal_b: '<p>Le preguntamos por sus objetivos, sus plazos y por cómo se ve «funcionar» dentro de un año. Usted nos pregunta lo que quiera.</p><p>Si encajamos, recibe un presupuesto cerrado en dos días. Si no, se lo decimos con franqueza — y le recomendamos a alguien bueno.</p>',
    },
  },
  components: {
    path: 'componentes',
    title: 'Componentes',
    navTitle: 'Componentes',
    description:
      'Los componentes interactivos propios con los que está construido este sitio — sliders y galerías lightbox — cada uno en todas las variantes que ofrece la plataforma.',
    data: {
    },
  },
  'comp-slider': {
    path: 'slider',
    title: 'Sliders',
    navTitle: 'Sliders',
    description:
      'El Carousel en todos sus modos — hero, fundido, deslizamiento, varias tarjetas con asomo, alineación, ticker automático, rueda + altura automática y clic para avanzar.',
    data: {
    },
  },
  'comp-lightbox': {
    path: 'lightbox',
    title: 'Lightbox',
    navTitle: 'Lightbox',
    description:
      'El visor de galería a pantalla completa — una tira de miniaturas, una animación de apertura que amplía desde la miniatura, un contador de imágenes + leyenda, teclado + deslizamiento + pinch-zoom, y conmutadores para la tira, las flechas, el ajuste y más.',
    data: {
      aria_single: 'Foto destacada',
    },
  },
  'comp-tabs': {
    path: 'pestanas',
    title: 'Pestañas',
    navTitle: 'Pestañas',
    description:
      'Paneles de contenido tras una lista de pestañas accesible — navegación con las flechas, los botones construidos a partir del título de cada panel, y un respaldo sin JS que apila todos los paneles.',
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
      'Un botón que abre un diálogo nativo — la trampa de foco, Escape, el fondo y la inactivación del resto de la página los aporta el navegador; el tamaño se ajusta con una sola clase.',
    data: {
    },
  },
  'comp-parallax': {
    path: 'parallax',
    title: 'Parallax',
    navTitle: 'Parallax',
    description:
      'Movimiento, atenuación, escala y desenfoque a partir del scroll — un runtime diminuto gobernado por atributos data-sw-parallax. Cada efecto se ancla a su propia ventana del paso por el viewport (con una fase de salida opcional), y las escenas de profundidad apilan capas posicionadas en absoluto. Discreto por defecto y desactivado con movimiento reducido.',
    data: {
      px_intro:
        'Movimiento a partir del scroll. Añade un atributo data-sw-parallax-* a cualquier elemento y la plataforma incluye un runtime diminuto que lo desplaza, atenúa, escala o desenfoca a medida que pasa por el viewport — cada efecto anclado a su propia ventana, combinable, acotado y desactivado por completo para quienes prefieren menos movimiento. Desplázate hacia abajo.',
      hero_t: 'Escena de profundidad',
      hero_d:
        'Un contenedor recortado de capas apiladas — el fondo se desplaza y se acerca mientras el título asciende, aparece, escala y se enfoca al centro, y luego sale de nuevo.',
      depth_t: 'Profundidad — un movimiento de→a',
      depth_d:
        'data-sw-parallax-translate="de,a" desliza un elemento entre dos desplazamientos en píxeles al cruzar el viewport. Desplazamientos mayores parecen más cercanos; combina direcciones opuestas para dar profundidad. Observa cómo las tarjetas avanzan a distinto ritmo.',
      c1: 'primer plano',
      c2: 'estático',
      c3: 'fondo',
      fx_t: 'Atenuar · escalar · desenfocar',
      fx_d:
        'Cada canal adicional interpola de,a a lo largo de su ventana — data-sw-parallax-opacity, -scale y -blur — y se combinan en un mismo elemento.',
      t_fade: 'Aparece al subir',
      t_scale: 'Crece al desplazarse',
      t_blur: 'Entra en foco',
      anchor_t: 'Ancla la ventana — y vuelve a salir',
      anchor_d:
        'Por defecto un efecto recorre todo el paso, así que alcanza su punto máximo al salir por arriba. Añade -<efecto>-range="0,0.5" para terminar mientras está centrado; una ventana más corta deja espacio para una fase -<efecto>-out que lo anima de vuelta.',
      t_window: 'Opacidad total en el centro (-opacity-range="0,0.5")',
      t_inout: 'Aparece hacia el centro y luego sale',
      nojs_t: 'Sin JavaScript (o con movimiento reducido)',
      nojs_d:
        'Cada elemento permanece exactamente donde está en el documento — el runtime solo añade encima una transformación/opacidad/filtro, así que nada se desplaza, se solapa ni desaparece. El parallax es decoración, nunca estructura.',
    },
  },
  'comp-shader': {
    path: 'fondo-animado',
    title: 'Fondo animado',
    navTitle: 'Fondo animado',
    description:
      'Un fondo animado WebGL detrás de cualquier sección — 30 presets con la identidad visual, regulados solo por atributos data-* declarativos (preset, velocidad, intensidad, ángulo, colores, interactivo), nunca por código propio. Limpio para CSP, en pausa fuera de pantalla, un único fotograma estático con movimiento reducido y un degradado CSS de reserva sin JS.',
    data: {
      intro_lead:
        'Un fondo con vida, sin vídeo ni imagen. Añade data-sw-component="shader-bg" a cualquier sección y la plataforma incluye un runtime WebGL diminuto y limpio para CSP que pinta un shader con tu identidad detrás del contenido — elige un preset, ajústalo con unos atributos data-* y seguirá los colores de tu marca y el tema claro/oscuro. Se pausa fuera de pantalla, muestra un fotograma fijo con movimiento reducido y, sin JavaScript, recurre a un degradado de marca.',
      hero_t: 'Marca el ambiente en un atributo',
      hero_d:
        'Todo este panel es un único shader-bg — mueve el puntero por encima. Los colores son tus tokens de identidad; una capa de legibilidad mantiene el texto nítido encima.',
      presets_t: 'Un preset para cada ambiente',
      presets_d:
        'Vienen treinta presets con nombre — desde degradados de malla suaves hasta seda fluida, cáusticas, lava y campos de estrellas. Pon data-preset y lo demás es automático; aquí van seis, cada uno recoloreado a la paleta de este sitio.',
      p_mesh: 'Degradado de malla',
      p_silk: 'Flujo de seda',
      p_caustics: 'Cáusticas',
      p_lava: 'Lámpara de lava',
      p_waterfall: 'Cascada',
      p_starfield: 'Campo de estrellas',
      knobs_t: 'Ajústalo con data-*',
      knobs_d:
        'Más allá del preset, cuatro reguladores opcionales moldean el aspecto — data-speed (0–4), data-intensity (0–1, saturación + brillo), data-angle (grados) y data-interactive (deja que el puntero lo deforme). data-colors puede incluso reasignar los tres huecos de la paleta a otros tokens de identidad.',
      k_calm: 'Calmado — baja intensidad, lento',
      k_vivid: 'Vívido — alta intensidad',
      k_interactive: 'Interactivo — sigue al puntero',
      nojs_t: 'Limpio para CSP, accesible y nunca obligatorio',
      nojs_d:
        'El runtime se entrega como un único components.js externo desde tu propio origen (sin script en línea, sin eval ni Workers) y solo cuando una página lo usa. Sin JavaScript — o con prefers-reduced-motion — el fondo es un degradado CSS quieto hecho con los mismos tokens de marca, así que el contenido nunca depende de la animación.',
    },
  },
  'comp-forms': {
    path: 'formularios',
    title: 'Formularios',
    navTitle: 'Formularios',
    description:
      'Incrusta un formulario configurado en cualquier sitio con una sola etiqueta — campos, validación, antispam y éxito en línea se generan por ti, y se elige el idioma correcto automáticamente.',
    data: {
    },
  },
  'comp-datetimepicker': {
    path: 'selector-fecha-hora',
    title: 'Selector de fecha y hora',
    navTitle: 'Selector de fecha',
    description:
      'Un calendario con la identidad visual del sitio y un selector de hora con deslizador sobre un campo de texto simple — fecha, un rango de dos meses con panel doble, fecha y hora, y solo hora, todos desde un atributo, con control total mediante data-* y una alternativa sin JS.',
    data: {
    },
  },
  faq: {
    path: 'preguntas-frecuentes',
    title: 'Preguntas frecuentes',
    navTitle: 'FAQ',
    description: 'Respuestas a las preguntas con las que empieza todo proyecto: plazos, coste, edición, hosting.',
    data: {
      href_contact: '/es/contacto',
    },
  },
  shop: {
    path: 'tienda',
    title: 'Merch del estudio — tienda Northwind',
    navTitle: 'Tienda',
    description: 'Merch del estudio para frikis de la web — añada al carrito y pida por WhatsApp, correo o enlace de pago.',
    data: {
      heading: 'Merch del estudio',
      intro: 'Un detalle para frikis de la web. Añada al carrito y pida por WhatsApp, correo o enlace de pago.',
    },
  },
  'nav-audit': {
    title: '<span class="inline-flex items-center gap-1.5 font-semibold text-accent">{{sw-icon "sparkles" "h-4 w-4"}} Auditoría gratis</span>',
  },
  ...translationsEsContent(assets),
  };
}
