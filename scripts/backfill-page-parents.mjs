#!/usr/bin/env node
/**
 * BACKFILL: give every page a parent, over the ADMIN HTTP API.
 *
 * Pages written before the tree invariant existed can have no `parent` at all. They render as second
 * roots: flush in the pages list, in their own drag group, never foldable into a parent's nav dropdown.
 * This walks every project a platform admin can see and sets the parent the invariant would have.
 *
 * ★ OVER THE API, NOT THE DATABASE. The instance is live. Writing rows directly would bypass schema
 * validation, the revision log and the project event bus — editors with the project open would keep
 * rendering a tree the database no longer agrees with. Every write here is the same `PUT …?merge=1`
 * the editor itself issues.
 *
 * ★ A URL CAN MOVE. A page in a non-default locale is parented to THAT LANGUAGE'S home, so it lands in
 * its own subtree — and inherits the home's slug: `/leistungen` becomes `/de/leistungen`. That is the
 * intended shape, but it is a live URL change, so every one is listed in the report (and counted
 * separately) for redirects. Default-locale pages never move: the root home's slug is empty.
 *
 * DRY RUN BY DEFAULT — nothing is written without `--apply`.
 *
 *   node scripts/backfill-page-parents.mjs --base https://sw.example.com --email admin@example.com
 *   node scripts/backfill-page-parents.mjs --base … --email … --apply --json report.json
 *
 * ★ THE PASSWORD NEVER GOES IN ARGV. There is deliberately no `--password` flag: a command line is
 * readable by every other user on the host (`ps`, /proc) and lands in shell history. Set
 * SW_ADMIN_PASSWORD, or let the script prompt (input is not echoed). A TOTP code goes in `--totp`
 * (or SW_ADMIN_TOTP) when the admin has MFA on.
 */
import { writeFile } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Page-tree resolution — INLINED from @sitewright/core on purpose
// ---------------------------------------------------------------------------
//
// This script has to run from a bare checkout (`node scripts/backfill-page-parents.mjs …`) and from a
// deployed container, neither of which can resolve a workspace package from `scripts/`: pnpm links
// dependencies per PACKAGE, and the repo root declares none. Adding one to the root looked like the
// tidy fix and was not — it re-resolved `@sitewright/blocks` from a workspace link to a store path and
// left the editor build with a dangling symlink. So the ~40 lines it needed live here instead, and the
// script imports nothing outside Node.
//
// The obvious hazard of a copy is DRIFT: a backfill that computes different parents from the API would
// quietly write the wrong tree across every project. `apps/api/test/backfill-script-parity.test.ts`
// imports both this file and `@sitewright/core` and asserts they agree, so the copy cannot diverge
// without a red test. Keep the two in step — mirror of `packages/core/src/page-parent.ts`,
// `routes.ts` and the `localeOf`/`localeHomeFor` pair in `i18n.ts`.

/** `kind: 'link'` is a nav PLACEHOLDER — it has no route of its own. */
const isLinkPage = (page) => page.kind === 'link';

/** A page's locale; the default-locale pages carry no explicit `locale`. */
const localeOf = (page, defaultLocale) => page.locale ?? defaultLocale;

/** Index pages by id, for the parent-chain walks below. */
export function pagesById(pages) {
  return new Map(pages.map((p) => [p.id, p]));
}

/**
 * The full root-relative route, from the PARENT CHAIN: `{ancestor slugs}/{own slug}`. Each `path` is a
 * single slug SEGMENT, and the home page's is empty — which is why parenting to home moves no URL.
 * Cycle-safe: a broken chain stops at the first repeated id.
 */
export function pagePath(page, byId) {
  const segments = [];
  const seen = new Set();
  let cur = page;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.path) segments.unshift(cur.path);
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return '/' + segments.join('/');
}

/** The site's root home: the empty-slug page in the default locale (a placeholder is not one). */
function rootHomeOf(pages, defaultLocale) {
  return pages.find((p) => p.path === '' && !isLinkPage(p) && localeOf(p, defaultLocale) === defaultLocale);
}

/** The home page of one language — the root of that language's subtree. */
function localeHomeFor(pages, locale, defaultLocale) {
  const home = pages.find((p) => p.path === '' && !isLinkPage(p) && localeOf(p, defaultLocale) === defaultLocale);
  if (!home) return undefined;
  const group = home.translationGroup ?? home.id;
  return pages.find((p) => (p.translationGroup ?? p.id) === group && localeOf(p, defaultLocale) === locale);
}

/** Does `candidate` sit anywhere under `pageId`? Keeps a repair from closing a cycle. */
function descendsFrom(candidate, pageId, byId) {
  const seen = new Set();
  let cur = candidate;
  while (cur && !seen.has(cur.id)) {
    if (cur.id === pageId) return true;
    seen.add(cur.id);
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return false;
}

/** The parent a page should hang off when it has none: its own language's home, else the root home. */
export function defaultParentFor(page, pages, defaultLocale) {
  const root = rootHomeOf(pages, defaultLocale);
  if (!root || root.id === page.id) return undefined;
  const locale = localeOf(page, defaultLocale);
  const localeHome = locale === defaultLocale ? undefined : localeHomeFor(pages, locale, defaultLocale);
  const target = localeHome && localeHome.id !== page.id ? localeHome : root;
  const byId = new Map(pages.map((p) => [p.id, p]));
  if (descendsFrom(target, page.id, byId)) return undefined;
  return target.id;
}

/** Whether `page.parent` fails the invariant. A cycle passes an existence check while being rootless. */
function parentIsBroken(page, pages, repairDangling) {
  if (page.parent === undefined) return true;
  if (page.parent === page.id) return true;
  if (!repairDangling) return false;
  const byId = new Map(pages.map((p) => [p.id, p]));
  const parent = byId.get(page.parent);
  if (!parent) return true;
  return descendsFrom(parent, page.id, byId);
}

/** `page` with the invariant applied — returned unchanged (by identity) when it already satisfies it. */
export function withResolvedParent(page, pages, defaultLocale, opts = {}) {
  if (!parentIsBroken(page, pages, opts.repairDangling === true)) return page;
  const parent = defaultParentFor(page, pages, defaultLocale);
  if (parent === undefined || parent === page.parent) return page;
  return { ...page, parent };
}


// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { apply: false, project: null, json: null, writesPerMinute: 45, insecure: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[(i += 1)];
    if (a === '--base') args.base = next();
    else if (a === '--email') args.email = next();
    else if (a === '--totp') args.totp = next();
    else if (a === '--project') args.project = next();
    else if (a === '--json') args.json = next();
    else if (a === '--writes-per-minute') args.writesPerMinute = Number(next());
    else if (a === '--apply') args.apply = true;
    else if (a === '--insecure') args.insecure = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument "${a}" (try --help)`);
  }
  return args;
}

const USAGE = `
Backfill page parents across every project, over the admin API.

  --base <url>              instance base URL (required), e.g. https://sw.example.com
  --email <address>         platform-admin email (required)
  --totp <code>             TOTP code, when the admin has MFA enabled (else SW_ADMIN_TOTP)
  --project <slug>          limit the run to one project
  --apply                   actually write; omit for a dry run
  --json <file>             also write the full report as JSON (mode 0600)
  --writes-per-minute <n>   throttle (default 45; the API allows 60/min per client)
  --insecure                permit a plain-http --base (loopback testing only)

The password comes from SW_ADMIN_PASSWORD or an unechoed prompt — never from a flag.
`.trimStart();

/** Read a secret from the terminal without echoing it. */
async function promptSecret(label) {
  if (!stdin.isTTY) throw new Error('no TTY to prompt on — set SW_ADMIN_PASSWORD instead');
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  try {
    let buf = '';
    for await (const chunk of stdin) {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') { stdout.write('\n'); return buf; }
        if (ch === '\u0003') { stdout.write('\n'); throw new Error('cancelled'); }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else buf += ch;
      }
    }
    return buf;
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** A cookie jar of exactly the size this needs: whatever the login response set. */
let cookie = '';

function rememberCookies(res) {
  const set = res.headers.getSetCookie?.() ?? [];
  const pairs = set.map((c) => c.split(';', 1)[0]).filter(Boolean);
  if (pairs.length > 0) cookie = pairs.join('; ');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Cap on an honoured `Retry-After`, so a misbehaving server cannot stall the run indefinitely. */
const MAX_RETRY_AFTER_S = 120;

/**
 * Resolve a request path against the base URL, KEEPING any path prefix the base carries.
 * `new URL('/projects', 'https://host/instance-a')` resolves to `https://host/projects` — the prefix
 * silently dropped, and the admin's credentials sent to whatever else is mounted at the domain root.
 */
function endpoint(base, path) {
  const root = base.endsWith('/') ? base : `${base}/`;
  return new URL(path.replace(/^\//, ''), root);
}

/**
 * One API call. Retries a 429 by the `Retry-After` the server names — the write routes allow 60/min
 * per client and a large instance will brush that ceiling even while throttled.
 *
 * `redirect: 'manual'`: this replays a session cookie on every request, and `fetch` would otherwise
 * follow a 3xx anywhere — a canonicalisation hop, a proxy misconfiguration, an open redirect — handing
 * the admin's session to that destination. A redirect here means a misconfigured `--base`, so say so.
 */
async function api(base, path, init = {}, attempt = 0) {
  const res = await fetch(endpoint(base, path), {
    ...init,
    redirect: 'manual',
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...init.headers,
    },
  });
  if (res.status >= 300 && res.status < 400) {
    throw Object.assign(
      new Error(`${path} redirected to ${res.headers.get('location') ?? '(no location)'} — check --base; the session was NOT followed through`),
      { status: res.status },
    );
  }
  rememberCookies(res);
  if (res.status === 429 && attempt < 5) {
    const wait = Math.min(Number(res.headers.get('retry-after')) || 5, MAX_RETRY_AFTER_S);
    process.stderr.write(`  rate-limited; waiting ${wait}s\n`);
    await sleep(wait * 1000);
    return api(base, path, init, attempt + 1);
  }
  if (!res.ok) {
    // The body goes to the OPERATOR's terminal, never into the report file: an API error can echo the
    // submitted fragment or other entity detail, and the report is written to disk and passed around.
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`${init.method ?? 'GET'} ${path} → ${res.status}`), {
      status: res.status,
      detail: body.slice(0, 300),
    });
  }
  return res.status === 204 ? null : res.json();
}

async function login(base, email, password, totp) {
  const first = await api(base, '/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!first?.mfaRequired) return;
  const code = totp ?? process.env.SW_ADMIN_TOTP;
  if (!code) throw new Error('this account has MFA enabled — pass --totp <code>');
  await api(base, '/auth/login/totp', { method: 'POST', body: JSON.stringify({ ticket: first.ticket, code }) });
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/** Every page that needs a parent, with the route it has now and the route it will have. */
export function planProject(pages, defaultLocale) {
  // Resolve against the WHOLE set at once: a locale home must itself be parented before the pages that
  // will hang off it are costed, or their "after" route would miss the language segment.
  const resolved = pages.map((p) => withResolvedParent(p, pages, defaultLocale, { repairDangling: true }));
  const before = pagesById(pages);
  const after = pagesById(resolved);
  const changes = [];
  for (const [i, next] of resolved.entries()) {
    const prev = pages[i];
    if (next.parent === prev.parent) continue;
    const urlBefore = pagePath(prev, before);
    const urlAfter = pagePath(next, after);
    changes.push({
      id: next.id,
      title: next.title,
      locale: next.locale ?? defaultLocale,
      from: prev.parent ?? null,
      to: next.parent,
      urlBefore,
      urlAfter,
      urlMoved: urlBefore !== urlAfter,
    });
  }
  return changes;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return void stdout.write(USAGE);
  if (!args.base || !args.email) throw new Error('--base and --email are required (try --help)');

  // The login below sends the admin password and then replays a session cookie on every request. Over
  // plain http both are readable on the wire, and the server does not mark the cookie `Secure` unless
  // it knows it is on https — so neither side fails safe. `--insecure` is for a loopback test only.
  const scheme = new URL(args.base).protocol;
  if (scheme !== 'https:' && !args.insecure) {
    throw new Error(`--base is ${scheme}// — the admin password and session cookie would cross the network in cleartext. Use https, or pass --insecure for a loopback test.`);
  }

  const password = process.env.SW_ADMIN_PASSWORD ?? (await promptSecret(`Password for ${args.email}: `));
  if (!password) throw new Error('no password given');

  await login(args.base, args.email, password, args.totp);
  const { projects } = await api(args.base, '/projects');
  const targets = args.project ? projects.filter((p) => p.slug === args.project) : projects;
  if (targets.length === 0) throw new Error(args.project ? `no project with slug "${args.project}"` : 'no projects visible to this account');

  stdout.write(`${args.apply ? 'APPLYING' : 'DRY RUN'} across ${targets.length} project(s) at ${args.base}\n\n`);

  const report = { base: args.base, applied: args.apply, projects: [] };
  const writeGapMs = Math.ceil(60_000 / Math.max(1, args.writesPerMinute));

  for (const project of targets) {
    const pid = encodeURIComponent(project.id);
    // One project's READ failure must not end the run. `api()` retries a 429, but a 503 from the
    // instance's list-memory admission gate is not retried — and thrown from here it would abort every
    // project still queued AND lose the report for the ones already written. The pass is idempotent, so
    // recording the project as failed and moving on leaves a re-run with exactly this project to do.
    try {
      // `?summary=1` drops each page's `source` and `data` — a full list of a big site is megabytes and
      // can trip the instance's list-memory admission gate. Every field the plan reads (path, parent,
      // locale, translationGroup, kind) is kept verbatim, and the write below sends only `{id, parent}`,
      // so a summarised page is never written back over a real one.
      const pages = (await api(args.base, `/projects/${pid}/content/page?summary=1`)).items ?? [];
      const settings = await api(args.base, `/projects/${pid}/content/settings/settings`).catch(() => null);
      const defaultLocale = settings?.item?.settings?.defaultLocale ?? 'en';
      const changes = planProject(pages, defaultLocale);
      const moved = changes.filter((c) => c.urlMoved);

      stdout.write(`${project.slug} — ${pages.length} page(s), ${changes.length} to re-parent`);
      stdout.write(moved.length > 0 ? `, ${moved.length} URL change(s)\n` : '\n');
      for (const c of changes) {
        const arrow = c.urlMoved ? `  ${c.urlBefore} → ${c.urlAfter}  ⚠ URL CHANGE` : `  ${c.urlBefore}`;
        stdout.write(`    ${c.id} (${c.locale}) → parent ${c.to}${arrow}\n`);
      }

      const failures = [];
      if (args.apply) {
        for (const c of changes) {
          try {
            // `?merge=1` PATCHES: the fragment carries only `parent`, so nothing else on the page —
            // source, data.swImport, order, status — is touched. A full PUT would replace the row.
            await api(args.base, `/projects/${pid}/content/page/${encodeURIComponent(c.id)}?merge=1`, {
              method: 'PUT',
              body: JSON.stringify({ id: c.id, parent: c.to }),
            });
          } catch (err) {
            // Status only in the report — see `api()`: a response body can carry content detail.
            failures.push({ id: c.id, status: err.status ?? null });
            process.stderr.write(`    ! ${c.id}: ${err.message}${err.detail ? ` — ${err.detail}` : ''}\n`);
          }
          await sleep(writeGapMs);
        }
      }
      report.projects.push({ slug: project.slug, name: project.name, pages: pages.length, changes, failures });
    } catch (err) {
      process.stderr.write(`${project.slug}: SKIPPED — ${err.message}${err.detail ? ` — ${err.detail}` : ''}\n`);
      report.projects.push({
        slug: project.slug,
        name: project.name,
        pages: 0,
        changes: [],
        failures: [{ id: null, status: err.status ?? null, phase: 'read' }],
      });
    }
  }

  const all = report.projects.flatMap((p) => p.changes);
  const failed = report.projects.flatMap((p) => p.failures);
  report.totals = {
    projects: targets.length,
    reparented: all.length,
    urlChanges: all.filter((c) => c.urlMoved).length,
    failures: failed.length,
  };

  stdout.write(`\n${args.apply ? 'Applied' : 'Would re-parent'}: ${report.totals.reparented} page(s) across ${report.totals.projects} project(s)\n`);
  stdout.write(`URL changes${args.apply ? '' : ' that would result'}: ${report.totals.urlChanges}\n`);
  if (failed.length > 0) stdout.write(`FAILURES: ${failed.length}\n`);
  if (!args.apply && report.totals.reparented > 0) stdout.write(`\nRe-run with --apply to write.\n`);
  if (args.json) {
    // Owner-only: the report names every project on the instance and its page structure.
    await writeFile(args.json, JSON.stringify(report, null, 2), { mode: 0o600 });
    stdout.write(`Report written to ${args.json}\n`);
  }
  if (failed.length > 0) process.exitCode = 1;
}

// Only run the CLI when this file IS the entry point — importing it (the parity test does) must not
// start talking to an instance.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  });
}
