import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness, type Harness } from './harness.js';
import type { AiProvider, AiCompleteRequest, AiUsage } from '../src/ai/provider.js';

/** A deterministic provider for tests — records calls, returns canned text+usage. */
class FakeProvider implements AiProvider {
  readonly calls: AiCompleteRequest[] = [];
  constructor(
    private readonly text = 'Generated copy',
    private readonly usage: AiUsage = { inputTokens: 10, outputTokens: 20 },
  ) {}
  async complete(req: AiCompleteRequest) {
    this.calls.push(req);
    return { text: this.text, model: 'fake-model', usage: this.usage };
  }
}

let h: Harness;
afterEach(async () => {
  await h?.close();
});

describe('AI generate + usage + quota', () => {
  it('returns 501 when AI is not configured', async () => {
    h = await makeHarness(); // no aiProvider
    const a = await h.signup();
    const proj = a.project(await a.createProject());
    const res = await a.post(`${proj.base}/ai/generate`, { instruction: 'write a hero headline' });
    expect(res.statusCode).toBe(501);
  });

  it('generates, records usage, and reflects it in the usage endpoint', async () => {
    const provider = new FakeProvider('A bold headline');
    h = await makeHarness({ aiProvider: provider });
    const a = await h.signup();
    const proj = a.project(await a.createProject());

    const gen = await a.post(`${proj.base}/ai/generate`, { instruction: 'headline', target: 'copy' });
    expect(gen.statusCode).toBe(200);
    const body = gen.json() as { result: { text: string }; usage: AiUsage; model: string };
    expect(body.result.text).toBe('A bold headline');
    expect(body.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(body.model).toBe('fake-model');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.system).toContain('copywriter'); // copy system prompt

    const usage = await a.get(`/orgs/${a.orgId}/ai/usage`);
    expect(usage.statusCode).toBe(200);
    const u = usage.json() as { enabled: boolean; org: { used: number }; user: { used: number } };
    expect(u.enabled).toBe(true);
    expect(u.org.used).toBe(30);
    expect(u.user.used).toBe(30);
  });

  it('parses a blocks target into a validated node', async () => {
    const node = { id: 'n', type: 'Section', children: [{ id: 'hh', type: 'Heading', props: { text: 'Hi' } }] };
    h = await makeHarness({ aiProvider: new FakeProvider(JSON.stringify(node)) });
    const a = await h.signup();
    const proj = a.project(await a.createProject());
    const res = await a.post(`${proj.base}/ai/generate`, { instruction: 'a hero section', target: 'blocks' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { result: { node?: unknown } }).result).toHaveProperty('node');
  });

  it('falls back to text when a blocks target returns non-JSON', async () => {
    h = await makeHarness({ aiProvider: new FakeProvider('not json at all') });
    const a = await h.signup();
    const proj = a.project(await a.createProject());
    const res = await a.post(`${proj.base}/ai/generate`, { instruction: 'x', target: 'blocks' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { result: { text?: string } }).result.text).toBe('not json at all');
  });

  it('enforces the per-user monthly token quota (429 over cap; no further spend)', async () => {
    const provider = new FakeProvider('x', { inputTokens: 40, outputTokens: 0 });
    h = await makeHarness({ aiProvider: provider, aiQuota: { userMonthlyTokens: 30 } });
    const a = await h.signup();
    const proj = a.project(await a.createProject());

    // First call: usage 0 < 30 → allowed, records 40.
    expect((await a.post(`${proj.base}/ai/generate`, { instruction: 'one' })).statusCode).toBe(200);
    // Second call: user is now at 40 ≥ 30 → blocked before spending.
    const over = await a.post(`${proj.base}/ai/generate`, { instruction: 'two' });
    expect(over.statusCode).toBe(429);
    expect(provider.calls).toHaveLength(1); // provider not invoked for the blocked call
  });

  it('blocks cross-tenant AI generation', async () => {
    h = await makeHarness({ aiProvider: new FakeProvider() });
    const a = await h.signup();
    const b = await h.signup();
    const projectId = await a.createProject();
    const res = await b.post(`/orgs/${a.orgId}/projects/${projectId}/ai/generate`, { instruction: 'x' });
    expect([403, 404]).toContain(res.statusCode);
  });
});
