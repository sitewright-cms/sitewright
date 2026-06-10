import {
  startDeviceAuthorization,
  requestDeviceToken,
  OAuthTokenError,
  type DeviceAuthorization,
  type FetchLike,
  type TokenSet,
} from './oauth.js';
import { saveCredentials } from './credentials.js';
import type { PendingLogin } from '@sitewright/mcp';

export interface DeviceLoginOptions {
  issuer: string;
  scope: string;
  /** Shows the user code + verification URL (the OS terminal in real use). */
  prompt: (auth: DeviceAuthorization) => void;
  fetchImpl?: FetchLike;
  /** Injectable wait (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

// NOT unref'd on purpose: while waiting between polls this timer is the only thing keeping the CLI
// alive. Unref'ing it let the process exit 0 during the very first sleep — before any poll — so
// `sitewright login --device` returned without ever persisting a token. (Injected sleeps in tests
// never exercised this, which is why it went unnoticed; the cli-e2e spawns the real bin to guard it.)
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls the token endpoint for an approved device grant — honoring `authorization_pending` /
 * `slow_down` (RFC 8628) — until approval, denial, or expiry. Persists the tokens on success.
 */
async function pollDeviceToken(
  ctx: { issuer: string; fetchImpl?: FetchLike },
  auth: DeviceAuthorization,
  sleep: (ms: number) => Promise<void>,
): Promise<TokenSet> {
  let interval = auth.interval;
  const deadline = Date.now() + auth.expiresIn * 1000;
  for (;;) {
    await sleep(interval * 1000);
    if (Date.now() > deadline) throw new Error('device login timed out — please run login again');
    try {
      const tokens = await requestDeviceToken({ issuer: ctx.issuer, deviceCode: auth.deviceCode }, ctx.fetchImpl);
      saveCredentials(ctx.issuer, tokens);
      return tokens;
    } catch (err) {
      if (err instanceof OAuthTokenError) {
        if (err.code === 'authorization_pending') continue;
        if (err.code === 'slow_down') {
          interval += 5; // back off as required by RFC 8628
          continue;
        }
      }
      throw err; // access_denied / expired_token / anything else is terminal
    }
  }
}

/**
 * Device authorization grant (RFC 8628) for headless/SSH logins: requests a device + user code,
 * shows the verification URL, then polls until approval. Persists the tokens on success. Used by the
 * `sitewright login --device` CLI command (synchronous: prints, then waits).
 */
export async function runDeviceLogin(opts: DeviceLoginOptions): Promise<TokenSet> {
  const sleep = opts.sleep ?? defaultSleep;
  const auth = await startDeviceAuthorization({ issuer: opts.issuer, scope: opts.scope }, opts.fetchImpl);
  opts.prompt(auth);
  return pollDeviceToken({ issuer: opts.issuer, fetchImpl: opts.fetchImpl }, auth, sleep);
}

/**
 * Starts a device-flow login for the MCP bridge: returns the verification URL + code to show the
 * user NOW, plus a `completion` promise that resolves once they approve (tokens persisted) — so the
 * `login` MCP tool can hand the agent the code immediately and finish in the background.
 */
export async function beginDeviceLogin(opts: {
  issuer: string;
  scope: string;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}): Promise<PendingLogin> {
  const sleep = opts.sleep ?? defaultSleep;
  const auth = await startDeviceAuthorization({ issuer: opts.issuer, scope: opts.scope }, opts.fetchImpl);
  const completion = pollDeviceToken({ issuer: opts.issuer, fetchImpl: opts.fetchImpl }, auth, sleep).then(() => {});
  return {
    verificationUrl: auth.verificationUriComplete ?? auth.verificationUri,
    userCode: auth.userCode,
    expiresIn: auth.expiresIn,
    completion,
  };
}
