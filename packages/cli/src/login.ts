import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { challengeFor, generateState, generateVerifier } from './pkce.js';
import { buildAuthorizeUrl, exchangeCode, parseCallback, type FetchLike, type TokenSet } from './oauth.js';
import { saveCredentials } from './credentials.js';

export interface LoginOptions {
  issuer: string;
  scope: string;
  /** Opens the consent URL — the OS browser in real use; injected in tests. */
  open: (url: string) => void | Promise<void>;
  /** Overridable fetch (token exchange) — defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Whole-flow timeout (default 5 min). */
  timeoutMs?: number;
}

/**
 * Runs the OAuth loopback + PKCE login: spins an ephemeral 127.0.0.1 listener,
 * opens the browser to the consent page, captures the redirected code, exchanges
 * it for tokens, persists them, and returns the token set. The listener is always
 * closed; the verifier never leaves this process.
 */
export async function runLogin(opts: LoginOptions): Promise<TokenSet> {
  const verifier = generateVerifier();
  const challenge = challengeFor(verifier);
  const state = generateState();

  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const authorizeUrl = buildAuthorizeUrl({ issuer: opts.issuer, redirectUri, challenge, scope: opts.scope, state });

  try {
    // Single awaited promise: its executor wires the callback handler AND launches
    // the browser, so a rejection always has a handler (no unhandled-rejection gap).
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('login timed out')), opts.timeoutMs ?? 300_000);
      timer.unref?.();
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const result = parseCallback(url.searchParams, state);
        if ('error' in result) {
          res.writeHead(400, { 'content-type': 'text/html' }).end('<h1>Login failed</h1><p>You can close this window.</p>');
          clearTimeout(timer);
          reject(new Error(`authorization failed: ${result.error}`));
        } else {
          res
            .writeHead(200, { 'content-type': 'text/html' })
            .end('<h1>Signed in to Sitewright</h1><p>You can close this window and return to the terminal.</p>');
          clearTimeout(timer);
          resolve(result.code);
        }
      });
      Promise.resolve(opts.open(authorizeUrl)).catch((err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error('failed to open browser'));
      });
    });
    const tokens = await exchangeCode({ issuer: opts.issuer, code, redirectUri, verifier }, opts.fetchImpl);
    saveCredentials(opts.issuer, tokens);
    return tokens;
  } finally {
    server.close();
  }
}
