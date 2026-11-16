import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReleaseManifest } from '../src/publish/build.js';
import type { BuildJob, BuildRunner } from '../src/publish/runner.js';
import { makeHarness, type Harness, type ProjectClient, type TestClient } from './harness.js';

/**
 * The instance-wide bound on whole-site builds (`siteBuildConcurrency`).
 *
 * Every build — a draft preview, a publish, a deploy, an audit's build — lives in the main process, and
 * nothing bounded how many ran at once: measured on a 1.5 GiB container under ten agents' edits plus
 * publishes and audits, ~20 ran together and the container was OOM-killed. Past the bound a build
 * WAITS (it is never refused), and it waits before reading its inputs, so a queued build holds nothing.
 *
 * Deterministic: the runner parks every build on a deferred the test resolves.
 */

const MANIFEST: ReleaseManifest = { publishedAt: '2026-11-15T00:00:00.000Z', routes: 1, bytes: 42 };

class ParkedRunner implements BuildRunner {
  readonly parked: Array<{ outDir: string; resolve: (m: ReleaseManifest) => void }> = [];
  private readonly listeners: Array<() => void> = [];

  run(job: BuildJob): Promise<ReleaseManifest> {
    return new Promise((resolve) => {
      this.parked.push({ outDir: job.outDir, resolve });
      for (const l of this.listeners.splice(0)) l();
    });
  }

  /** Resolves once `n` builds have started in total. */
  async started(n: number): Promise<void> {
    while (this.parked.length < n) await new Promise<void>((r) => this.listeners.push(r));
  }
}

const homePage = {
  id: 'home',
  path: '',
  title: 'Home',
  root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Hi' } }] },
};

let seq = 0;
async function makeProject(client: TestClient): Promise<ProjectClient> {
  const projectId = await client.createProject('Site', `sbg-site-${seq++}`);
  const proj = client.project(projectId);
  expect((await proj.putContent('page', 'home', homePage)).statusCode).toBeLessThan(300);
  return proj;
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

describe('site builds are bounded instance-wide', () => {
  let harness: Harness;
  let runner: ParkedRunner;
  const roots: string[] = [];

  beforeEach(async () => {
    const publishRoot = await mkdtemp(join(tmpdir(), 'sw-sbg-sites-'));
    const previewRoot = await mkdtemp(join(tmpdir(), 'sw-sbg-preview-'));
    const mediaRoot = await mkdtemp(join(tmpdir(), 'sw-sbg-media-'));
    roots.push(publishRoot, previewRoot, mediaRoot);
    runner = new ParkedRunner();
    harness = await makeHarness({ publishRoot, previewRoot, mediaRoot, buildRunner: runner, siteBuildConcurrency: 2 });
  });

  afterEach(async () => {
    for (const p of runner.parked) p.resolve(MANIFEST);
    await harness.close();
    for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
  });

  it('★ runs at most the bound at once across projects; the next starts when one finishes', async () => {
    const client = await harness.signup();
    const projects = [await makeProject(client), await makeProject(client), await makeProject(client)];

    const publishes = projects.map((p) => client.post(`${p.base}/publish`));
    await runner.started(2);
    await settle();
    // The third project's build is waiting for a slot — it has not started.
    expect(runner.parked).toHaveLength(2);

    runner.parked[0]!.resolve(MANIFEST);
    await runner.started(3);
    expect(runner.parked).toHaveLength(3);

    for (const p of runner.parked) p.resolve(MANIFEST);
    for (const r of await Promise.all(publishes)) expect(r.statusCode).toBe(200);
  });

  it('a draft preview build takes its turn in the same bound — it waits, it is not refused', async () => {
    const client = await harness.signup();
    const [a, b, c] = [await makeProject(client), await makeProject(client), await makeProject(client)];

    const publishes = [client.post(`${a.base}/publish`), client.post(`${b.base}/publish`)];
    await runner.started(2);
    const preview = client.get(`${c.base}/preview-url`);
    await settle();
    expect(runner.parked).toHaveLength(2);

    runner.parked[1]!.resolve(MANIFEST);
    await runner.started(3);
    runner.parked[2]!.resolve(MANIFEST);
    const res = await preview;
    expect(res.statusCode).toBe(200);
    expect((res.json() as { base: string }).base).toContain('/preview-site/');

    runner.parked[0]!.resolve(MANIFEST);
    for (const r of await Promise.all(publishes)) expect(r.statusCode).toBe(200);
  });

  it('★ a preview build that waited for its slot is stamped with what it READ — no second identical build', async () => {
    // The caller saw version v1; while its build waited, an agent saved again (v2). The build reads v2,
    // so stamping it v1 made the caller's loop run the whole build a second time.
    const client = await harness.signup();
    const [a, b, c] = [await makeProject(client), await makeProject(client), await makeProject(client)];

    const publishes = [client.post(`${a.base}/publish`), client.post(`${b.base}/publish`)];
    await runner.started(2);
    const preview = client.get(`${c.base}/preview-url`);
    await settle();
    expect((await c.putContent('page', 'home', { ...homePage, title: 'Edited while queued' })).statusCode).toBeLessThan(300);

    runner.parked[0]!.resolve(MANIFEST);
    await runner.started(3);
    runner.parked[2]!.resolve(MANIFEST);
    expect((await preview).statusCode).toBe(200);
    expect(runner.parked).toHaveLength(3); // the preview built ONCE

    runner.parked[1]!.resolve(MANIFEST);
    for (const r of await Promise.all(publishes)) expect(r.statusCode).toBe(200);
  });
});
