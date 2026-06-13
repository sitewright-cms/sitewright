import { describe, it, expect } from 'vitest';
import { renderTemplate } from '@sitewright/blocks';
import { WIDGET_PARTIALS } from '@sitewright/core';

// Renders the hero-slider WIDGET body through the REAL template engine, resolving `{{> hero-slider}}`
// from WIDGET_PARTIALS and consuming a `hero` config entry — the end-to-end binding the body relies
// on (data.hero singleton → settings as carousel data-* + the slides loop). Non-preview render, so
// the output is the clean static markup a published page ships.
const render = (config: Record<string, unknown>): string =>
  renderTemplate('{{> hero-slider}}', { data: { hero: [config] }, partials: WIDGET_PARTIALS });

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

  it('captions support basic HTML (richtext via {{sw-rich}}, sanitized)', () => {
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

  it('maps settings onto the carousel data-* attributes (read by VALUE by the runtime)', () => {
    const html = render(fullConfig);
    expect(html).toContain('data-autoplay="true"');
    expect(html).toContain('data-interval="6000"');
    expect(html).toContain('data-sw-part="prev"');
    expect(html).toContain('data-sw-part="next"');
    expect(html).toContain('data-sw-part="dots"');
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

  it('renders nothing until the `hero` dataset exists (no config → empty)', () => {
    expect(renderTemplate('{{> hero-slider}}', { data: { hero: [] }, partials: WIDGET_PARTIALS }).trim()).toBe('');
  });

  // Multiple configs (entry envelopes) + a page.data selection → the widget renders the CHOSEN one.
  const envelopes = [
    { id: 'config', values: { ...fullConfig, slides: [{ image: '/a.jpg', caption: 'First config' }] } },
    { id: 'minimal', values: { ...fullConfig, kenburns: false, slides: [{ image: '/b.jpg', caption: 'Minimal config' }] } },
  ];
  const renderPick = (selectedId?: string): string =>
    renderTemplate('{{> hero-slider}}', { data: { hero: envelopes }, page: { data: selectedId ? { hero_config: selectedId } : {} }, partials: WIDGET_PARTIALS });

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
