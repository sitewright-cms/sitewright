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
 * OAuth 2.1 authorization codes (PKCE). Short-lived (~60s), single-use. The row id
 * is the SHA-256 of the code; the raw code is shown once in the redirect. Binds the
 * grant to a user, ONE project, the granted capabilities, the client's redirect URI,
 * and the PKCE challenge — all verified at the token endpoint.
 */
export const oauthAuthCodes = sqliteTable('oauth_auth_codes', {
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
});

/**
 * OAuth 2.1 refresh tokens — rotating + single-use. The row id is the SHA-256 of the
 * token. On refresh the old token is marked `rotatedTo` the new one; presenting an
 * already-rotated token is treated as theft and revokes the whole chain.
 */
export const oauthRefreshTokens = sqliteTable('oauth_refresh_tokens', {
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
});

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
      enum: ['settings', 'page', 'partial', 'template', 'dataset', 'entry', 'media', 'deploy_target', 'pattern', 'translation'],
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
  | 'deploy_target';
