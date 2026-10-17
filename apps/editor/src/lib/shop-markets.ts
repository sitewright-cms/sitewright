import { useEffect, useState } from 'react';
import type { ShopMarket } from '@sitewright/schema';
import { api } from '../api';
import { useProjectEvents } from './use-project-events';

const NONE: readonly ShopMarket[] = [];

/**
 * The shop's markets (`website.shop.markets`), re-read when the settings change — for an editor that
 * prices a product per market. Fetched where needed rather than threaded down (see useSiteLocales);
 * unreadable reads as "no markets", which only hides inputs and loses nothing stored.
 */
export function useShopMarkets(projectId: string): { markets: readonly ShopMarket[]; loaded: boolean } {
  const [markets, setMarkets] = useState<readonly ShopMarket[]>(NONE);
  // Until (or unless) the settings answer, nothing is known — not "this shop has no markets".
  const [loaded, setLoaded] = useState(false);
  const [nonce, setNonce] = useState(0);
  useProjectEvents(projectId, (c) => {
    if (c.kind === 'settings') setNonce((n) => n + 1);
  });
  useEffect(() => {
    let alive = true;
    void Promise.resolve()
      .then(() => api.getSettings(projectId))
      .then(({ item }) => {
        if (!alive) return;
        setMarkets(item.website?.shop?.markets ?? NONE);
        setLoaded(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [projectId, nonce]);
  return { markets, loaded };
}
