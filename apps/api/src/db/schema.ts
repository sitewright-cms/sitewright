import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** A tenant — an agency/organization. The top of the isolation hierarchy. */
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Links a user to an organization with an org-level role. */
export const memberships = sqliteTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('uniq_user_org').on(t.userId, t.orgId)],
);

/** A client website project, owned by exactly one organization (tenant). */
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('uniq_org_slug').on(t.orgId, t.slug), index('projects_org_idx').on(t.orgId)],
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
 * Capabilities a project API key may carry. They NARROW access below the key's
 * role — a key's effective permission is `role ∩ capabilities`, never more than
 * its role. `deploy` (external egress) is never granted by default.
 */
export const API_KEY_CAPABILITIES = ['content:read', 'content:write', 'publish', 'deploy'] as const;
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
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
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
    orgId: text('org_id'),
    projectId: text('project_id'),
    role: text('role', { enum: ['owner', 'admin', 'member'] }),
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
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** The org role granted to issued tokens — the user's membership role at consent time. */
    role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
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
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
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
      enum: ['settings', 'page', 'partial', 'template', 'dataset', 'entry', 'media', 'deploy_target', 'pattern', 'translation', 'form', 'project_smtp'],
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
 * Per-call AI usage ledger (online generation). Powers agency-funded metering +
 * per-org/per-user monthly token quotas. `projectId` is nullable for org-level ops.
 */
export const aiUsage = sqliteTable(
  'ai_usage',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    projectId: text('project_id'),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('ai_usage_org_created_idx').on(t.orgId, t.createdAt),
    index('ai_usage_user_created_idx').on(t.userId, t.createdAt),
  ],
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

export type OrgRole = 'owner' | 'admin' | 'member';
export type ContentKind =
  | 'settings'
  | 'page'
  | 'partial'
  | 'template'
  | 'pattern'
  | 'translation'
  | 'dataset'
  | 'entry'
  | 'media'
  | 'deploy_target'
  | 'form'
  | 'project_smtp';
