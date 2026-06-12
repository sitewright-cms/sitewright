/** Base class for all Sitewright domain errors. */
export class SitewrightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown when a `Page.template` reference resolves to no known project or global template. */
export class TemplateResolutionError extends SitewrightError {}
