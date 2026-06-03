import {
  startDeviceAuthorization,
  requestDeviceToken,
  OAuthTokenError,
  type DeviceAuthorization,
  type FetchLike,
  type TokenSet,
} from './oauth.js';
import { saveCredentials } from './credentials.js';

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
 * Device authorization grant (RFC 8628) for headless/SSH logins: requests a
 * device + user code, shows the verification URL, then polls the token endpoint —
 * honoring `authorization_pending` / `slow_down` — until approval, denial, or
 * expiry. Persists the tokens on success.
 */
export async function runDeviceLogin(opts: DeviceLoginOptions): Promise<TokenSet> {
  const sleep = opts.sleep ?? defaultSleep;
  const auth = await startDeviceAuthorization({ issuer: opts.issuer, scope: opts.scope }, opts.fetchImpl);
  opts.prompt(auth);

  let interval = auth.interval;
  const deadline = Date.now() + auth.expiresIn * 1000;
  for (;;) {
    await sleep(interval * 1000);
    if (Date.now() > deadline) throw new Error('device login timed out — please run login again');
    try {
      const tokens = await requestDeviceToken({ issuer: opts.issuer, deviceCode: auth.deviceCode }, opts.fetchImpl);
      saveCredentials(opts.issuer, tokens);
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
