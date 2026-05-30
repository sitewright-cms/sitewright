/** Base class for all Sitewright domain errors. */
export class SitewrightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown when a block-tree operation targets a node id that does not exist. */
export class NodeNotFoundError extends SitewrightError {
  constructor(public readonly id: string) {
    super(`block node not found: ${id}`);
  }
}

/** Thrown for invalid block-tree operations (e.g. removing the root, moving into self). */
export class TreeOperationError extends SitewrightError {}

/** Thrown when a partial reference is missing or forms a cycle. */
export class PartialResolutionError extends SitewrightError {}

/** Thrown when a page's template is missing or lacks exactly one Outlet. */
export class TemplateResolutionError extends SitewrightError {}
