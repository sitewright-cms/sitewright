import { describe, it, expect } from 'vitest';
import { buildEffectForks } from '../src/http/effect-forks.js';
import { NAV_EFFECTS, BUTTON_EFFECTS, PRELOADER_EFFECTS, JS_NAV_EFFECTS, JS_BUTTON_EFFECTS } from '@sitewright/schema';

describe('buildEffectForks', () => {
  const f = buildEffectForks();

  it('covers every built-in effect with a labelled, standalone <style> snippet (no @utility / no &)', () => {
    expect(f.nav.map((x) => x.name)).toEqual([...NAV_EFFECTS]);
    expect(f.button.map((x) => x.name)).toEqual([...BUTTON_EFFECTS]);
    expect(f.preloader.map((x) => x.name)).toEqual([...PRELOADER_EFFECTS]);
    for (const x of [...f.nav, ...f.button]) {
      expect(x.label).toBeTruthy();
      expect(x.code).toContain('<style>');
      expect(x.code).not.toContain('@utility'); // standalone CSS, not the Tailwind source
    }
    // the nesting `&` (the scheme class) is stripped → a pure-CSS effect has none left.
    expect(f.nav.find((x) => x.name === 'box-solid')!.code).not.toContain('&');
  });

  it('targets the nav links / buttons directly with the dark-safe --sw-color-* tokens', () => {
    const box = f.nav.find((x) => x.name === 'box-solid')!;
    expect(box.code).toContain('#main-nav');
    expect(box.code).toContain('--sw-color-primary');
    expect(f.button.find((x) => x.name === 'lift')!.code).toContain('.btn');
  });

  it('pretty-prints the CSS (declarations on their own indented lines, no crammed rules)', () => {
    const box = f.nav.find((x) => x.name === 'box-solid')!.code;
    expect(box).toContain('\n  border-radius:'); // a declaration indented under its selector
    expect(box).toContain(' {\n'); // an opening brace ends its selector line
    // color-mix()'s internal commas are NOT broken onto new lines.
    expect(box).toContain('color-mix(in oklab, var(--sw-color-primary, var(--color-primary)) 12%, transparent)');
  });

  it('ships the runtime <script> only for the JS-backed nav effects, and the blob keyframes', () => {
    for (const x of f.nav) {
      expect(x.code.includes('<script>')).toBe((JS_NAV_EFFECTS as readonly string[]).includes(x.name));
    }
    for (const x of f.button) {
      expect(x.code.includes('<script>')).toBe((JS_BUTTON_EFFECTS as readonly string[]).includes(x.name));
    }
    expect(f.nav.find((x) => x.name === 'blob')!.code).toContain('@keyframes sw-nav-blob');
  });

  it('preloader forks are a complete overlay: markup + stylesheet + show/hide runtime', () => {
    const sp = f.preloader.find((x) => x.name === 'spinner')!;
    expect(sp.code).toContain('data-sw-preloader');
    expect(sp.code).toContain('<style>');
    expect(sp.code).toContain('<script>');
  });
});
