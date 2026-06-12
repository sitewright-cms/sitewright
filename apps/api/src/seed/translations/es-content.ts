import type { PageTranslationSeed } from '../pages/variants.js';

// Spanish LONG-FORM content: the fully translated blog (overview + 3 articles) and the legal
// documents. Article dates/images carry over from the English originals.
export function translationsEsContent(assets: Record<string, string>): Record<string, PageTranslationSeed> {
  return {
  blog: {
    path: 'blog',
    title: 'Blog',
    navTitle: 'Blog',
    description: 'Notas sobre diseño web, rendimiento y webs que se ganan el sueldo.',
    data: { heading: 'Desde el estudio', intro: 'Notas sobre diseño web, rendimiento y webs que se ganan el sueldo.' },
  },
  'blog-static-speed': {
    path: 'por-que-ganan-los-sitios-estaticos',
    title: 'Por qué los sitios estáticos ganan en velocidad',
    description: 'Una base estática mantiene su web rápida, barata de alojar y fácil de mantener.',
    data: {
      article_kicker: 'Rendimiento',
      article_title: 'Por qué los sitios estáticos ganan en velocidad',
      article_excerpt: 'Una base estática mantiene su web rápida, barata de alojar y fácil de mantener.',
      article_date: '2026-05-28',
      article_image: assets['blog-speed'] ?? '',
      article_body:
        '<p>Cada milisegundo de carga cuesta visitantes. Un sitio estático prerenderizado entrega HTML y CSS puros con una pizca de JS — no hay servidor al que esperar, así que la página aparece casi al instante.</p>' +
        '<h2>Menos piezas móviles</h2>' +
        '<p>Sin base de datos, sin runtime, sin parches. Toda la web es una carpeta de archivos que cualquier hosting puede servir desde un borde CDN cercano a su visitante.</p>' +
        '<ul><li>Core Web Vitals de récord de serie</li><li>Hosting barato y sencillo</li><li>Una superficie de ataque menor</li></ul>',
    },
  },
  'blog-design-systems': {
    path: 'sistemas-de-diseno-que-escalan',
    title: 'Sistemas de diseño que escalan',
    description: 'Tokens y componentes reutilizables mantienen una web creciente consistente — y rápida de construir.',
    data: {
      article_kicker: 'Diseño',
      article_title: 'Sistemas de diseño que escalan',
      article_excerpt: 'Tokens y componentes reutilizables mantienen una web creciente consistente — y rápida de construir.',
      article_date: '2026-04-14',
      article_image: assets['blog-design'] ?? '',
      article_body:
        '<p>Un sistema de diseño es el vocabulario común entre diseño y código: tokens de color, escalas tipográficas, espaciados y una biblioteca de componentes a la que todos recurren.</p>' +
        '<p>El beneficio se acumula. Cuando las piezas existen, las páginas nuevas se montan en horas, y un retoque de marca se propaga a todo desde un único cambio.</p>',
    },
  },
  'blog-seo-foundations': {
    path: 'fundamentos-de-seo',
    title: 'Fundamentos de SEO, desde el primer día',
    description: 'Marcado limpio, datos estructurados y páginas rápidas son los básicos de SEO que de verdad mueven rankings.',
    data: {
      article_kicker: 'SEO',
      article_title: 'Fundamentos de SEO, desde el primer día',
      article_excerpt: 'Marcado limpio, datos estructurados y páginas rápidas son los básicos que de verdad mueven rankings.',
      article_date: '2026-03-02',
      article_image: assets['blog-seo'] ?? '',
      article_body:
        '<p>El SEO no es un añadido. La web rápida, accesible y semánticamente marcada que usted lanza es exactamente la que los buscadores premian.</p>' +
        '<h2>Hacer bien lo básico</h2>' +
        '<ul><li>Títulos y meta descripciones descriptivos</li><li>Una estructura de URLs limpia y rastreable</li><li>Datos estructurados y un sitemap correcto</li></ul>',
    },
  },
  privacy: {
    path: 'privacidad',
    title: 'Política de privacidad',
    navTitle: 'Privacidad',
    data: {
      heading: 'Política de privacidad',
      body:
        'Lo mantenemos simple: recogemos solo lo que envía el formulario de contacto (nombre, correo y mensaje), lo usamos únicamente para responder y nunca lo vendemos ni compartimos. ' +
        'Nuestro proveedor de hosting guarda registros de acceso estándar (IP, hora, página) durante 14 días por seguridad. ' +
        'Esta web instala una sola cookie — la propia decisión de consentimiento — y usa estadística respetuosa, sin cookies. ' +
        'Puede pedirnos en cualquier momento ver o borrar todo lo que guardamos sobre usted: hello@northwindstudio.com.',
    },
  },
  imprint: {
    path: 'aviso-legal',
    title: 'Aviso legal',
    navTitle: 'Aviso legal',
    data: {
      heading: 'Aviso legal',
      body:
        'Northwind Web Studio Ltd. · 548 Market Street, Suite 200 · San Francisco, CA 94104 · EE. UU. ' +
        'Representada por Mara Whitfield (fundadora y directora de diseño). ' +
        'Contacto: hello@northwindstudio.com · +1 (415) 555-0142. ' +
        'Responsable del contenido: Mara Whitfield, dirección arriba indicada.',
    },
  },
  };
}
