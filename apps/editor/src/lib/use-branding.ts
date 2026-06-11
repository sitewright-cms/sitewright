import { useEffect, useState } from 'react';
import { DEFAULT_PLATFORM_NAME, DEFAULT_BRAND_PRIMARY, DEFAULT_BRAND_SECONDARY } from '@sitewright/schema';
import { api, type Branding } from '../api';

/** The built-in branding shown until `/auth/config` resolves (matches the CSS `:root` defaults). */
export const DEFAULT_BRANDING: Branding = {
  name: DEFAULT_PLATFORM_NAME,
  primary: DEFAULT_BRAND_PRIMARY,
  secondary: DEFAULT_BRAND_SECONDARY,
  logoUrl: null,
};

/** The platform's default favicon (the static `<link>` in index.html) — restored when a logo is removed. */
const DEFAULT_FAVICON = '/favicon.svg';

/** Point the browser favicon at `href`: drop the static icon links and install one fresh link (no
 *  `type`, so the browser sniffs — the logo may be png/jpeg/webp). Leaves the apple-touch-icon alone. */
function setFavicon(href: string): void {
  document.head.querySelectorAll('link[rel~="icon"]').forEach((l) => l.remove());
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = href;
  document.head.appendChild(link);
}

/**
 * Apply branding to the document chrome — the brand-gradient CSS vars (`--sw-brand-1/2`), the tab
 * title, and the favicon. Imperative so BOTH the boot hook and a live settings-save can re-skin the
 * page immediately. A null `logoUrl` restores the default favicon (e.g. after the admin removes one).
 */
export function applyBranding(b: Branding): void {
  const root = document.documentElement;
  root.style.setProperty('--sw-brand-1', b.primary);
  root.style.setProperty('--sw-brand-2', b.secondary);
  document.title = b.name;
  setFavicon(b.logoUrl ?? DEFAULT_FAVICON);
}

/**
 * Fetch the public branding once (the unauthenticated `/auth/config`) and apply it to the chrome,
 * returning it for components (login wordmark, header, project selector) to render the name + logo.
 * The defaults render until the fetch resolves (a brief, acceptable flash on a branded instance).
 */
export function useBranding(): Branding {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  useEffect(() => {
    let active = true;
    api
      .loginConfig()
      .then((c) => {
        if (!active) return;
        setBranding(c.branding);
        applyBranding(c.branding);
      })
      .catch(() => {
        /* best-effort — the CSS/`<title>` defaults already render the built-in brand */
      });
    return () => {
      active = false;
    };
  }, []);
  return branding;
}
