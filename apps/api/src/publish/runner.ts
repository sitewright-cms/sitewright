import { buildSite, type BuildSiteOptions, type ReleaseManifest } from './build.js';

/** A unit of build work (same shape the in-process builder consumes). */
export type BuildJob = BuildSiteOptions;

/**
 * Pluggable build executor. The default runs in-process (single-container,
 * smallest attack surface — pure rendering + sharp). A future worker
 * implementation can run the build in an isolated, resource-capped container
 * for untrusted multi-tenant content — same interface, drop-in, so an operator
 * opts in by configuring a different runner without touching the publish flow.
 */
export interface BuildRunner {
  run(job: BuildJob): Promise<ReleaseManifest>;
}

/** Default: build in the API process. */
export class InProcessBuildRunner implements BuildRunner {
  run(job: BuildJob): Promise<ReleaseManifest> {
    return buildSite(job);
  }
}
