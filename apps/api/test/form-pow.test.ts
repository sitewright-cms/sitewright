import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createPowChallenge, powScope, verifyPowSolution, DEFAULT_MAX_NUMBER, type PowClaim } from '../src/http/form-pow.js';

const SECRET = 'test-secret';
const SCOPE = powScope('proj1', 'formA');
const OTHER_SCOPE = powScope('proj1', 'formB');

/** Solve a challenge the way the browser runtime does: scan until the hash matches. */
const solve = (c: ReturnType<typeof createPowChallenge>): string => {
  for (let n = 0; n <= c.maxnumber; n += 1) {
    if (createHash('sha256').update(c.salt + String(n)).digest('hex') === c.challenge) {
      return Buffer.from(JSON.stringify({ algorithm: 'SHA-256', challenge: c.challenge, salt: c.salt, number: n, signature: c.signature })).toString('base64');
    }
  }
  throw new Error('unsolvable challenge — the answer must lie within maxnumber');
};

/**
 * A stand-in for the database claim with the same contract: true the first time, false on reuse.
 * Every test goes through one, because there is no non-consuming verify to call by accident.
 */
const spender = (): PowClaim => {
  const spent = new Set<string>();
  return async (challenge) => (spent.has(challenge) ? false : (spent.add(challenge), true));
};
/** For the cases that are refused before a claim is ever reached — using one here would be a bug. */
const neverClaims: PowClaim = async () => {
  throw new Error('claimed a solution that should have been rejected before the claim');
};

describe('form proof-of-work', () => {
  it('mints a solvable challenge and accepts its solution', async () => {
    const c = createPowChallenge(SECRET, SCOPE);
    expect(c.algorithm).toBe('SHA-256');
    expect(c.maxnumber).toBe(DEFAULT_MAX_NUMBER);
    expect(await verifyPowSolution(SECRET, SCOPE, solve(c), spender())).toBe('ok');
  });

  it('rejects a FORGED challenge — the client cannot mint its own work', async () => {
    // The whole scheme rests on this: without the signature check a bot would publish a trivial
    // challenge to itself (`maxnumber: 0`), solve it instantly, and the work would be zero.
    const own = { algorithm: 'SHA-256' as const, challenge: createHash('sha256').update('salt.9999999999999' + '0').digest('hex'), salt: 'salt.9999999999999', signature: 'deadbeef', maxnumber: 0 };
    const solution = Buffer.from(JSON.stringify({ ...own, number: 0 })).toString('base64');
    expect(await verifyPowSolution(SECRET, SCOPE, solution, neverClaims)).toBe('bad-signature');
  });

  it('rejects a solution signed with a DIFFERENT instance secret', async () => {
    const c = createPowChallenge('another-instance', SCOPE);
    expect(await verifyPowSolution(SECRET, SCOPE, solve(c), neverClaims)).toBe('bad-signature');
  });

  it('rejects the WRONG answer, however well-signed the challenge is', async () => {
    const c = createPowChallenge(SECRET, SCOPE, 10);
    const wrong = Buffer.from(JSON.stringify({ algorithm: 'SHA-256', challenge: c.challenge, salt: c.salt, number: 999999, signature: c.signature })).toString('base64');
    expect(await verifyPowSolution(SECRET, SCOPE, wrong, neverClaims)).toBe('wrong-answer');
  });

  it('EXPIRES, and the deadline cannot be extended by the client', async () => {
    const c = createPowChallenge(SECRET, SCOPE, 10, 1_000);
    expect(await verifyPowSolution(SECRET, SCOPE, solve(c), spender(), 1_000 + 60_000)).toBe('ok'); // inside the window
    expect(await verifyPowSolution(SECRET, SCOPE, solve(c), neverClaims, 1_000 + 60 * 60 * 1000)).toBe('expired');
    // The expiry lives INSIDE the signed salt, so editing it invalidates the signature rather than
    // buying more time.
    const solved = JSON.parse(Buffer.from(solve(c), 'base64').toString('utf8')) as Record<string, unknown>;
    const extended = Buffer.from(JSON.stringify({ ...solved, salt: `${String(solved.salt).split('.')[0]}.99999999999999` })).toString('base64');
    expect(await verifyPowSolution(SECRET, SCOPE, extended, neverClaims, 1_000 + 60 * 60 * 1000)).not.toBe('ok');
  });

  it('names WHY it failed, so a difficulty or TTL that costs real leads is visible', async () => {
    // "expired" (a visitor who left the tab open) and "wrong-answer" (a client that did no work) are
    // very different signals; collapsing them to false would hide a self-inflicted lead loss.
    expect(await verifyPowSolution(SECRET, SCOPE, undefined, neverClaims)).toBe('missing');
    expect(await verifyPowSolution(SECRET, SCOPE, 'not base64 json', neverClaims)).toBe('malformed');
    expect(await verifyPowSolution(SECRET, SCOPE, Buffer.from('{"algorithm":"MD5"}').toString('base64'), neverClaims)).toBe('malformed');
    expect(await verifyPowSolution(SECRET, SCOPE, Buffer.from('{"algorithm":"SHA-256","challenge":"x","salt":"s.1","signature":"y","number":-1}').toString('base64'), neverClaims)).toBe('malformed');
  });

  it('varies the answer per challenge — two mints are not interchangeable', async () => {
    const a = createPowChallenge(SECRET, SCOPE);
    const b = createPowChallenge(SECRET, SCOPE);
    expect(a.salt).not.toBe(b.salt);
    expect(a.challenge).not.toBe(b.challenge);
    const solvedA = JSON.parse(Buffer.from(solve(a), 'base64').toString('utf8')) as Record<string, unknown>;
    const swapped = Buffer.from(JSON.stringify({ ...solvedA, challenge: b.challenge, signature: b.signature })).toString('base64');
    expect(await verifyPowSolution(SECRET, SCOPE, swapped, neverClaims)).toBe('wrong-answer');
  });

  describe('one solve buys exactly one submission', () => {
    it('SPENDS the solution — the second use of the same work is `replayed`', async () => {
      // Without this, proof-of-work costs a spammer once per TTL rather than once per submission,
      // which is not a weaker guarantee than "cost per submission" — it is the absence of one.
      const claim = spender();
      const solution = solve(createPowChallenge(SECRET, SCOPE));
      expect(await verifyPowSolution(SECRET, SCOPE, solution, claim)).toBe('ok');
      expect(await verifyPowSolution(SECRET, SCOPE, solution, claim)).toBe('replayed');
      expect(await verifyPowSolution(SECRET, SCOPE, solution, claim)).toBe('replayed');
    });

    it('claims ONLY after the work checks out, so the store cannot be filled for free', async () => {
      // `neverClaims` throws if reached. A forged, expired or unsolved submission must be refused
      // before any row is written, or an attacker fills the table without doing any work at all.
      const c = createPowChallenge(SECRET, SCOPE, 10, 1_000);
      await expect(verifyPowSolution(SECRET, SCOPE, solve(c), neverClaims, 9e12)).resolves.toBe('expired');
      await expect(verifyPowSolution(SECRET, OTHER_SCOPE, solve(createPowChallenge(SECRET, SCOPE)), neverClaims)).resolves.toBe('bad-signature');
    });

    it('a real solve is still accepted after another challenge was spent', async () => {
      // Guards the obvious over-correction: spending must key on the challenge, not latch globally.
      const claim = spender();
      expect(await verifyPowSolution(SECRET, SCOPE, solve(createPowChallenge(SECRET, SCOPE)), claim)).toBe('ok');
      expect(await verifyPowSolution(SECRET, SCOPE, solve(createPowChallenge(SECRET, SCOPE)), claim)).toBe('ok');
    });
  });

  describe('a challenge is bound to ONE form', () => {
    it('refuses a solution minted for a different form on the same instance', async () => {
      const c = createPowChallenge(SECRET, SCOPE);
      expect(await verifyPowSolution(SECRET, SCOPE, solve(c), spender())).toBe('ok');
      // Same instance, same secret, same valid work — different form. Without scope binding this was
      // `ok`, so one solve could be sprayed across every form on the instance.
      expect(await verifyPowSolution(SECRET, OTHER_SCOPE, solve(c), neverClaims)).toBe('bad-signature');
    });

    it('encodes the scope injectively — ids cannot be shifted across the separator', async () => {
      // The ids come from the URL. A naive `project + ':' + form` would sign the same bytes for
      // ("a", "b:c") and ("a:b", "c"), letting one form's solve satisfy another.
      expect(powScope('a', 'b:c')).not.toBe(powScope('a:b', 'c'));
      const c = createPowChallenge(SECRET, powScope('a', 'b:c'));
      expect(await verifyPowSolution(SECRET, powScope('a:b', 'c'), solve(c), neverClaims)).toBe('bad-signature');
    });
  });
});
