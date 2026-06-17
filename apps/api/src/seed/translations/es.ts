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
  'comp-cookie': {
    path: 'consentimiento-cookies',
    title: 'Consentimiento de cookies',
    navTitle: 'Cookies',
    description:
      'Un banner de consentimiento guardado en localStorage — se entrega oculto, se muestra una vez en la primera visita y se oculta para siempre al aceptarlo. Es un componente de slot de plantilla, activo en todo el sitio.',
    data: {
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
