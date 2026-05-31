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

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });

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
