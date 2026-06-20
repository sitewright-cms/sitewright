// Snapshot smoke: renders a page (Latin + CJK + emoji) through the REAL `captureScreenshots` path and
// asserts every viewport returns a non-trivial JPEG. The CI `snapshot` job runs this INSIDE the built
// runtime image (`node apps/api/scripts/snapshot-smoke.mjs` with the image's /app on the path), so it
// verifies the slimmed Chromium (headless-shell, Mesa/LLVM stripped, CJK fonts kept) actually renders —
// the safety net for the image-size optimizations. Locally, point SW_SCREENSHOT_MODULE at a built dist.
//
// Exit 0 = both viewports rendered a plausible image; non-zero (with a reason) = the render path broke.
const MODULE = process.env.SW_SCREENSHOT_MODULE ?? '/app/dist/render/screenshot.js';
const MIN_BASE64 = 2000; // a blank/failed frame is far smaller than a real rendered page

const { captureScreenshots, closeScreenshotBrowser } = await import(MODULE);

// CJK + emoji in the content exercises the bundled fonts; a missing-font regression renders tofu (still
// bytes, so this is a smoke for "renders at all", not pixel-perfect glyphs — the fonts stay in the image).
const html =
  '<!doctype html><html><head><meta charset="utf-8"></head>' +
  '<body style="font-family:sans-serif;padding:40px">' +
  '<h1 style="color:#0a7">Snapshot smoke — 你好世界 · こんにちは · 😀</h1>' +
  '<p>The quick brown fox jumps over the lazy dog.</p></body></html>';

let failed = false;
try {
  const shots = await captureScreenshots(html, {
    originHostPort: '127.0.0.1:80',
    viewports: ['desktop', 'mobile'],
  });
  for (const vp of ['desktop', 'mobile']) {
    const shot = shots[vp];
    const len = shot?.base64?.length ?? 0;
    if (len < MIN_BASE64) {
      console.error(`FAIL ${vp}: screenshot missing or too small (${len} base64 chars) — render broke`);
      failed = true;
    } else {
      console.log(`OK ${vp}: ${shot.mimeType} ${shot.width}x${shot.height}, ${len} base64 chars`);
    }
  }
} catch (err) {
  console.error('FAIL: captureScreenshots threw —', err instanceof Error ? err.message : String(err));
  failed = true;
} finally {
  await closeScreenshotBrowser();
}
console.log(failed ? 'snapshot smoke FAILED' : 'snapshot smoke PASSED');
process.exit(failed ? 1 : 0);
