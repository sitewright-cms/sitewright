import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { api } from '../../api';

/** The outlined link-button both deploy dialogs end on. */
export const deployLinkClass =
  'inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-bold text-slate-700 dark:text-slate-200 transition hover:border-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-400';

/**
 * The project's configured production URL (`website.siteUrl`). `loaded` stays false until the read
 * settles. Only an http(s) URL counts: the schema refuses anything else on save, but a row written past
 * the API would otherwise land in an `href` as whatever scheme it carries.
 */
export function useProductionUrl(projectId: string): { loaded: boolean; siteUrl: string | undefined } {
  const [state, setState] = useState<{ loaded: boolean; siteUrl: string | undefined }>({ loaded: false, siteUrl: undefined });
  useEffect(() => {
    let alive = true;
    api
      .getSettings(projectId)
      .then((r) => {
        const siteUrl = r.item.website?.siteUrl;
        if (alive) setState({ loaded: true, siteUrl: siteUrl && /^https?:\/\//i.test(siteUrl) ? siteUrl : undefined });
      })
      // Settings unreadable → treat as no production URL.
      .catch(() => alive && setState({ loaded: true, siteUrl: undefined }));
    return () => {
      alive = false;
    };
  }, [projectId]);
  return state;
}

/** A Local Hosting address with the target's soft preview-token gate applied, as the View-live link has it. */
export function withPreviewToken(url: string, previewToken: string | undefined): string {
  return previewToken ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(previewToken)}` : url;
}

/** `https://acme.example.com/` → `acme.example.com`; a path form keeps its path. */
export function displayAddress(url: string): string {
  try {
    const u = new URL(url, window.location.href);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * "Open production site" — or, with no production URL configured, the one thing that costs: the build
 * writes no `sitemap.xml`, and `robots.txt` names none. Both deploy dialogs end on this.
 */
export function ProductionSiteLink({ siteUrl }: { siteUrl: string | undefined }) {
  if (siteUrl) {
    return (
      <a href={siteUrl} target="_blank" rel="noreferrer" className={deployLinkClass}>
        Open production site <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </a>
    );
  }
  return (
    <p className="rounded-lg border border-amber-300 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
      Website Production URL is not configured: no sitemap.xml is generated, and robots.txt does not point to one.
      Configure a production URL in website settings.
    </p>
  );
}
