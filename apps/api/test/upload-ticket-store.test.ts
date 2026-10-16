import { describe, it, expect } from 'vitest';
import { UploadTicketStore, type UploadTicketScope } from '../src/http/upload-ticket-store.js';

/**
 * The store behind `create_media_upload`. What changed with BATCH minting is what a ticket can carry
 * (an alt text and a font's metadata, pinned at mint time like the folder) and that a project's live
 * tickets can now be COUNTED — so one tenant minting fifty at a time cannot flush another's.
 */

const scope = (over: Partial<UploadTicketScope> = {}): UploadTicketScope => ({
  projectId: 'p1',
  projectSlug: 'site',
  userId: 'u1',
  folder: '',
  ...over,
});

describe('UploadTicketStore', () => {
  it('hands back the alt and font metadata the ticket was minted with — and only once', () => {
    const store = new UploadTicketStore();
    const token = store.put(scope({ alt: 'A red barn at dusk', font: { family: 'Inter', weight: 700, style: 'italic', fallback: 'serif' } }));
    expect(store.take(token)).toEqual({
      projectId: 'p1',
      projectSlug: 'site',
      userId: 'u1',
      folder: '',
      alt: 'A red barn at dusk',
      font: { family: 'Inter', weight: 700, style: 'italic', fallback: 'serif' },
    });
    expect(store.take(token)).toBeUndefined();
  });

  it('a plain ticket carries no alt or font keys at all', () => {
    const store = new UploadTicketStore();
    const taken = store.take(store.put(scope()));
    expect(taken).toEqual({ projectId: 'p1', projectSlug: 'site', userId: 'u1', folder: '' });
  });

  it('counts live tickets PER PROJECT, so a batch can be budgeted against its own tenant', () => {
    let now = 1_000;
    const store = new UploadTicketStore({ ttlMs: 100, now: () => now });
    store.put(scope());
    store.put(scope());
    const used = store.put(scope());
    store.put(scope({ projectId: 'p2' }));
    expect(store.liveFor('p1')).toBe(3);
    expect(store.liveFor('p2')).toBe(1);
    expect(store.liveFor('nobody')).toBe(0);

    // A redeemed ticket stops counting…
    store.take(used);
    expect(store.liveFor('p1')).toBe(2);
    // …and so does an expired one.
    now += 101;
    expect(store.liveFor('p1')).toBe(0);
  });

  it('★ holds enough live tickets that a 50-ticket batch does not evict another tenant', () => {
    // At the old 256-entry cap, five batches of fifty from ONE project pushed every other project's
    // freshly minted ticket out of the store — a cross-tenant denial of service that batch minting
    // would have introduced. The per-project budget (in the route) bounds one tenant well below this.
    const store = new UploadTicketStore();
    const theirs = store.put(scope({ projectId: 'other' }));
    for (let i = 0; i < 4 * 50; i += 1) store.put(scope());
    expect(store.take(theirs)).toBeDefined();
  });

  it('still evicts the OLDEST when the hard cap is reached', () => {
    const store = new UploadTicketStore({ maxEntries: 2 });
    const first = store.put(scope());
    store.put(scope());
    store.put(scope());
    expect(store.size).toBe(2);
    expect(store.take(first)).toBeUndefined();
  });
});
