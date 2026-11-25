# Paper Shaders

The **Neuro Noise** preset of `data-sw-component="shader-bg"` is ported from
[Paper Shaders](https://github.com/paper-design/shaders) (`@paper-design/shaders` 0.0.82,
`packages/shaders/src/shaders/neuro-noise.ts`). Copyright 2026 Paper, licensed under the Apache License 2.0.
This directory holds that package's `LICENSE` and `NOTICE`, unchanged.

This is not a `gen-vendor.mjs` target and nothing here is bundled. The shader was rewritten by hand as one
entry of `SHADER_BG_PRESETS` in `src/shader-bg-presets.ts`, so it runs on our own WebGL runtime. Its GLSL
keeps a comment naming the source and the license, and that comment ships to every page that uses the
component.

## What changed

- **GLSL ES 1.00 (WebGL1) instead of 3.00**, written as our `render(uv, st)` function between the shared
  prelude and `main()`. The pattern and its 15-layer loop are Paper's.
- **The pattern scales with the section, not the screen.** Paper sizes it in CSS pixels, so a small box
  shows a few large strokes and a tall page many. Here it is relative to the section's height and matches
  Paper's at 800 CSS pixels tall (`st * 1.04` is Paper's `v_patternUV * 0.13` at that height), so a picker
  thumbnail looks like the section it previews.
- **Three opaque colour slots** (`uC1` glow, `uC2` cores, `uC3` background) instead of Paper's
  `colorMid`, `colorFront` and `colorBack` with alpha.
- **Brightness and contrast are fixed** at Paper's defaults (0.05 and 0.3). Our `data-intensity` and
  `data-angle` apply on top, as for every preset.
- **Paper's `rotate()` turns the other way** from our `rot()`, so `rotate(v, 1.)` is written `rot(-1.0) * v`.

To compare with the original, Paper's Default look is
`data-colors="#47a6ff,#ffffff,#000000"`.
