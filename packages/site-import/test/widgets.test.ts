import { describe, expect, it } from 'vitest';
import { parse } from '../src/dom.js';
import { collectWidgetIntegrations, widgetProviderFor } from '../src/widgets.js';

describe('widgetProviderFor', () => {
  it('matches a known provider host + subdomain over https, rejects others / non-https', () => {
    expect(widgetProviderFor('https://weatherwidget.io/js/widget.min.js')).toMatchObject({ name: 'weatherwidget.io' });
    expect(widgetProviderFor('https://embed.tawk.to/abc/default')).toMatchObject({ name: 'Tawk.to' }); // subdomain
    expect(widgetProviderFor('https://static.elfsightcdn.com/platform.js')).toMatchObject({ name: 'Elfsight' }); // 2nd domain → same provider
    expect(widgetProviderFor('https://code.jquery.com/jquery.min.js')).toBeNull(); // a plain library CDN is NOT a widget
    expect(widgetProviderFor('https://www.googletagmanager.com/gtag/js')).toBeNull(); // analytics, not a widget
    expect(widgetProviderFor('http://weatherwidget.io/x.js')).toBeNull(); // non-https
    expect(widgetProviderFor('https://weatherwidget.io.evil.com/x.js')).toBeNull(); // suffix-spoof, not a subdomain
  });
});

describe('collectWidgetIntegrations', () => {
  it('detects a weatherwidget.io loader inside an INLINE script → ONE functional consent integration (no iframe)', () => {
    // droombos's real pattern: an <a class="weatherwidget-io"> mount + an inline getScript loader.
    const doc = parse(`<html><body>
      <a class="weatherwidget-io" href="https://forecast7.com/en/x/windhoek/">WEATHER</a>
      <script>ready(function(){ $.getScript("https://weatherwidget.io/js/widget.min.js"); __weatherwidget_init(); });</script>
    </body></html>`);
    const out = collectWidgetIntegrations([doc]);
    expect(out).toEqual([{ id: 'weatherwidget-io', name: 'weatherwidget.io', category: 'functional', src: 'https://weatherwidget.io/js/widget.min.js', async: true, origins: ['weatherwidget.io', '*.weatherwidget.io'] }]);
    expect(out[0]).not.toHaveProperty('frameOrigins'); // renders inline, no widget iframe
  });

  it('a chat widget with a NON-.js inline loader gets frameOrigins (so its iframe UI is not CSP-blocked)', () => {
    // Tawk.to's canonical loader: s1.src = 'https://embed.tawk.to/ID/1abc' — NO .js extension.
    const doc = parse(`<html><body><script>var s1=document.createElement("script");s1.src='https://embed.tawk.to/64abc/1hdefg';</script></body></html>`);
    const out = collectWidgetIntegrations([doc]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Tawk.to', frameOrigins: ['tawk.to', '*.tawk.to'] });
  });

  it('consolidates a multi-domain provider (elfsight.com + elfsightcdn.com) into ONE integration', () => {
    const a = parse(`<html><body><script src="https://static.elfsight.com/platform/platform.js"></script></body></html>`);
    const b = parse(`<html><body><script src="https://universe-static.elfsightcdn.com/x.js" async></script></body></html>`);
    const out = collectWidgetIntegrations([a, b]);
    expect(out).toHaveLength(1); // ONE Elfsight entry, not two
    expect(out[0]).toMatchObject({ name: 'Elfsight', category: 'functional', origins: ['elfsight.com', '*.elfsight.com', 'elfsightcdn.com', '*.elfsightcdn.com'], frameOrigins: ['elfsight.com', '*.elfsight.com', 'elfsightcdn.com', '*.elfsightcdn.com'] });
  });

  it('IGNORES library CDNs, analytics loaders, and same-site scripts (no false widgets)', () => {
    const doc = parse(`<html><body>
      <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/bootstrap/dist/js/bootstrap.min.js"></script>
      <script async src="https://www.googletagmanager.com/gtag/js?id=UA-1"></script>
      <script src="/js/site.js"></script>
    </body></html>`);
    expect(collectWidgetIntegrations([doc])).toEqual([]);
  });
});
