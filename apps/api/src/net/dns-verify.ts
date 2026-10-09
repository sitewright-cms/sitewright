import { Resolver } from 'node:dns/promises';
import { VERIFICATION_TXT_PREFIX } from '../repo/project-domains.js';

/** How long a verification lookup may take before it is reported as "not found yet". */
const LOOKUP_TIMEOUT_MS = 5_000;

/**
 * The outcome of a verification attempt. `pending` is deliberately distinct from `failed`: a TXT
 * record that has not propagated yet is the NORMAL state for the first few minutes after an operator
 * adds it, and telling them "verification failed" would send them editing DNS that is already correct.
 */
export type DnsVerifyResult =
  | { ok: true }
  | { ok: false; state: 'pending'; detail: string }
  | { ok: false; state: 'failed'; detail: string };

/** The injectable TXT lookup — the live one resolves, tests supply their own. */
export type TxtLookup = (name: string) => Promise<string[][]>;

/** The default resolver. A fresh `Resolver` per call so one slow query cannot wedge a shared one. */
export const liveTxtLookup: TxtLookup = async (name) => {
  const resolver = new Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 2 });
  return resolver.resolveTxt(name);
};

/**
 * Check whether `_sitewright.<host>` carries the expected token.
 *
 * ★ No SSRF concern and no allowlist: this makes a DNS query, not an HTTP request — there is no
 * attacker-chosen URL and nothing is fetched. What it must handle instead is the ordinary mess of real
 * DNS: a missing record while propagation is in flight, a record that exists with the wrong value, a
 * resolver timeout, and TXT values arriving pre-split into chunks (a long value is returned as several
 * strings that must be joined before comparison, or a token split across chunks would never match).
 *
 * Several TXT records on the same name is normal — other vendors verify the same way — so EVERY value
 * is checked rather than just the first.
 */
export async function verifyDomainTxt(
  host: string,
  expectedToken: string,
  lookup: TxtLookup = liveTxtLookup,
): Promise<DnsVerifyResult> {
  const name = `${VERIFICATION_TXT_PREFIX}.${host}`;
  let records: string[][];
  try {
    records = await lookup(name);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    // NXDOMAIN / NODATA: the record is simply not there yet. The most common case by far, and not a
    // failure the operator should be asked to debug.
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      return { ok: false, state: 'pending', detail: `no TXT record found at ${name} yet — DNS changes can take a few minutes to publish` };
    }
    if (code === 'ETIMEOUT' || code === 'ESERVFAIL' || code === 'EREFUSED') {
      return { ok: false, state: 'pending', detail: `the DNS lookup for ${name} did not complete — try again shortly` };
    }
    return { ok: false, state: 'failed', detail: `could not look up ${name}` };
  }
  // A single TXT value may be chunked into multiple strings — join before comparing.
  const values = records.map((chunks) => chunks.join('').trim());
  if (values.some((v) => v === expectedToken)) return { ok: true };
  if (values.length === 0) {
    return { ok: false, state: 'pending', detail: `no TXT record found at ${name} yet — DNS changes can take a few minutes to publish` };
  }
  return {
    ok: false,
    state: 'failed',
    detail: `${name} has a TXT record, but not the expected value — check it was pasted in full`,
  };
}
