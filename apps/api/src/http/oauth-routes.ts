import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db/client.js';
import { OAuthError, OAuthRepository, type Grant } from '../repo/oauth.js';
import { isValidS256Challenge } from '../auth/pkce.js';
import { API_KEY_CAPABILITIES, type ApiKeyCapability } from '../db/schema.js';
import { listProjectAccessForUser, resolveProjectRole } from '../repo/accounts.js';
import type { ProjectRepository } from '../repo/projects.js';
import { OAuthClientError, isLoopbackHttp, type OAuthClientRepository } from '../repo/oauth-clients.js';
import { ForbiddenError, NotFoundError } from '../repo/context.js';
import {
  isSafeCssTokenValue,
  DEFAULT_PLATFORM_NAME,
  DEFAULT_BRAND_PRIMARY,
  DEFAULT_BRAND_SECONDARY,
  type PlatformBackground,
} from '@sitewright/schema';
import { SHADER_BG_CSS, SHADER_BG_JS } from '@sitewright/blocks';
import { CONSENT_SCRIPT } from './consent-script.js';
import { AUTH_CODE_TTL_MS } from '../repo/oauth.js';

/** The built-in public client for the `sitewright` CLI (loopback redirect, PKCE, no secret). */
export const CLI_CLIENT_ID = 'sitewright-cli';

export interface OAuthDeps {
  db: Database;
  oauth: OAuthRepository;
  clients: OAuthClientRepository;
  projects: ProjectRepository;
  /** Resolves the session user id, or null when unauthenticated. */
  currentUserId: (req: FastifyRequest) => Promise<string | null>;
  /** Supplies the admin-configurable agent-session (refresh) cap applied to newly-issued tokens. */
  instanceSettings: {
    getAgentSessionMs(): Promise<number>;
    /** The admin's branding + animated background, so the consent screen looks like the platform. */
    getChrome(): Promise<ConsentChrome>;
  };
  /** The instance's public origin (`SW_PUBLIC_URL`). When set, it is the OAuth issuer / `resource`
   *  regardless of proxy headers — the fix for `http://` metadata behind a TLS-terminating proxy. */
  publicUrl?: string;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

/** The display name + redirect validator for a resolved client (CLI or registered). */
interface ResolvedClient {
  name: string;
  allowsRedirect: (uri: string) => boolean;
}

type AuthorizeQuery = {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  state?: string;
};

/** Escapes a string for safe interpolation into the (same-origin) consent HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The public origin the browser reaches us on — used to build the OAuth/MCP discovery metadata,
// authorize/token URLs, and the `resource` identifier. Prefer the operator-configured public URL
// (`SW_PUBLIC_URL`): it is deterministic and correct behind a TLS-terminating reverse proxy that the
// app otherwise can't see through. Fall back to the request, where `req.protocol`/`Host` only reflect
// the real browser origin when trustProxy is enabled — otherwise a proxied HTTPS request looks like
// `http://…` here, and MCP/OAuth clients reject the resulting `http://` metadata (set SW_PUBLIC_URL or
// TRUST_PROXY). The security boundary is the loopback/exact redirect allowlist, not this URL.
export function issuerOf(req: FastifyRequest, publicUrl?: string): string {
  if (publicUrl) return publicUrl.replace(/\/$/, '');
  const host = req.headers.host ?? 'localhost';
  return `${req.protocol}://${host}`;
}


/** Granted scope = the requested capabilities ∩ the known set (canonical order). */
function parseScope(raw: string | undefined): ApiKeyCapability[] {
  const requested = (raw ?? '').split(/\s+/).filter(Boolean);
  return API_KEY_CAPABILITIES.filter((c) => requested.includes(c));
}

/** The scope to PRE-SELECT on the consent page: the client's requested capabilities if it named any
 *  known ones, else ALL capabilities. A generic MCP/OAuth client (e.g. Claude Code) commonly requests
 *  no Sitewright-specific scope — rather than dead-end at `invalid_scope`, we present everything
 *  pre-checked and let the user UNCHECK what they don't want to grant. */
function resolveScope(raw: string | undefined): ApiKeyCapability[] {
  const parsed = parseScope(raw);
  return parsed.length > 0 ? parsed : [...API_KEY_CAPABILITIES];
}

/** Capabilities CHECKED on the consent form, in canonical order. Each capability is its OWN checkbox
 *  field (`scope_<cap>`) rather than a repeated `scope` field: the app's flat urlencoded parser is
 *  last-value-wins on repeated keys, so distinct field names are what let every checked box survive.
 *  Presence of the field (checkbox on) = granted. */
function selectedScope(body: Record<string, unknown>): ApiKeyCapability[] {
  return API_KEY_CAPABILITIES.filter((c) => body[`scope_${c}`] != null);
}

/** Capabilities whose grant is destructive or externally visible — flagged on the consent page so a
 *  quick "Approve" doesn't hand them over unnoticed. They are still pre-checked (per the all-caps
 *  default); the user can uncheck them. */
const ELEVATED_SCOPES: readonly ApiKeyCapability[] = ['content:delete', 'deploy'];

/** Renders the editable per-capability checkboxes for a consent form; `selected` are pre-checked. */
function scopeCheckboxes(selected: readonly ApiKeyCapability[]): string {
  return API_KEY_CAPABILITIES.map((c) => {
    const warn = ELEVATED_SCOPES.includes(c) ? ' <span class="scope-warn">elevated</span>' : '';
    return `<label class="scope-opt"><input type="checkbox" name="scope_${escapeHtml(c)}" value="1"${
      selected.includes(c) ? ' checked' : ''
    }> <code>${escapeHtml(c)}</code>${warn}</label>`;
  }).join('');
}

/**
 * A CSS custom-property value taken from admin settings. `CssColorSchema` already constrains the
 * stored brand colors, but this shell writes them into a `<style>` block, so the value is re-checked
 * against the SAME allowlist the rest of the platform uses for CSS sinks rather than trusted because
 * of where it came from. A rejected value falls back to the built-in default — the page always
 * renders, it just isn't branded. See `isSafeCssTokenValue`.
 */
function cssColor(value: string, fallback: string): string {
  return isSafeCssTokenValue(value) ? value : fallback;
}

/** The consent surface's chrome: the admin's branding plus (optionally) the animated background. */
export interface ConsentChrome {
  name: string;
  primary: string;
  secondary: string;
  logoUrl: string | null;
  background: PlatformBackground | null;
}

/** The built-in look, used when settings can't be read (the page must still render). */
export const DEFAULT_CONSENT_CHROME: ConsentChrome = {
  name: DEFAULT_PLATFORM_NAME,
  primary: DEFAULT_BRAND_PRIMARY,
  secondary: DEFAULT_BRAND_SECONDARY,
  logoUrl: null,
  background: null,
};

/**
 * The host element for the platform's animated background, or '' when none is configured.
 *
 * Reuses the SAME `data-sw-component="shader-bg"` runtime published sites use (served here by
 * `/oauth/consent.js`) rather than a second copy of the shader engine — the preset key, angle and
 * palette slots are the admin's stored values, passed as the runtime's own declarative `data-*`
 * knobs. Until the runtime enhances it (and forever, without JS or WebGL) its `::before` paints the
 * brand gradient, so the surface is never blank.
 */
function backgroundHost(bg: PlatformBackground | null): string {
  if (!bg) return '';
  // preset/angle/colors are schema-constrained (a lowercase key, an int, hex-or-token slots) and are
  // additionally escaped here — this is an HTML attribute sink.
  return (
    `<div class="sw-bg" aria-hidden="true" data-sw-component="shader-bg" data-preset="${escapeHtml(bg.preset)}" ` +
    `data-angle="${escapeHtml(String(bg.angle))}" data-colors="${escapeHtml(bg.colors.join(','))}"></div>`
  );
}

/**
 * The consent surface's document shell. Server-rendered (no SPA, no Tailwind at this point in the
 * flow), so the platform's look is reproduced with self-contained CSS: the brand gradient mark, a
 * frosted card on a tinted field, and the same slate type scale + rounded geometry as the editor.
 * Light AND dark, keyed off the viewer's system setting like every other platform surface.
 *
 * The brand stops, platform name, logo and animated background all come from INSTANCE SETTINGS — the
 * same values the editor and login screen use — so a white-labelled instance doesn't drop back to
 * stock indigo the moment an agent asks for authorization.
 *
 * `script` opts into `/oauth/consent.js` (project search + copy-to-clipboard + the shader runtime).
 * It is loaded only by the pages that need it, and every one of them works without it.
 */
function htmlPage(title: string, body: string, chrome: ConsentChrome = DEFAULT_CONSENT_CHROME, opts?: { script?: boolean }): string {
  const primary = cssColor(chrome.primary, DEFAULT_BRAND_PRIMARY);
  const secondary = cssColor(chrome.secondary, DEFAULT_BRAND_SECONDARY);
  const mark = chrome.logoUrl
    ? `<img class="mark logo" src="${escapeHtml(chrome.logoUrl)}" alt="">`
    : '<span class="mark"></span>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
    :root{
      --sw-brand-1:${primary}; --sw-brand-2:${secondary};
      /* The shader runtime resolves palette slots named as CI tokens through these; hex slots and the
         auto slot don't need them, but a token-named slot would otherwise fall back to stock colors. */
      --sw-color-primary:${primary}; --sw-color-secondary:${secondary}; --sw-color-neutral:#1f2937; --sw-color-base-100:#f8fafc;
      --bg:#f1f5f9; --panel:rgba(255,255,255,.82); --line:#e2e8f0; --ink:#0f172a; --muted:#64748b;
      --field:#fff; --field-line:#cbd5e1; --row:rgba(255,255,255,.7); --row-line:#e2e8f0;
    }
    @media (prefers-color-scheme:dark){
      :root{--bg:#0b1120;--panel:rgba(15,23,42,.82);--line:rgba(255,255,255,.1);--ink:#e2e8f0;--muted:#94a3b8;
            --field:rgba(15,23,42,.6);--field-line:rgba(255,255,255,.14);--row:rgba(30,41,59,.6);--row-line:rgba(255,255,255,.08);
            --sw-color-base-100:#0b1120}
    }
    *{box-sizing:border-box}
    /* align-items:center CLIPS a panel taller than the viewport at BOTH ends, with nothing to scroll
       to — a long project list plus the permissions fieldset reaches that on a laptop screen, and the
       Approve button is what disappears. flex-start + margin:auto on the shell centres it when there
       is room and simply scrolls when there is not. */
    body{margin:0;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:2rem 1.25rem;
      font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);
      background:radial-gradient(1200px 600px at 50% -10%,color-mix(in srgb,var(--sw-brand-1) 14%,transparent),transparent),var(--bg)}
    /* The admin's animated background, behind everything. Fixed + full-viewport beats the runtime's
       zero-specificity position:relative default. */
    .sw-bg{position:fixed;inset:0;z-index:-1;pointer-events:none}
    /* ★ With a background behind it, the heading and intro can no longer sit on bare page: the admin
       picks the palette, so text contrast is not ours to predict — the auto slot alone ranges from
       near-white to near-black. Rather than guess a text colour, the whole shell becomes ONE frosted
       panel (the platform's existing card language), and the inner card drops its own chrome so it
       doesn't read as a panel inside a panel. Legible over any palette the admin can choose. */
    body.has-bg .shell{border:1px solid var(--line);border-radius:1.25rem;background:var(--panel);
      backdrop-filter:blur(16px);box-shadow:0 24px 60px rgba(15,23,42,.18);padding:1.35rem 1.4rem}
    body.has-bg .card{margin-top:.9rem;padding:0;border:0;background:none;backdrop-filter:none;box-shadow:none}
    ${SHADER_BG_CSS}
    .shell{width:100%;max-width:34rem;margin:auto}
    .brand{display:flex;align-items:center;gap:.6rem;margin-bottom:1rem;font-weight:700;letter-spacing:-.01em}
    .mark{width:1.9rem;height:1.9rem;border-radius:.6rem;background:linear-gradient(135deg,var(--sw-brand-1),var(--sw-brand-2));
      box-shadow:0 6px 18px color-mix(in srgb,var(--sw-brand-1) 35%,transparent)}
    .mark.logo{object-fit:contain;background:none;box-shadow:none}
    h1{font-size:1.2rem;line-height:1.35;margin:0 0 .35rem;letter-spacing:-.01em}
    h1 strong{background:linear-gradient(135deg,var(--sw-brand-1),var(--sw-brand-2));-webkit-background-clip:text;background-clip:text;color:transparent}
    p{margin:.35rem 0;color:var(--muted);font-size:.9rem}
    .card{margin-top:1rem;padding:1.35rem;border:1px solid var(--line);border-radius:1rem;background:var(--panel);
      backdrop-filter:blur(14px);box-shadow:0 18px 45px rgba(15,23,42,.10)}
    .lbl{display:block;font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 .5rem}
    input[type=search],input[type=text]{width:100%;font:inherit;padding:.5rem .7rem;border-radius:.6rem;border:1px solid var(--field-line);
      background:var(--field);color:var(--ink)}
    input[type=search]:focus,input[type=text]:focus{outline:2px solid color-mix(in srgb,var(--sw-brand-1) 55%,transparent);outline-offset:1px}
    .search{margin:0 0 .5rem}
    /* Project picker — the card-row list from the editor's project selector, as radios. */
    .projects{display:flex;flex-direction:column;gap:.5rem;max-height:15rem;overflow:auto;margin:0;padding:0;border:0}
    .project{display:flex;align-items:center;gap:.7rem;padding:.7rem .85rem;border:1px solid var(--row-line);border-radius:.85rem;
      background:var(--row);cursor:pointer;transition:border-color .15s,background .15s}
    .project:hover{border-color:color-mix(in srgb,var(--sw-brand-1) 45%,var(--row-line))}
    .project:has(input:checked){background:linear-gradient(135deg,var(--sw-brand-1),var(--sw-brand-2));border-color:transparent;color:#fff}
    .project input{accent-color:var(--sw-brand-1);margin:0}
    .project:has(input:checked) input{accent-color:#fff}
    .project .nm{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .project[hidden]{display:none}
    .no-match{margin:.25rem 0 0;font-size:.85rem}
    fieldset.scopes{margin:1.1rem 0 0;border:1px solid var(--line);border-radius:.85rem;padding:.65rem .9rem}
    fieldset.scopes legend{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:0 .35rem}
    label.scope-opt{display:flex;align-items:center;gap:.5rem;margin:.25rem 0;font-size:.87rem;font-weight:400}
    label.scope-opt input{margin:0;accent-color:var(--sw-brand-1)}
    .scope-warn{font-size:.62rem;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:.3rem;padding:.05rem .35rem;
      font-weight:700;text-transform:uppercase;letter-spacing:.04em}
    @media (prefers-color-scheme:dark){.scope-warn{color:#fca5a5;background:rgba(127,29,29,.35);border-color:rgba(248,113,113,.35)}}
    .row{display:flex;gap:.6rem;margin-top:1.35rem;flex-wrap:wrap}
    button{font:inherit;font-weight:600;padding:.6rem 1.15rem;border-radius:.7rem;border:1px solid var(--field-line);
      background:var(--field);color:var(--ink);cursor:pointer;transition:filter .15s,border-color .15s}
    button:hover{border-color:var(--muted)}
    button.primary{flex:1;border-color:transparent;color:#fff;background:linear-gradient(135deg,var(--sw-brand-1),var(--sw-brand-2));
      box-shadow:0 8px 22px color-mix(in srgb,var(--sw-brand-1) 32%,transparent)}
    button.primary:hover{filter:brightness(1.08)}
    a{color:inherit}
    code{background:color-mix(in srgb,var(--muted) 16%,transparent);padding:.08rem .32rem;border-radius:.3rem;font-size:.85em}
    /* The issued authorization code: a full-width, selectable, monospace block. */
    .code-box{display:flex;align-items:center;gap:.5rem;margin:.6rem 0 0;padding:.7rem .85rem;border:1px solid var(--field-line);
      border-radius:.7rem;background:var(--field);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85rem;
      word-break:break-all;user-select:all}
    .expiry{font-size:.78rem}
    /* The "just the code" alternative: present but folded away, so the URL (what most clients ask
       for) is the obvious action and the code is still one click from anyone who needs it. */
    details.alt{margin-top:.9rem}
    details.alt summary{cursor:pointer;font-size:.82rem;color:var(--muted)}
    details.alt summary:hover{color:var(--ink)}
    /* Copy confirmation. Hidden until the script shows it; it never appears without JS, and without JS
       the code is still visible and selectable, so nothing depends on it. */
    .toast{position:fixed;left:50%;bottom:1.5rem;transform:translate(-50%,1rem);opacity:0;pointer-events:none;
      padding:.6rem 1rem;border-radius:.7rem;color:#fff;font-weight:600;font-size:.87rem;
      background:linear-gradient(135deg,var(--sw-brand-1),var(--sw-brand-2));box-shadow:0 10px 30px rgba(15,23,42,.25);
      transition:opacity .18s ease,transform .18s ease}
    .toast.show{opacity:1;transform:translate(-50%,0)}
    @media (prefers-reduced-motion:reduce){.toast{transition:none}}
  </style></head><body class="${chrome.background ? 'has-bg' : ''}">${backgroundHost(chrome.background)}<div class="shell"><div class="brand">${mark}${escapeHtml(chrome.name)}</div>${body}</div>` +
    `<div class="toast" id="sw-toast" role="status" aria-live="polite"></div>` +
    `${opts?.script ? '<script src="/oauth/consent.js"></script>' : ''}</body></html>`;
}

/**
 * The host of a redirect URI, for labelling the continue button — `127.0.0.1:8976`, `claude.ai`. Falls
 * back to the raw (escaped) value if it somehow will not parse; the URI is already validated against
 * the client's registered set by this point, so this is presentation only.
 */
function redirectHost(redirectUri: string): string {
  try {
    return new URL(redirectUri).host || redirectUri;
  } catch {
    return redirectUri;
  }
}

/**
 * The post-approval screen: what the client needs in order to finish, offered in BOTH the shapes
 * clients ask for, plus the redirect as an explicit choice rather than something that happens TO the
 * user.
 *
 * ★ Two values, because clients disagree about what "paste it here" means. Claude Code's manual
 * fallback asks for the whole **callback URL** and rejects a bare code; other clients (and the
 * `sitewright` CLI's own prompt) ask for just the **code**. Shipping only the code made this screen
 * useless for the very client it was built for, so the URL leads — it is the more common ask and it
 * CONTAINS the code — with the code kept a click away for the clients that want it alone.
 *
 * Neither value authorises anything by itself: the code is single-use and bound to the client's PKCE
 * `code_verifier`, and the URL is that same code inside the redirect the browser would have followed.
 * What they buy is a way to finish when the callback is unreachable from this browser — an agent in a
 * container or on another machine — which is exactly when the automatic redirect strands the user.
 *
 * The page is `no-store` + `no-referrer` (see the caller) and both values expire with the code.
 */
function issuedCodePage(code: string, continueUrl: string, redirectUri: string, chrome: ConsentChrome): string {
  const minutes = Math.max(1, Math.round(AUTH_CODE_TTL_MS / 60000));
  return htmlPage(
    'Authorization approved',
    `<h1>Approved — finish in <strong>${escapeHtml(redirectHost(redirectUri))}</strong></h1>
     <p>Most clients (including Claude Code) ask you to paste the whole callback URL. It can be used
        once, and expires in ${minutes} minutes.</p>
     <div class="card">
       <span class="lbl">Callback URL</span>
       <div class="code-box"><span id="sw-url">${escapeHtml(continueUrl)}</span></div>
       <div class="row">
         <button class="primary" type="button" id="sw-copy-url" data-copy="sw-url" data-copied="Callback URL copied">Copy URL</button>
         <a href="${escapeHtml(continueUrl)}"><button type="button">Open it in this browser</button></a>
       </div>
       <details class="alt">
         <summary>My client asks for just the code</summary>
         <div class="code-box"><span id="sw-code">${escapeHtml(code)}</span></div>
         <div class="row">
           <button type="button" id="sw-copy" data-copy="sw-code" data-copied="Code copied">Copy code</button>
         </div>
       </details>
       <p class="expiry">Opening it only works if this browser can reach ${escapeHtml(redirectHost(redirectUri))} — otherwise copy and paste.</p>
     </div>`,
    chrome,
    { script: true },
  );
}

/** Builds a redirect URL appending query params, preserving any existing query. */
function redirectWith(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * Registers the OAuth 2.1 endpoints: discovery metadata, the authorization
 * endpoint (with a server-rendered consent page + project picker), and the token
 * endpoint (authorization_code + PKCE, and refresh_token rotation). The CLI is a
 * built-in public client; tokens issued are the same scoped bearer tokens the
 * rest of the API validates.
 */
export function registerOAuthRoutes(app: FastifyInstance, deps: OAuthDeps): void {
  const { oauth, clients, db, projects, currentUserId, instanceSettings, publicUrl, rl } = deps;
  /** Absolute refresh-token expiry for a NEWLY-issued grant = now + the admin's agent-session cap. */
  const sessionExpiry = async (): Promise<Date> => new Date(Date.now() + (await instanceSettings.getAgentSessionMs()));

  // Resolves a client_id to its display name + redirect validator: the built-in
  // CLI client (loopback redirects), or a dynamically-registered client
  // (exact-match against its registered URIs). Null = unknown client.
  async function resolveClient(clientId: string): Promise<ResolvedClient | null> {
    if (clientId === CLI_CLIENT_ID) {
      return { name: 'Sitewright CLI', allowsRedirect: isLoopbackHttp };
    }
    const client = await clients.get(clientId);
    if (!client) return null;
    return { name: client.name, allowsRedirect: (uri) => client.redirectUris.includes(uri) };
  }

  // The user's project options for a consent/device picker — every project they can reach (a
  // platform admin → all; everyone else → their memberships). The option value is the project id.
  async function projectOptions(userId: string): Promise<Array<{ value: string; label: string }>> {
    const access = await listProjectAccessForUser(db, userId);
    // Alphabetical, case- and accent-insensitively: the picker is a flat list an operator SCANS, and
    // membership order (effectively insertion order) is meaningless to them.
    return access
      .map((p) => ({ value: p.projectId, label: p.projectName }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  }

  /** The admin's chrome for a consent render. Never fails the page: a settings read that throws
   *  degrades to the built-in look rather than a 500 in the middle of an authorization. */
  const chromeOf = async (): Promise<ConsentChrome> => {
    try {
      return await instanceSettings.getChrome();
    } catch {
      return DEFAULT_CONSENT_CHROME;
    }
  };

  // The consent surface's script: the shared shader-bg runtime (the SAME one published sites use, so
  // the admin's animated background renders here without a second copy of the engine) plus the page's
  // own search/copy behaviour. Static and content-addressed by the build, so it caches hard.
  app.get('/oauth/consent.js', { config: rl(60) }, async (_req, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('cache-control', 'public, max-age=3600')
      .send(`${SHADER_BG_JS}\n${CONSENT_SCRIPT}`),
  );

  // ---- Discovery (RFC 8414 + RFC 9728) ----
  app.get('/.well-known/oauth-authorization-server', async (req, reply) => {
    const issuer = issuerOf(req, publicUrl);
    return reply.send({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      device_authorization_endpoint: `${issuer}/oauth/device_authorization`,
      response_types_supported: ['code'],
      grant_types_supported: [
        'authorization_code',
        'refresh_token',
        'urn:ietf:params:oauth:grant-type:device_code',
      ],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: API_KEY_CAPABILITIES,
    });
  });

  app.get('/.well-known/oauth-protected-resource', async (req, reply) => {
    const issuer = issuerOf(req, publicUrl);
    return reply.send({ resource: issuer, authorization_servers: [issuer] });
  });

  // ---- Dynamic Client Registration (RFC 7591) ----
  // Open registration (public clients, PKCE, no secret) so hosted MCP clients
  // (claude.ai / ChatGPT) self-register. The user still authenticates + consents,
  // and redirect URIs are matched EXACTLY at the authorization endpoint.
  app.post<{ Body: { client_name?: unknown; redirect_uris?: unknown } }>(
    '/oauth/register',
    { config: rl(10) },
    async (req, reply) => {
      const body = req.body ?? {};
      const name = typeof body.client_name === 'string' ? body.client_name : '';
      const redirectUris: unknown[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
      try {
        const client = await clients.register({ name, redirectUris });
        return reply.code(201).send({
          client_id: client.id,
          client_name: client.name,
          redirect_uris: client.redirectUris,
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        });
      } catch (err) {
        if (err instanceof OAuthClientError) {
          return reply.code(400).send({ error: 'invalid_client_metadata', error_description: err.message });
        }
        throw err;
      }
    },
  );

  // ---- Authorization endpoint ----
  // Validates the request, then either prompts the user to sign in or renders a
  // consent page (project picker). PKCE is mandatory; only the loopback CLI client
  // is accepted (DCR for hosted clients is a follow-up).
  app.get<{ Querystring: AuthorizeQuery }>(
    '/oauth/authorize',
    { config: rl(30) },
    async (req, reply) => {
      const q = req.query;
      const clientId = q.client_id ?? '';
      const redirectUri = q.redirect_uri ?? '';
      // A bad client_id / redirect_uri must NOT redirect (open-redirect guard) — render.
      const client = await resolveClient(clientId);
      if (!client || !client.allowsRedirect(redirectUri)) {
        return reply.code(400).type('text/html').send(
          htmlPage(
            'Invalid request',
            '<div class="card"><h1>Invalid authorization request</h1><p>Unknown client or redirect URI.</p></div>',
            await chromeOf(),
          ),
        );
      }
      // From here, parameter errors can safely redirect back to the (validated) client.
      const fail = (error: string): FastifyReply =>
        reply.redirect(redirectWith(redirectUri, { error, ...(q.state ? { state: q.state } : {}) }));
      if (q.response_type !== 'code') return fail('unsupported_response_type');
      if (q.code_challenge_method !== 'S256' || !q.code_challenge || !isValidS256Challenge(q.code_challenge)) {
        return fail('invalid_request');
      }
      const scope = resolveScope(q.scope);

      const userId = await currentUserId(req);
      if (!userId) {
        // Round-trip through the editor's login instead of dead-ending. `next` carries THIS request's
        // path+query, so approval resumes exactly where it left off — the old page just told the user
        // to go and sign in somewhere else and then find their way back, which for an agent-initiated
        // flow means digging the URL out of a terminal.
        //
        // OPEN-REDIRECT GUARD: `next` is built here from `req.url` — never from user input — and the
        // editor only honours a value that starts with `/oauth/authorize` (see App.tsx). Both halves
        // matter: this one cannot be forged by an attacker crafting an /oauth/authorize link, because
        // the value it produces is always this same endpoint.
        return reply.redirect(`/?next=${encodeURIComponent(req.url)}`, 302);
      }

      const options = await projectOptions(userId);
      if (options.length === 0) {
        return reply.code(200).type('text/html').send(
          htmlPage(
            'No projects',
            '<div class="card"><h1>No projects yet</h1><p>Create a project in the editor first, then retry this authorization.</p></div>',
            await chromeOf(),
          ),
        );
      }

      const hidden = (name: string, value: string): string =>
        `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
      // Radio CARDS, matching the editor's project selector, rather than a bare <select>: the project
      // is the single most consequential choice on this page (it scopes every token the agent gets),
      // so it should read like a choice, not like a dropdown default nobody looked at.
      // `data-name` is what the client-side filter matches on — reading it off the attribute keeps the
      // filter independent of the markup inside the card.
      const optionsHtml = options
        .map(
          (o, i) =>
            `<label class="project" data-name="${escapeHtml(o.label)}">` +
            `<input type="radio" name="project" value="${escapeHtml(o.value)}"${i === 0 ? ' checked' : ''} required>` +
            `<span class="nm">${escapeHtml(o.label)}</span></label>`,
        )
        .join('');
      // The search box only earns its space once the list is long enough to scan for.
      const searchHtml =
        options.length > 5
          ? '<input type="search" id="sw-project-search" class="search" placeholder="Search projects — Enter to approve" ' +
            'aria-label="Search projects" autocomplete="off">'
          : '';
      return reply.code(200).type('text/html').send(
        htmlPage(
          'Authorize access',
          `<h1>Authorize <strong>${escapeHtml(client.name)}</strong></h1>
           <p>Choose the project and the permissions to grant — everything is pre-selected; uncheck anything you want to withhold.</p>
           <div class="card">
             <form method="post" action="/oauth/authorize">
               ${hidden('client_id', clientId)}${hidden('redirect_uri', redirectUri)}
               ${hidden('response_type', 'code')}${hidden('code_challenge', q.code_challenge)}
               ${hidden('code_challenge_method', 'S256')}
               ${q.state ? hidden('state', q.state) : ''}
               <span class="lbl">Project</span>
               ${searchHtml}
               <div class="projects" id="sw-projects" role="radiogroup" aria-label="Project">${optionsHtml}</div>
               <p class="no-match" id="sw-no-match" hidden>No project matches that search.</p>
               <fieldset class="scopes" style="margin-top:.75rem"><legend>Permissions</legend>${scopeCheckboxes(scope)}</fieldset>
               <div class="row">
                 <button class="primary" id="sw-approve" type="submit" name="decision" value="approve">Approve</button>
                 <button type="submit" name="decision" value="deny">Deny</button>
               </div>
             </form>
           </div>`,
          await chromeOf(),
          { script: true },
        ),
      );
    },
  );

  // Consent submission. Same-origin form; the session cookie is sameSite=strict,
  // so a cross-site forgery can't carry it (CSRF protection). All OAuth params are
  // re-validated server-side.
  app.post<{ Body: Record<string, string> }>(
    '/oauth/authorize',
    { config: rl(30) },
    async (req, reply) => {
      const b = req.body ?? {};
      const clientId = b.client_id ?? '';
      const redirectUri = b.redirect_uri ?? '';
      const client = await resolveClient(clientId);
      if (!client || !client.allowsRedirect(redirectUri)) {
        return reply.code(400).type('text/html').send(htmlPage('Invalid request', '<div class="card"><h1>Invalid request</h1></div>', await chromeOf()));
      }
      const state = b.state;
      const back = (params: Record<string, string>): FastifyReply =>
        reply.redirect(redirectWith(redirectUri, { ...params, ...(state ? { state } : {}) }));

      // Auth first, so an unauthenticated POST always 401s (never a misleading
      // access_denied that looks like a user decision).
      const userId = await currentUserId(req);
      if (!userId) return reply.code(401).type('text/html').send(htmlPage('Sign in required', '<div class="card"><h1>Sign in required</h1></div>', await chromeOf()));
      if (b.decision !== 'approve') return back({ error: 'access_denied' });
      // Re-validate the same params the GET enforced (a client can POST directly).
      if (b.response_type !== 'code') return back({ error: 'unsupported_response_type' });
      if (b.code_challenge_method !== 'S256') return back({ error: 'invalid_request' });
      if (!b.code_challenge || !isValidS256Challenge(b.code_challenge)) return back({ error: 'invalid_request' });
      // The granted scope is what the user CHECKED on the consent page (not the client's request);
      // withholding everything can't mint an empty-capability token.
      const scope = selectedScope(b);
      if (scope.length === 0) return back({ error: 'invalid_scope' });

      const projectId = b.project ?? '';
      if (!projectId) return back({ error: 'invalid_request' });

      // Verify the user can reach the chosen project, resolve their effective role (frozen into the
      // grant), and issue the code — all under one error guard.
      try {
        const role = await resolveProjectRole(db, userId, projectId);
        if (!role) return back({ error: 'access_denied' });
        await projects.get(projectId); // 404 if the project no longer exists
        const grant: Grant = { clientId, userId, projectId, role, scope };
        const code = await oauth.createAuthCode(grant, redirectUri, b.code_challenge);
        // ★ NO automatic redirect. The client's callback is often unreachable from where the user is
        // actually sitting — an agent in a container/sandbox advertises a loopback redirect that only
        // resolves INSIDE that sandbox — and the old behaviour bounced the browser at it, leaving the
        // user to dig the code back out of a failed navigation's URL bar. The code is shown instead,
        // with the redirect kept one click away for the flows where it does work.
        return reply
          .code(200)
          .type('text/html')
          // The document carries a live credential: never cached, never leaked via Referer.
          .header('cache-control', 'no-store')
          .header('referrer-policy', 'no-referrer')
          .send(issuedCodePage(code, redirectWith(redirectUri, { code, ...(state ? { state } : {}) }), redirectUri, await chromeOf()));
      } catch (err) {
        if (err instanceof ForbiddenError || err instanceof NotFoundError) return back({ error: 'access_denied' });
        if (err instanceof OAuthError) return back({ error: err.code });
        throw err;
      }
    },
  );

  // ---- Device Authorization Grant (RFC 8628) — headless / SSH CLI ----
  app.post<{ Body: Record<string, string> }>(
    '/oauth/device_authorization',
    { config: rl(20) },
    async (req, reply) => {
      const b = req.body ?? {};
      const clientId = b.client_id ?? '';
      if (clientId !== CLI_CLIENT_ID && !(await clients.get(clientId))) {
        return reply.code(400).send({ error: 'invalid_client' });
      }
      // Intentionally strict (unlike the interactive authorize flow, no all-caps fallback): the device
      // grant is driven by the `sitewright` CLI, which requests explicit scopes, and its approval page
      // has no scope UI to narrow an over-broad default. Generic clients get scope selection via the
      // authorization-code consent page instead.
      const scope = parseScope(b.scope);
      if (scope.length === 0) return reply.code(400).send({ error: 'invalid_scope' });
      const issuer = issuerOf(req, publicUrl);
      const { deviceCode, userCode, expiresAt, interval } = await oauth.startDeviceAuthorization({ clientId, scope });
      return reply.send({
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: `${issuer}/oauth/device`,
        verification_uri_complete: `${issuer}/oauth/device?user_code=${encodeURIComponent(userCode)}`,
        expires_in: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
        interval,
      });
    },
  );

  // The browser page where the user enters/confirms the user code + picks a project.
  app.get<{ Querystring: { user_code?: string } }>(
    '/oauth/device',
    { config: rl(30) },
    async (req, reply) => {
      const userId = await currentUserId(req);
      if (!userId) {
        return reply.code(401).type('text/html').send(
          htmlPage(
            'Sign in required',
            `<h1>Sign in to authorize a device</h1><p>Open the <a href="/">Sitewright editor</a>, sign in, then return here.</p>`,
          ),
        );
      }
      const prefilled = req.query.user_code ?? '';
      const options = await projectOptions(userId);
      if (options.length === 0) {
        return reply.code(200).type('text/html').send(
          htmlPage('No projects', '<h1>No projects</h1><p>Create a project first, then retry.</p>'),
        );
      }
      const optionsHtml = options
        .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
        .join('');
      return reply.code(200).type('text/html').send(
        htmlPage(
          'Authorize device',
          `<h1>Authorize a device</h1>
           <p>Enter the code shown in your terminal and choose the project to grant access to.</p>
           <div class="card">
             <form method="post" action="/oauth/device">
               <label for="user_code">Code</label>
               <input id="user_code" name="user_code" value="${escapeHtml(prefilled)}" required
                 style="width:100%;padding:.5rem;border:1px solid #cbd5e1;border-radius:.5rem;font:inherit;text-transform:uppercase">
               <label for="project">Project</label>
               <select id="project" name="project" required>${optionsHtml}</select>
               <div class="row">
                 <button class="primary" type="submit" name="decision" value="approve">Approve</button>
                 <button type="submit" name="decision" value="deny">Deny</button>
               </div>
             </form>
           </div>`,
        ),
      );
    },
  );

  app.post<{ Body: Record<string, string> }>(
    '/oauth/device',
    { config: rl(30) },
    async (req, reply) => {
      const userId = await currentUserId(req);
      if (!userId) return reply.code(401).type('text/html').send(htmlPage('Sign in required', '<h1>Sign in required</h1>'));
      const b = req.body ?? {};
      const userCode = (b.user_code ?? '').trim().toUpperCase();
      const result = (title: string, msg: string) =>
        reply.code(200).type('text/html').send(htmlPage(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(msg)}</p>`));

      if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(userCode)) return result('Invalid code', 'Enter the code exactly as shown in your terminal.');
      const pending = await oauth.findDeviceByUserCode(userCode);
      if (!pending) return result('Unknown or expired code', 'Check the code in your terminal and try again.');

      if (b.decision !== 'approve') {
        await oauth.denyDevice(userCode);
        return result('Request denied', 'You can close this window.');
      }
      const projectId = b.project ?? '';
      if (!projectId) return result('Invalid request', 'No project was selected.');
      let approvedName = '';
      try {
        const role = await resolveProjectRole(db, userId, projectId);
        if (!role) return result('Not allowed', 'You do not have access to that project.');
        approvedName = (await projects.get(projectId)).name;
        await oauth.approveDevice({ userCode, userId, projectId, role });
      } catch (err) {
        if (err instanceof ForbiddenError || err instanceof NotFoundError) {
          return result('Not allowed', 'You are not a member of that project.');
        }
        if (err instanceof OAuthError) return result('Could not authorize', err.message);
        throw err;
      }
      // Success: the CLI continues on its own. Hand the user back to the editor for THIS project so
      // they can keep that tab open and watch the agent's changes land live in the preview.
      return reply.code(200).type('text/html').send(
        htmlPage(
          'Device authorized',
          `<h1>Device authorized</h1>
           <p>An agent can now edit <strong>${escapeHtml(approvedName)}</strong>. Return to your terminal — the CLI will continue automatically.</p>
           <p style="margin-top:1rem">Want to watch it work? Open the editor and keep the tab open — the agent’s changes appear live in the preview.</p>
           <p><a href="/" style="display:inline-block;background:#0f172a;color:#fff;padding:.5rem 1rem;border-radius:.5rem;text-decoration:none;font-weight:600">Open the editor</a></p>`,
        ),
      );
    },
  );

  // ---- Token endpoint ----
  app.post<{ Body: Record<string, string> }>(
    '/oauth/token',
    { config: rl(60) },
    async (req, reply) => {
      const b = req.body ?? {};
      const fail = (status: number, error: string, description: string): FastifyReply =>
        reply.code(status).send({ error, error_description: description });
      try {
        if (b.grant_type === 'authorization_code') {
          if (!b.code || !b.client_id || !b.redirect_uri || !b.code_verifier) {
            return fail(400, 'invalid_request', 'missing required parameter');
          }
          const tokens = await oauth.redeemAuthCode(
            { code: b.code, clientId: b.client_id, redirectUri: b.redirect_uri, codeVerifier: b.code_verifier },
            new Date(),
            await sessionExpiry(),
          );
          return reply.send({
            access_token: tokens.accessToken,
            token_type: 'Bearer',
            expires_in: tokens.expiresInSeconds,
            refresh_token: tokens.refreshToken,
            scope: tokens.scope.join(' '),
          });
        }
        if (b.grant_type === 'refresh_token') {
          if (!b.refresh_token || !b.client_id) return fail(400, 'invalid_request', 'missing required parameter');
          // Pass the CURRENT instance cap so a lowered session length tightens this rotation.
          const tokens = await oauth.refresh({ refreshToken: b.refresh_token, clientId: b.client_id }, new Date(), await sessionExpiry());
          return reply.send({
            access_token: tokens.accessToken,
            token_type: 'Bearer',
            expires_in: tokens.expiresInSeconds,
            refresh_token: tokens.refreshToken,
            scope: tokens.scope.join(' '),
          });
        }
        if (b.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
          if (!b.device_code || !b.client_id) return fail(400, 'invalid_request', 'missing required parameter');
          const tokens = await oauth.redeemDeviceCode({ deviceCode: b.device_code, clientId: b.client_id }, new Date(), await sessionExpiry());
          return reply.send({
            access_token: tokens.accessToken,
            token_type: 'Bearer',
            expires_in: tokens.expiresInSeconds,
            refresh_token: tokens.refreshToken,
            scope: tokens.scope.join(' '),
          });
        }
        return fail(400, 'unsupported_grant_type', 'unsupported grant_type');
      } catch (err) {
        if (err instanceof OAuthError) return fail(400, err.code, err.message);
        throw err;
      }
    },
  );
}
