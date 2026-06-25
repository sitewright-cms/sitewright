import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { loginConfig } = vi.hoisted(() => ({ loginConfig: vi.fn() }));
vi.mock('../src/api', () => ({ api: { loginConfig: () => loginConfig() } }));

import { applyBranding, useBranding, DEFAULT_BRANDING } from '../src/lib/use-branding';

const BRANDING = { name: 'Acme CMS', primary: '#ff0066', secondary: '#00ddaa', logoUrl: '/branding/logo?v=3' };

beforeEach(() => {
  loginConfig.mockReset();
  document.documentElement.removeAttribute('style');
  document.title = '';
  document.head.querySelectorAll('link[rel~="icon"]').forEach((l) => l.remove());
});

describe('applyBranding', () => {
  it('sets the brand gradient CSS vars, the tab title, and the favicon', () => {
    applyBranding(BRANDING);
    expect(document.documentElement.style.getPropertyValue('--sw-brand-1')).toBe('#ff0066');
    expect(document.documentElement.style.getPropertyValue('--sw-brand-2')).toBe('#00ddaa');
    expect(document.title).toBe('Acme CMS');
    const icon = document.head.querySelector('link[rel~="icon"]');
    expect(icon?.getAttribute('href')).toBe('/branding/logo?v=3');
  });

  it('restores the default favicon when no logo is set (e.g. after a logo is removed)', () => {
    document.head.innerHTML = '<link rel="icon" href="/branding/logo?v=1">';
    applyBranding({ ...BRANDING, logoUrl: null });
    const icons = document.head.querySelectorAll('link[rel~="icon"]');
    expect(icons).toHaveLength(1);
    expect(icons[0]?.getAttribute('href')).toBe('/favicon.svg');
  });
});

describe('useBranding', () => {
  it('returns the defaults first, then fetches + applies the branding', async () => {
    loginConfig.mockResolvedValue({ oidcProviders: [], branding: BRANDING });
    const { result } = renderHook(() => useBranding());
    expect(result.current).toEqual(DEFAULT_BRANDING); // before the fetch resolves
    await waitFor(() => expect(result.current.name).toBe('Acme CMS'));
    expect(document.documentElement.style.getPropertyValue('--sw-brand-1')).toBe('#ff0066');
    expect(document.title).toBe('Acme CMS');
  });

  it('keeps the built-in defaults on a fetch failure (no throw)', async () => {
    loginConfig.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useBranding());
    await waitFor(() => expect(loginConfig).toHaveBeenCalled());
    expect(result.current).toEqual(DEFAULT_BRANDING);
  });
});
