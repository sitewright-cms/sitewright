import { useEffect, useState } from 'react';
import { api } from '../api';
import { useProjectEvents } from './use-project-events';

/** The site's languages: its MAIN one (whose text is an entry's `values`) and the OTHERS it is translated into. */
export interface SiteLocales {
  main: string;
  others: readonly string[];
}

const SINGLE: SiteLocales = { main: 'en', others: [] };

/**
 * The project's languages, re-read when its settings change (a language added or removed in another
 * panel). Fetched by whatever needs it rather than threaded down as a prop: a dataset entry opens from
 * the Data rail, a click in the preview and the entry loader, and a prop through one of them is a form
 * with no language switch in the others. Until it answers (or if it fails) the site reads as one language.
 */
export function useSiteLocales(projectId: string): SiteLocales {
  const [locales, setLocales] = useState<SiteLocales>(SINGLE);
  const [nonce, setNonce] = useState(0);
  useProjectEvents(projectId, (c) => {
    if (c.kind === 'settings') setNonce((n) => n + 1);
  });
  useEffect(() => {
    let alive = true;
    // Inside the promise chain, so a request that cannot even be made fails the same way as one that
    // fails: the site reads as one language and the form still works.
    void Promise.resolve()
      .then(() => api.getSettings(projectId))
      .then(({ item }) => {
        if (!alive) return;
        const main = item.settings.defaultLocale;
        const others = item.settings.locales.filter((l) => l !== main);
        setLocales((prev) => (prev.main === main && prev.others.join() === others.join() ? prev : { main, others }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [projectId, nonce]);
  return locales;
}
