import { describe, it, expect } from 'vitest';
import { WEBSITE_FORM_KEYS } from '../src/views/settings/SettingsView';
import { toForm, toBundle } from '../src/views/settings/model';
import type { SettingsBundle } from '../src/api';
import type { SettingsForm } from '../src/views/settings/model';

/**
 * The Settings modal splits ONE form across two independently-saved tabs, and the split is a
 * hand-maintained Set of field names. Nothing connected that Set to where a field actually GOES, so
 * adding a website field and forgetting to list it produced a field that:
 *   - never armed the Website tab's dirty check, so its Save button stayed disabled — unsavable; and
 *   - counted as an Identity field (the check is an equality against `section === 'website'`), so
 *     Identity's Discard silently reverted it and Identity's Save dropped it.
 * Both silent. This derives the REAL partition from `toBundle` and asserts the Set agrees.
 */
const base: SettingsBundle = {
  identity: { name: 'Acme', colors: {} },
  website: { effects: { preloaderCode: '<div></div>' } },
  settings: { defaultLocale: 'en', locales: ['en'] },
};

/** A different-but-valid value for a form field, or undefined when we can't safely synthesise one. */
function mutate(value: unknown): unknown {
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'string') return `${value}zz`;
  return undefined; // arrays/objects/enums — a naive change isn't necessarily valid; skipped below
}

describe('settings section partition', () => {
  const form = toForm(base);
  const baseline = toBundle(form, base);

  const keys = (Object.keys(form) as Array<keyof SettingsForm>).filter(
    (k) => mutate(form[k]) !== undefined,
  );

  it('covers enough of the form to be a meaningful guard', () => {
    // Guards the guard: if this drops to a handful, the sweep below has stopped testing anything.
    expect(keys.length).toBeGreaterThan(20);
  });

  it.each(keys)('%s is filed under the section it actually writes to', (key) => {
    const changed = toBundle({ ...form, [key]: mutate(form[key]) } as SettingsForm, base);
    const touchesWebsite = JSON.stringify(changed.website) !== JSON.stringify(baseline.website);
    const touchesIdentity = JSON.stringify(changed.identity) !== JSON.stringify(baseline.identity);

    if (touchesWebsite && !touchesIdentity) {
      expect(WEBSITE_FORM_KEYS.has(key), `${key} writes into website.* but is not in WEBSITE_FORM_KEYS`).toBe(true);
    }
    if (touchesIdentity && !touchesWebsite) {
      expect(WEBSITE_FORM_KEYS.has(key), `${key} writes into identity.* but IS in WEBSITE_FORM_KEYS`).toBe(false);
    }
  });

  it('files preloaderBackdrop with the website — the field that found this', () => {
    expect(WEBSITE_FORM_KEYS.has('preloaderBackdrop')).toBe(true);
    expect(WEBSITE_FORM_KEYS.has('preloaderCode')).toBe(true);
  });
});
