import { minorUnitExponent, type BookingConfig, type Form, type ShopChannel, type ShopPricing } from '@sitewright/schema';
import type { ProjectBundle } from '@sitewright/core';
import type { DemoPriceList, DemoRuntimeData, ShopCatalog } from '@sitewright/blocks';
import { publicOffering } from '../booking/public-view.js';
import type { BuildSiteOptions } from './build.js';

/*
 * A DEMO COPY's build: the site with every receiver left out, for a deploy target with `demo` on.
 *
 * The live features still work in the browser — the demo runtime (packages/blocks/src/demo-runtime.ts) answers
 * them in the page — but nothing can reach anyone: no platform endpoint, email address, WhatsApp number,
 * third-party form URL, `contact.php`, payment link, captcha provider or statistics counter.
 *
 * ★ Rewritten at the INPUT boundary, before anything renders, so the templates never need to know about a demo:
 * a form that is platform-routed with no captcha renders exactly as such a form always does, and `contact.php`
 * is never generated because no form uses it any more.
 */

/** A form as a demo copy renders it: platform-routed (answered in the page), with no guard and no hand-off. */
function demoForm(form: Form): Form {
  const out: Form = { ...form, mode: 'globalSmtp', captcha: false, pow: false };
  delete out.redirectUrl;
  delete out.thirdPartyUrl;
  delete out.whatsappNumber;
  delete out.whatsappIntro;
  return out;
}

/**
 * The cart's order channels a demo copy keeps: the order form and the checkout, both answered in the page.
 * WhatsApp, mailto and payment-link channels hand the order to a real receiver from the visitor's own device,
 * so they are left out.
 */
function demoChannels(channels: readonly ShopChannel[]): ShopChannel[] {
  return channels.flatMap((c): ShopChannel[] => {
    if (c.kind === 'checkout') return [{ ...c, captcha: false, pow: false }];
    if (c.kind === 'form') return [{ ...c, captcha: false }];
    return [];
  });
}

/** The bundle as a demo copy builds it. */
function demoBundle(bundle: ProjectBundle): ProjectBundle {
  const website = bundle.project.website;
  const shop = website?.shop;
  const consent = website?.consent;
  const booking: BookingConfig | undefined = bundle.booking ? { ...bundle.booking, captcha: false, pow: false } : undefined;
  // The managed analytics integrations (GA4, GTM, Plausible, Matomo, Umami, pixels…) would report a demo copy's
  // visits to the live site's accounts. The consent manager itself stays, with its banner and categories.
  const demoConsent = consent?.integrations ? { ...consent, integrations: [] } : consent;
  return {
    ...bundle,
    project: website
      ? {
          ...bundle.project,
          website: {
            ...website,
            ...(shop?.channels ? { shop: { ...shop, channels: demoChannels(shop.channels) } } : {}),
            ...(demoConsent ? { consent: demoConsent } : {}),
          },
        }
      : bundle.project,
    ...(bundle.forms ? { forms: bundle.forms.map(demoForm) } : {}),
    ...(booking ? { booking } : {}),
  };
}

/**
 * The build options of a demo copy: the bundle rewritten, and no platform address, captcha site key or
 * statistics key at all (so the page's content policy names no platform origin either).
 */
export function demoBuildOptions(opts: BuildSiteOptions): BuildSiteOptions {
  const out: BuildSiteOptions = { ...opts, bundle: demoBundle(opts.bundle) };
  delete out.publicBaseUrl;
  delete out.captcha;
  delete out.stats;
  // The search engine tags verify the platform's account for the LIVE site; a copy elsewhere has no use for them.
  delete out.siteVerification;
  return out;
}

function priceList(catalog: ShopCatalog, pricing: ShopPricing | undefined): DemoPriceList {
  return {
    c: catalog.currency,
    d: minorUnitExponent(catalog.currency),
    // Name and unit price only, which every product tile already shows. Never the declared stock.
    items: Object.fromEntries(Object.values(catalog.items).map((i) => [i.sku, { n: i.name, p: i.priceMinor }])),
    // Shipping and tax, so a demo total is the one the live checkout would charge.
    ...(pricing ? { pricing } : {}),
  };
}

/**
 * What the demo runtime needs to answer like the platform, all of it public: each booking offering's public view
 * (the one the availability route answers with), each checkout's thank-you page, and the price lists the build
 * just sealed from the rendered pages.
 */
export function demoRuntimeData(
  bundle: ProjectBundle,
  catalog: ShopCatalog | undefined,
  catalogs: Record<string, ShopCatalog> | undefined,
): DemoRuntimeData {
  const booking = bundle.booking;
  const offerings = booking ? Object.fromEntries(booking.offerings.map((o) => [o.id, publicOffering(o, booking)])) : {};
  const shop = bundle.project.website?.shop;
  const returnPaths = Object.fromEntries(
    (shop?.channels ?? []).flatMap((c) => (c.kind === 'checkout' && c.returnPath ? [[c.key, c.returnPath]] : [])),
  );
  // The pricing the checkout route applies: a market's own, else the shop's (payment-routes.ts, priceOrder).
  const marketPricing = (id: string): ShopPricing | undefined => shop?.markets?.find((m) => m.id === id)?.pricing ?? shop?.pricing;
  return {
    ...(Object.keys(offerings).length > 0 ? { offerings } : {}),
    ...(Object.keys(returnPaths).length > 0 ? { returnPaths } : {}),
    ...(catalog ? { catalog: priceList(catalog, shop?.pricing) } : {}),
    ...(catalogs
      ? { catalogs: Object.fromEntries(Object.entries(catalogs).map(([market, c]) => [market, priceList(c, marketPricing(market))])) }
      : {}),
  };
}
