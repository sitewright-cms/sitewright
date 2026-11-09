# Lightbox: SmartPhoto 1.6.5 → 2.x (evaluation, migration deferred)

**Status:** DEFERRED on 2026-11-09. Sites stay on SmartPhoto **1.6.5**. Re-evaluate in **January 2027**.

**Decision.** SmartPhoto 2 is a rewrite of the library every gallery site ships, not an upgrade. Its
phone and accessibility fixes are worth having, so the plan is to **migrate** rather than to ignore 2.x
for good, as a task of its own with real-device testing. Until then Dependabot skips smartphoto
**majors** (`.github/dependabot.yml`), and #1202 (1.6.5 → 2.1.18) was closed unmerged. It could not be
merged as it was anyway: v2 no longer ships the `smartphoto/src/core/index.js` our runtime imports, so
`gen:vendor` fails.

Our wiring lives in `packages/blocks/vendor-src/lightbox-smartphoto.entry.js`. `scripts/gen-vendor.mjs`
bundles it into `src/vendor/lightbox-smartphoto-runtime.ts` and renames `smartphoto` to `sw-lightbox`.

## The upstream picture (measured 2026-11-09)

- 1.6.5 was released 2023-06-14. 2.0.0 was released 2026-08-10, rewritten in TypeScript around a native
  `<dialog>`, with a programmatic API. There were 18 releases up to **2.1.18 (2026-09-29)** and none
  since.
- The GitHub release notes list only Dependabot PRs. The real changelog is the commit history
  (`gh api 'repos/appleple/SmartPhoto/commits?per_page=100'`), written in Japanese.
- Most 2.1.x releases fix bugs the rewrite introduced, many of them on mobile. The rewrite is still
  settling.

## What 2.x improves

| area | change |
|---|---|
| accessibility | The viewer opens with `dialog.showModal()`. It sits in the top layer above sticky headers, the page behind it becomes inert, and focus stays inside. That closes upstream #50 ("Focus not trapped"), open since 2019. On close, focus returns to the thumbnail that opened it, which our wrapper adds by hand today. |
| phones | Pinch-zoom was reworked to the PhotoSwipe / iOS Photos model, and trackpad pinch was fixed. Panning a zoomed photo no longer snaps back, and a fast flick changes slides (`swipeVelocity`). |
| phones | Fixes for: the page showing below the thumbnail strip with iOS 26 Safari's bottom tab bar, the iOS home-indicator safe area, landscape rotation overlapping the strip, a resizing address bar (`visualViewport`), and Safari at a page zoom other than 100%. |
| robustness | Fixes for a slide breaking on a fast prev→next, and for the viewer reopening itself after a close during preload. |
| size | It has no runtime dependencies. v1 drags in a-template (with morphdom and delegate) plus the IE polyfills we alias away. The standalone minified JS goes from 16,133 B to **11,145 B** gzipped (−31%). |
| no re-render | Without morphdom, attributes we set on the viewer persist, so they no longer have to be re-applied on a timer. |
| theming | CSS variables `--smartphoto-animation-speed`, `-animation-function`, `-backdrop-color`, `-header-color` and `-arrow-top`. The icon colour is auto-contrasted against the backdrop. |
| API | Data-source mode: `show(indexOrId, { group, trigger })`, `next()`/`prev()`/`hide()`, `addItem()`, `currentIndex`, `destroy()` and `[Symbol.dispose]`. Opening can use the View Transitions API (`useViewTransitionApi`, default on). |
| safety | Captions are set with `textContent`, so there is no HTML injection. |

## What it costs us — the migration checklist

1. **Import path.** Import `smartphoto` (its `exports` map → `lib/smartphoto.mjs`) instead of
   `smartphoto/src/core/index.js`. Drop the polyfill aliases in `gen-vendor.mjs`, which v2 doesn't need.
2. **The 100 Hz inertia timer can no longer be gated.** In 1.6.5 the constructor starts a 10 ms
   `setInterval`, and our wrapper clears it until a photo opens (`sp.interval` / `sp._doAnim()`). In 2.x
   the timer is a closure variable inside `createGestures`. It still starts at construction, and only
   `destroy()` clears it. Every gallery on a page would wake the CPU 100 times a second for as long as
   the page is open. Either patch the vendored copy (attach the gestures on open, detach them on close)
   or get that upstream. **This is the one real regression.**
3. **Private state our wrapper reads.** `sp.data.hide` is gone; open/closed now lives in
   `state.viewer.isOpen`. Use the public `open` / `close` events instead of private fields.
4. **Zoom cursor.** `.smartphoto-img { cursor: zoom-in }` is still unconditional, so the
   `data-sw-zoomable` fix stays. It can become event-driven (on `open`/`change`) instead of the 500 ms
   poll, because nothing strips the attribute any more.
5. **Reduced motion.** There is still no `prefers-reduced-motion` handling. Keep our `showAnimation:
   false`, and decide whether the View Transition open also has to be turned off for it.
6. **Captions become plain text.** v1 inserted `data-caption` as markup, so any bold text or link in an
   existing caption would show as literal tags. Decide: accept it (and say so in the component docs),
   or render rich captions ourselves.
7. **Items added later.** v2's auto-detection only works when constructed from a selector string. We
   pass element arrays, because `data-gallery` merges galleries across sections, so `watchForNewItems`
   stays. It could call `addItem()` instead of destroying and rebuilding the instance.
8. **Markup and CSS.** The viewer is a `<dialog>` with `<button>` arrows. Its stylesheet changed (12
   selectors removed, 18 added; 2,149 → 2,422 B gzipped), so our overrides in `components.ts` (thumbnail
   rail, arrows, zoomable cursor) need rework. The `classNames` keys are identical in 2.x (all 25), so
   the `sw-lightbox-*` rename still applies.
9. **Tests.** Update `packages/blocks/test/lightbox.behavior.test.ts` for the dialog. Test every form on
   iOS Safari, Android Chrome and desktop: the explicit `data-sw-part="item"` grid, a single `<img>`, the
   minimal `<div>`, a `data-gallery` merge across sections, a lightbox inside a carousel (the kayec case,
   #1236), and load-more appends. Check scroll lock, focus return, Escape, history off, and the timer
   being idle while closed.

## Re-evaluating

Check whether there are releases after 2.1.18. Check whether the inertia timer still starts in the
constructor: `grep -n setInterval` in `lib/smartphoto.mjs`, which is inside `createGestures` as of
2.1.18. Then fetch the new tarball and re-run the comparison above.
