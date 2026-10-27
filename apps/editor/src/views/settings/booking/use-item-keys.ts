import { useState } from 'react';

let counter = 0;

/**
 * Stable React keys for a list edited in place. An item's id cannot be its key: a new item's id follows its name, so
 * keying by id would remount its card (and lose focus) on every keystroke; keying by position would hand one item's
 * open card and half-typed fields to another after a removal. Keys here are kept through renames and saves, dropped
 * with their item, and never equal an id (`#` is not allowed in one).
 */
export function useItemKeys(ids: readonly string[]): { keys: readonly string[]; added: () => string; removed: (index: number) => void } {
  const [keys, setKeys] = useState<string[]>(() => [...ids]);
  // The list was replaced from outside (a reload with other items): start again from its ids.
  if (keys.length !== ids.length) {
    const fresh = [...ids];
    setKeys(fresh);
    return { keys: fresh, added: () => '', removed: () => undefined };
  }
  return {
    keys,
    added: () => {
      counter += 1;
      const key = `#new-${counter}`;
      setKeys((k) => [...k, key]);
      return key;
    },
    removed: (index) => setKeys((k) => k.filter((_, j) => j !== index)),
  };
}
