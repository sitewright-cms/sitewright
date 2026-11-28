// Revokes every project token and member token on the capture slot (see seed-base.mjs for why).
import { api, ok } from './lib.mjs';
import { ADMIN } from './admin.mjs';
const a = await api(ADMIN.email, ADMIN.password);
const { projects } = await ok(a.get('/projects'), 'projects');
for (const p of projects) {
  const keys = await ok(a.get(`/projects/${p.id}/api-keys`), 'keys');
  for (const k of keys.items ?? keys.keys ?? []) await ok(a.delete(`/projects/${p.id}/api-keys/${k.id}`), `revoke ${k.name}`);
}
const tokens = await ok(a.get('/account/member-tokens'), 'member tokens');
for (const t of tokens.items ?? []) if (!t.revokedAt) await ok(a.delete(`/account/member-tokens/${t.id}`), `revoke ${t.name}`);
console.log('tokens revoked');
