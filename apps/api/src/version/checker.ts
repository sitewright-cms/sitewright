// Pull-based release check: the running instance compares its version against
// the latest published release and surfaces an update banner. Updates are never
// auto-applied — the operator pulls a new image and restarts.

/** Parses a semver-ish tag (`v1.2.3`, `1.2.3-rc.1`) into numeric [major,minor,patch]. */
function parseSemver(version: string): [number, number, number] {
  const core = version.trim().replace(/^v/i, '').split(/[-+]/)[0] ?? '';
  const parts = core.split('.').map((n) => Number.parseInt(n, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** Numeric semver comparison of the major.minor.patch core (ignores pre-release tags). */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    const ai = pa.at(i) ?? 0;
    const bi = pb.at(i) ?? 0;
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}

/** True when `latest` is a strictly newer release than `current`. */
export function isNewer(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}

export interface ReleaseCheckerOptions {
  /** `owner/repo` on GitHub. */
  repo: string;
  /** Cache TTL in ms after a successful check (avoids hitting the API on every request). */
  ttlMs?: number;
  /** Shorter back-off in ms after a failed check (so a startup-time outage clears quickly). */
  retryMs?: number;
  /** Request timeout in ms. */
  timeoutMs?: number;
  /** Injectable fetch (defaults to global fetch) — overridden in tests. */
  fetchImpl?: typeof fetch;
  /** Injectable clock (ms) for deterministic cache tests. */
  now?: () => number;
}

/**
 * Returns a cached, timeout-guarded, failure-tolerant provider of the latest
 * release tag. Network/parse failures resolve to `null` (no banner) rather than
 * throwing, so a release-feed outage never breaks the app.
 */
export function createReleaseChecker(
  options: ReleaseCheckerOptions,
): () => Promise<string | null> {
  const ttlMs = options.ttlMs ?? 6 * 60 * 60 * 1000; // 6h after success
  const retryMs = options.retryMs ?? 5 * 60 * 1000; // 5min after failure
  const timeoutMs = options.timeoutMs ?? 5_000;
  const doFetch = options.fetchImpl ?? fetch;
  const clock = options.now ?? Date.now;
  const url = `https://api.github.com/repos/${options.repo}/releases/latest`;

  let cached: string | null = null;
  let succeededAt = -Infinity;
  let failedAt = -Infinity;
  let inFlight: Promise<string | null> | null = null;

  async function refresh(): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'sitewright' },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { tag_name?: unknown };
      return typeof body.tag_name === 'string' && body.tag_name.length > 0 ? body.tag_name : null;
    } catch {
      return null; // network error / timeout / bad JSON — degrade silently
    } finally {
      clearTimeout(timer);
    }
  }

  return async function latest(): Promise<string | null> {
    const elapsedSince = clock() - Math.max(succeededAt, failedAt);
    const window = succeededAt >= failedAt ? ttlMs : retryMs;
    if (elapsedSince < window) return cached; // within the current cache/back-off window
    if (inFlight) return inFlight; // dedupe concurrent callers onto one request
    inFlight = refresh().then((tag) => {
      if (tag !== null) {
        cached = tag;
        succeededAt = clock();
      } else {
        // Keep any previously-known value; just back off briefly before retrying.
        failedAt = clock();
      }
      inFlight = null;
      return cached;
    });
    return inFlight;
  };
}
