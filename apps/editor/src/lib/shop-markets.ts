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
export function useShopMarkets(projectId: string): readonly ShopMarket[] {
  const [markets, setMarkets] = useState<readonly ShopMarket[]>(NONE);
  const [nonce, setNonce] = useState(0);
  useProjectEvents(projectId, (c) => {
    if (c.kind === 'settings') setNonce((n) => n + 1);
  });
  useEffect(() => {
    let alive = true;
    void Promise.resolve()
      .then(() => api.getSettings(projectId))
      .then(({ item }) => {
        if (alive) setMarkets(item.website?.shop?.markets ?? NONE);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [projectId, nonce]);
  return markets;
}
