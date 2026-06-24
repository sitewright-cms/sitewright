import { describe, it, expect } from 'vitest';
import { SHADER_BG_CSS, SHADER_BG_JS } from '../src/shader-bg.js';
import { SHADER_BG_PRESETS, SHADER_BG_PRESET_KEYS, DEFAULT_SHADER_PRESET, shaderPresetByKey } from '../src/shader-bg-presets.js';
import { componentTypesInSource, componentAssets, COMPONENT_TYPES } from '../src/components.js';
import { COMPONENT_CATALOG } from '@sitewright/schema';

describe('shader-bg presets', () => {
  it('has 30 presets with unique kebab-case keys', () => {
    expect(SHADER_BG_PRESETS.length).toBe(30);
    expect(new Set(SHADER_BG_PRESET_KEYS).size).toBe(SHADER_BG_PRESET_KEYS.length);
    for (const k of SHADER_BG_PRESET_KEYS) expect(k).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('every preset defines render() and the default resolves', () => {
    for (const p of SHADER_BG_PRESETS) expect(p.glsl).toContain('vec3 render(vec2 uv, vec2 st)');
    expect(SHADER_BG_PRESET_KEYS).toContain(DEFAULT_SHADER_PRESET);
    expect(shaderPresetByKey('does-not-exist').key).toBe(DEFAULT_SHADER_PRESET);
    expect(shaderPresetByKey('plasma').key).toBe('plasma');
  });
});

describe('shader-bg runtime', () => {
  it('is registered as a component and ships only when the marker is used', () => {
    expect(COMPONENT_TYPES.has('ShaderBg')).toBe(true);
    expect(componentTypesInSource('<p>no components here</p>')).not.toContain('ShaderBg');
    const types = componentTypesInSource('<section data-sw-component="shader-bg" data-preset="plasma"></section>');
    expect(types).toContain('ShaderBg');
    const { css, js } = componentAssets(types);
    expect(css.length).toBeGreaterThan(0);
    expect(js.length).toBeGreaterThan(0);
  });

  it('runtime is syntactically valid JS and embeds every preset', () => {
    expect(() => new Function(SHADER_BG_JS)).not.toThrow();
    expect((SHADER_BG_JS.match(/vec3 render\(vec2 uv/g) || []).length).toBe(30);
  });

  it('consumes every documented data-* knob', () => {
    for (const a of ['data-preset', 'data-speed', 'data-intensity', 'data-angle', 'data-interactive', 'data-colors']) {
      expect(SHADER_BG_JS, a).toContain(a);
    }
  });

  it('CSS provides the noJs gradient fallback and hides it once enhanced', () => {
    expect(SHADER_BG_CSS).toContain('data-sw-component="shader-bg"');
    expect(SHADER_BG_CSS).toContain('linear-gradient(');
    expect(SHADER_BG_CSS).toContain('var(--sw-color-primary');
    expect(SHADER_BG_CSS).toContain('data-sw-enhanced="true"');
  });

  it('the catalog entry documents every preset key (no drift)', () => {
    const entry = COMPONENT_CATALOG.find((c) => c.marker === 'shader-bg');
    expect(entry, 'shader-bg must be in COMPONENT_CATALOG').toBeTruthy();
    const text = JSON.stringify(entry);
    for (const k of SHADER_BG_PRESET_KEYS) expect(text, `catalog must list preset ${k}`).toContain(k);
  });
});
