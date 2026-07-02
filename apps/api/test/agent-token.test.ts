import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { mintAgentToken, revokeAgentToken, isActiveAgentToken, clearAgentTokenActive } from '../src/ai/agent-token.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let projectId: string;
let userId: string;

beforeEach(async () => {
  db = await makeTestDb();
  const projects = new ProjectRepository(db);
  const acct = await registerAccount(db, 'owner@acme.test', 'Pw-secret-1');
  userId = acct.userId;
  const proj = await projects.create({ name: 'Site', slug: 'site' });
  projectId = proj.id;
  await addProjectMember(db, userId, projectId, 'owner');
});

describe('agent-token active registry (rate-limit exemption)', () => {
  it('marks a freshly-minted token active, then clears it', async () => {
    const minted = await mintAgentToken(db, { projectId, userId, role: 'owner', capabilities: ['content:write'], ttlMs: 60_000 });
    // While the loop runs, the token is exempt from the network rate-limiter.
    expect(isActiveAgentToken(minted.token)).toBe(true);
    // An unrelated / random bearer is never exempt.
    expect(isActiveAgentToken('swk_not_a_real_token')).toBe(false);
    expect(isActiveAgentToken(null)).toBe(false);
    expect(isActiveAgentToken(undefined)).toBe(false);

    // Loop teardown drops it from the registry (auth still applies via revoke).
    clearAgentTokenActive(minted.token);
    expect(isActiveAgentToken(minted.token)).toBe(false);
    await revokeAgentToken(db, minted.keyId);
  });

  it('clearing is idempotent and only affects the given token', async () => {
    const a = await mintAgentToken(db, { projectId, userId, role: 'owner', capabilities: ['content:write'], ttlMs: 60_000 });
    const b = await mintAgentToken(db, { projectId, userId, role: 'member', capabilities: ['content:read'], ttlMs: 60_000 });
    expect(isActiveAgentToken(a.token)).toBe(true);
    expect(isActiveAgentToken(b.token)).toBe(true);

    clearAgentTokenActive(a.token);
    clearAgentTokenActive(a.token); // idempotent — no throw, still gone
    expect(isActiveAgentToken(a.token)).toBe(false);
    expect(isActiveAgentToken(b.token)).toBe(true); // untouched

    clearAgentTokenActive(b.token);
  });
});
