import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ContentRepository } from '../src/repo/content.js';
import { ProjectEventBus, type ContentChange } from '../src/events/bus.js';
import { type ProjectContext } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

const page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } };

let db: Database;
let bus: ProjectEventBus;
let content: ContentRepository;
let ctx: ProjectContext;

beforeEach(async () => {
  db = await makeTestDb();
  bus = new ProjectEventBus();
  content = new ContentRepository(db, bus);
  const a = await registerAccount(db, 'a@acme.test', 'Pw-secret-1');
  const project = await new ProjectRepository(db).create({ name: 'A', slug: 'a' });
  await addProjectMember(db, a.userId, project.id, 'owner');
  ctx = { userId: a.userId, projectId: project.id, role: 'owner' };
});

describe('ContentRepository change events', () => {
  it('emits a put event (scoped to the project) on a successful write', async () => {
    const events: ContentChange[] = [];
    bus.subscribe(ctx.projectId, (e) => events.push(e));
    await content.put(ctx, 'page', 'home', page);
    expect(events).toEqual([
      { kind: 'page', entityId: 'home', op: 'put', actor: undefined, scope: '', version: expect.any(String) },
    ]);
    // The event carries the version the entity now HAS, so a client that just wrote can recognise the
    // echo of its own change instead of re-fetching (and, when its buffer is dirty, warning the author
    // about themselves). It must therefore equal what a read returns.
    expect(events[0]?.version).toBe(await content.versionOf(ctx, 'page', 'home'));
  });

  it('emits a delete event on removal', async () => {
    await content.put(ctx, 'page', 'home', page);
    const events: ContentChange[] = [];
    bus.subscribe(ctx.projectId, (e) => events.push(e));
    await content.remove(ctx, 'page', 'home');
    // No version on a delete — there is no post-write state to name.
    expect(events).toEqual([{ kind: 'page', entityId: 'home', op: 'delete', actor: undefined, scope: '' }]);
  });

  it('carries the DATASET as scope for an entry — an entry id alone is ambiguous across datasets', async () => {
    await content.put(ctx, 'dataset', 'products', { id: 'products', slug: 'products', name: 'Products', fields: [] });
    const events: ContentChange[] = [];
    bus.subscribe(ctx.projectId, (e) => events.push(e));
    await content.put(ctx, 'entry', 'row_1', { id: 'row_1', dataset: 'products', values: {} });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'entry', entityId: 'row_1', scope: 'products' });
  });

  it('does not emit when the write fails validation', async () => {
    const events: ContentChange[] = [];
    bus.subscribe(ctx.projectId, (e) => events.push(e));
    await expect(content.put(ctx, 'page', 'home', { id: 'home' })).rejects.toThrow();
    expect(events).toHaveLength(0);
  });

  it('tags each change with the actor (agent for a bearer/MCP write, user for a session)', async () => {
    const events: ContentChange[] = [];
    bus.subscribe(ctx.projectId, (e) => events.push(e));
    await content.put({ ...ctx, actor: 'agent' }, 'page', 'home', page);
    await content.put({ ...ctx, actor: 'user' }, 'page', 'home', page);
    await content.remove({ ...ctx, actor: 'agent' }, 'page', 'home');
    expect(events.map((e) => e.actor)).toEqual(['agent', 'user', 'agent']);
  });
});
