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
  const a = await registerAccount(db, 'a@acme.test', 'pw-secret-1');
  const project = await new ProjectRepository(db).create({ name: 'A', slug: 'a' });
  await addProjectMember(db, a.userId, project.id, 'owner');
  ctx = { userId: a.userId, projectId: project.id, role: 'owner' };
});

describe('ContentRepository change events', () => {
  it('emits a put event (scoped to the project) on a successful write', async () => {
    const events: ContentChange[] = [];
    bus.subscribe(ctx.projectId, (e) => events.push(e));
    await content.put(ctx, 'page', 'home', page);
    expect(events).toEqual([{ kind: 'page', entityId: 'home', op: 'put' }]);
  });

  it('emits a delete event on removal', async () => {
    await content.put(ctx, 'page', 'home', page);
    const events: ContentChange[] = [];
    bus.subscribe(ctx.projectId, (e) => events.push(e));
    await content.remove(ctx, 'page', 'home');
    expect(events).toEqual([{ kind: 'page', entityId: 'home', op: 'delete' }]);
  });

  it('does not emit when the write fails validation', async () => {
    const events: ContentChange[] = [];
    bus.subscribe(ctx.projectId, (e) => events.push(e));
    await expect(content.put(ctx, 'page', 'home', { id: 'home' })).rejects.toThrow();
    expect(events).toHaveLength(0);
  });
});
