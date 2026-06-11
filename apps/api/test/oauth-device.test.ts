import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ApiKeyRepository } from '../src/repo/api-keys.js';
import { OAuthRepository, DEVICE_CODE_TTL_MS } from '../src/repo/oauth.js';
import type { Database } from '../src/db/client.js';
import type { ProjectContext } from '../src/repo/context.js';

const CLIENT = 'sitewright-cli';

let db: Database;
let oauth: OAuthRepository;
let keys: ApiKeyRepository;
let pctx: ProjectContext;

beforeEach(async () => {
  db = await makeTestDb();
  oauth = new OAuthRepository(db);
  keys = new ApiKeyRepository(db);
  const a = await registerAccount(db, 'a@acme.test', 'Pw-secret-1');
  const project = await new ProjectRepository(db).create({ name: 'A', slug: 'a' });
  await addProjectMember(db, a.userId, project.id, 'owner');
  pctx = { userId: a.userId, projectId: project.id, role: 'owner' };
});

async function start() {
  return oauth.startDeviceAuthorization({ clientId: CLIENT, scope: ['content:read', 'content:write'] });
}
async function approve(userCode: string) {
  await oauth.approveDevice({
    userCode,
    userId: pctx.userId,
    projectId: pctx.projectId,
    role: 'owner',
  });
}

describe('OAuthRepository — device authorization grant', () => {
  it('issues a device_code + a human user_code, discoverable while pending', async () => {
    const auth = await start();
    expect(auth.deviceCode.startsWith('swd_')).toBe(true);
    expect(auth.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(auth.interval).toBeGreaterThan(0);
    const view = await oauth.findDeviceByUserCode(auth.userCode);
    expect(view).toMatchObject({ clientId: CLIENT, scope: ['content:read', 'content:write'] });
    expect(await oauth.findDeviceByUserCode('ZZZZ-ZZZZ')).toBeNull();
  });

  it('polls authorization_pending → slow_down → (approve) → tokens, single-use', async () => {
    const auth = await start();
    const poll = () => oauth.redeemDeviceCode({ deviceCode: auth.deviceCode, clientId: CLIENT });
    await expect(poll()).rejects.toMatchObject({ code: 'authorization_pending' });
    await expect(poll()).rejects.toMatchObject({ code: 'slow_down' }); // polled again too fast
    await approve(auth.userCode);
    const tokens = await poll();
    expect(tokens.accessToken.startsWith('swk_')).toBe(true);
    const resolved = await keys.resolve(tokens.accessToken);
    expect(resolved).toMatchObject({ projectId: pctx.projectId, role: 'owner' });
    // Single-use: redeeming again fails.
    await expect(poll()).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('returns access_denied after the user denies', async () => {
    const auth = await start();
    await oauth.denyDevice(auth.userCode);
    await expect(
      oauth.redeemDeviceCode({ deviceCode: auth.deviceCode, clientId: CLIENT }),
    ).rejects.toMatchObject({ code: 'access_denied' });
  });

  it('rejects client mismatch, unknown code, and expired codes', async () => {
    const auth = await start();
    await expect(
      oauth.redeemDeviceCode({ deviceCode: auth.deviceCode, clientId: 'evil' }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(
      oauth.redeemDeviceCode({ deviceCode: 'swd_nope', clientId: CLIENT }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
    // Expired: poll with a `now` past the TTL.
    const past = new Date(Date.now() + DEVICE_CODE_TTL_MS + 1000);
    await expect(
      oauth.redeemDeviceCode({ deviceCode: auth.deviceCode, clientId: CLIENT }, past),
    ).rejects.toMatchObject({ code: 'expired_token' });
  });

  it('refuses to approve an unknown or already-decided code', async () => {
    const auth = await start();
    await approve(auth.userCode);
    await expect(approve(auth.userCode)).rejects.toMatchObject({ code: 'invalid_request' }); // already approved
    await expect(
      oauth.approveDevice({ userCode: 'ZZZZ-ZZZZ', userId: pctx.userId, projectId: pctx.projectId, role: 'owner' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
