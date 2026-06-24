// The I/O boundary of the mechanical nativizer: render a rawFidelity replica of an imported page in
// headless Chromium and capture a styled DOM tree at 3 viewports. The captured trees feed the PURE
// transform in @sitewright/site-import (mergeTrees → renderTree). SSRF-guarded by the same gate as
// screenshots, and bounded by the shared render-slot cap. Browser-only → coverage-exempt (the pure
// transform is what carries the unit tests; this glue is exercised by the deploy e2e).
/* v8 ignore start */
import type { Route, Request as PwRequest } from 'playwright-core';
import type { CapturedNode } from '@sitewright/site-import';
import { getBrowser, injectBaseHref, isRequestAllowed, withRenderSlot } from './screenshot.js';
import { NAVDATA, SCROLL_SETTLE, WALK } from './nativize-walk.js';

// Mobile-first capture widths (smallest→largest); the transform emits base + md:/lg: from these.
const VIEWPORTS = [390, 768, 1280] as const;
const DEFAULT_TIMEOUT_MS = 12_000;

export interface CapturedTrees {
  base: CapturedNode[];
  md: CapturedNode[];
  lg: CapturedNode[];
}
export interface NavData {
  logo: { src: string; alt: string } | null;
  links: { text: string; href: string }[];
}

async function withGuardedPage<T>(
  html: string,
  originHostPort: string,
  timeout: number,
  viewport: { width: number; height: number },
  fn: (page: Awaited<ReturnType<Awaited<ReturnType<typeof getBrowser>>['newPage']>>) => Promise<T>,
): Promise<T> {
  const doc = injectBaseHref(html, originHostPort);
  return withRenderSlot(async () => {
    const browser = await getBrowser();
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(timeout);
      await page.route('**/*', async (route: Route, request: PwRequest) => {
        const allowed = await isRequestAllowed(request.url(), originHostPort).catch(() => false);
        if (allowed) await route.continue();
        else await route.abort('blockedbyclient');
      });
      await page.setContent(doc, { waitUntil: 'load', timeout });
      return await fn(page);
    } finally {
      await context.close().catch(() => {});
    }
  });
}

/**
 * Capture a styled DOM tree of `html` at each viewport. `rootSelector` scopes the walk to the content
 * region (default <body>). Returns one CapturedNode[] per breakpoint for the transform to merge.
 */
export async function captureStyledTrees(
  html: string,
  opts: { originHostPort: string; rootSelector?: string; timeoutMs?: number },
): Promise<CapturedTrees> {
  const rootSel = opts.rootSelector ?? 'body';
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return withGuardedPage(html, opts.originHostPort, timeout, { width: 1280, height: 1000 }, async (page) => {
    const trees: CapturedNode[][] = [];
    for (const w of VIEWPORTS) {
      await page.setViewportSize({ width: w, height: 1000 });
      await page.evaluate(SCROLL_SETTLE as () => Promise<void>).catch(() => {});
      await page.waitForTimeout(400); // let reflow + lazy content settle after the resize
      const tree = (await page.evaluate(WALK as (sel: string) => unknown, rootSel)) as CapturedNode[];
      trees.push(tree);
    }
    return { base: trees[0]!, md: trees[1]!, lg: trees[2]! };
  });
}

/** Capture a nav slot's logo + link list so the orchestrator can rebuild a clean responsive navbar. */
export async function captureNavData(
  html: string,
  opts: { originHostPort: string; rootSelector: string; timeoutMs?: number },
): Promise<NavData> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return withGuardedPage(html, opts.originHostPort, timeout, { width: 1280, height: 1000 }, async (page) => {
    return (await page.evaluate(NAVDATA as (sel: string) => unknown, opts.rootSelector)) as NavData;
  });
}
/* v8 ignore stop */
