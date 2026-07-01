import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/** A client website project — the tenancy boundary (there is one implicit platform). */
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
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('mfa_login_tickets_expires_idx').on(t.expiresAt)],
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
    type: text('type', { enum: ['reg', 'auth'] }).notNull(),
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
export const API_KEY_CAPABILITIES = ['content:read', 'content:write', 'content:delete', 'publish', 'deploy'] as const;
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
      enum: ['settings', 'page', 'template', 'snippet', 'dataset', 'entry', 'media', 'mediafolder', 'deploy_target', 'translation', 'form', 'project_smtp', 'ai_config'],
    }).notNull(),
    /** The entity's own id (or `settings` for the singleton). */
    entityId: text('entity_id').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('uniq_content').on(t.projectId, t.kind, t.entityId),
    index('content_project_kind_idx').on(t.projectId, t.kind),
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
      enum: ['settings', 'page', 'template', 'snippet', 'dataset', 'entry', 'media', 'mediafolder', 'deploy_target', 'translation', 'form', 'project_smtp', 'ai_config'],
    }).notNull(),
    entityId: text('entity_id').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
    op: text('op', { enum: ['put', 'delete', 'restore'] }).notNull(),
    /** Who authored this revision (the session user, or the API-key creator for an agent write). */
    userId: text('user_id').notNull(),
    actor: text('actor', { enum: ['user', 'agent'] }).notNull(),
    /** Optional human label, e.g. "Restored from 2026-06-20 10:31". */
    note: text('note'),
    revisionAt: integer('revision_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('content_rev_entity_idx').on(t.projectId, t.kind, t.entityId, t.revisionAt),
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
 * hCaptcha keys, permitted web-form mail modes). A singleton: exactly one row keyed
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

/**
 * Web-form submissions (text fields only — never binaries/attachments). Project-
 * scoped; `formId` is the `form` content entity. Captured even when email delivery
 * is unconfigured, so the inbox is the source of truth.
 */
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
  },
  (t) => [
    index('form_submissions_project_created_idx').on(t.projectId, t.createdAt),
    index('form_submissions_project_form_idx').on(t.projectId, t.formId),
  ],
);

/** Platform-staff role (the single agency): full admin, or a developer scoped to assigned projects. */
export type PlatformRole = 'admin' | 'developer';
/** A user's role within a single project. */
export type ProjectRole = 'owner' | 'member';
export type ContentKind =
  | 'settings'
  | 'page'
  | 'template'
  | 'snippet'
  | 'translation'
  | 'dataset'
  | 'entry'
  | 'media'
  | 'mediafolder'
  | 'deploy_target'
  | 'form'
  | 'project_smtp'
  | 'ai_config';
