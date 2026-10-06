import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ★★ THE SWEEPS MUST BE WIRED, not merely written.
 *
 * `sweepExpiredReservations`, `expireStale`, `reapEvents` and `dueForReconciliation` were all
 * implemented and unit-tested and then connected to NOTHING. That is worse than not having them:
 * every other invariant in the payments module is documented as safe *because* they run, so the code
 * read as though an abandoned checkout self-heals when in fact a hold was stranded for ever and a
 * paid order whose webhook was lost stayed invisible to the merchant.
 *
 * Unit tests could not catch it — each sweep passed its own tests in isolation. This asserts the
 * INTEGRATION: that each one is reachable from the app's periodic maintenance pass. It is a source
 * assertion rather than a behavioural one because the alternative is driving a real timer, and the
 * failure being guarded is "nobody calls this", which the call graph answers directly.
 */
const appSource = readFileSync(fileURLToPath(new URL('../src/http/app.ts', import.meta.url)), 'utf8');

/**
 * The body of a named function, by brace matching.
 *
 * Deliberately not "slice between two function names": the first version of this test did that and
 * broke the moment the declarations were in a different order than assumed, which is a property of
 * the test rather than of the code.
 */
function bodyOf(name: string): string {
  const start = appSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`app.ts has no function ${name}`);
  // Walk past the PARAMETER LIST first. A parameter can carry an inline object type
  // (`{ shopCatalog?: ShopCatalog }`), whose brace would otherwise be mistaken for the body.
  let i = appSource.indexOf('(', start);
  let parens = 0;
  for (; i < appSource.length; i += 1) {
    if (appSource[i] === '(') parens += 1;
    else if (appSource[i] === ')') {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  const open = appSource.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < appSource.length; j += 1) {
    const ch = appSource[j];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return appSource.slice(open, j + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe('payments maintenance is reachable from the app', () => {
  it('runs a payment sweep from the periodic maintenance pass', () => {
    const sweeps = appSource.slice(appSource.indexOf('const runMaintenanceSweeps'), appSource.indexOf('if (sweepMs > 0)'));
    expect(sweeps).toContain('runPaymentSweeps()');
  });

  it.each([
    ['expireStale', 'an abandoned checkout is moved to expired so its stock comes back'],
    ['sweepExpiredReservations', 'a hold whose release never happened is freed'],
    ['reapEvents', 'the spent-event table stays bounded'],
    ['dueForReconciliation', 'a paid order whose webhook never arrived is recovered'],
  ])('calls %s — %s', (fn) => {
    // Named individually so a removal names the invariant it breaks, rather than failing as a count.
    expect(appSource).toContain(`${fn}(`);
  });

  it('★ reconciliation can actually resolve a payment, not just read one', () => {
    const fn = bodyOf('reconcileDuePayments');
    expect(fn).toContain('fetchProviderStatus');
    expect(fn).toContain("advance(txn.id, 'paid'");
    // And it must commit the stock that the missing webhook would have committed.
    expect(fn).toContain('shopStockRepo.commit');
    // ★ A recovered payment is LOUD: an operator needs to know a webhook is not arriving, because
    // the next one will not arrive either.
    expect(fn).toContain('app.log.warn');
  });

  it('★ reconciliation leaves a still-unknown payment alone rather than guessing', () => {
    const fn = bodyOf('reconcileDuePayments');
    expect(fn).toContain("status.kind === 'recheck'");
  });

  it('★ every sweep skips a PREVIEW transaction, which never held stock', () => {
    const fn = `${bodyOf('runPaymentSweeps')}${bodyOf('reconcileDuePayments')}`;
    expect(fn).toContain('!t.preview');
    expect(fn).toContain('!txn.preview');
  });

  it('does nothing at all when the instance has no encryption key', () => {
    const fn = bodyOf('runPaymentSweeps');
    // No key ⇒ no gateway repo ⇒ no payment surface ⇒ nothing to sweep (and nothing to crash on).
    expect(fn).toContain('if (!gatewayRepo) return;');
  });

  it('persists the LIVE catalog from a publish and the DRAFT one from a preview', () => {
    expect(appSource).toContain("persistShopCatalog(project.id, 'live', release)");
    expect(appSource).toContain("persistShopCatalog(project.id, 'draft', manifest)");
  });

  it('★ reconciles stock ONLY from a live build — a preview must not restock a shop', () => {
    expect(bodyOf('persistShopCatalog')).toContain("if (mode === 'live')");
  });
});
