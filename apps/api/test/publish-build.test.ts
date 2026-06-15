import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectBundle } from '@sitewright/core';
import { WIDGET_MANIFESTS } from '@sitewright/core';
import { buildSite } from '../src/publish/build.js';

let outDir: string;

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'sw-publish-'));
});
afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

function bundle(over: Partial<ProjectBundle> = {}): ProjectBundle {
  return {
    project: {
      formatVersion: 2 as const,
      id: 'p',
      name: 'Acme',
      slug: 'acme',
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    },
    pages: [],
    datasets: [],
    entries: [],
    ...over,
  } as ProjectBundle;
}

describe('buildSite', () => {
  it('renders a code-first source-page (Handlebars) to static HTML + feeds its classes to the shared sheet', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        pages: [
          {
            id: 'home', path: '', title: 'Home',
            // placeholder block tree, ignored when source is set
            source: '<div class="grid"><h1>{{ company.name }}</h1></div>',
          },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home.startsWith('<!doctype html>')).toBe(true);
    // Rendered from the Handlebars source ({{ company.name }} → Acme); block tree NOT rendered.
    // The skeleton wraps the page body in <main id="page-content"> (the author wrote a neutral <div>).
    expect(home).toContain('<body><main id="page-content"><div class="grid"><h1>Acme</h1></div></main>');
    expect(home).not.toContain('<section data-sw-block="Section"');
    // The source's literal Tailwind class is compiled into the shared, root-linked sheet.
    expect(home).toContain('<link rel="stylesheet" href="styles.css" />');
    expect(await readFile(join(outDir, 'styles.css'), 'utf8')).toContain('display:grid');
  });

  it('resolves a composed Widget ({{> hero-slider}}) at publish AND feeds its classes to the sheet', async () => {
    // The Widget body is NOT a project snippet — it must come from WIDGET_PARTIALS, merged inside
    // buildSite (no opts.snippets here). Its `hero` dataset + config entry drive the render.
    const heroDs = WIDGET_MANIFESTS['hero-slider']!.datasets[0]!;
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      // A project snippet of the SAME name must NOT shadow the managed widget (widgets win).
      snippets: { 'hero-slider': '<p>SHADOW</p>' },
      bundle: bundle({
        pages: [{ id: 'home', path: '', title: 'Home', source: '<div>{{> hero-slider}}</div>' }],
        datasets: [{ id: heroDs.slug, name: heroDs.name, slug: heroDs.slug, fields: heroDs.fields }],
        entries: [
          {
            id: 'config',
            dataset: 'hero',
            status: 'published',
            values: { autoplay: true, interval: 6000, show_arrows: true, show_indicators: true, slides: [{ image: '/media/a.jpg', caption: 'Harbor & Co.' }] },
          },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    // The managed Widget body won over the same-named project snippet (reserved name).
    expect(home).not.toContain('SHADOW');
    // The Widget rendered from its dataset: carousel root, an <img> slide, and the caption.
    expect(home).toContain('data-sw-component="carousel"');
    // sw-url rebases the asset to the page-relative root at publish (/media/a.jpg → media/a.jpg).
    expect(home).toMatch(/<img class="sw-kenburns"[^>]*src="[^"]*a\.jpg"/);
    expect(home).toContain('Harbor &amp; Co.');
    // The class-extraction gotcha guard: a utility from the WIDGET body (h-[60vh]) must be compiled,
    // proving referencedSnippets scanned the merged widget partial — not just project snippets.
    expect(await readFile(join(outDir, 'styles.css'), 'utf8')).toContain('height:60vh');
  });

  it('renders a source-less page as an empty body (no crash)', async () => {
    // A page with neither `source` nor a referenced template (e.g. a brand-new page) publishes the
    // skeleton with an empty <main> — the body is always the rendered source, never a block tree.
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        pages: [{ id: 'home', path: '', title: 'Home' }],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home.startsWith('<!doctype html>')).toBe(true);
    expect(home).toContain('<main id="page-content"></main>'); // empty body, no crash
  });

  it('exposes page.slug + the page.parent view (title/data) to a child page', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        pages: [
          {
            id: 'home', path: '', title: 'Home',
            source: '<div>{{ company.name }}</div>', data: { section_color: 'tomato' },
          },
          {
            id: 'services', path: 'services', parent: 'home', title: 'Services',
            source: '<div><b>{{page.slug}}</b> up:{{page.parent.title}} c:{{page.parent.data.section_color}}</div>',
          },
        ],
      }),
    });
    const svc = await readFile(join(outDir, 'services', 'index.html'), 'utf8');
    expect(svc).toContain('<b>services</b>'); // page.slug = the page's OWN segment (not the full /services route)
    expect(svc).toContain('up:Home'); // page.parent.title — the parent (home)
    expect(svc).toContain('c:tomato'); // page.parent.data.section_color — inherited from the parent's page.data
  });

  it('publishes a data-sw-html rich region: override applied, sanitized, markers stripped', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        pages: [
          {
            id: 'home', path: '', title: 'Home',
            source: '<div><section data-sw-html="intro"><p>fallback</p></section></div>',
            data: { intro: '<p>Hello <strong>there</strong></p><script>alert(1)</script>' },
          },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    // The override replaced the default, the script was stripped at render, and the marker is gone.
    expect(home).toContain('<section><p>Hello <strong>there</strong></p></section>');
    expect(home).not.toContain('data-sw-html');
    expect(home).not.toContain('<script>alert(1)');
    expect(home).not.toContain('fallback');
  });

  it('publishes {{item.<dataset>.<key>}} — direct keyed entry access (no loop)', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        datasets: [{ id: 'posts', name: 'Posts', slug: 'posts', fields: [{ name: 'title', type: 'text', required: false, localized: false }] }],
        entries: [{ id: 'hello', dataset: 'posts', status: 'published', values: { title: 'Hi there' } }],
        pages: [
          {
            id: 'home', path: '', title: 'Home',
            source: '<div><h1>{{item.posts.hello.title}}</h1></div>',
          },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).toContain('<h1>Hi there</h1>');
  });

  it('compiles brand-themed DaisyUI components into the shared sheet for a source page', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: { primary: '#0a7fae' } },
          settings: { defaultLocale: 'en', locales: ['en'] },
        },
        pages: [
          {
            id: 'home', path: '', title: 'Home',
            source: '<div><button class="btn btn-primary">Sign up</button></div>',
          },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).toContain('<button class="btn btn-primary">Sign up</button>');
    expect(home).toContain('<link rel="stylesheet" href="styles.css" />');
    const sheet = await readFile(join(outDir, 'styles.css'), 'utf8');
    expect(sheet).toMatch(/\.btn/); // the DaisyUI component compiled into the shared sheet
    expect(sheet).toContain('#0a7fae'); // themed by the brand primary, not DaisyUI's default
    expect(sheet).not.toContain('oklch(45% 0.24 277.023)'); // DaisyUI's indigo default is gone
  });

  it('renders project-wide skeleton slots (topNav/footer + auto-nav) into every page', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          settings: { defaultLocale: 'en', locales: ['en'] },
          website: {
            // Slot content uses NEUTRAL elements (a <div> with the DaisyUI .navbar / .footer
            // classes) — the skeleton owns the <nav id="top-nav"> / <footer id="footer"> landmarks.
            topNav:
              '<div class="navbar bg-base-100"><a class="btn btn-ghost" href="/">{{ company.name }}</a>' +
              '<ul class="menu menu-horizontal">{{#each nav.header}}<li><a href="{{sw-url path}}">{{label}}</a></li>{{/each}}</ul></div>',
            footer: '<div class="footer">© {{ company.name }}</div>',
          },
        },
        pages: [
          { id: 'home', path: '', title: 'Home', source: '<div>Home body</div>', nav: { slots: ['header'], order: 1 } },
          { id: 'about', path: 'about', parent: 'home', title: 'About', source: '<div>About body</div>', nav: { slots: ['header'], order: 2 } },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).toContain('Home body'); // the page's own source
    // The shared topNav slot is wrapped in the platform's <nav id="top-nav"> landmark.
    expect(home).toContain('<nav id="top-nav"><div class="navbar bg-base-100">');
    // The auto-nav lists BOTH pages (built from each page's nav settings); internal links
    // are rebased page-relative (portable): from the home page, "/" → "./", "/about" → "about".
    expect(home).toContain('<a href="./">Home</a>');
    expect(home).toContain('<a href="about">About</a>');
    // The shared footer slot is wrapped in the platform's <footer id="footer"> landmark.
    expect(home).toContain('<footer id="footer"><div class="footer">© Acme</div></footer>'); // shared footer + brand
    expect(home).toContain('<link rel="stylesheet" href="styles.css" />');
    // The slot's DaisyUI/Tailwind classes are compiled into the shared sheet.
    const sheet = await readFile(join(outDir, 'styles.css'), 'utf8');
    expect(sheet).toMatch(/\.btn/);

    // A second page shares the exact same nav + footer (authored once); from /about/
    // (depth 1) the internal links rebase onto '../'.
    const about = await readFile(join(outDir, 'about', 'index.html'), 'utf8');
    expect(about).toContain('About body');
    expect(about).toContain('<a href="../about">About</a>');
    expect(about).toContain('<footer id="footer"><div class="footer">© Acme</div></footer>');
  });

  it('marks the current nav item active via {{sw-active}} — class + aria-current swap per page', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          settings: { defaultLocale: 'en', locales: ['en'] },
          website: {
            topNav:
              '<div class="navbar"><ul class="menu">{{#each nav.header}}' +
              '<li><a class="{{#if (sw-active path)}}active{{/if}}" href="{{sw-url path}}"' +
              '{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{label}}</a></li>' +
              '{{/each}}</ul></div>',
          },
        },
        pages: [
          { id: 'home', path: '', title: 'Home', source: '<div>Home body</div>', nav: { slots: ['header'], order: 1 } },
          { id: 'about', path: 'about', parent: 'home', title: 'About', source: '<div>About body</div>', nav: { slots: ['header'], order: 2 } },
        ],
      }),
    });
    // On HOME, the Home item is active (exact ⇒ aria-current="page"); About is inactive. Hrefs are
    // rebased page-relative ('/' → './', '/about' → 'about') — sw-active compares the ROOT-relative
    // route, so the highlight is unaffected by the rebasing.
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).toContain('<a class="active" href="./" aria-current="page">Home</a>');
    expect(home).toContain('<a class="" href="about">About</a>'); // not current → aria-current omitted
    // On ABOUT, the roles swap.
    const about = await readFile(join(outDir, 'about', 'index.html'), 'utf8');
    expect(about).toContain('<a class="active" href="../about" aria-current="page">About</a>');
    expect(about).toContain('<a class="" href="../">Home</a>');
  });

  it('applies website.theme nav/button effects as <body> classes + ships the (tree-shaken) effect CSS', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: { primary: '#4f46e5' } },
          settings: { defaultLocale: 'en', locales: ['en'] },
          website: {
            theme: { navEffect: 'pill', buttonEffect: 'lift' },
            topNav:
              '<div class="navbar"><ul class="menu">{{#each nav.header}}<li><a class="{{#if (sw-active path)}}active{{/if}}" href="{{sw-url path}}">{{label}}</a></li>{{/each}}</ul></div>',
          },
        },
        pages: [
          { id: 'home', path: '', title: 'Home', source: '<a class="btn btn-primary" href="/x">Go</a>', nav: { slots: ['header'], order: 1 } },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    // The chosen schemes become <body> classes (cascade to the nav landmarks + .btn).
    expect(home).toContain('<body class="sw-nav-pill sw-btn-lift">');
    const sheet = await readFile(join(outDir, 'styles.css'), 'utf8');
    // Only the chosen schemes ship, scoped to the platform landmarks, themed by the brand.
    expect(sheet).toContain('.sw-nav-pill');
    expect(sheet).toMatch(/#top-nav/);
    expect(sheet).toContain('.sw-btn-lift');
    expect(sheet).not.toContain('sw-nav-underline'); // tree-shaken (not chosen)
    expect(sheet).not.toContain('sw-btn-glow');
  });

  it('ships the preloader overlay + runtime when theme.preloaderEffect is set (and nothing when not)', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: { primary: '#4f46e5' } },
          settings: { defaultLocale: 'en', locales: ['en'] },
          website: { theme: { preloaderEffect: 'logo-pulse' } },
        },
        pages: [{ id: 'home', path: '', title: 'Home', source: '<h1>Hi</h1>' }],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    // Overlay injected as the first body child, in loading state, with the chosen effect + noscript hide.
    expect(home).toContain('data-sw-preloader');
    expect(home).toContain('sw-preloader-logo-pulse');
    expect(home).toContain('class="loading sw-preloader-logo-pulse"');
    expect(home).toContain('[data-sw-preloader]{display:none!important}'); // noscript no-JS safety
    expect(home).toContain('preloader.js'); // runtime linked
    // The runtime file is emitted at the site root.
    expect(await readFile(join(outDir, 'preloader.js'), 'utf8')).toContain("classList.remove('loading')");
  });

  it('does NOT ship the preloader when no effect is chosen', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: { primary: '#4f46e5' } },
          settings: { defaultLocale: 'en', locales: ['en'] },
          website: {},
        },
        pages: [{ id: 'home', path: '', title: 'Home', source: '<h1>Hi</h1>' }],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).not.toContain('data-sw-preloader');
    expect(home).not.toContain('preloader.js');
  });

  it('composes {{> snippet}} Handlebars partials into a published source page', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      snippets: { promo: '<div class="alert">{{ company.name }} promo</div>' },
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          settings: { defaultLocale: 'en', locales: ['en'] },
        },
        pages: [
          { id: 'home', path: '', title: 'Home', source: '<div><h1>Home</h1>{{> promo}}</div>' },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).toContain('<div class="alert">Acme promo</div>'); // the snippet expanded + bound
    // The snippet's classes feed the shared utility sheet (compiled output lives in styles.css).
    const sheet = await readFile(join(outDir, 'styles.css'), 'utf8');
    expect(sheet).toMatch(/\.alert/);
  });

  it('ships the component + dialog runtimes when a COMPOSED snippet authors a modal', async () => {
    // The interactive component lives only in a {{> snippet}} partial — detection must scan the
    // referenced-snippet surface (not just page sources), so its platform JS still ships.
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      snippets: {
        promo:
          '<div data-sw-component="modal"><button data-sw-part="open">Open</button>' +
          '<dialog data-sw-part="dialog"><p>Hi</p></dialog></div>',
      },
      bundle: bundle({
        pages: [{ id: 'home', path: '', title: 'Home', source: '<div>{{> promo}}</div>' }],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).toContain('data-sw-component="modal"'); // the snippet's component expanded into the page
    expect(home).toContain('<script defer src="components.js"></script>');
    expect(home).toContain('<script defer src="nav-link.js"></script>');
    expect(await readFile(join(outDir, 'components.js'), 'utf8')).toContain('[data-sw-component="modal"]');
    expect(await readFile(join(outDir, 'nav-link.js'), 'utf8')).toContain('scrollIntoView');
  });

  it('ships classes only for snippets the site actually composes (an un-included one adds no weight)', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      // Two snippets are AVAILABLE (as the built-in globals always are), but the page includes only one.
      snippets: {
        used: '<span class="flex">{{ company.name }}</span>',
        unused: '<span class="grid">never composed</span>',
      },
      bundle: bundle({
        pages: [
          { id: 'home', path: '', title: 'Home', source: '<div>{{> used}}</div>' },
        ],
      }),
    });
    const sheet = await readFile(join(outDir, 'styles.css'), 'utf8');
    expect(sheet).toContain('display:flex'); // the composed snippet's utility ships
    expect(sheet).not.toContain('display:grid'); // the un-composed snippet's utility does NOT
  });

  it('fails the publish when a referenced snippet is undefined', async () => {
    await expect(
      buildSite({
        publishedAt: '2026-05-29T00:00:00.000Z',
        outDir,
        bundle: bundle({
          pages: [{ id: 'home', path: '', title: 'Home', source: '<div>{{> missing}}</div>' }],
        }),
      }),
    ).rejects.toThrow(/page "home" template error.*missing/); // pins the cause: the named partial
  });

  it('fails the publish (does not crash) on mutually-recursive snippets', async () => {
    // a → b → a passes per-snippet validation but recurses at render; renderTemplate catches the
    // stack overflow and the publish fails gracefully with a clear, page-scoped error.
    await expect(
      buildSite({
        publishedAt: '2026-05-29T00:00:00.000Z',
        outDir,
        snippets: { a: '<div>{{> b}}</div>', b: '<div>{{> a}}</div>' },
        bundle: bundle({
          pages: [{ id: 'home', path: '', title: 'Home', source: '<div>{{> a}}</div>' }],
        }),
      }),
    ).rejects.toThrow(/page "home" template error/);
  });

  it('fails the publish when a snippet is unsafe (partials are validated too)', async () => {
    await expect(
      buildSite({
        publishedAt: '2026-05-29T00:00:00.000Z',
        outDir,
        snippets: { evil: '<div>{{x}}</div><script>steal()</script>' },
        bundle: bundle({
          pages: [{ id: 'home', path: '', title: 'Home', source: '<div>{{> evil}}</div>' }],
        }),
      }),
    ).rejects.toThrow(/page "home" template error.*script/i); // pins the cause: the validator rejects <script>
  });

  it('decodes the publish-time JSON snapshot into {{ website.json_data }} (source page + slot)', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      // The snapshot is fetched in the main process and passed into the build job.
      jsonData: { title: 'Berlin', extract: 'Capital of Germany', tags: ['a', 'b'] },
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          settings: { defaultLocale: 'en', locales: ['en'] },
          website: {
            jsonDataUrl: 'https://en.wikipedia.org/api/rest_v1/page/summary/Berlin',
            footer: '<div>{{ website.json_data.title }} tags: {{#each website.json_data.tags}}{{this}}{{/each}}</div>',
          },
        },
        pages: [
          { id: 'home', path: '', title: 'Home', source: '<div><h1>{{ website.json_data.title }}</h1><p>{{ website.json_data.extract }}</p></div>', nav: { slots: ['header'], order: 1 } },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).toContain('<h1>Berlin</h1>'); // source page reads the snapshot
    expect(home).toContain('<p>Capital of Germany</p>');
    // The footer slot ({{#each}} over the array) wrapped in the platform's <footer id="footer">.
    expect(home).toContain('<footer id="footer"><div>Berlin tags: ab</div></footer>'); // a slot can {{#each}} the array
  });

  it('HTML-escapes json_data string values (the snapshot is untrusted external input)', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      jsonData: { title: '<script>alert(1)</script>', note: '"&<>' },
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          settings: { defaultLocale: 'en', locales: ['en'] },
        },
        pages: [
          { id: 'home', path: '', title: 'Home', source: '<div><h1>{{ website.json_data.title }}</h1><p>{{ website.json_data.note }}</p></div>' },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    const body = home.slice(home.indexOf('<body'));
    expect(body).not.toContain('<script>alert(1)</script>'); // never injected raw
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;'); // HTML-escaped
  });

  it('renders all validated skeleton slots (mobileNav/sidebars/bottom) in source order', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          settings: { defaultLocale: 'en', locales: ['en'] },
          website: {
            // Slot content uses NEUTRAL elements (a <div> keeps the author's id + DaisyUI classes);
            // the skeleton wraps each non-empty slot in its own landmark (<nav id="top-nav"> etc.).
            topNav: '<div id="slot-top" class="navbar">top</div>',
            mobileNav: '<div id="slot-mob" class="drawer">mobile</div>',
            sidebarLeft: '<div id="slot-sl" class="menu">left</div>',
            sidebarRight: '<div id="slot-sr" class="menu">right</div>',
            footer: '<div id="slot-foot" class="footer">foot</div>',
            bottom: '<div id="slot-bottom" class="modal">{{ company.name }}</div>',
          },
        },
        pages: [
          { id: 'home', path: '', title: 'Home', source: '<div id="page-body">Home body</div>', nav: { slots: ['header'], order: 1 } },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    const order = ['slot-top', 'slot-mob', 'page-body', 'slot-sl', 'slot-sr', 'slot-foot', 'slot-bottom'].map((id) => home.indexOf(id));
    order.forEach((p) => expect(p).toBeGreaterThanOrEqual(0));
    expect(order).toEqual([...order].sort((a, b) => a - b)); // strictly increasing
    expect(home).toContain('>Acme</div>'); // the bottom slot got the company-name binding
    // Every validated slot's classes feed the shared utility sheet.
    const sheet = await readFile(join(outDir, 'styles.css'), 'utf8');
    expect(sheet).toMatch(/\.drawer/);
    expect(sheet).toMatch(/\.menu/);
  });

  it('fails the publish when a NEW validated slot (e.g. bottom) is unsafe', async () => {
    await expect(
      buildSite({
        publishedAt: '2026-05-29T00:00:00.000Z',
        outDir,
        bundle: bundle({
          project: {
            formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
            identity: { name: 'Acme', colors: { primary: '#0a7' } },
            settings: { defaultLocale: 'en', locales: ['en'] },
            website: { bottom: '<div>{{website.json}}</div><script>x()</script>' },
          },
          pages: [{ id: 'home', path: '', title: 'Home', source: '<div>h</div>' }],
        }),
      }),
    ).rejects.toThrow(/website bottom/);
  });

  it('builds per-locale auto-nav from each locale\'s own pages', async () => {
    // Locale variants are their own pages now; each locale's auto-nav lists only that
    // locale's pages, using their own (already-localized) paths — no link rebasing.
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: {} },
          settings: { defaultLocale: 'en', locales: ['en', 'de'] },
          website: { topNav: '<div>{{#each nav.header}}<a href="{{sw-url path}}">{{label}}</a>{{/each}}</div>' },
        },
        pages: [
          { id: 'home', path: '', title: 'Home', source: '<div>h</div>', nav: { slots: ['header'], order: 1 }, translationGroup: 'home' },
          { id: 'about', path: 'about', parent: 'home', title: 'About', source: '<div>a</div>', nav: { slots: ['header'], order: 2 } },
          { id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', source: '<div>hd</div>', nav: { slots: ['header'], order: 1 } },
          { id: 'about-de', path: 'about', parent: 'home-de', title: 'Über', locale: 'de', source: '<div>ad</div>', nav: { slots: ['header'], order: 2 } },
        ],
      }),
    });
    // The en home's nav lists the EN pages; links are rebased page-relative (portable).
    const en = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(en).toContain('href="about"'); // "/about" → "about" from the root
    expect(en).not.toContain('href="/about"'); // not absolute
    expect(en).not.toContain('de/about'); // EN nav lists only EN pages
    // The de home (/de/index.html, depth 1) lists the DE pages only, rebased from '../'.
    const de = await readFile(join(outDir, 'de', 'index.html'), 'utf8');
    expect(de).toContain('href="../de/about"'); // "/de/about" → "../de/about"
    expect(de).not.toContain('href="/de/about"'); // not absolute
  });

  it('an inherit-mode locale variant renders the OWNER code with its OWN data', async () => {
    // The de variant carries NO source/template → it follows the en owner's code
    // (`resolveCodeRef`), rendering the main language's layout with the variant's data.
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: {} },
          settings: { defaultLocale: 'en', locales: ['en', 'de'] },
        },
        pages: [
          {
            id: 'home', path: '', title: 'Home',
            source: '<h1 data-sw-text="headline" class="text-2xl">EN</h1>', data: { headline: 'Welcome' },
            translationGroup: 'home',
          },
          // Inherit-mode: no source, no template — code follows the owner; own data only.
          {
            id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de',
            translationGroup: 'home', data: { headline: 'Willkommen' },
          },
        ],
      }),
    });
    const en = await readFile(join(outDir, 'index.html'), 'utf8');
    const de = await readFile(join(outDir, 'de', 'index.html'), 'utf8');
    // Both render the SAME owner layout (the <h1>), but each shows its own data value.
    expect(en).toContain('>Welcome</h1>');
    expect(de).toContain('>Willkommen</h1>');
    expect(de).toContain('<html lang="de">'); // the variant's locale drives <html lang>
    // The owner's Tailwind class reaches the shared sheet, so the inheriting variant is styled.
    expect(de).toContain('text-2xl');
  });

  it('a locale-only page (no owner) renders from its OWN code', async () => {
    // A page that exists only in `de` with no en counterpart carries its own source.
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: {} },
          settings: { defaultLocale: 'en', locales: ['en', 'de'] },
        },
        pages: [
          { id: 'home', path: '', title: 'Home', source: '<div>home</div>' },
          { id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', source: '<div>start</div>' },
          // Locale-only: only exists in de, own code, no translationGroup.
          { id: 'kontakt-de', path: 'kontakt', parent: 'home-de', title: 'Kontakt', locale: 'de', source: '<h1>Kontakt DE</h1>' },
        ],
      }),
    });
    const page = await readFile(join(outDir, 'de', 'kontakt', 'index.html'), 'utf8');
    expect(page).toContain('<h1>Kontakt DE</h1>');
    expect(page).toContain('<html lang="de">');
  });

  it('fails the publish with a template-error message when a skeleton slot is malformed', async () => {
    await expect(
      buildSite({
        publishedAt: '2026-05-29T00:00:00.000Z',
        outDir,
        bundle: bundle({
          project: {
            formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
            identity: { name: 'Acme', colors: {} }, settings: { defaultLocale: 'en', locales: ['en'] },
            website: { topNav: '<div>{{#each nav.header}}<a>{{label}}</a></div>' }, // unclosed {{#each}}
          },
          pages: [{ id: 'home', path: '', title: 'Home', source: '<div>x</div>' }],
        }),
      }),
    ).rejects.toThrow(/website topNav template error/);
  });

  it('fails the publish with a clear error when a skeleton slot is unsafe', async () => {
    await expect(
      buildSite({
        publishedAt: '2026-05-29T00:00:00.000Z',
        outDir,
        bundle: bundle({
          project: {
            formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
            identity: { name: 'Acme', colors: {} }, settings: { defaultLocale: 'en', locales: ['en'] },
            website: { topNav: '<div>{{#each nav.header}}<a href="{{sw-url path}}">{{label}}</a>{{/each}}</div><script>x()</script>' },
          },
          pages: [{ id: 'home', path: '', title: 'Home', source: '<div>x</div>' }],
        }),
      }),
    ).rejects.toThrow(/website topNav/);
  });

  it('bakes client-edited region content ({{edit}} overrides) into a source-page build', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        pages: [
          {
            id: 'home', path: '', title: 'Home',
            source: '<div><h1 data-sw-text="headline">Default headline</h1></div>',
            data: { headline: 'Client wrote this' }, // the override now lives in page.data ({{edit}} reads it)
          },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).toContain('<h1>Client wrote this</h1>'); // override applied
    expect(home).not.toContain('Default headline'); // the template default replaced
  });

  it('fails the publish with a page-scoped error when a source-page is unsafe', async () => {
    await expect(
      buildSite({
        publishedAt: '2026-05-29T00:00:00.000Z',
        outDir,
        bundle: bundle({
          pages: [{ id: 'bad', path: '', title: 'Bad', source: '<script>x()</script>' }],
        }),
      }),
    ).rejects.toThrow(/page "bad"/);
  });

  it('aborts when the build exceeds maxOutputBytes (disk-fill DoS guard)', async () => {
    const big = 'x'.repeat(5000);
    await expect(
      buildSite({
        publishedAt: '2026-05-29T00:00:00.000Z',
        outDir,
        maxOutputBytes: 1024, // tiny cap → the first page already overflows
        bundle: bundle({
          pages: [
            { id: 'home', path: '', title: 'Home', source: `<div>${big}</div>` },
          ],
        }),
      }),
    ).rejects.toThrow(/maximum output size/);
  });

  it('tolerates a missing media variant without failing the build', async () => {
    const asset = {
      kind: 'image' as const,
      folder: '',
      id: 'a2',
      filename: 'x.png',
      format: 'image/png',
      bytes: 10,
      width: 100,
      height: 100,
      variants: [{ format: 'webp' as const, width: 100, height: 100, path: 'a2-100.webp' }],
      fallback: 'a2-100.jpg',
      url: '/media/p/a2/a2-100.jpg',
    };
    const manifest = await buildSite({
      publishedAt: '2026-05-30T00:00:00.000Z',
      outDir,
      media: [asset],
      readMedia: async (_assetId, file) => {
        if (file === 'a2-100.webp') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return Buffer.from('img');
      },
      bundle: bundle({
        pages: [{ id: 'home', path: '', title: 'Home' }],
      }),
    });
    expect(manifest.routes).toBe(1);
    // The present file was copied; the missing one was skipped.
    await expect(readFile(join(outDir, '_assets', 'a2', 'a2-100.jpg'), 'utf8')).resolves.toBe('img');
    await expect(readFile(join(outDir, '_assets', 'a2', 'a2-100.webp'), 'utf8')).rejects.toBeTruthy();
  });

  it('fails the build on a non-missing media read error (no partial artifact)', async () => {
    const asset = {
      kind: 'image' as const, folder: '',
      id: 'a4', filename: 'x.png', format: 'image/png', bytes: 1, width: 10, height: 10,
      variants: [], fallback: 'a4-10.jpg', url: '/media/p/a4/a4-10.jpg',
    };
    await expect(
      buildSite({
        publishedAt: '2026-05-30T00:00:00.000Z',
        outDir,
        media: [asset],
        readMedia: async () => {
          throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        },
        bundle: bundle({ pages: [{ id: 'home', path: '', title: 'Home' }] }),
      }),
    ).rejects.toThrow('disk full');
    // The previous (absent) build dir was not replaced with a partial one.
    await expect(readFile(join(outDir, 'index.html'), 'utf8')).rejects.toBeTruthy();
  });

  it('ignores media when no reader is provided (no copy)', async () => {
    const asset = {
      kind: 'image' as const, folder: '',
      id: 'a3', filename: 'x.png', format: 'image/png', bytes: 1, width: 10, height: 10,
      variants: [], fallback: 'a3-10.jpg', url: '/media/p/a3/a3-10.jpg',
    };
    await buildSite({
      publishedAt: '2026-05-30T00:00:00.000Z',
      outDir,
      media: [asset], // no readMedia
      bundle: bundle({ pages: [{ id: 'home', path: '', title: 'Home' }] }),
    });
    await expect(readFile(join(outDir, 'media', 'a3', 'a3-10.jpg'), 'utf8')).rejects.toBeTruthy();
  });

  it('bundles a kind:font asset via copyMedia + emits @font-face at the media path (never Google)', async () => {
    // A self-hosted font is just a media asset (kind 'font'); a typography slot references it by id.
    const fontAsset = {
      kind: 'font' as const,
      id: 'fa-boombox',
      filename: 'Boombox',
      folder: 'Brand',
      bytes: 6,
      family: 'Boombox',
      fallback: 'sans-serif' as const,
      source: 'local' as const,
      files: [{ weight: 400 as const, style: 'normal' as const, format: 'ttf' as const, file: '400.ttf' }],
      url: '/media/p/fa-boombox/400.ttf',
    };
    const reads: string[] = [];
    await buildSite({
      publishedAt: '2026-05-30T00:00:00.000Z',
      outDir,
      media: [fontAsset],
      readMedia: async (assetId, file) => {
        reads.push(`${assetId}/${file}`);
        if (assetId === 'fa-boombox' && file === '400.ttf') return Buffer.from('TTFBYT');
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: {
            name: 'Acme', colors: { primary: '#0a7' },
            typography: {
              fontFamilies: {},
              heading: { source: 'asset', family: 'Boombox', weight: 400, assetId: 'fa-boombox' },
            },
          },
          settings: { defaultLocale: 'en', locales: ['en'] },
        },
        pages: [{ id: 'home', path: '', title: 'Home' }],
      }),
    });

    // The font's face is bundled flat under _assets/<assetId>/ (like an image), via copyMedia.
    expect(reads).toContain('fa-boombox/400.ttf');
    expect((await readFile(join(outDir, '_assets', 'fa-boombox', '400.ttf'))).toString()).toBe('TTFBYT');

    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    // The inline @font-face points at the bundled media path, page-relative — never Google — ttf format.
    expect(home).toContain('@font-face');
    expect(home).toContain('src:url(_assets/fa-boombox/400.ttf) format("truetype")');
    expect(home).toContain('--sw-font-heading:"Boombox", sans-serif');
    expect(home).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it('rebuilds cleanly, removing files from a previous build', async () => {
    const opts = {
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({ pages: [{ id: 'gone', path: 'gone', title: 'Gone' }] }),
    };
    await buildSite(opts);
    await expect(readFile(join(outDir, 'gone', 'index.html'), 'utf8')).resolves.toBeTruthy();

    await buildSite({ ...opts, bundle: bundle({ pages: [{ id: 'home', path: '', title: 'Home' }] }) });
    await expect(readFile(join(outDir, 'gone', 'index.html'), 'utf8')).rejects.toBeTruthy();
    await expect(readFile(join(outDir, 'index.html'), 'utf8')).resolves.toBeTruthy();
  });
});
