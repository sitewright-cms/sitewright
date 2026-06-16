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
      hero_alt: 'Una web reciente de Northwind',
      stat1_n: '120+', stat1_l: 'Webs entregadas',
      stat2_n: '9', stat2_l: 'Años en el mercado',
      stat3_n: '100', stat3_l: 'Lighthouse medio',
      stat4_n: '38%', stat4_l: 'Más consultas de media',
      spotlight: 'proj-harbor-es',
      aria_prev: 'Testimonio anterior',
      aria_next: 'Testimonio siguiente',
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
      aria_caption: 'Galería de proyectos',
    },
  },
  services: {
    path: 'servicios',
    title: 'Servicios',
    navTitle: 'Servicios',
    description: 'Estrategia, diseño, desarrollo, marca, SEO y mantenimiento — de principio a fin o por fases.',
    data: {
      proc_title: 'Un proceso simple y probado',
      p1_t: 'Descubrir', p1_b: 'Objetivos, audiencia y las métricas que importan.',
      p2_t: 'Diseñar', p2_b: 'Interfaces y un sistema de marca, revisados juntos.',
      p3_t: 'Construir', p3_b: 'Rápido, accesible, gestionable, listo para SEO.',
      p4_t: 'Lanzar y cuidar', p4_b: 'Publicamos, medimos y seguimos mejorando.',
      srv_cta: 'Empezar un proyecto',
      href_contact: '/es/contacto',
    },
  },
  'service-web-design': {
    path: 'diseno-web',
    title: 'Diseño web',
    description: 'Interfaces distintivas y fieles a la marca — al píxel en cualquier pantalla.',
    data: {
      wd_eyebrow: 'Servicio',
      wd_h1: 'Diseño web',
      wd_intro: 'Interfaces distintivas y fieles a la marca, al píxel en cualquier pantalla — del primer wireframe a una UI pulida y accesible.',
      wd_price_l: 'Rango habitual:',
      wd_1t: 'Sistemas de diseño', wd_1b: 'Componentes y tokens reutilizables que escalan con su marca.',
      wd_2t: 'Responsivo por defecto', wd_2b: 'Cada layout se trabaja para móvil, tablet y escritorio.',
      wd_cta: 'Empezar un proyecto',
      svc_ref: 'svc-design-es',
      href_contact: '/es/contacto',
    },
  },
  'service-seo': {
    path: 'seo',
    title: 'SEO y rendimiento',
    description: 'SEO técnico, Core Web Vitals y analítica — integrados desde el primer día.',
    data: {
      seo_eyebrow: 'Servicio',
      seo_h1: 'SEO y rendimiento',
      seo_intro: 'SEO técnico, Core Web Vitals y analítica desde el primer día — para que la web rápida y hermosa que lanza sea la que Google premia.',
      seo_price_l: 'Rango habitual:',
      seo_1t: 'Core Web Vitals', seo_1b: 'Afinamos LCP, CLS e INP hasta que todo esté en verde.',
      seo_2t: 'SEO técnico', seo_2b: 'Datos estructurados, sitemaps y marcado limpio y rastreable.',
      seo_cta: 'Empezar un proyecto',
      svc_ref: 'svc-seo-es',
      href_contact: '/es/contacto',
    },
  },
  'service-pricing': {
    path: 'precios',
    title: 'Precios',
    description: 'Precios honestos y cerrados para proyectos y planes de mantenimiento mensuales.',
    data: {
      pr_h1: 'Precios honestos, a alcance cerrado',
      pr_intro: 'Nada de estimaciones que se duplican a mitad de proyecto. Elija un paquete, conozca la cifra, reciba la web.',
      pr_note: 'Precios en USD, impuestos no incluidos. Los proyectos mayores se presupuestan a medida — consúltenos.',
      pr_cta: 'Empezar un proyecto',
      pr_faq: 'Leer las preguntas frecuentes',
      tab_projects: 'Proyectos',
      tab_care: 'Mantenimiento',
      pr_badge: 'El más elegido',
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
      ab_p2: 'Creemos que una gran web es el miembro más trabajador de su equipo: rápida, clara y discretamente persuasiva. Esa convicción guía cada decisión que tomamos.',
      ab_img_alt: 'El estudio Northwind',
      val_title: 'Lo que valoramos',
      v1_t: 'Oficio antes que volumen', v1_b: 'Cuidamos los detalles que otros se saltan — porque los detalles son lo que la gente siente.',
      v2_t: 'La velocidad es una funcionalidad', v2_b: 'Cada web que entregamos es estática, optimizada y carga al instante.',
      v3_t: 'Hablar claro', v3_b: 'Alcances cerrados, plazos claros y consejo honesto — aunque nos cueste la venta adicional.',
      team_title: 'Las personas con las que trabajará',
      gal_title: 'Dentro del estudio',
      gal_empty: 'Aún no hay fotos — suba algunas a la carpeta Studio.',
      gallery_folder: 'Studio',
      aria_gallery: 'Fotos del estudio',
    },
  },
  careers: {
    path: 'empleo',
    title: 'Empleo',
    description: 'Vacantes en Northwind — equipo pequeño, trabajo exigente, cero tonterías.',
    data: {
      ca_h1: 'Venga a hacer el mejor trabajo de su carrera',
      ca_intro: 'Un equipo pequeño significa que su trabajo se publica, lleva su nombre y nadie gestiona al gestor. Estas vacantes están abiertas ahora mismo.',
      ca_empty: 'Ahora mismo no hay vacantes — pero un buen portfolio lo leemos siempre.',
      ca_cta_t: '¿No ve su puesto?',
      ca_cta_b: 'Convénzanos. La mejor gente rara vez encaja en una plantilla.',
      ca_cta: 'Escríbanos',
      badge_remote: 'Remoto posible',
      posted_l: 'Publicado',
      href_contact: '/es/contacto',
    },
  },
  contact: {
    path: 'contacto',
    title: 'Contacto',
    navTitle: 'Contacto',
    description: 'Cuéntenos su proyecto — respondemos en un día laborable.',
    data: {
      c_hours: 'Lun–Vie, 9–18 h (PT)',
      c_modal_btn: '¿Qué pasa en la llamada inicial?',
      c_modal_t: 'Una conversación de 20 minutos, sin discurso de ventas',
      c_modal_b: '<p>Le preguntamos por sus objetivos, sus plazos y por cómo se ve «funcionar» dentro de un año. Usted nos pregunta lo que quiera.</p><p>Si encajamos, recibe un presupuesto cerrado en dos días. Si no, se lo decimos con franqueza — y le recomendamos a alguien bueno.</p>',
      c_form_t: 'Consulta de proyecto',
      c_close: 'Cerrar',
    },
  },
  components: {
    path: 'componentes',
    title: 'Componentes',
    navTitle: 'Componentes',
    description:
      'Los componentes interactivos propios con los que está construido este sitio — sliders y galerías lightbox — cada uno en todas las variantes que ofrece la plataforma.',
    data: {
      comp_eyebrow: 'Showcase',
      comp_h1: 'Componentes interactivos',
      comp_intro:
        'Los componentes propios con los que está construido este sitio, cada uno en todas sus configuraciones — primero los valores por defecto, después cada opción. Todo funciona con teclado, táctil y sin JavaScript.',
      a_view: 'Explorar',
    },
  },
  'comp-slider': {
    path: 'slider',
    title: 'Sliders',
    navTitle: 'Sliders',
    description:
      'El Carousel en todos sus modos — hero, fundido, deslizamiento, varias tarjetas con asomo, alineación, ticker automático, rueda + altura automática y clic para avanzar.',
    data: {
      a_prev: 'Diapositiva anterior',
      a_next: 'Diapositiva siguiente',
      sld_intro:
        'Un componente, todas las configuraciones. Cada slider de abajo es marcado declarativo puro — un root data-sw-component, slots data-sw-part y opciones data-*.',
      sec_hero_t: 'Slider hero — un solo include',
      sec_hero_d:
        'La apertura clásica de portada: diapositivas de altura fija con imágenes de fondo, un efecto Ken Burns alternante y captions que entran. Todo este bloque es el Widget hero-slider — insértalo y luego edita sus diapositivas (imágenes + captions) como datos. Sin CSS propio.',
      sec_fade_t: 'Slider — los valores por defecto',
      sec_fade_d: 'Sin opciones: las diapositivas se funden, las flechas se superponen a media altura y los indicadores quedan centrados abajo.',
      aria_fade: 'Presentación de proyectos (fundido)',
      sec_slide_t: 'Efecto slide, bucle y autoplay',
      sec_slide_d: 'La banda deslizante en lugar del fundido, en bucle sin fin y avanzando sola — se pausa al pasar el cursor o recibir el foco.',
      aria_slide: 'Presentación de proyectos (deslizante)',
      sec_items_t: 'Varias tarjetas con asomo',
      sec_items_d: 'La variable --sw-items fija las tarjetas por vista; un valor fraccionario deja asomar una tarjeta. data-item-align="center" centra la tarjeta activa con un asomo a ambos lados — la primera y la última se ajustan a los bordes. Arrastra, desliza o usa las flechas.',
      aria_items: 'Tarjetas de proyectos',
      sec_align_t: 'Alinear una fila incompleta',
      sec_align_d: 'Cuando se muestran menos elementos de los que llenan la fila, data-item-align los distribuye horizontalmente — inicio (por defecto), centro o final — en lugar de dejarlos pegados a la izquierda.',
      aria_align: 'Herramientas destacadas (centradas)',
      sec_scroll_t: 'Desplazamiento automático continuo',
      sec_scroll_d: 'Un ticker constante en lugar de pasos — pensado para muros de logos y tiras de imágenes. Se pausa con el cursor o el foco.',
      aria_scroll: 'Ticker de proyectos',
      sec_wheel_t: 'Gestos de rueda y altura automática',
      sec_wheel_d: 'Mueve la rueda del ratón o el trackpad sobre el slider para avanzar; la banda anima su altura para ajustarse a cada cita.',
      aria_wheel: 'Opiniones de clientes',
      sec_click_t: 'Clic para avanzar',
      sec_click_d:
        'Sin flechas: un clic o un toque en cualquier punto de la diapositiva avanza — cada pulsación responde con una onda. Los enlaces dentro de la diapositiva siguen siendo enlaces, arrastrar sigue deslizando y las flechas del teclado funcionan en cuanto el slider tiene el foco.',
      aria_click: 'Proyectos destacados (clic para avanzar)',
    },
  },
  'comp-lightbox': {
    path: 'lightbox',
    title: 'Lightbox',
    navTitle: 'Lightbox',
    description:
      'El visor de galería a pantalla completa — una tira de miniaturas, una animación de apertura que amplía desde la miniatura, un contador de imágenes + leyenda, teclado + deslizamiento + pinch-zoom, y conmutadores para la tira, las flechas, el ajuste y más.',
    data: {
      lb_intro:
        'Una cuadrícula de fotos que se abre a pantalla completa al hacer clic — la imagen se amplía desde su mosaico, una tira de miniaturas y un contador la acompañan, y el deslizamiento / pinch-zoom / teclado funcionan. El foco vuelve al mosaico al cerrar.',
      sec_lb_t: 'Lightbox — los valores por defecto',
      sec_lb_d: 'Haz clic en cualquier foto: se amplía desde su mosaico a un visor a pantalla completa con tira de miniaturas, contador de imágenes y leyenda. Desliza o pellizca en táctil, flechas en el teclado, Escape para cerrar.',
      aria_gallery: 'Galería del estudio',
      sec_lbfx_t: 'Lightbox — versión reducida',
      sec_lbfx_d: 'La misma galería con la tira de miniaturas y las flechas desactivadas — un visor más limpio, gobernado solo por el deslizamiento, el teclado y el contador.',
      aria_gallery2: 'Galería de proyectos',
      sec_lb3_t: 'Lightbox — llenar la pantalla',
      sec_lb3_d: 'El ajuste puede llenar el viewport en vez de mostrar la imagen completa, la animación de apertura puede desactivarse y la imagen abierta puede reflejarse en la URL. En el móvil, la imagen ampliada puede desplazarse con la inclinación del dispositivo.',
      aria_gallery3: 'Galería del estudio, modo llenar',
      sec_single_t: 'Lightbox — una sola imagen (una línea)',
      sec_single_d:
        'Sin estructura de cuadrícula: pon data-sw-component="lightbox" directamente en un <img> y esa única imagen se abre a pantalla completa al hacer clic — toda la lightbox en una sola línea.',
      aria_single: 'Foto destacada',
      sec_masonry_t: 'Lightbox — cuadrícula masonry',
      sec_masonry_d:
        'Imágenes de proporciones variadas — verticales, horizontales y portadas anchas — escalonadas en columnas CSS equilibradas, sin recorte. El atributo va directamente en el contenedor de columnas; las imágenes forman una galería.',
      aria_masonry: 'Galería masonry',
      sec_group_t: 'Lightbox — una galería desde imágenes separadas',
      sec_group_d:
        'Estas imágenes son elementos independientes en sus propias tarjetas, pero un mismo nombre data-gallery las une en una sola lightbox — haz clic en cualquiera y pasa por ambas. Lo mismo funciona entre distintas secciones de la página.',
    },
  },
  'comp-tabs': {
    path: 'pestanas',
    title: 'Pestañas',
    navTitle: 'Pestañas',
    description:
      'Paneles de contenido tras una lista de pestañas accesible — navegación con las flechas, los botones construidos a partir del título de cada panel, y un respaldo sin JS que apila todos los paneles.',
    data: {
      tab_intro:
        'Un componente, cualquier contenido. Una raíz de pestañas con un slot de lista y un panel por pestaña — el runtime lee el título de cada panel, construye los botones, cablea las flechas y, sin JavaScript, apila todo de forma legible.',
      sec_basic_t: 'Etiquetas de pestaña — simples o con HTML',
      sec_basic_d:
        'Cada panel recibe una etiqueta: un data-sw-title simple, o un elemento opcional data-sw-part="tabtitle" para un icono u otro HTML. Es por pestaña, así que puedes mezclarlas — aquí las dos primeras pestañas son enriquecidas y la tercera es simple. Haz clic en una pestaña, o enfócala y usa las flechas.',
      tab1: 'Resumen',
      body1:
        'Las pestañas agrupan contenido relacionado en un área compacta — el visitante ve un panel a la vez y cambia entre ellos sin salir de la página.',
      tab2: 'Cómo funciona',
      body2:
        'Da a cada panel un título y su contenido. El runtime genera la lista de pestañas accesible, enlaza cada botón con su panel y mueve el foco con las flechas (Inicio y Fin saltan al primero y al último).',
      tab3: 'Accesibilidad',
      body3:
        'El marcado sigue el patrón de pestañas de WAI-ARIA: una lista de botones que controlan cada uno un panel etiquetado. El roving tabindex hace que Tab entre en el panel activo en vez de recorrer cada botón.',
      sec_rich_t: 'Los paneles admiten cualquier marcado',
      sec_rich_d:
        'Un panel es solo un contenedor — pon dentro una lista, una cuadrícula de cifras, una imagen o una llamada a la acción. Aquí un panel es una lista de verificación y el siguiente, un conjunto de cifras.',
      rtab1: 'Qué incluye',
      rli1: 'Paneles ilimitados, cada uno con su propio título y contenido',
      rli2: 'Compatibilidad con teclado, táctil y lector de pantalla de serie',
      rli3: 'Sin JavaScript propio — solo marcado declarativo',
      rtab2: 'En cifras',
      rstat1_n: '0',
      rstat1_l: 'líneas de JavaScript que escribes',
      rstat2_n: '100 %',
      rstat2_l: 'utilizable solo con el teclado',
      sec_nojs_t: 'Sin JavaScript',
      sec_nojs_d:
        'Si los scripts no se ejecutan, la lista de pestañas queda oculta y cada panel se muestra apilado, uno tras otro — todo el contenido sigue ahí y es legible. Nunca ocultes contenido esencial tras una pestaña que solo aparece con JS.',
    },
  },
  'comp-modal': {
    path: 'modal',
    title: 'Modal',
    navTitle: 'Modal',
    description:
      'Un botón que abre un diálogo nativo — la trampa de foco, Escape, el fondo y la inactivación del resto de la página los aporta el navegador; el tamaño se ajusta con una sola clase.',
    data: {
      mod_intro:
        'Un botón y un diálogo nativo. El navegador aporta la trampa de foco, Escape para cerrar, el ::backdrop atenuado y la inactivación de la página detrás — el componente solo cablea los botones de abrir y cerrar. El tamaño lo decides con una clase max-w-*.',
      mod_close: 'Cerrar',
      sec_basic_t: 'Modal — los valores por defecto',
      sec_basic_d:
        'Un disparador y un diálogo: el botón de cerrar con estilo (arriba a la derecha) se añade automáticamente. Un diálogo sin clases usa los colores de fondo y de texto de tu sitio, esquinas redondeadas y un relleno cómodo. Escape, el botón de cerrar o un clic en el fondo lo descartan.',
      mod1_open: '¿Qué pasa después?',
      mod1_title: '¿Qué pasa después?',
      mod1_body:
        'Tras tu consulta concertamos una llamada breve, definimos juntos el alcance y enviamos un presupuesto cerrado en dos días hábiles — sin compromiso.',
      sec_wide_t: 'Un diálogo más ancho con contenido rico',
      sec_wide_d:
        'El mismo componente, ampliado con max-w-2xl. Las clases de utilidad en el diálogo anulan cualquier valor por defecto — fondo, texto, relleno, radio. También puedes ocultar el botón de cerrar automático con data-closebutton="false" y mantener el modal abierto al hacer clic en el fondo con data-backdrop-close="false"; aquí están ambos, así que el botón de abajo es la única salida.',
      mod2_open: 'Ver todo el proceso',
      mod2_title: 'Cómo trabajamos',
      mod2_step1: 'Descubrimiento — conocemos tus objetivos, tu público y tus restricciones.',
      mod2_step2: 'Diseño y desarrollo — vistas previas semanales, con tu feedback integrado.',
      mod2_step3: 'Lanzamiento y cuidado — publicamos, medimos y seguimos mejorando.',
      sec_form_t: 'Un modal con un formulario',
      sec_form_d:
        'Coloca el formulario de contacto incrustado directamente en el diálogo — envía, valida y muestra su mensaje de éxito sin salir nunca de la página.',
      mod3_open: 'Ponte en contacto',
      mod3_title: 'Envíanos un mensaje',
      mod3_body: 'Solemos responder en un día.',
      sec_nojs_t: 'Sin JavaScript y modales globales',
      sec_nojs_d:
        'Sin JS el disparador simplemente no hace nada y la página sigue siendo plenamente usable — así que nunca pongas contenido esencial solo dentro de un modal. Un marcador de navegación que apunte a un #dialog-id también puede abrir uno desde el menú.',
    },
  },
  'comp-cookie': {
    path: 'consentimiento-cookies',
    title: 'Consentimiento de cookies',
    navTitle: 'Cookies',
    description:
      'Un banner de consentimiento guardado en localStorage — se entrega oculto, se muestra una vez en la primera visita y se oculta para siempre al aceptarlo. Es un componente de slot de plantilla, activo en todo el sitio.',
    data: {
      cc_intro:
        'Un pequeño banner de consentimiento que el runtime muestra solo hasta que el visitante acepta — la elección se recuerda en localStorage, así que aparece una vez y nunca más. Vive en un slot de plantilla y por eso está en todas las páginas; el real lo viste al pie de tu primera visita.',
      sec_preview_t: 'Qué aspecto tiene',
      sec_preview_d:
        'Una vista previa estática del banner (mostrada aquí para que sea visible incluso después de aceptar el real). El banner en vivo queda fijo al pie del viewport y se desliza en la primera visita.',
      cc_text: 'Usamos unas pocas cookies esenciales para que el sitio funcione y estadísticas anónimas para mejorarlo.',
      cc_more: 'Más información',
      cc_accept: 'Entendido',
      sec_how_t: 'Cómo funciona',
      sec_how_d:
        'Créalo una vez en un slot de plantilla (el pie u otro propio). El servidor lo renderiza con un atributo hidden; el runtime consulta localStorage y lo muestra solo cuando no hay elección guardada, y lo oculta de forma permanente al pulsar el botón de aceptar. El comportamiento lo aporta el marcador, no el HTML escrito. El consentimiento se guarda bajo la clave sw-cookie-consent por defecto — añade un data-cookiename opcional para usar tu propia clave, de modo que dos banners independientes registren el consentimiento por separado.',
      sec_nojs_t: 'Sin JavaScript',
      sec_nojs_d:
        'No aparece ningún banner — y sin scripts no hay nada que establecer ni guardar, así que la página se sirve tal cual.',
    },
  },
  'comp-forms': {
    path: 'formularios',
    title: 'Formularios',
    navTitle: 'Formularios',
    description:
      'Incrusta un formulario configurado en cualquier sitio con una sola etiqueta — campos, validación, antispam y éxito en línea se generan por ti, y se elige el idioma correcto automáticamente.',
    data: {
      frm_intro:
        'Crea un formulario una vez en la pestaña Formularios y luego incrústalo donde quieras — {{sw-form "id"}} o data-sw-form="id" lo expande al renderizar: campos, etiquetas, validación, un honeypot y un mensaje de éxito en línea. No hay marcado que escribir a mano ni nada que cablear.',
      sec_helper_t: 'Incrustar con el helper',
      sec_helper_d:
        'El formulario más simple: una llamada al helper expande la definición «contact» guardada. Añade class= para dar estilo al contenedor.',
      sec_attr_t: 'Incrustar por atributo, en tu propio diseño',
      sec_attr_d:
        '¿Prefieres colocarlo a mano? Un elemento vacío con data-sw-form="contact" se rellena con el mismo marcado — ponlo en cualquier contenedor con estilo, como esta tarjeta.',
      sec_about_t: 'Antispam, según el idioma, sin JS',
      sec_about_d:
        'Cada incrustación recibe un honeypot oculto, una trampa de tiempo al enviar y hCaptcha opcional; envía JSON al endpoint inyectado y muestra el éxito o el error en línea. En una página traducida, «contact» resuelve automáticamente al formulario localizado correspondiente. Sin JavaScript el formulario no tiene atributo action y no se envía — antispam por diseño.',
    },
  },
  'comp-datetimepicker': {
    path: 'selector-fecha-hora',
    title: 'Selector de fecha y hora',
    navTitle: 'Selector de fecha',
    description:
      'Un calendario con la identidad visual del sitio y un selector de hora con deslizador sobre un campo de texto simple — fecha, rango, fecha y hora, y solo hora, todos desde un atributo, con control total mediante data-* y una alternativa sin JS.',
    data: {
      dtp_intro:
        'Pon un atributo en un campo de texto y se convierte en un calendario con la marca del sitio y un selector de hora con deslizador. Fecha, rango, fecha y hora, y solo hora — cada uno es un único valor data-mode, y los colores, la tipografía y la transición provienen automáticamente de la identidad visual de tu sitio.',
      sec_basic_t: 'Una línea para el caso común',
      sec_basic_d:
        'Un selector de fecha es solo data-sw-component="datetimepicker" en un campo de texto — sin configuración. Haz clic en el campo para abrir el calendario; el día seleccionado usa tu color primario.',
      lbl_date: 'Fecha de la cita',
      ph_date: 'Selecciona una fecha…',
      sec_modes_t: 'Cuatro modos, un atributo',
      sec_modes_d:
        'data-mode cambia el selector: una sola fecha, un rango inicio–fin en un campo, una fecha con deslizador de hora, o solo la hora. Todo lo demás permanece automático.',
      lbl_range: 'Rango de fechas',
      ph_range: 'Entrada – Salida',
      lbl_datetime: 'Fecha y hora',
      ph_datetime: 'Elige un día y una hora…',
      lbl_time: 'Solo hora',
      ph_time: 'Elige una hora…',
      sec_full_t: 'Control total cuando lo necesitas',
      sec_full_d:
        'Para los demás casos hay atributos data-*: límites (data-min / data-max), formato de visualización, inicio de semana, paso de minutos, botones Hoy / Borrar, idioma y data-inline para un calendario siempre abierto incrustado en la página — que se muestra aquí.',
      lbl_inline: 'Calendario siempre abierto',
      sec_nojs_t: 'Sin JavaScript',
      sec_nojs_d:
        'Si los scripts no se ejecutan, cada campo sigue siendo un campo de texto normal — el visitante aún puede escribir un valor y se envía dentro de un formulario. Solo el calendario emergente no está disponible.',
    },
  },
  faq: {
    path: 'preguntas-frecuentes',
    title: 'Preguntas frecuentes',
    navTitle: 'FAQ',
    description: 'Respuestas a las preguntas con las que empieza todo proyecto: plazos, coste, edición, hosting.',
    data: {
      faq_cta_t: '¿Sigue con dudas?',
      faq_cta: 'Pregúntenos lo que sea',
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
