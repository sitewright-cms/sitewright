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
}

/**
 * A search engine refused, or could not be reached. `kind` is for the caller; the message is shown to admins.
 * - `invalid`: what was entered is not a key of that kind (nothing was sent).
 * - `auth`: the service refused the key.
 * - `disabled`: the key works, but an API it needs is switched off for its project.
 * - `unverified`: the service looked for the site's verification tag and did not find it.
 * - `rate`, `unavailable`: try again later.
 */
export class WebmasterError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid' | 'auth' | 'disabled' | 'unverified' | 'rate' | 'unavailable',
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
  init: { method: 'GET' | 'POST' | 'PUT'; headers: Record<string, string>; body?: string },
  io: WebmasterIo,
): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), io.timeoutMs ?? DEFAULT_TIMEOUT_MS);
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
  return { status, json };
}
