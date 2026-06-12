import type { Entry } from '@sitewright/schema';
import { pub } from '../helpers.js';

// Spanish dataset entries — the `-es` twins auto-resolved on `/es` pages. Entry ids carry the
// same `-es` suffix; `roles-es` manager references point at `team-es` ids so the keyed
// `{{item.team.…}}` lookup resolves within the locale. Shop prices stay in USD (one merchant
// currency); service/plan prices are localized copy.
export function entriesEs(assets: Record<string, string>): Entry[] {
  return [
  // --- services-es ---
  pub('services-es', 'svc-strategy-es', { icon: '🧭', title: 'Estrategia y UX', summary: 'Investigación, posicionamiento y recorridos de usuario que convierten visitas en clientes.', price: 'desde 4.000 $' }),
  pub('services-es', 'svc-design-es', { icon: '🎨', title: 'Diseño web', summary: 'Interfaces distintivas y fieles a la marca, al píxel en cualquier pantalla.', price: 'desde 8.000 $' }),
  pub('services-es', 'svc-build-es', { icon: '⚡', title: 'Desarrollo', summary: 'Sitios estáticos artesanales y ultrarrápidos con puntuaciones Lighthouse de récord.', price: 'desde 10.000 $' }),
  pub('services-es', 'svc-brand-es', { icon: '✨', title: 'Identidad de marca', summary: 'Logotipos, sistemas tipográficos y lenguajes visuales que escalan en cada punto de contacto.', price: 'desde 6.000 $' }),
  pub('services-es', 'svc-seo-es', { icon: '📈', title: 'SEO y rendimiento', summary: 'SEO técnico, Core Web Vitals y analítica integrados desde el primer día.', price: 'desde 3.000 $' }),
  pub('services-es', 'svc-care-es', { icon: '🛟', title: 'Planes de mantenimiento', summary: 'Cambios, monitorización y mejoras continuas para que su web siga rindiendo.', price: '450 $/mes' }),
  // --- projects-es ---
  pub('projects-es', 'proj-harbor-es', { title: 'Harbor & Co.', client: 'Harbor Coffee Roasters', category: 'E-commerce', summary: 'Una tienda guiada por el sabor que elevó los pedidos online un 38 %.', image: assets['proj-harbor'], year: '2025' }),
  pub('projects-es', 'proj-vela-es', { title: 'Vela Health', client: 'Vela', category: 'Salud', summary: 'Un portal de pacientes sereno y accesible, con su web de marketing.', image: assets['proj-vela'], year: '2025' }),
  pub('projects-es', 'proj-lumen-es', { title: 'Lumen Capital', client: 'Lumen', category: 'Finanzas', summary: 'Una web sólida y rica en datos para una boutique de inversión.', image: assets['proj-lumen'], year: '2024' }),
  pub('projects-es', 'proj-terra-es', { title: 'Terra Studio', client: 'Terra Architects', category: 'Portfolio', summary: 'Un escaparate inmersivo y visual para un estudio premiado.', image: assets['proj-terra'], year: '2024' }),
  pub('projects-es', 'proj-flint-es', { title: 'Flint & Steel', client: 'Flint BBQ', category: 'Hostelería', summary: 'Una web que abre el apetito, con reservas online para una cadena en plena expansión.', image: assets['proj-flint'], year: '2024' }),
  pub('projects-es', 'proj-aria-es', { title: 'Aria Festival', client: 'Aria', category: 'Eventos', summary: 'Una web de festival audaz y enérgica, lista para aguantar el día del lanzamiento.', image: assets['proj-aria'], year: '2023' }),
  // --- team-es ---
  pub('team-es', 'team-mara-es', { name: 'Mara Whitfield', role: 'Fundadora y directora de diseño', photo: assets['team-mara'], bio: 'Doce años dando forma a marcas para estudios y startups.' }),
  pub('team-es', 'team-dev-es', { name: 'Devon Park', role: 'Ingeniero principal', photo: assets['team-devon'], bio: 'Obsesionado con el rendimiento; entrega sitios con un 100 redondo.' }),
  pub('team-es', 'team-ines-es', { name: 'Inés Romero', role: 'Estratega UX', photo: assets['team-ines'], bio: 'Convierte objetivos difusos en recorridos que convierten.' }),
  pub('team-es', 'team-sol-es', { name: 'Sol Nakamura', role: 'Diseñador de marca', photo: assets['team-sol'], bio: 'Construye sistemas tipográficos y logotipos con vocación de permanencia.' }),
  // --- testimonials-es ---
  pub('testimonials-es', 'tst-1-es', { quote: 'Northwind reconstruyó nuestra web en seis semanas y nuestras consultas se duplicaron. Es ese raro estudio que domina por igual el diseño y la ingeniería.', author: 'Priya Anand', role: 'CEO, Harbor Coffee' }),
  pub('testimonials-es', 'tst-2-es', { quote: 'El equipo más rápido y cuidadoso con el que hemos trabajado. Nuestros Lighthouse pasaron de los 40 a un 100 perfecto.', author: 'Marcus Lee', role: 'CMO, Lumen Capital' }),
  pub('testimonials-es', 'tst-3-es', { quote: 'Trataron nuestra marca como si fuera suya. La nueva web por fin se parece a la empresa que estamos llegando a ser.', author: 'Elena Fischer', role: 'Fundadora, Terra Architects' }),
  // --- products-es ---
  pub('products-es', 'prod-tee-es', { sku: 'TEE-01', name: 'Camiseta del estudio', price: 29, image: assets['prod-tee'], description: 'Camiseta de algodón grueso y suave con un sutil distintivo Northwind.' }),
  pub('products-es', 'prod-mug-es', { sku: 'MUG-01', name: 'Taza de cerámica', price: 14, image: assets['prod-mug'], description: 'Una taza de 350 ml para los deploys de madrugada.' }),
  pub('products-es', 'prod-notebook-es', { sku: 'NB-01', name: 'Cuaderno punteado', price: 18, image: assets['prod-notebook'], description: 'Cuaderno A5 de apertura plana para bocetar layouts.' }),
  pub('products-es', 'prod-poster-es', { sku: 'POS-01', name: 'Póster tipográfico', price: 35, image: assets['prod-poster'], description: 'Impresión risográfica de muestrario tipográfico, A2.' }),
  pub('products-es', 'prod-stickers-es', { sku: 'STK-01', name: 'Pack de pegatinas', price: 8, image: assets['prod-stickers'], description: 'Seis pegatinas de vinilo troqueladas para su portátil.' }),
  pub('products-es', 'prod-cap-es', { sku: 'CAP-01', name: 'Gorra', price: 24, image: assets['prod-cap'], description: 'Gorra baja de seis paneles con distintivo bordado.' }),
  // --- faq-es ---
  pub('faq-es', 'faq-timeline-es', { question: '¿Cuánto dura un proyecto típico?', answer: '<p>La mayoría de las webs de marketing salen en <strong>4–8 semanas</strong> desde el arranque: una o dos semanas de estrategia y diseño, de dos a cuatro de desarrollo y contenidos, y una última de pulido, QA y lanzamiento.</p>' }),
  pub('faq-es', 'faq-cost-es', { question: '¿Cuánto cuesta una web?', answer: '<p>Los proyectos parten de unos <strong>5.000 $</strong> para una one-page enfocada y llegan a 25.000 $+ en sitios grandes — consulte <a href="/es/servicios/precios">precios</a> para cifras honestas a precio cerrado.</p>' }),
  pub('faq-es', 'faq-editing-es', { question: '¿Podemos editar la web nosotros mismos?', answer: '<p>Sí — cada web incluye un editor que su equipo usa sin tocar código: textos, imágenes, blog, productos y datos son todos suyos.</p>' }),
  pub('faq-es', 'faq-hosting-es', { question: '¿Dónde se aloja la web?', answer: '<p>Donde usted quiera. Exportamos archivos estáticos portables — funcionan en cualquier hosting o CDN, sin atarse a ningún proveedor.</p><ul><li>Su hosting actual</li><li>Un CDN global que configuramos</li><li>Incluso un simple espacio SFTP</li></ul>' }),
  pub('faq-es', 'faq-after-es', { question: '¿Qué pasa después del lanzamiento?', answer: '<p>O usted toma las llaves, o un <strong>plan de mantenimiento</strong> nos mantiene a bordo para cambios, monitorización y mejora continua. Cancelable cada mes.</p>' }),
  // --- plans-es ---
  pub('plans-es', 'plan-launch-es', { name: 'Launch', price: 4800, period: 'por proyecto', monthly: false, featured: false, blurb: 'Una one-page enfocada que le pone online rápido.', features: ['Web de una página', 'Pulido de textos', 'Lanzamiento en 3 semanas', 'Base de SEO técnico'] }),
  pub('plans-es', 'plan-growth-es', { name: 'Growth', price: 9800, period: 'por proyecto', monthly: false, featured: true, blurb: 'La web de marketing completa que la mayoría necesita.', features: ['Hasta 10 páginas', 'Sistema de diseño', 'Blog + datos CMS', 'Analítica y SEO', '30 días de soporte'] }),
  pub('plans-es', 'plan-flagship-es', { name: 'Flagship', price: 24000, period: 'por proyecto', monthly: false, featured: false, blurb: 'Guiada por estrategia, multilingüe y lista para vender.', features: ['Páginas ilimitadas', 'Identidad de marca', 'Multilingüe', 'Tienda y formularios', 'Equipo prioritario'] }),
  pub('plans-es', 'plan-care-es', { name: 'Care', price: 450, period: 'al mes', monthly: true, featured: false, blurb: 'Mantiene la web sana y al día.', features: ['Cambios mensuales', 'Monitorización de uptime y velocidad', 'Actualización de dependencias'] }),
  pub('plans-es', 'plan-care-plus-es', { name: 'Care Plus', price: 950, period: 'al mes', monthly: true, featured: true, blurb: 'Mejora continua, no solo mantenimiento.', features: ['Todo lo de Care', 'Experimentos A/B', 'Revisión UX trimestral', 'Arreglos el mismo día'] }),
  // --- roles-es (manager → team-es entry ids) ---
  pub('roles-es', 'role-designer-es', { title: 'Diseñador/a de producto sénior', dept: 'Design', location: 'San Francisco', remote: true, posted: '2026-05-18', manager: 'team-mara-es', description: '<p>Será dueño del diseño desde el primer boceto hasta la web publicada: pensamiento sistémico, tipografía precisa y el criterio para mantenerlo simple.</p><ul><li>5+ años diseñando para la web</li><li>Portfolio de webs de marketing publicadas</li><li>Acostumbrado/a a trabajar directamente con clientes</li></ul>' }),
  pub('roles-es', 'role-engineer-es', { title: 'Ingeniero/a front-end', dept: 'Engineering', location: 'San Francisco', remote: true, posted: '2026-05-02', manager: 'team-dev-es', description: '<p>Peleará por los últimos 100 ms. HTML semántico, CSS moderno y una sana desconfianza hacia el JavaScript innecesario.</p><ul><li>Fundamentos sólidos de HTML/CSS</li><li>Presupuestos de rendimiento como hábito</li><li>La accesibilidad no es negociable</li></ul>' }),
  pub('roles-es', 'role-strategist-es', { title: 'Estratega de contenidos', dept: 'Strategy', location: 'San Francisco', remote: false, posted: '2026-04-20', manager: 'team-ines-es', description: '<p>Convierte posicionamientos difusos en páginas que se leen claras y convierten: sitemaps, mensajes y dirección de textos.</p><ul><li>3+ años en estrategia de contenidos o de marca</li><li>Muestras de escritura que venden sin gritar</li></ul>' }),
  ];
}
