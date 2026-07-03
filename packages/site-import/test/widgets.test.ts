import { describe, expect, it } from 'vitest';
import { parse } from '../src/dom.js';
import { collectWidgetIntegrations, widgetProviderFor } from '../src/widgets.js';

describe('widgetProviderFor', () => {
  it('matches a known provider host + subdomain over https, rejects others / non-https', () => {
    expect(widgetProviderFor('https://weatherwidget.io/js/widget.min.js')).toMatchObject({ base: 'weatherwidget.io', name: 'weatherwidget.io' });
    expect(widgetProviderFor('https://embed.tawk.to/abc/default')).toMatchObject({ base: 'tawk.to' });
    expect(widgetProviderFor('https://code.jquery.com/jquery.min.js')).toBeNull(); // a plain library CDN is NOT a widget
    expect(widgetProviderFor('https://www.googletagmanager.com/gtag/js')).toBeNull(); // analytics, not a widget
    expect(widgetProviderFor('http://weatherwidget.io/x.js')).toBeNull(); // non-https
  });
});

describe('collectWidgetIntegrations', () => {
  it('detects a weatherwidget.io loader inside an INLINE script → ONE functional consent integration', () => {
    // droombos's real pattern: an <a class="weatherwidget-io"> mount + an inline getScript loader.
    const doc = parse(`<html><body>
      <a class="weatherwidget-io" href="https://forecast7.com/en/x/windhoek/">WEATHER</a>
      <script>ready(function(){ $.getScript("https://weatherwidget.io/js/widget.min.js"); __weatherwidget_init(); });</script>
    </body></html>`);
    const out = collectWidgetIntegrations([doc]);
    expect(out).toEqual([{ id: 'weatherwidget-io', name: 'weatherwidget.io', category: 'functional', src: 'https://weatherwidget.io/js/widget.min.js', async: true, origins: ['weatherwidget.io'] }]);
  });

  it('detects an external <script src> widget and dedupes a provider across pages', () => {
    const a = parse(`<html><body><script src="https://static.elfsight.com/platform/platform.js"></script></body></html>`);
    const b = parse(`<html><body><script src="https://static.elfsight.com/platform/platform.js" async></script></body></html>`);
    const out = collectWidgetIntegrations([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Elfsight', category: 'functional', origins: ['elfsight.com'] });
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
