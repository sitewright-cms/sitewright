import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../src/template.js';
import { componentAssets, componentTypesInSource } from '../src/components.js';
import {
  IMAGE_MAP_ATTR,
  jsonForScript,
  renderImageMapMarkup,
  resolveImageMapEmbeds,
  sanitizeImageMapConfig,
  sanitizeSvgFragment,
  unknownImageMapMessage,
  type RenderImageMap,
} from '../src/image-map-embed.js';

const map = (config: Record<string, unknown>): RenderImageMap => ({ id: 'floor', config });

const BASIC = {
  general: { name: 'Floor' },
  artboards: [
    {
      id: 'a1',
      title: 'Ground',
      image_url: '/media/acme/a1b2c3-ground.jpg',
      children: [{ id: 'o1', title: 'Reception', type: 'rect', x: 10, y: 10, width: 20, height: 20 }],
    },
  ],
};

/** The config back out of rendered markup — what the runtime will actually parse. */
function configFrom(html: string): Record<string, unknown> {
  const m = html.match(/<script type="application\/json" data-sw-part="config">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no config block in output');
  return JSON.parse(m[1]!) as Record<string, unknown>;
}

describe('image map markup', () => {
  it('renders the component marker, a fallback image and the config block', () => {
    const html = renderImageMapMarkup(map(BASIC));
    expect(html).toContain('data-sw-component="image-map"');
    expect(html).toContain('<img src="/media/acme/a1b2c3-ground.jpg" alt="Ground"');
    expect(configFrom(html)).toMatchObject({ general: { name: 'Floor' } });
  });

  it('applies an authored class to the wrapper', () => {
    expect(renderImageMapMarkup(map(BASIC), { class: 'rounded-xl w-full' })).toContain('class="rounded-xl w-full"');
  });

  it('omits the fallback image when the first artboard has none', () => {
    const html = renderImageMapMarkup(map({ ...BASIC, artboards: [{ id: 'a1', title: 'X', children: [] }] }));
    expect(html).not.toContain('<img');
    expect(html).toContain('data-sw-component="image-map"');
  });
});

describe('jsonForScript', () => {
  it('neutralises a </script> breakout while staying parseable', () => {
    const out = jsonForScript({ text: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<script>');
    expect(JSON.parse(out)).toEqual({ text: '</script><script>alert(1)</script>' });
  });
});

describe('sanitizeImageMapConfig', () => {
  it('strips script and handlers from a tooltip block’s rich text, keeping the markup that is the point', () => {
    const out = sanitizeImageMapConfig({
      tooltip_content: [{ type: 'Paragraph', text: '<b>Bold</b><script>alert(1)</script><i onclick="x()">i</i>' }],
    }) as { tooltip_content: Array<{ text: string }> };
    const text = out.tooltip_content[0]!.text;
    expect(text).toContain('<b>Bold</b>');
    expect(text).not.toContain('<script');
    expect(text).not.toContain('onclick');
  });

  it('sanitises text at every nesting depth', () => {
    // A map is artboards → objects → nested group children → blocks; the walk must not depend on
    // a hand-written list of paths that can miss a level.
    const out = sanitizeImageMapConfig({
      artboards: [
        {
          children: [
            {
              type: 'group',
              children: [
                { type: 'rect', tooltip_content: [{ type: 'Heading', text: 'ok<script>bad()</script>' }] },
              ],
            },
          ],
        },
      ],
    }) as never;
    expect(JSON.stringify(out)).not.toContain('<script');
    expect(JSON.stringify(out)).toContain('ok');
  });

  it('force-sandboxes a YouTube embed and drops a non-https one', () => {
    const ok = sanitizeImageMapConfig({
      embedCode: '<iframe src="https://www.youtube.com/embed/abc" width="560"></iframe>',
    }) as { embedCode: string };
    expect(ok.embedCode).toContain('sandbox');
    expect(ok.embedCode).toContain('https://www.youtube.com/embed/abc');

    const bad = sanitizeImageMapConfig({ embedCode: '<iframe src="javascript:alert(1)"></iframe>' }) as {
      embedCode: string;
    };
    expect(bad.embedCode).not.toContain('javascript:');
  });

  it('leaves non-markup values untouched', () => {
    const input = { general: { name: 'Floor', width: 800 }, artboards: [{ id: 'a1', x: -12.5 }] };
    expect(sanitizeImageMapConfig(input)).toEqual(input);
  });
});

describe('sanitizeSvgFragment', () => {
  it('keeps geometry and drops script from an imported region', () => {
    const out = sanitizeSvgFragment('<g><path d="M0 0L10 10"/><script>alert(1)</script></g>');
    expect(out).toContain('<path');
    expect(out).toContain('M0 0L10 10');
    expect(out).not.toContain('<script');
    // The wrapper used to reach the audited whole-document sanitizer must not leak into the output.
    expect(out).not.toContain('<svg');
  });

  it('strips inline handlers and remote references', () => {
    const out = sanitizeSvgFragment('<g onclick="x()"><image href="https://evil.test/p.png"/></g>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('https://evil.test');
  });

  it('is empty for an empty fragment, and inert for a non-markup one', () => {
    expect(sanitizeSvgFragment('')).toBe('');
    // Bare text inside an SVG region draws nothing and carries no behaviour — it is passed
    // through rather than treated as an error.
    expect(sanitizeSvgFragment('not markup at all')).toBe('not markup at all');
  });
});

describe('resolveImageMapEmbeds', () => {
  const ctx = { imageMaps: { floor: map(BASIC) } };

  it('is a byte-identical no-op without a reference', () => {
    const html = '<p>no maps here</p>';
    expect(resolveImageMapEmbeds(html, ctx)).toBe(html);
  });

  it('is a no-op when the surface supplies no maps', () => {
    const html = `<div ${IMAGE_MAP_ATTR}="floor"></div>`;
    expect(resolveImageMapEmbeds(html, {})).toBe(html);
  });

  it('leaves prose mentioning the attribute untouched', () => {
    const html = '<p>Use data-sw-imagemap="id" to embed a map.</p>';
    expect(resolveImageMapEmbeds(html, ctx)).toBe(html);
  });

  it('resolves a hand-authored carrier, keeping its own attributes', () => {
    const out = resolveImageMapEmbeds(`<div ${IMAGE_MAP_ATTR}="floor" class="w-full"></div>`, ctx);
    expect(out).toContain('data-sw-component="image-map"');
    expect(out).toContain('class="w-full"');
    expect(configFrom(out)).toMatchObject({ general: { name: 'Floor' } });
  });

  it('keeps an author-supplied fallback instead of generating one', () => {
    const out = resolveImageMapEmbeds(`<div ${IMAGE_MAP_ATTR}="floor"><img src="/mine.jpg" alt="Mine"></div>`, ctx);
    // Exactly one <img> — the author's. (The artboard's image_url still appears inside the config
    // block, which is where the runtime reads it from.)
    const imgs = out.match(/<img\b[^>]*>/g) ?? [];
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toContain('/mine.jpg');
  });

  it('strips the marker on publish and keeps it in preview', () => {
    const html = `<div ${IMAGE_MAP_ATTR}="floor"></div>`;
    expect(resolveImageMapEmbeds(html, ctx)).not.toContain(IMAGE_MAP_ATTR);
    expect(resolveImageMapEmbeds(html, { ...ctx, preview: true })).toContain(IMAGE_MAP_ATTR);
  });

  it('throws a named error for an unknown id', () => {
    expect(() => resolveImageMapEmbeds(`<div ${IMAGE_MAP_ATTR}="nope"></div>`, ctx)).toThrow(
      unknownImageMapMessage('nope'),
    );
  });

  it('does not resolve an id inherited from Object.prototype', () => {
    expect(() => resolveImageMapEmbeds(`<div ${IMAGE_MAP_ATTR}="constructor"></div>`, ctx)).toThrow(
      unknownImageMapMessage('constructor'),
    );
  });

  it('sanitises on the way out', () => {
    const dirty = {
      ...BASIC,
      artboards: [
        {
          id: 'a1',
          title: 'Ground',
          children: [{ id: 'o1', type: 'rect', tooltip_content: [{ type: 'Paragraph', text: '<script>bad()</script>hi' }] }],
        },
      ],
    };
    const out = resolveImageMapEmbeds(`<div ${IMAGE_MAP_ATTR}="floor"></div>`, {
      imageMaps: { floor: map(dirty) },
    });
    expect(out).not.toContain('bad()');
    expect(JSON.stringify(configFrom(out))).toContain('hi');
  });
});

describe('{{sw-imagemap}} through the render engine', () => {
  it('renders a stored map, and ships the component CSS/JS for the page', () => {
    const html = renderTemplate('<section>{{sw-imagemap "floor" class="w-full"}}</section>', {
      imageMaps: { floor: map(BASIC) },
    });
    expect(html).toContain('data-sw-component="image-map"');
    expect(html).toContain('class="w-full"');
    expect(configFrom(html)).toMatchObject({ general: { name: 'Floor' } });

    // The only-used-ships pipeline must see the marker the helper emitted.
    expect(componentTypesInSource(html)).toEqual(['ImageMap']);
    expect(componentAssets(componentTypesInSource(html)).js).toContain('data-sw-component');
  });

  it('renders nothing on a surface with no maps, rather than erroring', () => {
    // Mirrors {{sw-form}}: the snippet hover preview supplies no maps, and that is not an
    // authoring mistake.
    expect(renderTemplate('[{{sw-imagemap "floor"}}]', {})).toBe('[]');
  });

  it('fails loudly on an unknown id', () => {
    expect(() => renderTemplate('{{sw-imagemap "nope"}}', { imageMaps: { floor: map(BASIC) } })).toThrow(
      /Unknown image map/,
    );
  });

  it('resolves a hand-authored carrier through the pass', () => {
    const html = renderTemplate(`<div ${IMAGE_MAP_ATTR}="floor"></div>`, { imageMaps: { floor: map(BASIC) } });
    expect(html).toContain('data-sw-component="image-map"');
    expect(componentTypesInSource(html)).toEqual(['ImageMap']);
  });
});

describe('sanitizeImageMapConfig prototype safety', () => {
  it('does not let a stored config pollute Object.prototype', () => {
    // JSON.parse produces an OWN "__proto__" property; a plain out[key] = … assignment for that key
    // runs the prototype SETTER, which would leak into every object in the render process.
    const config = JSON.parse('{"general":{"name":"x"},"__proto__":{"polluted":"yes"}}') as unknown;
    const out = sanitizeImageMapConfig(config) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.keys(out)).toEqual(['general']);
  });

  it('survives a nested __proto__ too', () => {
    const config = JSON.parse('{"artboards":[{"children":[{"__proto__":{"nested":"yes"}}]}]}') as unknown;
    sanitizeImageMapConfig(config);
    expect(({} as Record<string, unknown>).nested).toBeUndefined();
  });
});
