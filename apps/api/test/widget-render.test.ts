import { describe, it, expect } from 'vitest';
import { renderTemplate } from '@sitewright/blocks';
import { WIDGET_PARTIALS } from '@sitewright/core';

// Renders the hero-slider WIDGET body through the REAL template engine, resolving `{{> hero-slider}}`
// from WIDGET_PARTIALS and consuming a `hero` config entry — the end-to-end binding the body relies
// on (dataset.hero singleton → settings as carousel data-* + the slides loop). Non-preview render, so
// the output is the clean static markup a published page ships.
const render = (config: Record<string, unknown>): string =>
  renderTemplate('{{> hero-slider}}', { dataset: { hero: [config] }, partials: WIDGET_PARTIALS });

const fullConfig = {
  autoplay: true,
  interval: 6000,
  kenburns: true,
  show_arrows: true,
  show_indicators: true,
  slides: [
    { image: '/media/a.jpg', caption: 'Alpha' },
    { image: '/media/b.jpg', caption: 'Beta' },
    { image: '', caption: '<strong>Gamma</strong>' },
  ],
};

describe('hero-slider Widget render', () => {
  it('resolves {{> hero-slider}} and renders one slide per `slides` entry', () => {
    const html = render(fullConfig);
    expect(html).toContain('data-sw-component="carousel"');
    expect((html.match(/data-sw-part="slide"/g) ?? []).length).toBe(3);
  });

  it('renders a slide image as an <img> (object-fit cover via .sw-kenburns), with the caption', () => {
    const html = render(fullConfig);
    expect(html).toMatch(/<img class="sw-kenburns"[^>]*src="\/media\/a\.jpg"/);
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
  });

  it('captions support basic HTML (richtext via {{sw-html}}, sanitized)', () => {
    const html = render(fullConfig);
    // The <strong> in the caption survives sanitization …
    expect(html).toContain('<strong>Gamma</strong>');
    // … but a script would be discarded.
    expect(render({ ...fullConfig, slides: [{ image: '', caption: 'Hi<script>alert(1)</script>' }] })).not.toContain('<script>');
  });

  it('falls back to a base-200 placeholder for an empty image (a freshly-provisioned slide)', () => {
    const html = render(fullConfig);
    expect(html).toContain('<div class="sw-kenburns bg-base-200"></div>');
  });

  it('hides the caption pill for a slide with a blank caption (no empty box ships)', () => {
    // One real caption, then a run of "empty" forms: cleared (''), whitespace, and the markup residue a
    // cleared WYSIWYG can leave (<p></p>, <p><br></p>). Only the real caption renders a .sw-caption pill.
    const html = render({
      ...fullConfig,
      slides: [
        { image: '/media/a.jpg', caption: 'Alpha' },
        { image: '/media/b.jpg', caption: '' },
        { image: '/media/c.jpg', caption: '   ' },
        { image: '/media/d.jpg', caption: '<p></p>' },
        { image: '/media/e.jpg', caption: '<p><br></p>' },
      ],
    });
    // five slides, but exactly one caption pill
    expect((html.match(/data-sw-part="slide"/g) ?? []).length).toBe(5);
    expect((html.match(/class="sw-caption/g) ?? []).length).toBe(1);
    expect(html).toContain('Alpha');
  });

  it('maps settings onto the carousel data-* attributes (read by VALUE by the runtime)', () => {
    const html = render(fullConfig);
    expect(html).toContain('data-autoplay="true"');
    expect(html).toContain('data-interval="6000"');
    expect(html).toContain('data-sw-part="prev"');
    expect(html).toContain('data-sw-part="next"');
    expect(html).toContain('data-sw-part="dots"');
  });

  it('enables click-to-advance (data-click-next) on the slider', () => {
    expect(render(fullConfig)).toContain('data-click-next="true"');
  });

  it('PREVIEW (markEntries) wraps the hero in a data-sw-entry marker → click opens the config entry', () => {
    const html = renderTemplate('{{> hero-slider}}', {
      dataset: { hero: [{ id: 'config', dataset: 'hero', values: fullConfig }] },
      markEntries: true,
      partials: WIDGET_PARTIALS,
    });
    expect(html).toContain('data-sw-entry="config"');
    expect(html).toContain('data-sw-dataset="hero"');
    // publish render (no markEntries) must NOT add the marker.
    expect(render(fullConfig)).not.toContain('data-sw-entry');
  });

  it('honours the toggles: autoplay off, arrows/indicators hidden, Ken Burns off', () => {
    const html = render({ ...fullConfig, autoplay: false, kenburns: false, show_arrows: false, show_indicators: false });
    expect(html).toContain('data-autoplay="false"');
    expect(html).toContain('data-kenburns="off"');
    // Ken Burns off keeps the cover layout + caption (only the drift animation is gated, in CSS).
    expect(html).toContain('class="sw-caption');
    expect(html).not.toContain('data-sw-part="prev"');
    expect(html).not.toContain('data-sw-part="next"');
    expect(html).not.toContain('data-sw-part="dots"');
  });

  it('Ken Burns on → data-kenburns="on" (drives the drift animation)', () => {
    expect(render(fullConfig)).toContain('data-kenburns="on"');
  });

  it('arrow chevrons carry NO size utility (class="") so the base CSS owns the edge/circle glyph size', () => {
    // Regression guard: a BARE {{sw-icon "chevron-left"}} defaults to the helper's `h-5 w-5` class, which
    // (a real class) outranks the zero-specificity component CSS and shrinks the hero chevron. The widget
    // must pass an explicit empty class — {{sw-icon "chevron-left" ""}} → <svg class=""> — so the CSS sizes it.
    const html = render(fullConfig);
    expect(html).toMatch(/data-sw-part="prev"[^>]*>\s*<svg class=""/);
    expect(html).toMatch(/data-sw-part="next"[^>]*>\s*<svg class=""/);
    expect(html).not.toContain('h-5 w-5'); // no size utility anywhere on the hero arrows
  });

  it('height: an explicit CSS length sets an inline style and drops the class-based default height', () => {
    const html = render({ ...fullConfig, height: '70vh' });
    expect(html).toContain('style="height:70vh"');
    expect(html).not.toContain('h-[60vh]'); // the vh default is suppressed when an explicit height is set
    expect(html).not.toContain('h-[86vh]');
  });

  it('height: blank → the full_bleed-based default height class applies (no inline style)', () => {
    const contained = render({ ...fullConfig, full_bleed: false, height: '' });
    expect(contained).toContain('h-[60vh]');
    expect(contained).not.toContain('style="height:');
    const bleed = render({ ...fullConfig, full_bleed: true, height: '' });
    expect(bleed).toContain('h-[86vh]');
    expect(bleed).not.toContain('style="height:');
  });

  it('height overrides a contained hero cleanly (max-h clamp dropped so a tall value is honoured; corners kept)', () => {
    const html = render({ ...fullConfig, full_bleed: false, height: '900px' });
    expect(html).toContain('style="height:900px"');
    expect(html).not.toContain('max-h-[640px]'); // would otherwise clamp an explicit tall height
    expect(html).toContain('rounded-3xl'); // contained corner treatment still applies
  });

  it('renders nothing until the `hero` dataset exists (no config → empty)', () => {
    expect(renderTemplate('{{> hero-slider}}', { dataset: { hero: [] }, partials: WIDGET_PARTIALS }).trim()).toBe('');
  });

  // Multiple configs (entry envelopes) + a page.data selection → the widget renders the CHOSEN one.
  const envelopes = [
    { id: 'config', values: { ...fullConfig, slides: [{ image: '/a.jpg', caption: 'First config' }] } },
    { id: 'minimal', values: { ...fullConfig, kenburns: false, slides: [{ image: '/b.jpg', caption: 'Minimal config' }] } },
  ];
  const renderPick = (selectedId?: string): string =>
    renderTemplate('{{> hero-slider}}', { dataset: { hero: envelopes }, page: { data: selectedId ? { hero_config: selectedId } : {} }, partials: WIDGET_PARTIALS });

  it('renders the config selected by page.data.hero_config', () => {
    const html = renderPick('minimal');
    expect(html).toContain('Minimal config');
    expect(html).toContain('data-kenburns="off"');
    expect(html).not.toContain('First config');
  });

  it('defaults to the FIRST config when no selection is set (or the id is unknown)', () => {
    expect(renderPick()).toContain('First config');
    expect(renderPick('nope')).toContain('First config');
  });
});
