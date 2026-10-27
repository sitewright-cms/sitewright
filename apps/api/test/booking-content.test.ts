import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { addProjectMember } from '../src/repo/accounts.js';

/**
 * The booking set-up as content: one entity per project, id `booking`, with no `id` of its own (a STRICT
 * schema, so an `id` the API added would be refused outright). Stored, revisioned, exported and copied
 * with the project like the settings.
 */

let h: Harness;
let client: TestClient;
let pid: string;

beforeEach(async () => {
  h = await makeHarness();
  client = await h.signup({ email: 'booking@e2e.test', admin: true });
  pid = await client.createProject('Rooms', 'rooms');
});
afterEach(() => h.close());

const setup = (name = 'Anna') => ({
  resources: [{ id: 'anna', name, timeZone: 'Europe/Berlin', hours: [{ days: ['mon', 'tue'], from: '09:00', to: '17:00' }] }],
  offerings: [{ id: 'consult', name: 'Consultation', mode: 'duration', durationMin: 45, resourceIds: ['anna'] }],
});
const url = (id = 'booking') => `/projects/${pid}/content/booking/${id}`;

describe('the booking set-up', () => {
  it('a new project has none; the first write creates it, and it reads back with its defaults filled in', async () => {
    expect((await client.get(url())).statusCode).toBe(404);
    const put = await client.put(url(), setup());
    expect(put.statusCode, put.body).toBe(200);
    const got = await client.get(url());
    expect(got.statusCode).toBe(200);
    expect(got.json().item.resources[0]).toMatchObject({ id: 'anna', capacity: 1, blocks: [] });
    expect(got.json().item.offerings[0]).toMatchObject({ confirmation: 'instant', maxAdvanceDays: 90 });
    expect(got.json().item).not.toHaveProperty('id');
  });

  it('★ refuses what the schema refuses, naming the field: a typo, a missing resource, a bad time zone', async () => {
    const typo = await client.put(url(), { ...setup(), offerings: [{ ...setup().offerings[0], maxQuantiy: 3 }] });
    expect(typo.statusCode).toBe(400);
    const missing = await client.put(url(), { ...setup(), offerings: [{ ...setup().offerings[0], resourceIds: ['ben'] }] });
    expect(missing.statusCode).toBe(400);
    expect(missing.body).toContain('ben');
    const zone = await client.put(url(), { ...setup(), resources: [{ ...setup().resources[0], timeZone: 'Mars/Olympus' }] });
    expect(zone.statusCode).toBe(400);
    expect((await client.get(url())).statusCode).toBe(404);
  });

  it('there is only ever one: any other id is refused', async () => {
    const other = await client.put(url('second'), setup());
    expect(other.statusCode).toBe(409);
  });

  it('keeps a history, and restoring an earlier version brings it back', async () => {
    await client.put(url(), setup('Anna'));
    await client.put(url(), setup('Anna B.'));
    const revisions = await client.get(`${url()}/revisions`);
    expect(revisions.statusCode).toBe(200);
    const items = revisions.json().items as Array<{ id: string }>;
    expect(items).toHaveLength(2);
    const restore = await client.post(`${url()}/revisions/${items[1]!.id}/restore`);
    expect(restore.statusCode, restore.body).toBe(200);
    expect((await client.get(url())).json().item.resources[0].name).toBe('Anna');
  });

  it('★ travels with the project: a copy has the same booking set-up', async () => {
    await client.put(url(), setup());
    const copy = await client.post(`/projects/${pid}/duplicate`, {});
    expect(copy.statusCode, copy.body).toBe(201);
    const copyId = copy.json().project.id as string;
    const got = await client.get(`/projects/${copyId}/content/booking/booking`);
    expect(got.statusCode).toBe(200);
    expect(got.json().item.offerings[0].id).toBe('consult');
  });

  it('a project without one copies without one', async () => {
    const copy = await client.post(`/projects/${pid}/duplicate`, {});
    expect(copy.statusCode, copy.body).toBe(201);
    expect((await client.get(`/projects/${copy.json().project.id}/content/booking/booking`)).statusCode).toBe(404);
  });

  it('★ cannot be deleted (live holds name its offerings); saving an empty one switches booking off', async () => {
    await client.put(url(), setup());
    const del = await client.del(url());
    expect(del.statusCode).toBe(403);
    expect(del.body).toContain('empty');
    expect((await client.put(url(), { resources: [], offerings: [] })).statusCode).toBe(200);
    expect((await client.get(url())).json().item).toEqual({ resources: [], offerings: [] });
  });

  it('is a full replace: a partial merge is refused', async () => {
    await client.put(url(), setup());
    const merge = await client.put(`${url()}?merge=1`, { resources: [] });
    expect(merge.statusCode).toBe(400);
    expect((await client.get(url())).json().item.resources).toHaveLength(1);
  });

  it('a project member edits it, as they edit the settings', async () => {
    const member = await h.signup({ email: 'member@e2e.test' });
    await addProjectMember(h.db, member.userId, pid, 'member');
    expect((await member.put(url(), setup('Anna M.'))).statusCode).toBe(200);
    expect((await member.get(url())).json().item.resources[0].name).toBe('Anna M.');
    // Someone outside the project neither reads nor writes it.
    const stranger = await h.signup({ email: 'stranger@e2e.test' });
    expect((await stranger.get(url())).statusCode).toBe(403);
    expect((await stranger.put(url(), setup())).statusCode).toBe(403);
  });
});
