import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  /**
   * scrypt `<salt>:<hash>`, or NULL for an account with no password — e.g. one provisioned via OIDC
   * single sign-on. A null-password user can't log in by password (nor use password-confirmed
   * actions) until they set one; the password paths treat null as "no password set".
   */
  passwordHash: text('password_hash'),
  /**
   * Platform-staff role (the single agency). `admin` = full control of every project + instance
   * settings + user management (seeded from SW_ADMIN_EMAIL). `developer` = agency staff that reaches
   * only the projects they're a member of. NULL = a client (reaches only their own project(s)).
   */
  platformRole: text('platform_role', { enum: ['admin', 'developer'] }),
  /**
   * When true, the user must set a new password before they can do anything else — the first-boot
   * seed sets it ONLY for an admin still on the well-known DEFAULT password (never when
   * SW_ADMIN_PASSWORD provided a real one). Cleared the moment the password is changed. While set, a
   * server guard rejects every state-changing request with a `password-change-required` sentinel and
   * the editor forces a "set a new password" screen. Defaults to false for every normal account.
   */
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  /**
   * Set when the password is TEMPORARY — one somebody else generated (an invite approved without its
   * link, or a password an admin issued), so somebody else has seen it. NULL for every password its
   * owner chose. While set:
   *  - the password stops working at this time unless it has been replaced;
   *  - a session opened with it can do nothing but replace it (`mustChangePassword` is set with it,
   *    and unlike the default-admin case this is enforced in development too);
   *  - signing in another way (single sign-on, a passkey) discards it instead.
   * Cleared whenever the password is replaced or discarded.
   */
  passwordExpiresAt: integer('password_expires_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/** A client website project — the tenancy boundary (there is one implicit platform). */
/**
 * Every content kind, as a value list.
 *
 * The `content.kind` and `content_revisions.kind` text columns and the {@link ContentKind} union
 * are all derived from this — they used to be three hand-maintained copies of the same list.
 * There is no SQL CHECK, so adding a kind stays a type-level change with no migration.
 */
export const CONTENT_KIND_VALUES = [
  'settings',
  'page',
  'template',
  'snippet',
  'dataset',
  'entry',
  'media',
  'mediafolder',
  'deploy_target',
  'translation',
  'form',
  'imagemap',
  'project_smtp',
  'project_captcha',
  'ai_config',
  'preview_share',
  /** Level 1 — a payment gateway definition. Instance-wide; stored under the reserved global scope. */
  'payment_gateway',
  /** Level 2 — one project's credentials for a gateway. Values encrypted at rest, per mode. */
  'project_payment',
  /** The project's booking set-up: resources and offerings. A singleton, id `booking`; no secrets, so exported. */
  'booking',
] as const;

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** Instance-unique (there is one platform); the published site serves at `/sites/<slug>/`. */
    slug: text('slug').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * SOFT-DELETE marker. NULL = a live project. When set, the project is hidden from every
     * member-facing query (lists, role resolution, project routes 404, the published site 404s)
     * but ALL its rows + on-disk artifacts are RETAINED so an instance admin can restore it. The
     * final REAP (admin) clears the rows + disk. `deletedBy` is the acting user (display only).
     */
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    deletedBy: text('deleted_by'),
    /**
     * When publishable content was last DELETED from this project. NULL = never.
     *
     * ★ The publish "dirty" signal is a MAXIMUM over `content.updated_at`, and a delete removes the
     * row instead of touching it — so the maximum does not move and the site reads clean with a
     * deleted page still being served. Recording the deletion time lets {@link latestContentUpdate}
     * fold it into that maximum. Only publishable kinds bump it: dropping a deploy target or an SMTP
     * credential changes nothing a visitor can see.
     */
    contentDeletedAt: integer('content_deleted_at', { mode: 'timestamp_ms' }),
  },
  () => [],
);

/**
 * Project membership: who can reach a project and their project role. `owner` = the client who owns
 * the project (manages its team); `member` = any other user granted access (an agency developer, or
 * an additional client-side user). Platform admins reach every project WITHOUT a row here.
 */
export const projectMembers = sqliteTable(
  'project_members',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('uniq_user_project').on(t.userId, t.projectId),
    index('project_members_project_idx').on(t.projectId),
  ],
);

/**
 * A pending invitation. It materializes into a membership ONLY when the invitee accepts
 * while signed in as the invited email — so a leaked link is useless without that
 * account, and there is no account-existence oracle. Org-level (projectId null, role
 * owner/admin) invites a developer/staff member; project-scoped (projectId set, role
 * member) invites a client to one project. The token is stored hashed; it is one-time
 * and time-limited.
 */
export const invites = sqliteTable(
  'invites',
  {
    id: text('id').primaryKey(),
    // Null → a PLATFORM invite (grants `platform_role` admin|developer); set → a PROJECT invite
    // (grants the project role owner|member).
    projectId: text('project_id').references(() => projects.id),
    email: text('email').notNull(),
    role: text('role', { enum: ['admin', 'developer', 'owner', 'member'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => users.id),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
    acceptedBy: text('accepted_by').references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('invites_project_idx').on(t.projectId)],
);

/** Server-side sessions (token id is stored hashed). */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * A user's TOTP (authenticator-app) second factor — at most one row per user. The shared secret is
 * stored ENCRYPTED at rest (AES-256-GCM envelope via crypto/secret.ts) because it must be recoverable
 * to verify codes, so it cannot be hashed. `confirmedAt` is null between setup and the first valid
 * code: an UNCONFIRMED secret never gates login, so a half-finished enrolment can never lock anyone
 * out. Deleting the row disables TOTP.
 */
export const userMfaTotp = sqliteTable('user_mfa_totp', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  /** The CONFIRMED secret (EncryptedSecret JSON) — null until the first confirm / after disable. */
  secret: text('secret', { mode: 'json' }).$type<{ iv: string; ct: string; tag: string }>(),
  /**
   * An in-progress enrolment secret, not yet confirmed (null when none pending). Kept SEPARATE from
   * `secret` so re-enrolling never tears down the live factor — the new secret only replaces the old
   * one atomically at confirm.
   */
  pendingSecret: text('pending_secret', { mode: 'json' }).$type<{ iv: string; ct: string; tag: string }>(),
  /**
   * The most recently accepted TOTP step (floor(epoch/30) ± window). A code at or below this step is
   * rejected as a replay, so an intercepted code can't be reused inside its ±90s validity window
   * (RFC 6238 §5.2).
   */
  lastUsedStep: integer('last_used_step'),
  confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * One-time recovery codes — the break-glass path when the authenticator app is lost. Only the
 * SHA-256 of each code is stored (the plaintext set is shown once at generation). A code is
 * single-use: `usedAt` is stamped on redemption and a used code never verifies again.
 */
export const userMfaRecoveryCodes = sqliteTable(
  'user_mfa_recovery_codes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    codeHash: text('code_hash').notNull(),
    usedAt: integer('used_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('user_mfa_recovery_user_idx').on(t.userId)],
);

/**
 * Short-lived, single-use handle bridging login step 1 (password/passkey verified) and step 2 (TOTP
 * code). The row id is the SHA-256 of the raw ticket — the raw value is returned to the client once
 * and never stored. It carries NO session authority: only the right to attempt the second factor for
 * `userId` until it expires (~5 min) or is consumed. Issued only AFTER the first factor passed.
 */
export const mfaLoginTickets = sqliteTable(
  'mfa_login_tickets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * The first factor was single sign-on rather than a password or a passkey. A completed SSO sign-in
     * discards an unused temporary password (see `users.passwordExpiresAt`), and "completed" means
     * AFTER the code — so the step that finishes the sign-in has to know how it began.
     */
    viaSso: integer('via_sso', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('mfa_login_tickets_expires_idx').on(t.expiresAt)],
);

/**
 * A CUSTOM DOMAIN a locally-hosted project is served at (`www.clientbrand.com` → that project's site),
 * in addition to `<slug>.<SW_SITES_DOMAIN>`.
 *
 * ★ `host` is UNIQUE across the whole instance, enforced by the index rather than by application code.
 * Two projects claiming one hostname is not a validation nicety: whichever won the lookup would be
 * served a different tenant's site. App-level uniqueness provably drifts here — the integrity checker
 * carries a "duplicate dataset slugs" check precisely because `put` enforces that in code — so this one
 * is a database constraint.
 *
 * Rows key on `projectId`, never on the slug, so a project rename needs no migration (the standing
 * invariant is that anything keyed BY the slug must move or die when the slug changes — this is not).
 * There is no ON DELETE CASCADE anywhere in this schema, so `ProjectRepository.remove()` must delete
 * these rows and `REAPED_TABLES` in test/project-reap.test.ts must list the table; missing either makes
 * the project permanently un-reapable, which has already happened twice (`agent_grants`, `form_filtered`).
 */
export const projectDomains = sqliteTable(
  'project_domains',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** The hostname, lowercased with any trailing dot stripped. Instance-unique. No scheme, no port. */
    host: text('host').notNull().unique(),
    /**
     * The project's CANONICAL host when several are verified — what "View live" advertises and what the
     * other verified hosts redirect to. Apex + `www` is the ordinary case, and only one of them can be
     * the address the site calls itself.
     */
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull(),
    /**
     * The value the operator must publish at `_sitewright.<host>` as a TXT record. Not a secret (it
     * goes into public DNS); it only has to be unguessable enough that it cannot be predicted for a
     * domain somebody else is about to claim.
     */
    verificationToken: text('verification_token').notNull(),
    /**
     * When DNS ownership was confirmed. NULL = claimed but NOT SERVING: an unverified host never enters
     * the routing map.
     *
     * ★ This is the whole security model, and it is why there is no re-claim cooldown. A claim is inert
     * until DNS points here, so the only attack a claim enables is taking over a hostname that ALREADY
     * resolves to this instance — the dangling-DNS / subdomain-takeover class. Requiring a TXT record
     * closes it directly: whoever cannot publish DNS for the host cannot serve it, released by a previous
     * project or not. A time window would add nothing on top.
     *
     * It also makes DNS control the tiebreaker for a squatted name: an UNVERIFIED claim does not block a
     * claimant who can verify (see the claim route), because the unverified holder proved nothing.
     */
    verifiedAt: integer('verified_at', { mode: 'timestamp_ms' }),
    /** The user who claimed it, so a squat is attributable. */
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('project_domains_project_idx').on(t.projectId)],
);

/**
 * A registered passkey (WebAuthn credential) — an alternative first factor. One row per credential;
 * a user may have several. The credential id and COSE public key are non-secret (base64url); the
 * private key never leaves the authenticator. `counter` is the signature counter (clone-detection);
 * `transports`/`deviceType`/`backedUp` are hints surfaced from registration.
 */
export const userPasskeys = sqliteTable(
  'user_passkeys',
  {
    /** The WebAuthn credential id (base64url) — the credential's unique handle. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** COSE public key, base64url-encoded (non-secret). */
    publicKey: text('public_key').notNull(),
    /** Signature counter; only ever advances (a regression signals a cloned authenticator). */
    counter: integer('counter').notNull(),
    transports: text('transports', { mode: 'json' }).$type<string[]>(),
    /** `singleDevice` | `multiDevice` (a synced/backed-up passkey) — a registration hint. */
    deviceType: text('device_type'),
    backedUp: integer('backed_up', { mode: 'boolean' }).notNull(),
    /** User-facing label, e.g. "MacBook Touch ID". */
    name: text('name').notNull(),
    /**
     * The WebAuthn Relying Party id (a bare hostname) this credential was registered against.
     *
     * A passkey is bound to its rpID by the authenticator, so one registered on `cms.example.com` is
     * simply NOT OFFERED by the browser on `admin.example.com` — the user sees "no passkey available"
     * and nothing anywhere explains why. Recording the rpID lets the Security tab name the host each
     * credential belongs to, which is the only thing that makes that failure legible.
     *
     * NULLABLE on purpose: credentials registered before this column existed have an rpID we cannot
     * know, and stamping them with the CURRENT host would be a confident lie about the one fact the
     * column exists to record. Null renders as "unknown", never as the current host.
     */
    rpId: text('rp_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('user_passkeys_user_idx').on(t.userId)],
);

/**
 * A short-lived WebAuthn challenge bridging an options request and its verify. The row id is an
 * opaque handle returned to the client and presented back at verify. `userId` is null for
 * usernameless authentication (the credential — and thus the user — is only known once the
 * authenticator responds). Single-use: consumed at verify; expired rows are pruned (~5 min).
 */
export const webauthnChallenges = sqliteTable(
  'webauthn_challenges',
  {
    id: text('id').primaryKey(),
    userId: text('user_id'),
    challenge: text('challenge').notNull(),
    // `stepup` is a signed-in user confirming it is them (a member token is minted with it). Kept apart
    // from `auth` so a sign-in challenge can never be replayed as a confirmation, or the other way round.
    type: text('type', { enum: ['reg', 'auth', 'stepup'] }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('webauthn_challenges_expires_idx').on(t.expiresAt)],
);

/**
 * A durable link between a local user and an external OIDC identity. Matched on the stable
 * `(issuer, subject)` pair (NOT email, which can change at the IdP) on every login after the first;
 * the first login links by verified email. `email` is the last-seen address (informational).
 */
export const oidcIdentities = sqliteTable(
  'oidc_identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    email: text('email'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
  },
  (t) => [uniqueIndex('uniq_oidc_issuer_subject').on(t.issuer, t.subject), index('oidc_identities_user_idx').on(t.userId)],
);

/**
 * Short-lived, single-use state for one OIDC login attempt, bridging the authorize redirect and the
 * callback. The row id is the SHA-256 of the raw `state` (the raw value travels via the IdP and comes
 * back in the callback). It carries the `nonce` and PKCE verifier (validated by openid-client) plus
 * the provider id. Consumed (single-use) at the callback; ~10-min TTL; expired rows swept.
 */
export const oidcLoginStates = sqliteTable(
  'oidc_login_states',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id').notNull(),
    nonce: text('nonce').notNull(),
    pkceVerifier: text('pkce_verifier').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('oidc_login_states_expires_idx').on(t.expiresAt)],
);

/**
 * Capabilities a project API key may carry. They NARROW access below the key's
 * role — a key's effective permission is `role ∩ capabilities`, never more than
 * its role. `content:delete` gates DESTRUCTIVE removes (pages, content entities,
 * media + media folders, form submissions, locales, SMTP config) and is NOT
 * implied by `content:write` — an agent can be allowed to create/update without
 * the irreversible power to delete.
 * `deploy` (external egress) is never granted by default. Order is canonical
 * (it drives the OAuth granted-scope order in oauth-routes).
 */
/**
 * Bearer-token capabilities. The single source of truth: the zod validator, the OAuth
 * `scopes_supported`, `parseScope`, `RequiredAccess` and `CAPABILITY_SET` all derive from this, and
 * it is a JSON text column rather than a DB enum, so adding one needs no migration.
 *
 * ★ `payments:provider:write` is OPT-IN and never implied by `content:write` — the `content:delete`
 * precedent. It authors GATEWAY DEFINITIONS (level 1), which is what makes "an agent adds a payment
 * provider" work. It deliberately does NOT cover a project's own payment credentials (level 2):
 * those are session-only, because an agent that can mint a live key into a project can redirect that
 * project's revenue.
 */
export const API_KEY_CAPABILITIES = [
  'content:read',
  'content:write',
  'content:delete',
  'publish',
  'deploy',
  'payments:provider:write',
] as const;
export type ApiKeyCapability = (typeof API_KEY_CAPABILITIES)[number];

/**
 * Project-scoped, capability-restricted, time-limited access tokens for
 * non-browser clients (the CLI / MCP bridge). Only the SHA-256 of the token is
 * stored — the raw `swk_…` token is shown once at creation. A key is bound to
 * exactly one project, carries a role (never above its creator's), and a set of
 * capabilities that narrow access below that role. Keys can be revoked before
 * they expire.
 */
export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    /** JSON array of {@link ApiKeyCapability}. */
    capabilities: text('capabilities', { mode: 'json' }).notNull().$type<ApiKeyCapability[]>(),
    /** SHA-256 hex of the raw token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    /** Short, non-secret identifying prefix shown in the UI (e.g. `swk_a1b2c3d4`). */
    tokenPrefix: text('token_prefix').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    /** Set when the key is revoked before its expiry (null = active). */
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    /** Best-effort last-use timestamp for audit (null until first use). */
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    /**
     * How the key was minted: `pat` = a long-lived token created in the editor
     * (shown in the management UI); `oauth` = a short-lived access token issued by
     * the OAuth flow (validated the same way, but hidden from the management list).
     */
    source: text('source', { enum: ['pat', 'oauth'] })
      .notNull()
      .default('pat'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('api_keys_project_idx').on(t.projectId)],
);

export type ApiKeySource = 'pat' | 'oauth';

/**
 * Capabilities ONLY a member token may carry — they act on the ACCOUNT's reach rather than inside one
 * project, so they have no meaning on a project key and must never reach one.
 *
 * ★ Kept OUT of {@link API_KEY_CAPABILITIES} on purpose. That list also drives the OAuth
 * `scopes_supported` and the consent page, which pre-checks every non-elevated capability for a client
 * that asked for no scope — adding these there would hand "delete projects" to any agent a user
 * approved without reading. Every one of them is opt-in when the token is minted.
 *
 * `members:manage` covers what does not create access: listing and removing a project's members,
 * listing and revoking its invites.
 *
 * ★ `members:invite` is separate, and is the one capability here that reaches PAST the token. An
 * invite is redeemed by a person, who becomes a project member with a login of their own — one that
 * is not narrowed by this token's capabilities, can open the settings a bearer never can (the
 * project's payment credentials among them), and stays a member after the token is revoked. Folding
 * it into `members:manage` would have made "may remove a member" quietly mean "may create a login".
 *
 * `members:invite` also covers APPROVING an invite without its link. For an address that has no account
 * yet, that creates one and hands its TEMPORARY password to the caller — the same login an invite leads
 * to, minus the invitee's inbox. Replacing the password of an account that already EXISTS is not a
 * capability at all: that stays an interactive decision for every kind of bearer.
 */
export const MEMBER_TOKEN_ADMIN_CAPABILITIES = [
  'projects:create',
  'projects:rename',
  'projects:delete',
  'members:manage',
  'members:invite',
] as const;
export type MemberTokenAdminCapability = (typeof MEMBER_TOKEN_ADMIN_CAPABILITIES)[number];

/** Everything a member token may carry: the project capabilities plus the opt-in account ones. */
export const MEMBER_TOKEN_CAPABILITIES = [...API_KEY_CAPABILITIES, ...MEMBER_TOKEN_ADMIN_CAPABILITIES] as const;
export type MemberTokenCapability = (typeof MEMBER_TOKEN_CAPABILITIES)[number];

/**
 * MEMBER tokens: a bearer token that belongs to a staff MEMBER rather than to one project. It reaches
 * every project its owner can reach, with the owner's CURRENT role there — looked up on each request,
 * never frozen at mint time — narrowed by `capabilities`. For agents and automation that create and
 * manage several projects; a project key ({@link apiKeys}) remains the narrow, one-site option.
 *
 * Only the SHA-256 of the token is stored; the raw `swm_…` token is shown once at creation. No
 * `role` column, deliberately: the role is whatever the member holds on the project being addressed.
 */
export const memberTokens = sqliteTable(
  'member_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    /** JSON array of {@link MemberTokenCapability}. */
    capabilities: text('capabilities', { mode: 'json' }).notNull().$type<MemberTokenCapability[]>(),
    tokenHash: text('token_hash').notNull().unique(),
    /** Short, non-secret identifying prefix shown in the UI (e.g. `swm_a1b2c3d4`). */
    tokenPrefix: text('token_prefix').notNull(),
    /**
     * The most new projects this token may create per 24 hours, chosen when it was minted. Null means
     * "whatever the instance allows". Either way the instance maximum still applies on every use, so
     * an admin who lowers it tightens tokens that already exist.
     */
    dailyProjectLimit: integer('daily_project_limit'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('member_tokens_user_idx').on(t.userId)],
);

/**
 * Which projects a member token has actually touched. A member token is bound to no project, so
 * without this a project's owner could not see that automation is acting on their project.
 *
 * One row per (token, project); removed with either.
 */
export const memberTokenProjects = sqliteTable(
  'member_token_projects',
  {
    tokenId: text('token_id')
      .notNull()
      .references(() => memberTokens.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    firstUsedAt: integer('first_used_at', { mode: 'timestamp_ms' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tokenId, t.projectId] }),
    index('member_token_projects_project_idx').on(t.projectId),
  ],
);

/**
 * The ledger of projects a member token CREATED: provenance ("which token made this project") and
 * what the per-token daily creation cap counts.
 *
 * ★ `projectId` is deliberately NOT a foreign key. A creation that is rolled back (a failed import, a
 * failed duplicate) hard-deletes the project, and if these rows went with it, every failed attempt
 * would be refunded from the cap — leaving the most expensive loop there is (create, import, fail,
 * remove) bounded by nothing but the request rate. The row therefore outlives its project, which is
 * also the more useful provenance: it still says who made a project that has since been reaped.
 *
 * Rows are kept for MEMBER_TOKEN_LEDGER_RETENTION_DAYS and then pruned by housekeeping: the cap only
 * ever looks back one day, and a token that lives a year would otherwise keep every row it ever wrote.
 */
export const memberTokenCreations = sqliteTable(
  'member_token_creations',
  {
    id: text('id').primaryKey(),
    tokenId: text('token_id')
      .notNull()
      .references(() => memberTokens.id),
    projectId: text('project_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('member_token_creations_token_idx').on(t.tokenId, t.createdAt)],
);

/**
 * A user's first-connect CONSENT for the on-page AI assistant on one project: which capabilities they
 * granted it and its autonomy. Written when the user approves the consent panel; read on every
 * subsequent drawer open (so approval is one-time per user+project) and by the chat endpoint to clamp
 * the minted scoped token. One row per (user, project).
 */
export const agentGrants = sqliteTable(
  'agent_grants',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** JSON array of {@link ApiKeyCapability} the user granted the assistant (default = full). */
    capabilities: text('capabilities', { mode: 'json' }).notNull().$type<ApiKeyCapability[]>(),
    /** `full` = act without per-step confirmation; `ask` = pause for confirmation (reserved for the UI). */
    autonomy: text('autonomy', { enum: ['full', 'ask'] })
      .notNull()
      .default('full'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('uniq_agent_grant_user_project').on(t.userId, t.projectId)],
);

/**
 * OAuth 2.1 dynamically-registered clients (RFC 7591) — e.g. claude.ai / ChatGPT
 * connecting as remote MCP clients. Public clients (PKCE, no secret); each carries
 * an exact-match allowlist of redirect URIs. The built-in `sitewright-cli` client
 * is NOT stored here (it's a hardcoded loopback client).
 */
export const oauthClients = sqliteTable('oauth_clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  redirectUris: text('redirect_uris', { mode: 'json' }).notNull().$type<string[]>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  /**
   * When this registration was last presented at the authorization or token endpoint. NULL = never
   * since it was registered, and every reader treats that as `created_at` (see
   * `effectiveLastUse` in repo/oauth-clients.ts), so a registration that is mid-flow is never
   * mistaken for an abandoned one.
   *
   * A registration is not a credential — the token endpoint never reads this table, so deleting a
   * row revokes nothing. It exists only so the eviction order can tell an ABANDONED registration
   * from one that is simply idle between sessions, which `created_at` cannot.
   */
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
});

/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628) — for headless/SSH CLI logins
 * with no loopback browser. The CLI polls with the `device_code` (id = its SHA-256)
 * while the user approves in a browser by entering the short `user_code`. On
 * approval the row carries the grant (project + role + scope, frozen at consent).
 */
export const oauthDeviceCodes = sqliteTable(
  'oauth_device_codes',
  {
    id: text('id').primaryKey(),
    userCode: text('user_code').notNull().unique(),
    clientId: text('client_id').notNull(),
    scope: text('scope', { mode: 'json' }).notNull().$type<ApiKeyCapability[]>(),
    status: text('status', { enum: ['pending', 'approved', 'denied'] }).notNull(),
    // Grant — null until approved.
    userId: text('user_id'),
    projectId: text('project_id'),
    role: text('role', { enum: ['owner', 'member'] }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    /** Set when the device_code is redeemed for tokens (single-use). */
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
    /** Last poll time — enforces the minimum polling interval (slow_down). */
    lastPolledAt: integer('last_polled_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('oauth_device_codes_expires_idx').on(t.expiresAt)],
);

/**
 * OAuth 2.1 authorization codes (PKCE). Short-lived (~60s), single-use. The row id
 * is the SHA-256 of the code; the raw code is shown once in the redirect. Binds the
 * grant to a user, ONE project, the granted capabilities, the client's redirect URI,
 * and the PKCE challenge — all verified at the token endpoint.
 */
export const oauthAuthCodes = sqliteTable(
  'oauth_auth_codes',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** The project role granted to issued tokens — the user's project role at consent time. */
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    scope: text('scope', { mode: 'json' }).notNull().$type<ApiKeyCapability[]>(),
    redirectUri: text('redirect_uri').notNull(),
    /** PKCE S256 challenge (base64url SHA-256 of the verifier). */
    codeChallenge: text('code_challenge').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    /** Set the moment the code is redeemed — replay is detected and refused. */
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('oauth_auth_codes_expires_idx').on(t.expiresAt)],
);

/**
 * OAuth 2.1 refresh tokens — rotating + single-use. The row id is the SHA-256 of the
 * token. On refresh the old token is marked `rotatedTo` the new one; presenting an
 * already-rotated token is treated as theft and revokes the whole chain.
 */
export const oauthRefreshTokens = sqliteTable(
  'oauth_refresh_tokens',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    scope: text('scope', { mode: 'json' }).notNull().$type<ApiKeyCapability[]>(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    /** The token this one was rotated into (set on use); a marker for reuse-detection. */
    rotatedTo: text('rotated_to'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('oauth_refresh_expires_idx').on(t.expiresAt),
    // Theft response revokes a user's OAuth access tokens for a project.
    index('oauth_refresh_user_project_idx').on(t.userId, t.projectId),
  ],
);

/**
 * Polymorphic per-project content store. One row per content entity (page,
 * partial, dataset, entry) or the project's settings singleton. `data` holds the
 * schema-validated JSON; the DB is the source of truth (the file format is
 * export/import). Always scoped by `projectId`.
 */
export const content = sqliteTable(
  'content',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    kind: text('kind', {
      // text column (no SQL CHECK) — adding a kind is a type-level change, no migration.
      enum: CONTENT_KIND_VALUES,
    }).notNull(),
    /** The entity's own id (or `settings` for the singleton). */
    entityId: text('entity_id').notNull(),
    /**
     * Uniqueness SCOPE for the (kind, entityId) key. `''` for every singleton/project-global kind; for
     * `entry` it is the OWNING DATASET SLUG — so an entry id only has to be unique WITHIN its dataset,
     * and two datasets can each hold e.g. `intro` / `row_1`. Ids stay CLEAN (the dataset is never
     * encoded into the id): GET/DELETE of an entry pass the dataset, and PUT derives it from the body.
     */
    scope: text('scope').notNull().default(''),
    data: text('data', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * SOFT-DELETE marker (currently only `media`): NULL = live. When set, the asset is hidden from every
     * list (File Manager, render, exports) but its row + on-disk binary are RETAINED so it can be
     * RESTORED from the File Manager's Recycle Bin. A 90-day reaper permanently purges older entries.
     */
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('uniq_content').on(t.projectId, t.kind, t.scope, t.entityId),
    index('content_project_kind_idx').on(t.projectId, t.kind),
    index('content_deleted_idx').on(t.projectId, t.kind, t.deletedAt),
  ],
);

/**
 * Append-only version history for content. Each row is a full JSON snapshot of one entity's `data` at a
 * point in time (for `op: 'delete'` it is the state AT deletion, so a restore can recreate the entity).
 * Written best-effort alongside the live `content` write (a failure here never breaks a save). Rapid
 * same-author edits to one entity coalesce into the latest row; history is capped per entity + pruned by
 * age (see RevisionsRepository). Restore re-writes `content`, producing a new `op: 'restore'` row.
 */
export const contentRevisions = sqliteTable(
  'content_revisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    // Mirrors content.kind (same text enum, no SQL CHECK). Recording is gated to the user-editable
    // subset in code (REVISIONED_KINDS) — credentials + media binaries are never snapshotted.
    kind: text('kind', {
      enum: CONTENT_KIND_VALUES,
    }).notNull(),
    entityId: text('entity_id').notNull(),
    /** Uniqueness scope mirroring `content.scope` (dataset slug for `entry`, else `''`) so an entry's
     *  history is keyed per-dataset — matching the live row it snapshots. */
    scope: text('scope').notNull().default(''),
    data: text('data', { mode: 'json' }).notNull(),
    // `create` = the write that made the entity (no stored row before it), `put` = an update of one.
    // A text enum with no SQL CHECK (like `kind`), so a new value needs no migration; rows written
    // before `create` existed simply stay `put`.
    op: text('op', { enum: ['create', 'put', 'delete', 'restore'] }).notNull(),
    /** Who authored this revision (the session user, or the API-key creator for an agent write). */
    userId: text('user_id').notNull(),
    actor: text('actor', { enum: ['user', 'agent'] }).notNull(),
    /** Optional human label, e.g. "Restored from 2026-06-20 10:31". */
    note: text('note'),
    revisionAt: integer('revision_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('content_rev_entity_idx').on(t.projectId, t.kind, t.scope, t.entityId, t.revisionAt),
    // The project-wide activity feed (History view) orders all of a project's revisions by time.
    index('content_rev_project_time_idx').on(t.projectId, t.revisionAt),
  ],
);

/**
 * Per-call AI usage ledger (online generation). Powers agency-funded metering +
 * per-org/per-user monthly token quotas. `projectId` is nullable for org-level ops.
 */
export const aiUsage = sqliteTable(
  'ai_usage',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    projectId: text('project_id'),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('ai_usage_user_created_idx').on(t.userId, t.createdAt)],
);

/**
 * Instance-wide settings, configured by an instance admin (global mail transport,
 * permitted web-form mail modes). A singleton: exactly one row keyed
 * by {@link INSTANCE_SETTINGS_ID}. Secrets inside `data` are encrypted at rest.
 */
export const instanceSettings = sqliteTable('instance_settings', {
  id: text('id').primaryKey(),
  data: text('data', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/** The fixed primary key of the instance-settings singleton row. */
export const INSTANCE_SETTINGS_ID = 'instance';

/** The fixed entity id of a project's SMTP-config singleton (content kind `project_smtp`). */
export const PROJECT_SMTP_ENTITY_ID = 'smtp';
/** The one `booking` content entity a project has. */
export const BOOKING_ENTITY_ID = 'booking';

/** The fixed entity id of a project's captcha-config singleton (content kind `project_captcha`). */
export const PROJECT_CAPTCHA_ENTITY_ID = 'captcha';

/**
 * Web-form submissions (text fields only — never binaries/attachments). Project-
 * scoped; `formId` is the `form` content entity. Captured even when email delivery
 * is unconfigured, so the inbox is the source of truth.
 */
/**
 * FILTERED submissions, counted rather than stored.
 *
 * The bot traps answer `{ok:true}` and keep nothing — deliberately, so a bot learns nothing from the
 * response. The cost was that they also told the OPERATOR nothing: every other branch of the submit
 * route logs (captcha failures, storage caps, SMTP gaps), while a honeypot or time-trap drop returned
 * 200 and vanished. So "we blocked 40 spam attempts" and "we lost 40 real enquiries" looked identical
 * from the outside, and a client reporting "I filled in your form and never heard back" could not be
 * checked at all.
 *
 * A COUNT, not the payload: storing what was filtered would move the spam into the database (and past
 * the per-form storage cap that exists to stop exactly that). The count is enough to answer the only
 * question that matters day to day — is this number small and steady, or did it jump the day we changed
 * a form? — and to tune the traps against evidence instead of taste.
 */
export const formFiltered = sqliteTable(
  'form_filtered',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    formId: text('form_id').notNull(),
    /** Which trap fired. Open-ended by design: interaction gating and proof-of-work add their own. */
    reason: text('reason').notNull(),
    count: integer('count').notNull().default(0),
    lastAt: integer('last_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.formId, t.reason] })],
);

/**
 * Spent proof-of-work challenges — what makes one solve buy exactly ONE submission.
 *
 * The challenge is the PRIMARY KEY, so claiming is a single atomic insert: a duplicate is a replay,
 * with no check-then-write window for two concurrent posts to slip through. Nothing here is secret —
 * a challenge is published to the client that solves it — so it is stored verbatim.
 *
 * Rows are written only for solutions that already passed verification (so filling this table costs
 * the same CPU as a real submission) and are swept once expired: an expired challenge is refused by
 * the signature/TTL check before the claim is ever reached, so a swept row cannot be replayed.
 */
/**
 * The last published RELEASE of a project — publishedAt, route/byte counts, and any page failures.
 *
 * ★ WHY IT IS A ROW AND NOT A FILE. This lived as `release.json` INSIDE the built site directory,
 * which made it a hostage to that directory's lifetime. The build is derived output that only Local
 * Hosting ever serves, so it is a natural thing to reap — but reaping it also destroyed the answer to
 * "is the published site out of date?", and a remote-only project would start reporting that it had
 * never been published at all. Separating the small durable FACT from the large derived BYTES is what
 * makes the build safe to delete.
 *
 * `release.json` is still written into the build (it is part of the artifact, and excluded from
 * deploys); this row is what the API reports from.
 */
export const projectReleases = sqliteTable('project_releases', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id),
  publishedAt: integer('published_at', { mode: 'timestamp_ms' }).notNull(),
  routes: integer('routes').notNull().default(0),
  bytes: integer('bytes').notNull().default(0),
  /** Draft-preview page failures, as stored in the manifest. Absent/empty when everything rendered. */
  pageFailures: text('page_failures', { mode: 'json' }),
});

export const formPowSpent = sqliteTable('form_pow_spent', {
  challenge: text('challenge').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

export const formSubmissions = sqliteTable(
  'form_submissions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    formId: text('form_id').notNull(),
    data: text('data', { mode: 'json' }).$type<Record<string, string>>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * Whether the NOTIFICATION for this submission reached the recipient. The submission itself is
     * never at risk — it is stored before any delivery is attempted, which is what makes the inbox
     * the source of truth. What used to vanish was the knowledge that nobody had been told: a
     * failure wrote one line to the server log and the visitor was thanked either way.
     *
     * `na` for a form the platform does not route (contact.php / third-party post elsewhere and
     * never reach this table's writer), so `pending` genuinely means "we owe someone an email".
     */
    deliveryState: text('delivery_state', { enum: ['pending', 'sent', 'failed', 'na', 'abandoned'] })
      .notNull()
      .default('na'),
    deliveryAttempts: integer('delivery_attempts').notNull().default(0),
    /** When the next attempt becomes due. Also the LEASE: pushed forward before an attempt, so a
     *  process killed mid-send leaves a row that becomes due again rather than one stuck sending. */
    deliveryNextAt: integer('delivery_next_at', { mode: 'timestamp_ms' }),
    /** Last failure, already sanitized by describeDeliveryFailure — safe to show an operator. */
    deliveryError: text('delivery_error'),
    /**
     * When something started ATTEMPTING this delivery, or null when nothing holds it.
     *
     * An explicit marker because it cannot be inferred: `deliveryNextAt` is in the future both for a
     * row a runner has claimed AND for one merely backing off, and `pending` covers both too. Set by
     * the request handler at creation (it sends inline, so it is the first claimant) and by every
     * runner claim; cleared whenever an outcome is recorded. A claim older than the lease is stale —
     * the process holding it died — and may be taken over.
     */
    deliveryClaimedAt: integer('delivery_claimed_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('form_submissions_project_created_idx').on(t.projectId, t.createdAt),
    index('form_submissions_project_form_idx').on(t.projectId, t.formId),
    // The runner's hot query: rows that are due, oldest first. Without this it scans every
    // submission ever stored on every tick.
    index('form_submissions_delivery_idx').on(t.deliveryState, t.deliveryNextAt),
  ],
);

/**
 * The SHOP CATALOG SNAPSHOT, one row per project per mode.
 *
 * ★ The authoritative price list. Written by the publish build (`live`) and the draft-preview build
 * (`draft`); read by the checkout endpoint to re-price `{sku, qty}` into an amount. The browser
 * never sends a price, so this table is the only thing that decides what a buyer is charged.
 *
 * ★ A `draft` row is usable ONLY by a test-mode checkout. That is what lets an author rehearse a
 * real payment flow against a provider sandbox without a published site, and what stops a preview
 * transacting against the live account.
 *
 * Derived, not authored — hence its own table rather than a `content` kind: it is regenerated whole
 * on every publish and carries no revision history worth keeping.
 */
export const shopCatalog = sqliteTable(
  'shop_catalog',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** `live` (published) or `draft` (preview). */
    mode: text('mode', { enum: ['live', 'draft'] }).notNull(),
    /** The MARKET this list prices for; '' for a shop without markets (its one list). */
    market: text('market').notNull().default(''),
    /** ISO-4217 settlement currency the prices below are denominated in. */
    currency: text('currency').notNull(),
    /** sku → { name, priceMinor, image?, stock? }. Prices are integer MINOR units. */
    items: text('items', { mode: 'json' })
      .$type<Record<string, { sku: string; name: string; priceMinor: number; image?: string; stock?: number }>>()
      .notNull(),
    /** Content digest — stamped onto each transaction so an order records which price list priced it. */
    digest: text('digest').notNull(),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.mode, t.market] })],
);

/**
 * The STOCK LEDGER — the platform's own record of availability, per SKU.
 *
 * ★★ THE OWNERSHIP SPLIT. The AUTHOR owns the restock number (`stock=` in the markup, harvested into
 * `authored_at_publish`); the PLATFORM owns `sold`. `on_stock` is rewritten by a publish ONLY when
 * the authored value CHANGED since the last one — an explicit restock. An unchanged republish must
 * never reset a sold-down quantity, or the first price refresh silently restocks everything that had
 * sold out. See `reconcileStock`.
 *
 * `reserved` holds units during the redirect to the provider, so two buyers cannot both be sold the
 * last one while each is away paying. A reservation expires (`reserved_until`) and is swept, because
 * an abandoned checkout must not hold stock for ever.
 */
export const shopStock = sqliteTable(
  'shop_stock',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sku: text('sku').notNull(),
    /** Units on the shelf. NULL = untracked: this SKU is never refused for being out of stock. */
    onStock: integer('on_stock'),
    /** Units sold (paid). Platform-owned; a publish never writes this. */
    sold: integer('sold').notNull().default(0),
    /** Units held by in-flight checkouts. */
    reserved: integer('reserved').notNull().default(0),
    /** When the oldest live reservation lapses, so the sweeper knows there is work. */
    reservedUntil: integer('reserved_until', { mode: 'timestamp_ms' }),
    /** What the author declared at the LAST publish. The hinge of the restock rule above. */
    authoredAtPublish: integer('authored_at_publish'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.sku] })],
);

/**
 * ONE PAYMENT. Created when a checkout session is requested, advanced only by a VERIFIED webhook or
 * by reconciliation against the provider — never by the buyer's return navigation, which is a
 * navigation they can forge.
 */
export const shopTransactions = sqliteTable(
  'shop_transactions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** Which `checkout` shop channel produced this. */
    channelKey: text('channel_key').notNull(),
    gatewayId: text('gateway_id').notNull(),
    /** ★ Stamped at creation: a test transaction can never be confused for a live one afterwards. */
    mode: text('mode', { enum: ['test', 'live'] }).notNull(),
    /**
     * Whether this came from a DRAFT PREVIEW checkout rather than the published site.
     *
     * ★ Distinct from `mode`, and both are needed. A project legitimately running in `test` mode is
     * still running its real shop, so its checkouts must hold and commit real stock; a PREVIEW is a
     * rehearsal against the draft catalog and holds nothing. Without this flag the paid webhook would
     * commit `sold` for a rehearsal that never reserved, permanently understating availability.
     */
    preview: integer('preview', { mode: 'boolean' }).notNull().default(false),
    status: text('status', {
      enum: ['created', 'pending', 'paid', 'failed', 'expired', 'refunded', 'partially_refunded', 'cancelled'],
    })
      .notNull()
      .default('created'),
    /** Operator-moved, deliberately separate from `status`: different owner, different meaning. */
    fulfilment: text('fulfilment', { enum: ['new', 'packed', 'shipped', 'done', 'cancelled'] }).notNull().default('new'),
    fulfilmentNote: text('fulfilment_note'),
    currency: text('currency').notNull(),
    /** The shop MARKET the order was placed in, when the shop has markets. */
    market: text('market'),
    /** The ship-to country (ISO 3166-1 alpha-2) the buyer chose — always one of the market's. */
    shipCountry: text('ship_country'),
    subtotalMinor: integer('subtotal_minor').notNull(),
    shippingMinor: integer('shipping_minor').notNull().default(0),
    taxMinor: integer('tax_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull(),
    refundedMinor: integer('refunded_minor').notNull().default(0),
    /**
     * ★ A FROZEN COPY of the lines as priced. The catalog is replaced on every publish; an order must
     * not be. A row that re-derived its lines from the current catalog would silently rewrite history
     * the first time a name or a price changed.
     */
    lines: text('lines', { mode: 'json' })
      .$type<Array<{ sku: string; name: string; unitMinor: number; qty: number; lineMinor: number }>>()
      .notNull(),
    /** The buyer's submitted fields. Text only, as for a form submission — never card data. */
    buyer: text('buyer', { mode: 'json' }).$type<Record<string, string>>().notNull(),
    /** Which price list priced this order. */
    catalogDigest: text('catalog_digest').notNull(),
    /** The provider's id for the session/order. Unique per gateway: the webhook's join key. */
    providerRef: text('provider_ref'),
    /** The provider's id for the payment itself, when it differs from the session. */
    providerPaymentRef: text('provider_payment_ref'),
    /**
     * ★ Opaque token for the thank-you page — SEPARATE from `id` so a shared return URL cannot be
     * walked to enumerate other people's orders, and so it can be rotated independently.
     */
    publicToken: text('public_token').notNull(),
    /**
     * ★ TWO INDEPENDENT delivery state sets, not one. The shop-admin notification and the customer
     * receipt fail independently: a bouncing merchant address must not block the buyer's receipt, and
     * retrying one must never re-send the other. A single shared column would make "the merchant was
     * not told" and "the customer was not told" indistinguishable, and those differ in urgency.
     */
    notifyState: text('notify_state', { enum: ['pending', 'sent', 'failed', 'na', 'abandoned'] }).notNull().default('na'),
    notifyAttempts: integer('notify_attempts').notNull().default(0),
    notifyNextAt: integer('notify_next_at', { mode: 'timestamp_ms' }),
    notifyError: text('notify_error'),
    notifyClaimedAt: integer('notify_claimed_at', { mode: 'timestamp_ms' }),
    receiptState: text('receipt_state', { enum: ['pending', 'sent', 'failed', 'na', 'abandoned'] }).notNull().default('na'),
    receiptAttempts: integer('receipt_attempts').notNull().default(0),
    receiptNextAt: integer('receipt_next_at', { mode: 'timestamp_ms' }),
    receiptError: text('receipt_error'),
    receiptClaimedAt: integer('receipt_claimed_at', { mode: 'timestamp_ms' }),
    /** Where the receipt goes: the provider's verified payer email, else a submitted field. */
    customerEmail: text('customer_email'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    paidAt: integer('paid_at', { mode: 'timestamp_ms' }),
    /** When an unpaid session stops being reconcilable and may be swept to `expired`. */
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('shop_txn_public_token_idx').on(t.publicToken),
    // The webhook's lookup. Per GATEWAY, not global: two providers may legitimately mint the same id.
    uniqueIndex('shop_txn_provider_ref_idx').on(t.gatewayId, t.providerRef),
    index('shop_txn_project_created_idx').on(t.projectId, t.createdAt),
    index('shop_txn_project_status_idx').on(t.projectId, t.status),
    // The notification runners' hot queries, and the reconciler's.
    index('shop_txn_notify_idx').on(t.notifyState, t.notifyNextAt),
    index('shop_txn_receipt_idx').on(t.receiptState, t.receiptNextAt),
    index('shop_txn_reconcile_idx').on(t.status, t.updatedAt),
  ],
);

/**
 * SPENT WEBHOOK EVENTS — replay defence, the same shape as `form_pow_spent`.
 *
 * A provider retries a webhook until it gets a 2xx, and some retry anyway. Without this, a replayed
 * `paid` would re-run everything that follows a payment: a second notification, a second receipt, a
 * second stock commit. Keyed per gateway because event ids are only unique within a provider.
 */
export const shopPaymentEvents = sqliteTable(
  'shop_payment_events',
  {
    gatewayId: text('gateway_id').notNull(),
    eventId: text('event_id').notNull(),
    seenAt: integer('seen_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.gatewayId, t.eventId] }), index('shop_payment_events_seen_idx').on(t.seenAt)],
);

/**
 * Counters for checkouts the bot gates REFUSED, per project/channel/reason.
 *
 * Mirrors `form_filtered`, and exists for the same reason: a silent drop makes "we blocked 40 bots"
 * and "we lost 40 sales" indistinguishable.
 */
export const shopFiltered = sqliteTable(
  'shop_filtered',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    channelKey: text('channel_key').notNull(),
    reason: text('reason').notNull(),
    count: integer('count').notNull().default(0),
    lastAt: integer('last_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.channelKey, t.reason] })],
);

/**
 * KEYWORD RANK TRACKING — the instance's choice of provider and its monthly budget. A singleton row keyed by
 * {@link RANK_TRACKING_CONFIG_ID}. Its own table rather than a section of `instance_settings`: that document is
 * rebuilt section by section on every save, and a provider-agnostic part fits better beside its credentials.
 */
export const rankTrackingConfig = sqliteTable('rank_tracking_config', {
  id: text('id').primaryKey(),
  /** The provider new checks are sent to; NULL = tracking is off. Checks already sent are still collected. */
  activeProvider: text('active_provider'),
  /** USD × 1,000,000. Checks stop for the month once what was spent reaches it. */
  monthlyBudgetMicros: integer('monthly_budget_micros').notNull(),
  /** The provider's last refusal (bad credentials, no funds), cleared by the next success. Never a secret. */
  lastError: text('last_error'),
  lastErrorAt: integer('last_error_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/** The fixed primary key of the rank-tracking config singleton. */
export const RANK_TRACKING_CONFIG_ID = 'instance';

/** A rank provider's credentials: its fields as one JSON object, encrypted with `SW_ENCRYPTION_KEY`. */
export const rankProviderCredentials = sqliteTable('rank_provider_credentials', {
  provider: text('provider').primaryKey(),
  /** An `EncryptedSecret` ({iv, ct, tag}) of the JSON object of field → value. */
  secret: text('secret', { mode: 'json' }).$type<{ iv: string; ct: string; tag: string }>().notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/** A project's tracking setup: the domain results are matched against, how often, and how deep. */
export const rankProjects = sqliteTable('rank_projects', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id),
  /** Lowercased host without `www.` (see `normalizeRankDomain`). */
  domain: text('domain').notNull(),
  includeSubdomains: integer('include_subdomains', { mode: 'boolean' }).notNull(),
  schedule: text('schedule', { enum: ['daily', 'weekly'] }).notNull(),
  /** How many results a check reads (10–100). */
  depth: integer('depth').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/** A keyword tracked for a project, with where and how it is searched. */
export const rankKeywords = sqliteTable(
  'rank_keywords',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** Normalized: lowercased, whitespace collapsed (see `normalizeRankKeyword`). */
    keyword: text('keyword').notNull(),
    engine: text('engine', { enum: ['google'] }).notNull(),
    device: text('device', { enum: ['desktop', 'mobile'] }).notNull(),
    /** A Google Ads geo-target canonical name (see `RankLocationSchema`). */
    locationName: text('location_name').notNull(),
    countryCode: text('country_code').notNull(),
    languageCode: text('language_code').notNull(),
    /** A paused keyword keeps its history and is not checked. */
    paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('rank_keywords_unique').on(t.projectId, t.keyword, t.engine, t.device, t.locationName, t.languageCode),
    index('rank_keywords_project').on(t.projectId),
  ],
);

/**
 * One check of one keyword on one UTC day — and, finished, its result.
 *
 * ★ MONEY. The row is CLAIMED before the provider is called (status `posting`, unique per keyword and day), so a
 * keyword is sent at most once a day however many passes overlap or restart. The claim books the ESTIMATED cost
 * at once; the provider's own figure replaces it when it answers. A check whose outcome is uncertain (a reply
 * lost after the request went out) keeps the estimate and is not sent again that day: the budget may count a
 * check that was never charged, but never misses one that was.
 */
export const rankChecks = sqliteTable(
  'rank_checks',
  {
    id: text('id').primaryKey(),
    keywordId: text('keyword_id')
      .notNull()
      .references(() => rankKeywords.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** The UTC day the check is for (YYYY-MM-DD). */
    day: text('day').notNull(),
    /** Which provider ran it — results from different providers stay distinguishable. */
    provider: text('provider').notNull(),
    /** The provider's id for the queued search, used to collect the result. */
    providerRef: text('provider_ref'),
    /** `posting` (claimed, being sent) → `queued` (sent, result pending) → `done`, or `failed`. */
    status: text('status', { enum: ['posting', 'queued', 'done', 'failed'] }).notNull(),
    /** The site the check was sent for. Results are read against THIS, so a later domain change cannot mix sites. */
    domain: text('domain').notNull(),
    includeSubdomains: integer('include_subdomains', { mode: 'boolean' }).notNull(),
    depth: integer('depth').notNull(),
    /** The organic position, 1 = the first ordinary result; NULL when done = not in the top `depth`. */
    position: integer('position'),
    /** The position among every element of the results page (ads, maps, snippets included). */
    absolutePosition: integer('absolute_position'),
    /** The site's page that ranked. */
    url: text('url'),
    /** USD × 1,000,000: the estimate from the claim until the provider states the real charge. */
    costMicros: integer('cost_micros').notNull().default(0),
    /** Why it failed, in words safe to show an admin. */
    error: text('error'),
    postedAt: integer('posted_at', { mode: 'timestamp_ms' }).notNull(),
    /** When the search engine was queried (from the provider), once done. */
    checkedAt: integer('checked_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('rank_checks_keyword_day').on(t.keywordId, t.day),
    index('rank_checks_status').on(t.status),
    index('rank_checks_project_day').on(t.projectId, t.day),
    index('rank_checks_posted').on(t.postedAt),
  ],
);

/**
 * ★ MONEY — what each rank check cost, kept apart from the check. The month's spend is the sum of THESE, not of
 * `rank_checks`: a check row goes when its keyword is removed or its project purged (and with retention), but the money
 * was spent all the same. Summing the checks let staff remove keywords, add them again (new ids, so the once-a-day
 * index no longer applies) and pay for every check twice while the budget read nearly nothing.
 *
 * No foreign key on purpose: a charge outlives its check, its keyword and its project. Written in the same batch as
 * the check — the claim books the estimate, the provider's figure replaces it, an uncertain outcome keeps the
 * estimate — and deleted only when a claim is RELEASED (the provider refused the whole request, so nothing was
 * charged), or by retention after `STATS_RETENTION_MONTHS`.
 */
export const rankCharges = sqliteTable(
  'rank_charges',
  {
    checkId: text('check_id').primaryKey(),
    /** The UTC month the check was claimed in (YYYY-MM): the budget it counts against. */
    month: text('month').notNull(),
    /** USD × 1,000,000, as on the check: the estimate until the provider states its charge. */
    costMicros: integer('cost_micros').notNull(),
  },
  (t) => [index('rank_charges_month').on(t.month)],
);

/**
 * The platform's search engine accounts (instance admins): one row per service (`google`, `bing`). The secret
 * is an `EncryptedSecret` ({iv, ct, tag}) of a JSON object; `info` is what the admin view may show (the Google
 * service account's email and project) and never holds a secret.
 */
export const webmasterCredentials = sqliteTable('webmaster_credentials', {
  service: text('service').primaryKey(),
  secret: text('secret', { mode: 'json' }).$type<{ iv: string; ct: string; tag: string }>().notNull(),
  info: text('info', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * A project's site registered with one of the platform's search engine accounts: whether staff switched it on, the
 * verification tag its builds carry, and how far the search engine got. The tag belongs to the ACCOUNT and the URL,
 * so a new key or a new Production URL needs a new one (`account` and `site_url` say which it was made for).
 */
export const webmasterSites = sqliteTable(
  'webmaster_sites',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    service: text('service', { enum: ['google', 'bing'] }).notNull(),
    /** Switched on for the project by agency staff. Off: no tag in builds, and the site was removed from the account. */
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    /** The Production URL the tag and the verification are for ('' until a tag was first fetched). */
    siteUrl: text('site_url').notNull(),
    /** Which account the tag was made for: the Google service account's email, or a fingerprint of the Bing key. */
    account: text('account').notNull(),
    /** The verification tag's `content`; null when getting it failed. */
    token: text('token'),
    status: text('status', { enum: ['none', 'pending', 'verified', 'failed'] }).notNull(),
    detail: text('detail'),
    verifiedAt: integer('verified_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * Google only: the people staff made owners of the site in Search Console, beside the service account. The list
     * the platform manages — owners added at Google by anyone else are never touched. Kept when the switch goes off,
     * so a later verification gives them access again.
     */
    owners: text('owners', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** Why those owners did not get access at the last verification; null when they did (or there are none). */
    ownersDetail: text('owners_detail'),
    /** The last sitemap submission: when, whether the search engine took it, and what it said. */
    sitemapAt: integer('sitemap_at', { mode: 'timestamp_ms' }),
    sitemapOk: integer('sitemap_ok', { mode: 'boolean' }),
    sitemapDetail: text('sitemap_detail'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.service] })],
);

/**
 * A site the platform could not remove from one of its search engine accounts when its project was deleted: tried
 * again from the hourly sweep, with the account that registered it, backing off, and given up (a warning in the log)
 * after 14 days.
 *
 * No foreign key on purpose: it must outlive the purge, which deletes the `webmaster_sites` row that was the only other
 * record of the site. `project_id` is the project it belonged to; while that project is only soft-deleted, a restore
 * cancels the removal (its row still says what is registered).
 */
export const webmasterRemovals = sqliteTable(
  'webmaster_removals',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    service: text('service', { enum: ['google', 'bing'] }).notNull(),
    siteUrl: text('site_url').notNull(),
    /** The account that registered the site (as `webmaster_sites.account`): only that account can remove it. */
    account: text('account').notNull(),
    /** Google: the owners the platform added, who lose that ownership with the site. */
    owners: text('owners', { mode: 'json' }).$type<string[]>().notNull().default([]),
    attempts: integer('attempts').notNull(),
    lastError: text('last_error'),
    nextAt: integer('next_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('webmaster_removals_site').on(t.service, t.siteUrl, t.account), index('webmaster_removals_next').on(t.nextAt)],
);

/**
 * BOOKING CLAIMS: what the platform itself holds about bookings, kept small on purpose. The bookings
 * live in the owners' own calendars; a row here is one of:
 *   `hold`     a time claimed for minutes while a booking is written to a calendar or paid for;
 *   `pending`  a request waiting for the owner to accept it, its time held meanwhile;
 *   `booked`   a booking on a resource with no calendar Sitewright can write to (the small ledger).
 * Every row ends: holds and requests at `expires_at`, ledger bookings a few days after they finish
 * (`busy_end`), and the customer's details go with the row. A per-project cap refuses new claims beyond
 * a limit, so the table cannot grow without bound.
 */
export const bookingClaims = sqliteTable(
  'booking_claims',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    resourceId: text('resource_id').notNull(),
    offeringId: text('offering_id').notNull(),
    state: text('state', { enum: ['hold', 'pending', 'booked'] }).notNull(),
    /** The booking as the customer sees it. */
    startAt: integer('start_at', { mode: 'timestamp_ms' }).notNull(),
    endAt: integer('end_at', { mode: 'timestamp_ms' }).notNull(),
    /** What it occupies: the booking and its buffers. */
    busyStart: integer('busy_start', { mode: 'timestamp_ms' }).notNull(),
    busyEnd: integer('busy_end', { mode: 'timestamp_ms' }).notNull(),
    units: integer('units').notNull(),
    /** A `slots` booking: shares seats only with its own slot, and takes the resource for anything else. */
    exclusive: integer('exclusive', { mode: 'boolean' }).notNull().default(false),
    /** When a hold or a request lapses. Null for a ledger booking. */
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    /** The customer's own details (name, email, phone, note). Deleted with the row. */
    customer: text('customer', { mode: 'json' }).$type<Record<string, string>>().notNull().default({}),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('booking_claims_resource').on(t.projectId, t.resourceId, t.busyStart),
    index('booking_claims_expires').on(t.expiresAt),
    index('booking_claims_end').on(t.busyEnd),
  ],
);

/**
 * BOOKING CALENDARS: the outside calendars a resource's busy times are read from (an iCalendar feed: Google's
 * secret address, an Outlook published calendar, an Apple calendar, a rental platform's export). The feed's
 * address READS the calendar, so it is a credential: stored encrypted, never returned, never exported. The last
 * reading's outcome is kept for the business to see. A per-project cap bounds the table.
 */
export const bookingCalendars = sqliteTable(
  'booking_calendars',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    resourceId: text('resource_id').notNull(),
    kind: text('kind', { enum: ['ics'] }).notNull(),
    /** The business's own label for it ("Anna's Google calendar"). */
    name: text('name').notNull(),
    /** The feed's address, encrypted (AES-256-GCM envelope). */
    url: text('url', { mode: 'json' }).$type<{ iv: string; ct: string; tag: string }>().notNull(),
    /** The feed's host, which says which service it is without giving the address away. */
    host: text('host').notNull(),
    lastOkAt: integer('last_ok_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
    /** Events in the feed at the last good reading. */
    lastEvents: integer('last_events'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('booking_calendars_resource').on(t.projectId, t.resourceId)],
);

/**
 * BOOKING FEED: the business's own bookings as an iCalendar feed its calendar app subscribes to. The address
 * carries a secret token (the feed lists customers' names and contacts), so it is a credential: looked up by the
 * token's SHA-256, and kept encrypted so the editor can show the address again. One per project; a new one
 * replaces it (the old address stops working), and removing it switches the feed off.
 */
export const bookingFeeds = sqliteTable('booking_feeds', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id),
  /** SHA-256 (hex) of the token in the address: how a request finds its project. */
  tokenHash: text('token_hash').notNull().unique(),
  /** The token itself, encrypted (AES-256-GCM envelope), to show the address again. */
  token: text('token', { mode: 'json' }).$type<{ iv: string; ct: string; tag: string }>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  /** When a calendar app last fetched it: tells the business the subscription works. */
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp_ms' }),
});

/**
 * BOOKING MAILS on their way: the confirmations, requests and cancellations a booking sends the customer and
 * the business, each rendered when the booking happened (a cancelled booking has no row left to render from).
 * A row is DELETED once its mail is sent; one that keeps failing backs off (the form deliveries' schedule) and
 * is kept as `failed` for a week, then swept, the customer's details with it. Bounded by the bookings that
 * produce them (a project takes at most so many an hour) and by a per-project cap.
 */
export const bookingMails = sqliteTable(
  'booking_mails',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    replyTo: text('reply_to'),
    /** The mail as rendered: text, HTML, files and the calendar invitation. */
    body: text('body', { mode: 'json' }).$type<{ text: string; html?: string; attachments?: Array<{ filename: string; content: string; contentType: string }>; icalEvent?: { method: 'REQUEST' | 'CANCEL' | 'PUBLISH'; filename: string; content: string } }>().notNull(),
    state: text('state', { enum: ['pending', 'failed'] }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    /** When it is next due; pushed forward by a lease while an attempt runs. */
    nextAt: integer('next_at', { mode: 'timestamp_ms' }).notNull(),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('booking_mails_due').on(t.state, t.nextAt), index('booking_mails_project').on(t.projectId)],
);

/** Platform-staff role (the single agency): full admin, or a developer scoped to assigned projects. */
export type PlatformRole = 'admin' | 'developer';
/** A user's role within a single project. */
export type ProjectRole = 'owner' | 'member';
export type ContentKind = (typeof CONTENT_KIND_VALUES)[number];
