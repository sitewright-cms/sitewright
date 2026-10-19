import { describe, expect, it } from 'vitest';
import { ProjectRepository } from '../src/repo/projects.js';
import { makeTestDb } from './helpers.js';

// `existingIds` decides which projects' statistics the orphan reap may delete, so what it calls "existing" is
// what keeps a site's history alive.
describe('ProjectRepository.existingIds', () => {
  it('★ answers which ids exist — soft-deleted projects included — across more ids than one query may bind', async () => {
    const repo = new ProjectRepository(await makeTestDb());
    const live = await repo.create({ name: 'Live', slug: 'live' });
    const parked = await repo.create({ name: 'Parked', slug: 'parked' });
    await repo.softDelete(parked.id, 'someone');
    const asked = [...Array.from({ length: 1200 }, (_, i) => `missing-${i}`), live.id, parked.id];
    expect(await repo.existingIds(asked)).toEqual(new Set([live.id, parked.id]));
  });

  it('answers an empty question with an empty set', async () => {
    const repo = new ProjectRepository(await makeTestDb());
    expect(await repo.existingIds([])).toEqual(new Set());
  });
});
