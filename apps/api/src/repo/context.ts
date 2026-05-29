import type { OrgRole } from '../db/schema.js';

/**
 * The tenant context every scoped repository operation requires. There is no
 * data-access path that omits this — that is the multi-tenant isolation guarantee.
 */
export interface TenantContext {
  userId: string;
  orgId: string;
  role: OrgRole;
}

/** A tenant context narrowed to a specific project (verified to belong to the org). */
export interface ProjectContext extends TenantContext {
  projectId: string;
}

export class NotFoundError extends Error {
  constructor(message = 'not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends Error {
  constructor(message = 'conflict') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class UnauthorizedError extends Error {
  constructor(message = 'unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}
