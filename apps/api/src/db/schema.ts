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

export type OrgRole = 'owner' | 'admin' | 'member';
