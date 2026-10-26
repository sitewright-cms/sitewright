import { parse as secureJsonParse } from 'secure-json-parse';
import type { FetchLike } from '../payments/executor.js';

/**
 * The one way the search engine clients talk to Google and Bing: a bounded request whose answer is read as JSON
 * defensively, and whose failures are worded HERE — never a transport message, a URL or a response body, because
 * a URL can carry the Bing API key and a body can echo what was sent.
 */

export interface WebmasterIo {
  fetch: FetchLike;
  /** The deadline for one request. */
  timeoutMs?: number;
  /**
   * When the whole step must be over (epoch ms): no request starts after it, and none runs past it. A step that
   * timed out therefore stops for real, rather than finishing behind the next one.
   */
  deadline?: number;
  /** Access tokens kept between requests (Google's last an hour); without it, every call trades the key again. */
  tokens?: AccessTokens;
}

/**
 * Access tokens by account, reused until shortly before they expire: trading a key for a token is a full round trip
 * (about 0.75 s to Google, measured), and one Search performance view or verification makes several calls. Callers
 * that arrive while a token is being fetched share that one fetch; a failed fetch is not kept. A token an API call
 * answers 401 to is dropped (see {@link requestJson}), so a revoked one is not offered again. Bounded: one entry per
 * account, a few accounts at most.
 */
export class AccessTokens {
  private readonly kept = new Map<string, { until: number; value?: string; token: Promise<string> }>();

  constructor(private readonly max = 4) {}

  /** The token kept for `account` until it is due, else a new one from `fetch` (`ttlMs`: how long it may be used). */
  get(account: string, nowMs: number, fetch: () => Promise<{ token: string; ttlMs: number }>): Promise<string> {
    const kept = this.kept.get(account);
    if (kept && nowMs < kept.until) return kept.token;
    // Due, or never fetched: one fetch, shared by everyone who asks before it answers.
    const entry: { until: number; value?: string; token: Promise<string> } = { until: Infinity, token: Promise.resolve('') };
    entry.token = fetch().then(
      ({ token, ttlMs }) => {
        entry.value = token;
        entry.until = nowMs + ttlMs;
        return token;
      },
      (err: unknown) => {
        if (this.kept.get(account) === entry) this.kept.delete(account);
        throw err;
      },
    );
    this.kept.delete(account);
    this.kept.set(account, entry);
    for (const old of this.kept.keys()) {
      if (this.kept.size <= this.max) break;
      this.kept.delete(old);
    }
    return entry.token;
  }

  /** Stop offering `token`: an API refused it. */
  forget(token: string): void {
    for (const [account, entry] of this.kept) if (entry.value === token) this.kept.delete(account);
  }
}

/**
 * A search engine refused, or could not be reached. `kind` is for the caller; the message is shown to admins.
 * - `invalid`: what was entered is not a key of that kind (nothing was sent).
 * - `auth`: the service refused the key.
 * - `disabled`: the key works, but an API it needs is switched off for its project.
 * - `unverified`: the service looked for the site's verification tag and did not find it.
 * - `tagged`: the opposite — the site still carries the tag, so Google will not give the ownership up yet.
 * - `rate`, `unavailable`: try again later.
 */
export class WebmasterError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid' | 'auth' | 'disabled' | 'unverified' | 'tagged' | 'rate' | 'unavailable',
  ) {
    super(message);
    this.name = 'WebmasterError';
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;

export type Json = Record<string, unknown>;
export const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A service's message, cut down to something safe to show: one line, bounded. */
export function cleanMessage(raw: unknown): string {
  // eslint-disable-next-line no-control-regex -- deliberately stripping the C0 range
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200) : '';
}

/**
 * Sends one request and reads the answer. `status` is the HTTP status; `json` is the parsed body, or undefined
 * when it is not JSON. Only a transport failure throws (as `unavailable`, named after `service`).
 */
export async function requestJson(
  service: string,
  url: string,
  init: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; headers: Record<string, string>; body?: string },
  io: WebmasterIo,
): Promise<{ status: number; json: unknown }> {
  const left = io.deadline === undefined ? Infinity : io.deadline - Date.now();
  if (left <= 0) throw new WebmasterError(`${service} took too long to answer`, 'unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(io.timeoutMs ?? DEFAULT_TIMEOUT_MS, left));
  let status: number;
  let text: string;
  try {
    const res = await io.fetch(url, { ...init, signal: controller.signal });
    status = res.status;
    text = await res.text();
  } catch {
    throw new WebmasterError(`${service} could not be reached`, 'unavailable');
  } finally {
    clearTimeout(timer);
  }
  let json: unknown;
  try {
    json = secureJsonParse(text, undefined, { protoAction: 'remove', constructorAction: 'remove' });
  } catch {
    json = undefined;
  }
  // A refused token is not offered again: the next call trades the key for a new one.
  if (status === 401 && io.tokens) {
    const bearer = /^Bearer (.+)$/.exec(init.headers.authorization ?? '')?.[1];
    if (bearer) io.tokens.forget(bearer);
  }
  return { status, json };
}
