import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeTestDb } from './helpers.js';
import { SubmissionRepository } from '../src/repo/submissions.js';
import { projects } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let repo: SubmissionRepository;
let projectA: string;
let projectB: string;

async function makeProject(db: Database): Promise<string> {
  const projectId = randomUUID();
  const now = new Date();
  // Slug is now instance-unique (no org); derive a unique one per project.
  await db.insert(projects).values({ id: projectId, name: 'P', slug: `p-${projectId.slice(0, 8)}`, createdAt: now });
  return projectId;
}

beforeEach(async () => {
  db = await makeTestDb();
  repo = new SubmissionRepository(db);
  projectA = await makeProject(db);
  projectB = await makeProject(db);
});

describe('SubmissionRepository', () => {
  it('stores and reads back a text-only submission', async () => {
    const sub = await repo.create(projectA, 'contact', { email: 'a@b.co', message: 'hi' });
    expect(sub.formId).toBe('contact');
    expect(sub.fields).toEqual({ email: 'a@b.co', message: 'hi' });
    const got = await repo.get(projectA, sub.id);
    expect(got?.fields.message).toBe('hi');
  });

  it('lists newest-first with a total count, filterable by form', async () => {
    await repo.create(projectA, 'contact', { n: '1' });
    await repo.create(projectA, 'contact', { n: '2' });
    await repo.create(projectA, 'newsletter', { n: '3' });
    const all = await repo.list(projectA);
    expect(all.total).toBe(3);
    expect(all.items).toHaveLength(3);
    const contact = await repo.list(projectA, { formId: 'contact' });
    expect(contact.total).toBe(2);
    expect(contact.items.every((s) => s.formId === 'contact')).toBe(true);
  });

  it('paginates via limit/offset', async () => {
    for (let i = 0; i < 5; i += 1) await repo.create(projectA, 'contact', { n: String(i) });
    const page = await repo.list(projectA, { limit: 2, offset: 0 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(5);
  });

  it('isolates submissions by project (B cannot see A)', async () => {
    const a = await repo.create(projectA, 'contact', { x: '1' });
    expect((await repo.list(projectB)).total).toBe(0);
    expect(await repo.get(projectB, a.id)).toBeNull();
    expect(await repo.remove(projectB, a.id)).toBe(false); // cross-project delete is a no-op
    expect(await repo.get(projectA, a.id)).not.toBeNull(); // untouched
  });

  it('removes a submission and reports whether it existed', async () => {
    const a = await repo.create(projectA, 'contact', { x: '1' });
    expect(await repo.remove(projectA, a.id)).toBe(true);
    expect(await repo.get(projectA, a.id)).toBeNull();
    expect(await repo.remove(projectA, a.id)).toBe(false);
  });
});

describe('filtered counters — what the bot traps leave behind', () => {
  it('counts per (form, reason) and UPSERTS rather than writing a row per drop', async () => {
    // A row per drop would let a spam run write unbounded rows — the very thing the traps exist to
    // prevent. One row per (form, reason), incremented.
    await repo.recordFiltered(projectA, 'contact', 'honeypot');
    await repo.recordFiltered(projectA, 'contact', 'honeypot');
    await repo.recordFiltered(projectA, 'contact', 'too-fast');
    await repo.recordFiltered(projectA, 'quote', 'honeypot');

    const all = await repo.filteredSummary(projectA);
    expect(all).toHaveLength(3);
    expect(all.find((r) => r.formId === 'contact' && r.reason === 'honeypot')?.count).toBe(2);
    expect(all.find((r) => r.formId === 'contact' && r.reason === 'too-fast')?.count).toBe(1);
    expect(all.find((r) => r.formId === 'quote' && r.reason === 'honeypot')?.count).toBe(1);
  });

  it('scopes to one form — the Forms tab renders per form, not per project', async () => {
    await repo.recordFiltered(projectA, 'contact', 'honeypot');
    await repo.recordFiltered(projectA, 'quote', 'honeypot');
    const contact = await repo.filteredSummary(projectA, 'contact');
    expect(contact).toHaveLength(1);
    expect(contact[0]!.formId).toBe('contact');
  });

  it('never leaks another tenant’s counts', async () => {
    await repo.recordFiltered(projectA, 'contact', 'honeypot');
    expect(await repo.filteredSummary(projectB)).toEqual([]);
  });

  describe('proof-of-work spending', () => {
    it('claims a challenge once and refuses every reuse', async () => {
      const later = new Date(Date.now() + 60_000);
      expect(await repo.claimPowChallenge('abc', later)).toBe(true);
      expect(await repo.claimPowChallenge('abc', later)).toBe(false);
      expect(await repo.claimPowChallenge('abc', later)).toBe(false);
      // A different challenge is unaffected — spending keys on the challenge, it does not latch.
      expect(await repo.claimPowChallenge('def', later)).toBe(true);
    });

    it('lets exactly ONE of a set of CONCURRENT claims win', async () => {
      // The reason this is a single INSERT … ON CONFLICT and not an exists-check-then-write: two posts
      // carrying the same solution arriving together must not both read "unspent". A test that awaits
      // each claim in turn cannot see that window, so fire them all before awaiting any.
      const later = new Date(Date.now() + 60_000);
      const results = await Promise.all(Array.from({ length: 8 }, () => repo.claimPowChallenge('race', later)));
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('sweeps only what has already expired', async () => {
      const past = new Date(Date.now() - 60_000);
      const future = new Date(Date.now() + 60_000);
      await repo.claimPowChallenge('old', past);
      await repo.claimPowChallenge('new', future);
      await repo.sweepSpentPow();
      // The expired row is gone, so its key is claimable again — harmless, because a challenge that
      // far past its signed TTL is refused as `expired` long before the claim is consulted.
      expect(await repo.claimPowChallenge('old', future)).toBe(true);
      // The live one is still spent. A sweep that took this would silently reopen replay.
      expect(await repo.claimPowChallenge('new', future)).toBe(false);
    });
  });

  it('records WHEN the trap last fired, so a jump is attributable to a change', async () => {
    // "Is this number small and steady, or did it jump the day we edited the form?" is the question
    // the counter exists to answer, and it needs a timestamp to answer it.
    const earlier = new Date('2026-01-01T00:00:00Z');
    const later = new Date('2026-02-01T00:00:00Z');
    await repo.recordFiltered(projectA, 'contact', 'honeypot', earlier);
    await repo.recordFiltered(projectA, 'contact', 'honeypot', later);
    const [row] = await repo.filteredSummary(projectA, 'contact');
    expect(row!.count).toBe(2);
    expect(row!.lastAt).toBe(later.getTime());
  });
});
