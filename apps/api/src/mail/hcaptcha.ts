// hCaptcha server-side verification. The verifier is injectable so tests never
// hit the network; the default implementation calls hCaptcha's siteverify API.

const SITEVERIFY_URL = 'https://hcaptcha.com/siteverify';

/** Verifies an hCaptcha response token against the instance secret. */
export interface HcaptchaVerifier {
  /** Returns true only on a confirmed solve. Fail-closed (false) on any error. */
  verify(secret: string, token: string | undefined, remoteip?: string): Promise<boolean>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/**
 * Calls hCaptcha's siteverify endpoint. Fail-CLOSED: a missing token, a non-2xx
 * response, a network error, or `success: false` all yield `false` — when an
 * admin requires a captcha, an unverifiable submission is rejected rather than
 * waved through.
 */
export class HttpHcaptchaVerifier implements HcaptchaVerifier {
  /**
   * @param fetchImpl test seam — defaults to the global `fetch`.
   * @param endpoint test seam — defaults to the hard-coded hCaptcha siteverify URL;
   *   production constructs this with no arguments, so the endpoint is not
   *   attacker- or tenant-influenced.
   */
  constructor(
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly endpoint: string = SITEVERIFY_URL,
  ) {}

  async verify(secret: string, token: string | undefined, remoteip?: string): Promise<boolean> {
    if (!token) return false;
    const params = new URLSearchParams({ secret, response: token });
    if (remoteip) params.set('remoteip', remoteip);
    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as { success?: boolean };
      return json.success === true;
    } catch {
      // Network/parse failure → cannot confirm → reject (fail-closed).
      return false;
    }
  }
}
