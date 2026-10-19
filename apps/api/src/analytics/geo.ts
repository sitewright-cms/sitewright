import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import { Reader, type Response } from 'mmdb-lib';

/**
 * IP address → country, for the built-in statistics.
 *
 * The bundled database is DB-IP's free "IP to Country Lite" (CC BY 4.0 — the Statistics tab carries the
 * attribution link the licence requires). Any MaxMind-format country database can replace it through
 * `SW_GEOIP_DB` — a fresher DB-IP download, or MaxMind's own GeoLite2-Country for an operator who holds a
 * licence key; both record shapes are read.
 *
 * ★ The reader holds the whole file in memory (~8 MB, ~16 MB RSS), so it is loaded LAZILY, on the first lookup
 * — an instance whose sites never switch statistics on never pays for it. A file that is missing or unreadable
 * disables country lookups (every visit counts as unknown) rather than failing the collector.
 */
export interface GeoLookup {
  /** The ISO 3166-1 alpha-2 country of `ip`, or null when unknown. */
  country(ip: string): string | null;
}

type CountryRecord = { country_code?: unknown; country?: { iso_code?: unknown } };

const COUNTRY_RE = /^[A-Z]{2}$/;

/** Where the bundled database lives (resolved through the package, so it follows `pnpm deploy`). */
export function bundledGeoDbPath(): string {
  return createRequire(import.meta.url).resolve('@ip-location-db/dbip-country-mmdb/dbip-country.mmdb');
}

/**
 * A lazily-loaded lookup over the MMDB file at `path`. `load()` starts reading it; lookups made before it has
 * finished answer null. `onError` hears about a database that could not be read, once.
 */
export function createGeoLookup(path: string, onError?: (err: unknown) => void): GeoLookup & { load(): Promise<void> } {
  let reader: Reader<Response> | null = null;
  let loading: Promise<void> | null = null;
  const load = (): Promise<void> => {
    loading ??= (async () => {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator config / bundled package path
        reader = new Reader<Response>(await readFile(path));
      } catch (err) {
        onError?.(err);
      }
    })();
    return loading;
  };
  return {
    load,
    country(ip: string): string | null {
      if (!reader) {
        void load();
        return null;
      }
      // An IPv4-mapped IPv6 address (`::ffff:1.2.3.4`, what a dual-stack socket reports) looks up as IPv4.
      const addr = ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
      if (!isIP(addr)) return null;
      let rec: CountryRecord | null = null;
      try {
        // Two record shapes: ip-location-db's flat `country_code`, and MaxMind's / DB-IP's `country.iso_code`.
        rec = reader.get(addr) as unknown as CountryRecord | null;
      } catch {
        return null;
      }
      const code = rec?.country_code ?? rec?.country?.iso_code;
      return typeof code === 'string' && COUNTRY_RE.test(code) ? code : null;
    },
  };
}
