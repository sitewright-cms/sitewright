import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectBundle } from '@sitewright/core';
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
    partials: [],
    datasets: [],
    entries: [],
    ...over,
  } as ProjectBundle;
}

describe('buildSite', () => {
  it('writes one index.html per static page plus a release manifest', async () => {
    const manifest = await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        pages: [
          { id: 'home', path: '/', title: 'Home', root: { id: 'r1', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Welcome' } }] } },
          { id: 'about', path: '/about', title: 'About', root: { id: 'r2', type: 'Section' } },
        ],
      }),
    });
    expect(manifest.routes).toBe(2);

    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home.startsWith('<!doctype html>')).toBe(true);
    expect(home).toContain('Welcome');
    expect(home).toContain('--sw-color-primary: #0a7;');

    const about = await readFile(join(outDir, 'about', 'index.html'), 'utf8');
    expect(about).toContain('data-sw-block="Section"');

    const release = JSON.parse(await readFile(join(outDir, 'release.json'), 'utf8'));
    expect(release.routes).toBe(2);
    expect(release.publishedAt).toBe('2026-05-29T00:00:00.000Z');
  });

  it('renders a code-first source-page (Handlebars) to static HTML + feeds its classes to the shared sheet', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        pages: [
          {
            id: 'home', path: '/', title: 'Home',
            root: { id: 'r', type: 'Section' }, // placeholder block tree, ignored when source is set
            source: '<main class="grid"><h1>{{ company.name }}</h1></main>',
          },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home.startsWith('<!doctype html>')).toBe(true);
    // Rendered from the Handlebars source ({{ company.name }} → Acme); block tree NOT rendered.
    expect(home).toContain('<body><main class="grid"><h1>Acme</h1></main>');
    expect(home).not.toContain('<section data-sw-block="Section"');
    // The source's literal Tailwind class is compiled into the shared, root-linked sheet.
    expect(home).toContain('<link rel="stylesheet" href="styles.css" />');
    expect(await readFile(join(outDir, 'styles.css'), 'utf8')).toContain('display:grid');
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
            id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' },
            source: '<main><button class="btn btn-primary">Sign up</button></main>',
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
            topNav:
              '<nav class="navbar bg-base-100"><a class="btn btn-ghost" href="/">{{ company.name }}</a>' +
              '<ul class="menu menu-horizontal">{{#each nav.header}}<li><a href="{{url path}}">{{label}}</a></li>{{/each}}</ul></nav>',
            footer: '<footer class="footer">© {{ company.name }}</footer>',
          },
        },
        pages: [
          { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<main>Home body</main>', nav: { slots: ['header'], order: 1 } },
          { id: 'about', path: '/about', title: 'About', root: { id: 'r2', type: 'Section' }, source: '<main>About body</main>', nav: { slots: ['header'], order: 2 } },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).toContain('Home body'); // the page's own source
    expect(home).toContain('<nav class="navbar bg-base-100">'); // the shared topNav slot
    // The auto-nav lists BOTH pages (built from each page's nav settings).
    expect(home).toContain('<a href="/">Home</a>');
    expect(home).toContain('<a href="/about">About</a>');
    expect(home).toContain('<footer class="footer">© Acme</footer>'); // shared footer + brand
    expect(home).toContain('<link rel="stylesheet" href="styles.css" />');
    // The slot's DaisyUI/Tailwind classes are compiled into the shared sheet.
    const sheet = await readFile(join(outDir, 'styles.css'), 'utf8');
    expect(sheet).toMatch(/\.btn/);

    // A second page shares the exact same nav + footer (authored once).
    const about = await readFile(join(outDir, 'about', 'index.html'), 'utf8');
    expect(about).toContain('About body');
    expect(about).toContain('<a href="/about">About</a>');
    expect(about).toContain('<footer class="footer">© Acme</footer>');
  });

  it('composes {{> snippet}} Handlebars partials into a published source page', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      snippets: { promo: '<aside class="alert">{{ company.name }} promo</aside>' },
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          settings: { defaultLocale: 'en', locales: ['en'] },
        },
        pages: [
          { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<main><h1>Home</h1>{{> promo}}</main>' },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).toContain('<aside class="alert">Acme promo</aside>'); // the snippet expanded + bound
    // The snippet's classes feed the shared utility sheet (compiled output lives in styles.css).
    const sheet = await readFile(join(outDir, 'styles.css'), 'utf8');
    expect(sheet).toMatch(/\.alert/);
  });

  it('fails the publish when a referenced snippet is undefined', async () => {
    await expect(
      buildSite({
        publishedAt: '2026-05-29T00:00:00.000Z',
        outDir,
        bundle: bundle({
          pages: [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<main>{{> missing}}</main>' }],
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
          pages: [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<main>{{> a}}</main>' }],
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
          pages: [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<main>{{> evil}}</main>' }],
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
            footer: '<footer>{{ website.json_data.title }} tags: {{#each website.json_data.tags}}{{this}}{{/each}}</footer>',
          },
        },
        pages: [
          { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<main><h1>{{ website.json_data.title }}</h1><p>{{ website.json_data.extract }}</p></main>', nav: { slots: ['header'], order: 1 } },
        ],
      }),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).toContain('<h1>Berlin</h1>'); // source page reads the snapshot
    expect(home).toContain('<p>Capital of Germany</p>');
    expect(home).toContain('<footer>Berlin tags: ab</footer>'); // a slot can {{#each}} the array
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
          { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<main><h1>{{ website.json_data.title }}</h1><p>{{ website.json_data.note }}</p></main>' },
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
            topNav: '<nav id="slot-top" class="navbar">top</nav>',
            mobileNav: '<nav id="slot-mob" class="drawer">mobile</nav>',
            sidebarLeft: '<aside id="slot-sl" class="menu">left</aside>',
            sidebarRight: '<aside id="slot-sr" class="menu">right</aside>',
            footer: '<footer id="slot-foot" class="footer">foot</footer>',
            bottom: '<div id="slot-bottom" class="modal">{{ company.name }}</div>',
          },
        },
        pages: [
          { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<main id="page-body">Home body</main>', nav: { slots: ['header'], order: 1 } },
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
          pages: [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<main>h</main>' }],
        }),
      }),
    ).rejects.toThrow(/website bottom/);
  });

  it('locale-prefixes skeleton-slot nav links for non-default locales', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        project: {
          formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
          identity: { name: 'Acme', colors: {} },
          settings: { defaultLocale: 'en', locales: ['en', 'de'] },
          website: { topNav: '<nav>{{#each nav.header}}<a href="{{url path}}">{{label}}</a>{{/each}}</nav>' },
        },
        pages: [
          { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<main>h</main>', nav: { slots: ['header'], order: 1 } },
          { id: 'about', path: '/about', title: 'About', root: { id: 'r2', type: 'Section' }, source: '<main>a</main>', nav: { slots: ['header'], order: 2 } },
        ],
      }),
    });
    // Default locale at the root → root-relative nav links.
    expect(await readFile(join(outDir, 'index.html'), 'utf8')).toContain('href="/about"');
    // Non-default locale under /de/ → its shared nav points at the in-locale page.
    const de = await readFile(join(outDir, 'de', 'index.html'), 'utf8');
    expect(de).toContain('href="/de/about"');
    expect(de).not.toContain('href="/about"');
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
            website: { topNav: '<nav>{{#each nav.header}}<a>{{label}}</a></nav>' }, // unclosed {{#each}}
          },
          pages: [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<main>x</main>' }],
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
            website: { topNav: '<nav>{{#each nav.header}}<a href="{{url path}}">{{label}}</a>{{/each}}</nav><script>x()</script>' },
          },
          pages: [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<main>x</main>' }],
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
            id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' },
            source: '<main><h1>{{edit "headline" "Default headline"}}</h1></main>',
            content: { headline: 'Client wrote this' },
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
          pages: [{ id: 'bad', path: '/', title: 'Bad', root: { id: 'r', type: 'Section' }, source: '<script>x()</script>' }],
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
            { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Html', props: { html: big } } },
          ],
        }),
      }),
    ).rejects.toThrow(/maximum output size/);
  });

  it('expands a collection page per published entry and excludes drafts', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        pages: [
          {
            id: 'post',
            path: '/blog/[slug]',
            title: 'Post',
            collection: { dataset: 'posts', param: 'slug' },
            root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { textField: 'title' } }] },
          },
        ],
        entries: [
          { id: 'p1', dataset: 'posts', status: 'published', values: { slug: 'first', title: 'First Post' } },
          { id: 'p2', dataset: 'posts', status: 'draft', values: { slug: 'second', title: 'Hidden' } },
        ],
      }),
    });

    const first = await readFile(join(outDir, 'blog', 'first', 'index.html'), 'utf8');
    expect(first).toContain('First Post');
    // The draft entry produced no route/file.
    await expect(readFile(join(outDir, 'blog', 'second', 'index.html'), 'utf8')).rejects.toBeTruthy();
  });

  it('bundles media and renders an optimized, page-relative <picture>', async () => {
    const asset = {
      kind: 'image' as const,
      folder: '',
      id: 'a1',
      filename: 'hero.png',
      format: 'image/png',
      bytes: 10,
      width: 800,
      height: 600,
      variants: [
        { format: 'avif' as const, width: 400, height: 300, path: 'a1-400.avif' },
        { format: 'webp' as const, width: 400, height: 300, path: 'a1-400.webp' },
      ],
      fallback: 'a1-400.jpg',
      url: '/media/p/a1/a1-400.jpg',
    };
    const reads: string[] = [];
    await buildSite({
      publishedAt: '2026-05-30T00:00:00.000Z',
      outDir,
      media: [asset],
      readMedia: async (assetId, file) => {
        reads.push(`${assetId}/${file}`);
        return Buffer.from(`bytes:${file}`);
      },
      bundle: bundle({
        pages: [
          { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Image', props: { src: '/media/p/a1/a1-400.jpg', alt: 'Hero' } } },
          { id: 'about', path: '/about', title: 'About', root: { id: 'r2', type: 'Image', props: { src: '/media/p/a1/a1-400.jpg', alt: 'Hero' } } },
        ],
      }),
    });

    // Binaries copied into the artifact.
    expect(reads.sort()).toEqual(['a1/a1-400.avif', 'a1/a1-400.jpg', 'a1/a1-400.webp']);
    expect((await readFile(join(outDir, 'media', 'a1', 'a1-400.jpg'), 'utf8'))).toContain('bytes:a1-400.jpg');

    // Root page references media/… ; the /about page (one level deep) uses ../media/…
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).toContain('<picture');
    expect(home).toContain('srcset="media/a1/a1-400.avif 400w"');
    const about = await readFile(join(outDir, 'about', 'index.html'), 'utf8');
    expect(about).toContain('../media/a1/a1-400.avif 400w');
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
        pages: [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } }],
      }),
    });
    expect(manifest.routes).toBe(1);
    // The present file was copied; the missing one was skipped.
    await expect(readFile(join(outDir, 'media', 'a2', 'a2-100.jpg'), 'utf8')).resolves.toBe('img');
    await expect(readFile(join(outDir, 'media', 'a2', 'a2-100.webp'), 'utf8')).rejects.toBeTruthy();
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
        bundle: bundle({ pages: [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } }] }),
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
      bundle: bundle({ pages: [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } }] }),
    });
    await expect(readFile(join(outDir, 'media', 'a3', 'a3-10.jpg'), 'utf8')).rejects.toBeTruthy();
  });

  it('rebuilds cleanly, removing files from a previous build', async () => {
    const opts = {
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({ pages: [{ id: 'gone', path: '/gone', title: 'Gone', root: { id: 'r', type: 'Section' } }] }),
    };
    await buildSite(opts);
    await expect(readFile(join(outDir, 'gone', 'index.html'), 'utf8')).resolves.toBeTruthy();

    await buildSite({ ...opts, bundle: bundle({ pages: [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } }] }) });
    await expect(readFile(join(outDir, 'gone', 'index.html'), 'utf8')).rejects.toBeTruthy();
    await expect(readFile(join(outDir, 'index.html'), 'utf8')).resolves.toBeTruthy();
  });
});
