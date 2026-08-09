import type { CaptchaProvider } from '@sitewright/schema';
import { DEFAULT_RECAPTCHA_MIN_SCORE } from '@sitewright/schema';

/**
 * Server-side captcha verification, for every provider the platform supports.
 *
 * Replaces the hCaptcha-only verifier. The providers differ in exactly three ways — the siteverify
 * URL, whether the answer carries a SCORE, and their error vocabulary — so one implementation with a
 * per-provider table beats three near-identical classes.
 *
 * FAIL-CLOSED throughout. A missing token, a non-2xx response, a network error, an unparseable body,
 * `success: false`, or a score below the threshold all reject. When an author has required a captcha,
 * an UNVERIFIABLE submission must not be waved through — the alternative is a form that silently
 * stops protecting itself the first time the provider has an outage.
 */

const SITEVERIFY_URL: Record<CaptchaProvider, string> = {
  hcaptcha: 'https://hcaptcha.com/siteverify',
  'recaptcha-v2': 'https://www.google.com/recaptcha/api/siteverify',
  'recaptcha-v3': 'https://www.google.com/recaptcha/api/siteverify',
};

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/** What siteverify answers. `score` is reCAPTCHA v3 only; `error-codes` is common to both vendors. */
interface SiteVerifyResponse {
  success?: boolean;
  score?: number;
  'error-codes'?: string[];
}

export interface CaptchaVerifyRequest {
  provider: CaptchaProvider;
  secret: string;
  token: string | undefined;
  remoteip?: string;
  /** reCAPTCHA v3 pass mark; ignored by the other providers. */
  minScore?: number;
}

export interface CaptchaVerifier {
  /** True only on a confirmed solve that also clears the score threshold, where one applies. */
  verify(req: CaptchaVerifyRequest): Promise<boolean>;
  /**
   * Checks the SECRET alone, without a real solve. Both vendors distinguish "your secret is wrong"
   * from "that token is wrong" in `error-codes`, so sending a deliberately invalid token and reading
   * which complaint comes back tells an author whether their credentials are right — the check that
   * would have caught a placeholder key before a visitor met it.
   */
  testCredentials(provider: CaptchaProvider, secret: string): Promise<{ ok: boolean; error?: string }>;
}

/** Vendor error codes that mean "the SECRET is wrong", as opposed to "the token is wrong". */
const BAD_SECRET_CODES = new Set(['invalid-input-secret', 'missing-input-secret', 'bad-request', 'invalid-keys']);

export class HttpCaptchaVerifier implements CaptchaVerifier {
  /**
   * @param fetchImpl test seam — defaults to the global `fetch`.
   * @param endpoints test seam — defaults to the hard-coded vendor URLs, so the endpoint is never
   *   attacker- or tenant-influenced.
   */
  constructor(
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly endpoints: Record<CaptchaProvider, string> = SITEVERIFY_URL,
  ) {}

  private async post(provider: CaptchaProvider, params: URLSearchParams): Promise<SiteVerifyResponse | null> {
    try {
      const res = await this.fetchImpl(this.endpoints[provider], {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!res.ok) return null;
      return (await res.json()) as SiteVerifyResponse;
    } catch {
      return null; // network/parse failure → cannot confirm
    }
  }

  async verify(req: CaptchaVerifyRequest): Promise<boolean> {
    if (!req.token) return false;
    const params = new URLSearchParams({ secret: req.secret, response: req.token });
    if (req.remoteip) params.set('remoteip', req.remoteip);
    const json = await this.post(req.provider, params);
    if (!json || json.success !== true) return false;

    // reCAPTCHA v3 always answers `success: true` for a well-formed token — the JUDGEMENT is the
    // score. Treating success alone as a pass would make v3 accept every bot on the internet, which
    // is the single most common way v3 is deployed wrong.
    if (req.provider === 'recaptcha-v3') {
      const threshold = req.minScore ?? DEFAULT_RECAPTCHA_MIN_SCORE;
      return typeof json.score === 'number' && json.score >= threshold;
    }
    return true;
  }

  async testCredentials(provider: CaptchaProvider, secret: string): Promise<{ ok: boolean; error?: string }> {
    // A token the vendor cannot possibly accept: the point is to be TOLD it is the token that is
    // wrong, which only happens once the secret itself has been accepted.
    const params = new URLSearchParams({ secret, response: 'sitewright-credential-probe' });
    const json = await this.post(provider, params);
    if (!json) return { ok: false, error: 'Could not reach the captcha provider.' };
    const codes = json['error-codes'] ?? [];
    if (codes.some((c) => BAD_SECRET_CODES.has(c))) {
      return { ok: false, error: 'The provider rejected the secret key. Check it against your dashboard.' };
    }
    // Anything else — including the expected "that token is invalid" — means the secret was accepted.
    return { ok: true };
  }
}
