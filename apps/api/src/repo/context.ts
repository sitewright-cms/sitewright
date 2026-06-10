import type { ProjectRole } from '../db/schema.js';

/**
 * The context every project-scoped repository operation requires — the tenancy boundary is the
 * project (there is one implicit platform). `role` is the caller's EFFECTIVE role on this project: a
 * platform admin resolves to `owner`; everyone else carries their `project_members` role. There is no
 * data-access path that omits this — that is the isolation guarantee.
 */
export interface ProjectContext {
  userId: string;
  projectId: string;
  role: ProjectRole;
  /**
   * Who is acting: `agent` for a bearer-token (API key / MCP bridge) request, `user` for an
   * interactive session. Used only to tag the live content-change event so the editor can show an
   * "an agent is editing" indicator — never a trust/authorization decision. Absent → treated as `user`.
   */
  actor?: 'agent' | 'user';
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
