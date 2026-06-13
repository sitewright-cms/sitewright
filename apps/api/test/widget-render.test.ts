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
  show_arrows: true,
  show_indicators: true,
  slides: [
    { image: '/media/a.jpg', caption: 'Alpha' },
    { image: '/media/b.jpg', caption: 'Beta' },
    { image: '', caption: 'Gamma' },
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
    expect(html).toContain('Gamma');
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

  it('honours the toggles: autoplay off, arrows/indicators hidden', () => {
    const html = render({ ...fullConfig, autoplay: false, show_arrows: false, show_indicators: false });
    expect(html).toContain('data-autoplay="false"');
    expect(html).not.toContain('data-sw-part="prev"');
    expect(html).not.toContain('data-sw-part="next"');
    expect(html).not.toContain('data-sw-part="dots"');
  });

  it('renders nothing until the `hero` dataset exists (no config → empty)', () => {
    expect(renderTemplate('{{> hero-slider}}', { data: { hero: [] }, partials: WIDGET_PARTIALS }).trim()).toBe('');
  });
});
