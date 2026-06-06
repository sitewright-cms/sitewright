import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReleaseManifest } from '../src/publish/build.js';
import type { BuildJob, BuildRunner } from '../src/publish/runner.js';
import { makeHarness, type Harness, type ProjectClient, type TestClient } from './harness.js';

/**
 * Integration coverage for the per-project concurrent-publish guard in the
 * publish route (`activePublishes` Set in `src/http/app.ts`). A second publish
 * of the SAME project while one is in flight is rejected with 409
 * ("a build is already in progress for this project"); the guard is released in
 * a `finally`, so it survives both success and runner errors.
 *
 * Determinism: instead of relying on real build timing, we inject a controllable
 * fake `buildRunner`. Each `run()` call parks on a deferred "gate" that the test
 * resolves (or rejects) on demand, letting us hold publish #1 open while issuing
 * publish #2 with zero sleeps.
 */

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const VALID_MANIFEST: ReleaseManifest = {
  publishedAt: '2026-05-30T00:00:00.000Z',
  routes: 1,
  bytes: 42,
};

/**
 * A `BuildRunner` whose every `run()` blocks on a fresh gate. Tests pull the
 * latest gate, then resolve it with a valid {@link ReleaseManifest} (publish
 * succeeds → 200) or reject it (publish fails → guard must still be released).
 */
class GatedBuildRunner implements BuildRunner {
  /** One gate per in-flight `run()`, in call order. */
  readonly gates: Array<Deferred<ReleaseManifest>> = [];
  /** Resolves once each new `run()` has actually started (gate registered). */
  private started: Array<Deferred<void>> = [deferred<void>()];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- BuildRunner.run signature requires job
  run(_job: BuildJob): Promise<ReleaseManifest> {
    const gate = deferred<ReleaseManifest>();
    this.gates.push(gate);
    // Signal that this call started, then arm the next waiter.
    this.started[this.gates.length - 1]?.resolve();
    this.started.push(deferred<void>());
    return gate.promise;
  }

  /** Awaits until the Nth (1-based) `run()` call has begun executing. */
  whenStarted(n: number): Promise<void> {
    while (this.started.length < n) this.started.push(deferred<void>());
    const d = this.started[n - 1];
    if (!d) throw new Error(`no start signal ${n}`);
    return d.promise;
  }

  /** Resolves the Nth (1-based) in-flight build with a valid manifest. */
  release(n: number, manifest: ReleaseManifest = VALID_MANIFEST): void {
    const gate = this.gates[n - 1];
    if (!gate) throw new Error(`no gate ${n}`);
    gate.resolve(manifest);
  }

  /** Rejects the Nth (1-based) in-flight build (drives the error/cleanup path). */
  fail(n: number, reason: unknown = new Error('build exploded')): void {
    const gate = this.gates[n - 1];
    if (!gate) throw new Error(`no gate ${n}`);
    gate.reject(reason);
  }
}

const homePage = {
  id: 'home',
  path: '',
  title: 'Home',
  root: {
    id: 'r',
    type: 'Section',
    children: [{ id: 'h', type: 'Heading', props: { text: 'Live Site' } }],
  },
};

let slugSeq = 0;

/**
 * Stages a project with one valid page so a publish has something to build.
 * Returns the {@link ProjectClient} plus the project's `slug` — the
 * published site is served (and stored) under `/sites/<slug>/`.
 */
async function makeProject(client: TestClient): Promise<{ proj: ProjectClient; slug: string }> {
  const slug = `cp-site-${slugSeq++}`;
  const projectId = await client.createProject('Site', slug);
  const proj = client.project(projectId);
  const put = await proj.putContent('page', 'home', homePage);
  expect(put.statusCode).toBeLessThan(300);
  return { proj, slug };
}

describe('concurrent publish guard (per-project, HTTP layer)', () => {
  let harness: Harness;
  let runner: GatedBuildRunner;
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-cp-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-cp-media-'));
    runner = new GatedBuildRunner();
    harness = await makeHarness({ publishRoot, mediaRoot, buildRunner: runner });
  });

  afterEach(async () => {
    // Drain any still-parked gate so a leftover publish promise can settle and
    // not keep the process busy, then tear down.
    for (const gate of runner.gates) gate.resolve(VALID_MANIFEST);
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('rejects a second publish of project P while one is in flight, then allows a fresh one after release', async () => {
    const client = await harness.signup();
    const { proj, slug } = await makeProject(client);

    // Publish #1 — do not await; it parks on the runner gate (build in flight).
    const pub1 = client.post(`${proj.base}/publish`);
    await runner.whenStarted(1);

    // Publish #2 of the SAME project, while #1 is still building → guard rejects.
    const pub2 = await client.post(`${proj.base}/publish`);
    expect(pub2.statusCode).toBe(409);
    expect((pub2.json() as { error: string }).error).toBe(
      'a build is already in progress for this project',
    );
    // The guard short-circuits — it must NOT have invoked the runner a 2nd time.
    expect(runner.gates).toHaveLength(1);

    // Release #1 → it completes 200 with the manifest, and the guard is freed.
    runner.release(1);
    const r1 = await pub1;
    expect(r1.statusCode).toBe(200);
    const body1 = r1.json() as { release: ReleaseManifest; url: string };
    expect(body1.release).toEqual(VALID_MANIFEST);
    expect(body1.url).toBe(`/sites/${slug}/`);

    // A fresh publish of P is now permitted (guard released in `finally`).
    const pub3 = client.post(`${proj.base}/publish`);
    await runner.whenStarted(2);
    expect(runner.gates).toHaveLength(2);
    runner.release(2);
    const r3 = await pub3;
    expect(r3.statusCode).toBe(200);
  });

  it('does not block concurrent publishes of DIFFERENT projects', async () => {
    const client = await harness.signup();
    const { proj: projA } = await makeProject(client);
    const { proj: projB } = await makeProject(client);

    // Both publishes parked simultaneously — neither blocks the other.
    const pubA = client.post(`${projA.base}/publish`);
    await runner.whenStarted(1);
    const pubB = client.post(`${projB.base}/publish`);
    await runner.whenStarted(2);

    // Two independent builds are in flight (the guard is keyed per project id).
    expect(runner.gates).toHaveLength(2);

    runner.release(1);
    runner.release(2);
    const [rA, rB] = await Promise.all([pubA, pubB]);
    expect(rA.statusCode).toBe(200);
    expect(rB.statusCode).toBe(200);
  });

  it('releases the guard when the build runner throws (subsequent publish of P succeeds)', async () => {
    const client = await harness.signup();
    const { proj } = await makeProject(client);

    // Publish #1 fails inside the runner (non-PublishError → bubbles to 500).
    const pub1 = client.post(`${proj.base}/publish`);
    await runner.whenStarted(1);
    runner.fail(1, new Error('build exploded'));
    const r1 = await pub1;
    // A generic runner failure is an unexpected error → 500 (not the 409 guard,
    // not the 409 PublishError mapping). The point of this case is the cleanup.
    expect(r1.statusCode).toBe(500);

    // The `finally` must have removed P from `activePublishes`, so a brand-new
    // publish of the SAME project is accepted (not stuck at 409 forever).
    const pub2 = client.post(`${proj.base}/publish`);
    await runner.whenStarted(2);
    runner.release(2);
    const r2 = await pub2;
    expect(r2.statusCode).toBe(200);
    expect((r2.json() as { release: ReleaseManifest }).release).toEqual(VALID_MANIFEST);
  });

  it('is per-project + tenant-scoped: another tenant cannot observe or affect P’s in-flight guard', async () => {
    const tenantA = await harness.signup();
    const tenantB = await harness.signup();
    const { proj: projA } = await makeProject(tenantA);

    // Tenant A starts a publish of its project P; hold it in flight.
    const pubA = tenantA.post(`${projA.base}/publish`);
    await runner.whenStarted(1);

    // Tenant B aims at A's project URL. It can't see A's org membership, so the
    // tenant check rejects with 403 BEFORE ever reaching the per-project guard —
    // proving the guard is not a cross-tenant side channel.
    const cross = await tenantB.post(`${projA.base}/publish`);
    expect(cross.statusCode).toBe(403);
    // The rejected cross-tenant call never invoked the runner.
    expect(runner.gates).toHaveLength(1);

    // Tenant B publishing ITS OWN, different project proceeds unaffected by A's
    // in-flight build (independent guard key) → reaches the runner.
    const { proj: projB } = await makeProject(tenantB);
    const pubB = tenantB.post(`${projB.base}/publish`);
    await runner.whenStarted(2);
    expect(runner.gates).toHaveLength(2);

    runner.release(1);
    runner.release(2);
    const [rA, rB] = await Promise.all([pubA, pubB]);
    expect(rA.statusCode).toBe(200);
    expect(rB.statusCode).toBe(200);
  });
});
