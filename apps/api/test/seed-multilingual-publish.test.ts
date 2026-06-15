import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import {
  EXAMPLE_IDENTITY,
  EXAMPLE_WEBSITE,
  EXAMPLE_SETTINGS,
  examplePages,
  EXAMPLE_DATASETS,
  exampleEntries,
  EXAMPLE_FORMS,
} from '../src/seed/index.js';

// Image URLs are irrelevant to the multilingual/publish assertions; seed with an empty asset map.
const EXAMPLE_PAGES = examplePages({});
const EXAMPLE_ENTRIES = exampleEntries({});

/**
 * End-to-end guard for the SEEDED flagship showcase: pushes the real demo content through the
 * actual publish pipeline ONCE (a single import + publish — the seed is large now) and asserts
 * the exported site carries the multilingual story it exists to demonstrate — inherit-mode
 * German pages (shared code, translated data), localized slugs/datasets/forms/chrome, hreflang,
 * the flag switcher — plus the feature showcases (carousel/tabs/lightbox/modal/
 * cookie-consent/data-aos/form embed) and the sitemap/noindex behavior of the legal pages.
 */
describe('seeded demo — flagship multilingual showcase publishes correctly', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'example';
  let publishRoot: string;
  let mediaRoot: string;
  const page = async (path: string): Promise<string> => {
    const res = await client.get(`/sites/${slug}/${path}`);
    expect(res.statusCode, path).toBe(200);
    return res.body;
  };

  beforeAll(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-seed-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-seed-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Example Project', slug);
    const proj = client.project(projectId);
    // ONE bundle import (the per-entity PUT loop would trip the per-route rate limit at this
    // size), mirroring seed.ts plus a siteUrl so hreflang/sitemap are emitted. Forms are not
    // part of the bundle schema — two PUTs.
    const res = await client.post(`${proj.base}/import`, {
      project: {
        identity: EXAMPLE_IDENTITY,
        website: { ...EXAMPLE_WEBSITE, siteUrl: 'https://northwind.example' },
        settings: EXAMPLE_SETTINGS,
      },
      pages: EXAMPLE_PAGES,
      datasets: EXAMPLE_DATASETS,
      entries: EXAMPLE_ENTRIES,
    });
    expect(res.statusCode).toBe(200);
    for (const form of EXAMPLE_FORMS) {
      expect((await proj.putContent('form', form.id, form)).statusCode, form.id).toBe(200);
    }
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);
  }, 120_000);

  afterAll(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('renders the English home at the root with English service data and localized chrome', async () => {
    const en = await page('index.html');
    expect(en).toContain('<html lang="en">');
    expect(en).toContain('Web Design'); // services (base) dataset
    expect(en).not.toContain('Webdesign'); // not the German variant
    expect(en).toContain('Start a project'); // chrome strings (en)
    expect(en).not.toContain('Projekt starten');
  });

  it('renders the German home at /de from the SAME inherited code with translated data + datasets + chrome', async () => {
    const de = await page('de/index.html');
    expect(de).toContain('<html lang="de">'); // page.locale drives <html lang>
    expect(de).toContain('Websites, die Ihnen mehr Geschäft'); // hero headline via the scoped catalog (data-sw-translate="home.headline")
    expect(de).toContain('Webdesign'); // data.services auto-resolved → services-de
    expect(de).not.toContain('Web Design');
    // INHERIT proof: a structural marker unique to the EN home source renders in German too.
    expect(de).toContain('data-sw-component="carousel"');
    expect(de).toContain('Projekt starten'); // chrome strings (de)
    // The spotlight keyed lookup resolved the GERMAN entry (page.data.spotlight → proj-harbor-de).
    expect(de).toContain('genussgetriebener Shop');
  });

  it('publishes the localized German slugs through the in-locale parent chain', async () => {
    for (const path of ['de/arbeiten', 'de/leistungen', 'de/leistungen/webdesign', 'de/leistungen/preise', 'de/ueber-uns', 'de/ueber-uns/karriere', 'de/kontakt', 'de/faq', 'de/datenschutz', 'de/impressum', 'de/blog', 'de/blog/warum-statische-websites-gewinnen']) {
      expect((await client.get(`/sites/${slug}/${path}/index.html`)).statusCode, path).toBe(200);
    }
    const services = await page('de/leistungen/index.html');
    expect(services).toContain('Strategie &amp; UX'); // services-de entries
    expect(services).toContain('Wartungspakete');
  });

  it('embeds the locale\'s own form on the contact pages ({{sw-form}} suffix resolution)', async () => {
    const en = await page('contact/index.html');
    expect(en).toContain(`data-sw-endpoint="/f/${projectId}/contact"`);
    expect(en).toContain('>Send enquiry</button>');
    expect(en).toContain('name="_hpt"'); // honeypot injected
    expect(en).not.toContain('hello@northwindstudio.com</p>'); // recipient never rendered as content
    const de = await page('de/kontakt/index.html');
    expect(de).toContain(`data-sw-endpoint="/f/${projectId}/contact-de"`);
    expect(de).toContain('>Anfrage senden</button>');
    expect(de).toContain('Erzählen Sie uns von Ihrem Projekt'); // translated field label
  });

  it('showcases the first-party components: carousel, tabs, lightbox, modal, data-aos', async () => {
    const home = await page('index.html');
    expect(home).toContain('data-sw-component="carousel"');
    expect(home).toContain('data-aos="fade-up"');
    expect(home).toContain('components.js'); // only-used-ships runtime linked
    expect(home).toContain('data-src'); // lazy-loaded hero (bare attr when the test's asset map is empty)
    expect(home).toContain('lazyload.js'); // its runtime ships (only-used-ships)
    const pricing = await page('services/pricing/index.html');
    expect(pricing).toContain('data-sw-component="tabs"');
    expect(pricing).toContain('data-sw-title="Project work"');
    expect(pricing).toContain('$4,800'); // plans dataset (locale-formatted `display` string)
    expect(pricing).toContain('Most popular'); // featured plan's gradient badge (pr_badge)
    const work = await page('work/index.html');
    expect(work).toContain('data-sw-component="lightbox"');
    const contact = await page('contact/index.html');
    expect(contact).toContain('data-sw-component="modal"');
    expect(contact).toContain('<dialog');
    const faq = await page('faq/index.html');
    // the accordion is the PATTERN (native <details> + DaisyUI collapse), not a component
    expect(faq).toContain('class="collapse collapse-plus join-item');
    expect(faq).toContain('<strong>4–8 weeks</strong>'); // {{sw-html}} kept the sanitized markup
    const deFaq = await page('de/faq/index.html');
    expect(deFaq).toContain('<strong>4–8 Wochen</strong>'); // faq-de dataset auto-resolved
  });

  it('renders the careers page from every dataset field type (select/boolean/date/richtext/reference)', async () => {
    const en = await page('about/careers/index.html');
    expect(en).toContain('Senior Product Designer');
    expect(en).toContain('Remote OK'); // boolean badge via page.data label
    expect(en).toContain('<time>2026-05-18</time>'); // {{sw-date posted}}
    expect(en).toContain('Mara Whitfield'); // manager REFERENCE via keyed item.team lookup
    const de = await page('de/ueber-uns/karriere/index.html');
    expect(de).toContain('Senior Product Designer (m/w/d)'); // roles-de
    expect(de).toContain('Remote möglich');
    expect(de).toContain('Gründerin &amp; Design-Direktorin'); // manager resolved within team-de
  });

  it('localizes the site chrome from one shared source (cookie banner, footer columns, mobile nav)', async () => {
    const en = await page('index.html');
    expect(en).toContain('data-sw-component="cookie-consent"');
    expect(en).toContain('OK, got it');
    expect(en).toContain('>Legal<'); // footer Legal column heading
    // The chrome now localizes via the EDITABLE data-sw-translate directive (S()→T()); the marker must
    // still be stripped from the published artifact (only the resolved text remains).
    expect(en).not.toContain('data-sw-translate');
    expect(en).toMatch(/aria-label="Menu"/); // mobile slot hamburger
    const de = await page('de/index.html');
    expect(de).toContain('Alles klar'); // cookie banner (de)
    expect(de).toContain('>Rechtliches<');
    expect(de).toMatch(/aria-label="Menü"/);
    expect(de).toContain('Datenschutz'); // the Legal column lists the German legal pages
  });

  it('emits hreflang alternates + x-default for every translated page', async () => {
    for (const [path, en, de] of [
      ['de/index.html', '/', '/de/'],
      ['services/index.html', '/services/', '/de/leistungen/'],
    ] as const) {
      const html = await page(path);
      expect(html).toContain(`<link rel="alternate" hreflang="en" href="https://northwind.example${en}" />`);
      expect(html).toContain(`<link rel="alternate" hreflang="de" href="https://northwind.example${de}" />`);
      expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="https://northwind.example${en}" />`);
    }
  });

  it('shows the flag language switcher on every page (the whole site is translated)', async () => {
    const en = await page('index.html');
    expect(en).toContain('aria-label="Language"');
    expect(en).toContain('href="de"'); // the German home, rebased page-relative
    expect(en).toMatch(/<svg[^>]*aria-label="Germany"/);
    expect(en).toMatch(/<svg[^>]*aria-label="United Kingdom"/);
    const deAbout = await page('de/ueber-uns/index.html');
    expect(deAbout).toContain('aria-label="Sprache"'); // localized switcher label
  });

  it('keeps the noindex legal pages out of the sitemap but includes the localized routes', async () => {
    const sitemap = (await client.get(`/sites/${slug}/sitemap.xml`)).body;
    expect(sitemap).toContain('https://northwind.example/de/leistungen/preise/');
    expect(sitemap).toContain('https://northwind.example/about/careers/');
    expect(sitemap).not.toContain('/privacy/');
    expect(sitemap).not.toContain('/impressum/');
    const privacy = await page('privacy/index.html');
    expect(privacy).toContain('noindex');
  });

  it('publishes the content-only blog with dated, truncated overview cards in both locales', async () => {
    const en = await page('blog/index.html');
    expect(en).toContain('Why static sites win on speed');
    expect(en).toContain('<time class="font-mono text-xs text-base-content/40">2026-05-28</time>');
    expect(en).not.toContain('data-sw-text'); // markers stripped on publish
    const article = await page('blog/why-static-sites-win/index.html');
    expect(article).toContain('Every millisecond of load time');
    const de = await page('de/blog/index.html');
    expect(de).toContain('Warum statische Websites beim Tempo gewinnen');
    const deArticle = await page('de/blog/warum-statische-websites-gewinnen/index.html');
    expect(deArticle).toContain('Jede Millisekunde Ladezeit kostet Besucher');
  });

  it('localizes the shop drawer + add-to-cart label from the translation catalog (reserved cart_* keys)', async () => {
    const en = await page('shop/index.html');
    expect(en).toContain('data-cart-title="Your cart"'); // cart_title (en) from website.translations
    expect(en).toContain('>Add to cart</button>'); // cart_add (en)
    expect(en).toContain('Studio Tee'); // products (en)
    expect(en).toContain('Order on WhatsApp'); // channel label (en) from shop.whatsapp
    expect(en).toContain('data-currency-symbol="$"'); // cart_currency_symbol (en)
    const de = await page('de/shop/index.html');
    expect(de).toContain('data-cart-title="Warenkorb"'); // cart_title (de) — bare {{sw-cart}}, no per-page hash
    expect(de).toContain('data-empty-label="Ihr Warenkorb ist leer."');
    expect(de).toContain('>In den Warenkorb</button>'); // cart_add (de) — the button now localizes too
    expect(de).toContain('Per WhatsApp bestellen'); // channel label (de) from shop.whatsapp (in data-channels JSON)
    expect(de).toContain('Studio-Shirt'); // products-de auto-resolved
    const es = await page('es/tienda/index.html');
    expect(es).toContain('data-cart-title="Su carrito"');
    expect(es).toContain('>Añadir al carrito</button>'); // cart_add (es)
    expect(es).toContain('Pedir por WhatsApp'); // channel label (es) from shop.whatsapp
  });

  it('renders the shared hero CTA from the translation catalog (data-sw-translate), stripped on publish', async () => {
    // The home hero CTA is `data-sw-translate="nav_cta"` — it renders the per-locale catalog value
    // (shared with the nav) and the marker is stripped from the published HTML.
    const en = await page('index.html');
    expect(en).toContain('>Start a project<'); // nav_cta (en)
    expect(en).not.toContain('data-sw-translate'); // directive marker stripped on publish
    const de = await page('de/index.html');
    expect(de).toContain('>Projekt starten<'); // nav_cta (de) — hero CTA localizes via the catalog
    expect(de).not.toContain('data-sw-translate');
    const es = await page('es/index.html');
    expect(es).toContain('>Empezar un proyecto<'); // nav_cta (es)
    expect(es).not.toContain('data-sw-translate');
  });

  it('renders the Spanish locale end-to-end: /es home, localized slugs, dataset/form/chrome resolution', async () => {
    const es = await page('es/index.html');
    expect(es).toContain('<html lang="es">');
    expect(es).toContain('Webs que le traen más negocio'); // hero headline via the scoped catalog (home.headline)
    expect(es).toContain('Diseño web'); // services-es auto-resolved
    expect(es).toContain('Empezar un proyecto'); // chrome strings (es)
    for (const path of ['es/trabajos', 'es/servicios', 'es/servicios/diseno-web', 'es/servicios/precios', 'es/nosotros', 'es/nosotros/empleo', 'es/contacto', 'es/preguntas-frecuentes', 'es/privacidad', 'es/aviso-legal', 'es/tienda', 'es/blog/por-que-ganan-los-sitios-estaticos']) {
      expect((await client.get(`/sites/${slug}/${path}/index.html`)).statusCode, path).toBe(200);
    }
    const contacto = await page('es/contacto/index.html');
    expect(contacto).toContain(`data-sw-endpoint="/f/${projectId}/contact-es"`);
    expect(contacto).toContain('>Enviar consulta</button>');
    const tienda = await page('es/tienda/index.html');
    expect(tienda).toContain('data-cart-title="Su carrito"');
    expect(tienda).toContain('Camiseta del estudio'); // products-es
  });

  it('emits the full hreflang trio + a three-flag switcher on translated pages', async () => {
    const html = await page('services/index.html');
    expect(html).toContain('<link rel="alternate" hreflang="en" href="https://northwind.example/services/" />');
    expect(html).toContain('<link rel="alternate" hreflang="de" href="https://northwind.example/de/leistungen/" />');
    expect(html).toContain('<link rel="alternate" hreflang="es" href="https://northwind.example/es/servicios/" />');
    expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://northwind.example/services/" />');
    expect(html).toMatch(/<svg[^>]*aria-label="United Kingdom"/);
    expect(html).toMatch(/<svg[^>]*aria-label="Germany"/);
    expect(html).toMatch(/<svg[^>]*aria-label="Spain"/);
  });

  it('renders the rich nav link placeholder with its translated label', async () => {
    const en = await page('index.html');
    expect(en).toContain('Free site audit');
    const de = await page('de/index.html');
    expect(de).toContain('Gratis Site-Check');
    const es = await page('es/index.html');
    expect(es).toContain('Auditoría gratis');
  });
});
