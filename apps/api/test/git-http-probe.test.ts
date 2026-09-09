import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { testGitTarget } from '../src/publish/git-test.js';

/**
 * The HTTPS git probe against a real (local) smart-HTTP server.
 *
 * ★ What this pins is the WRITE probe. `getRemoteInfo({ forPush: true })` asks for
 * `git-receive-pack` rather than `git-upload-pack`, and that choice is the entire reason the test can
 * claim push access rather than merely read access. A server that answers the receive-pack
 * advertisement here — and the 401/403 arms below — is what proves the distinction is really being
 * made on the wire, which no fake of `getRemoteInfo` could show.
 */

/** Wrap a payload as a git pkt-line (4 hex length chars covering themselves + the payload). */
function pkt(payload: string): string {
  return (payload.length + 4).toString(16).padStart(4, '0') + payload;
}
const FLUSH = '0000';
const SHA = 'a'.repeat(40);

/** A minimal `git-receive-pack` ref advertisement for a repo with the given branches. */
function advertisement(branches: string[]): string {
  const caps = 'report-status delete-refs side-band-64k';
  let body = pkt('# service=git-receive-pack\n') + FLUSH;
  if (branches.length === 0) {
    // An empty repository advertises the zero-id with capabilities and no refs.
    body += pkt(`${'0'.repeat(40)} capabilities^{}\0${caps}\n`);
  } else {
    branches.forEach((name, i) => {
      body += pkt(`${SHA} refs/heads/${name}${i === 0 ? `\0${caps}` : ''}\n`);
    });
  }
  return body + FLUSH;
}

let server: Server;
let base: string;
/** Records which git service each request asked for — the assertion that matters most. */
const servicesAsked: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    servicesAsked.push(url.searchParams.get('service') ?? '');
    const send = (status: number, body: string, type?: string): void => {
      res.writeHead(status, type ? { 'content-type': type } : {});
      res.end(body);
    };
    if (url.pathname.startsWith('/unauth.git')) return send(401, 'Unauthorized');
    if (url.pathname.startsWith('/readonly.git')) return send(403, 'Forbidden');
    if (url.pathname.startsWith('/missing.git')) return send(404, 'Not Found');
    if (url.pathname.startsWith('/empty.git')) {
      return send(200, advertisement([]), 'application/x-git-receive-pack-advertisement');
    }
    return send(200, advertisement(['main', 'gh-pages']), 'application/x-git-receive-pack-advertisement');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const cfg = (repo: string, branch = 'gh-pages') => ({ repoUrl: `${base}/${repo}`, branch, token: 'ghp_test' });
const stepMap = (r: { steps: Array<{ key: string; status: string }> }): Record<string, string> =>
  Object.fromEntries(r.steps.map((s) => [s.key, s.status]));

describe('git HTTPS probe — the write question', () => {
  it('asks for git-receive-pack, not git-upload-pack', async () => {
    servicesAsked.length = 0;
    const result = await testGitTarget(cfg('site.git'));
    expect(result.ok).toBe(true);
    // ★ Read access would be `git-upload-pack`. Asking for receive-pack is what makes "push access
    // confirmed" a true statement rather than a guess.
    expect(servicesAsked).toContain('git-receive-pack');
    expect(servicesAsked).not.toContain('git-upload-pack');
  });

  it('reports the branches it saw and marks an existing branch as present', async () => {
    const result = await testGitTarget(cfg('site.git', 'gh-pages'));
    expect(stepMap(result)).toEqual({ connect: 'ok', auth: 'ok', write: 'ok', branch: 'ok' });
    expect(result.steps.find((s) => s.key === 'branch')?.detail).toMatch(/2 branches/);
    expect(result.security).toBe('https');
  });

  it('treats a branch that is not there yet as informational', async () => {
    const result = await testGitTarget(cfg('site.git', 'not-yet'));
    expect(result.ok).toBe(true);
    expect(stepMap(result).branch).toBe('skipped');
  });

  it('handles an empty repository, which advertises no refs at all', async () => {
    const result = await testGitTarget(cfg('empty.git'));
    expect(result.ok).toBe(true);
    expect(stepMap(result).branch).toBe('skipped');
  });

  it('reads a 401 as a rejected token', async () => {
    const result = await testGitTarget(cfg('unauth.git'));
    expect(result.ok).toBe(false);
    expect(result.failure?.kind).toBe('auth');
  });

  // ★ The failure this whole probe exists to catch: a credential that can read but not push.
  it('reads a 403 as a credential that may not PUSH', async () => {
    const result = await testGitTarget(cfg('readonly.git'));
    expect(result.ok).toBe(false);
    expect(result.failure?.kind).toBe('permission');
    expect(result.failure?.message).toMatch(/refuses to let it PUSH/);
  });

  it('reads a 404 as a missing or invisible repository', async () => {
    const result = await testGitTarget(cfg('missing.git'));
    expect(result.ok).toBe(false);
    expect(result.failure?.kind).toBe('path');
  });

  it('reports the endpoint it dialled', async () => {
    const result = await testGitTarget(cfg('site.git'));
    expect(result.host).toBe('127.0.0.1');
    expect(result.port).toBe(443);
    expect(result.protocol).toBe('git');
  });
});
