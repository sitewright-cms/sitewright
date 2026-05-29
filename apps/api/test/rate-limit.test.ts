import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await createApp({ db: await makeTestDb() });
  await app.ready();
});

describe('rate limiting', () => {
  it('429s after the per-route auth limit is exceeded', async () => {
    // The /auth/login route is capped at 10/min per key (IP here, no session).
    const codes: number[] = [];
    for (let i = 0; i < 13; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'nobody@example.com', password: 'whatever' },
      });
      codes.push(res.statusCode);
    }
    // The first 10 are processed (401 — bad creds), then the limiter kicks in.
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    expect(codes[codes.length - 1]).toBe(429);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
  });

  it('sets rate-limit headers on a normal response', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });
});
