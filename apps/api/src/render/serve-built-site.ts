import { createServer, type Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { createGzip } from 'node:zlib';
import type { AddressInfo } from 'node:net';

/**
 * A minimal loopback static server for an already-built site directory, used to give a headless
 * browser (Lighthouse, screenshots) a REAL navigation over HTTP. Its cache headers deliberately
 * mirror the production deploy so a page-speed audit is representative rather than penalised by a
 * naive server: content-addressed assets are served long-cache + immutable, HTML is no-cache
 * (see the deploy's cache policy — published assets carry a `?v=` cache-bust + immutable, pages and
 * the shell are no-cache). Bind to loopback only; the caller is responsible for `close()`.
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';

/**
 * Text content-types worth gzipping. Mirrors what a real production host (nginx/CDN) compresses — so a
 * page-speed audit against this loopback is representative of a compressing deploy, not penalised by a
 * naive uncompressed server. Binary types (images / fonts / pdf) are already compressed → skipped.
 */
const COMPRESSIBLE = new Set([
  'text/html',
  'text/css',
  'text/javascript',
  'application/json',
  'image/svg+xml',
  'application/xml',
  'text/plain',
]);
function isCompressible(contentType: string): boolean {
  return COMPRESSIBLE.has(contentType.split(';')[0]!.trim());
}
function acceptsGzip(header: string | string[] | undefined): boolean {
  const h = Array.isArray(header) ? header.join(',') : (header ?? '');
  return /\bgzip\b/.test(h);
}

/**
 * Cache-control mirrors the real deploy EXACTLY: only a URL carrying the per-publish `?v=` cache-bust
 * token is `immutable`; every unversioned hit (HTML pages, and unversioned static files like
 * favicon.ico / robots.txt / sitemap.xml) revalidates. Keying on the version token — rather than on the
 * file extension — is what keeps Lighthouse's "efficient cache policy" audit representative instead of
 * flattering. (`build.ts` appends `?v=` to the compiled stylesheet + runtime script + hashed assets.)
 */
function cacheControlFor(rawUrl: string): string {
  return /[?&]v=/.test(rawUrl) ? IMMUTABLE : NO_CACHE;
}

export interface ServedSite {
  /** Base URL with a trailing slash, e.g. `http://127.0.0.1:54321/`. */
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Serve `root` on an ephemeral loopback port. `GET /` and any directory resolve to `index.html`.
 * Paths are confined to `root` (no traversal), query strings are ignored for file resolution.
 */
export async function serveBuiltSite(root: string, host = '127.0.0.1'): Promise<ServedSite> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        const rawUrl = req.url ?? '/';
        const rawPath = decodeURIComponent(rawUrl.split('?')[0] ?? '/');
        // Strip any `..` segments before joining so the served file can never escape `root`.
        let rel = normalize(rawPath).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
        if (rel === '' || rawPath.endsWith('/')) rel = join(rel, 'index.html');
        let file = join(root, rel);
        let s = await stat(file).catch(() => null);
        if (s?.isDirectory()) {
          file = join(file, 'index.html');
          s = await stat(file).catch(() => null);
        }
        if (!s?.isFile()) {
          res.statusCode = 404;
          res.setHeader('cache-control', NO_CACHE);
          res.end('not found');
          return;
        }
        const contentType = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
        res.setHeader('content-type', contentType);
        res.setHeader('cache-control', cacheControlFor(rawUrl));
        const stream = createReadStream(file);
        // A file made unreadable after stat() (TOCTOU on the temp dir) must not crash the process.
        stream.on('error', () => {
          if (!res.headersSent) res.statusCode = 500;
          res.end();
        });
        // Gzip text responses (like a real host) so the audit sees representative transfer sizes; the
        // gzipped length is unknown up front, so drop content-length and stream through zlib. Binary
        // assets keep their exact content-length and are served verbatim.
        if (isCompressible(contentType) && acceptsGzip(req.headers['accept-encoding'])) {
          res.setHeader('content-encoding', 'gzip');
          res.setHeader('vary', 'Accept-Encoding');
          const gz = createGzip();
          gz.on('error', () => {
            if (!res.headersSent) res.statusCode = 500;
            res.end();
          });
          stream.pipe(gz).pipe(res);
        } else {
          res.setHeader('content-length', s.size);
          stream.pipe(res);
        }
      } catch {
        if (!res.headersSent) res.statusCode = 500;
        res.end('error');
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://${host}:${port}/`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
