/**
 * Normalized shape of the build-time data snapshot.
 * Produced by scripts/fetch-data.ts and consumed by the Astro components.
 * All dates are ISO calendar dates ("YYYY-MM-DD"), interpreted as UTC.
 */

export interface PatchRef {
  /** Full patch version, e.g. "1.36.1". */
  version: string;
  /** Target/release date of the patch ("YYYY-MM-DD"). */
  date: string;
  /** Cherry-pick deadline, when known. */
  cherryPickDeadline?: string;
  /** Optional upstream note about the patch. */
  note?: string;
}

/** A currently-supported minor release (from schedule.yaml). Dates are exact. */
export interface SupportedRelease {
  version: string;
  releaseDate: string;
  /** Start of maintenance mode = end of standard ("active") support. */
  maintenanceStartDate: string;
  eolDate: string;
  /** Latest released version on this branch; x.y.0 until the first patch ships. */
  latestPatch: PatchRef;
  /** Next scheduled patch, if any. */
  nextPatch: PatchRef | null;
  /** Number of patches released so far. */
  patchCount: number;
  /** False: dates come straight from upstream and are exact. */
  derived: false;
}

/**
 * An end-of-life minor release.
 *
 * eolDate + finalPatch come from the official eol.yaml (or, for releases older
 * than the official archive, from kube-api.ninja). The releaseDate is the exact
 * historical date from kube-api.ninja when available, otherwise derived from
 * Kubernetes' ~14-month support policy. maintenanceStartDate is always derived.
 */
export interface EolRelease {
  version: string;
  eolDate: string;
  finalPatch: string;
  /** Exact (kube-api.ninja / official) when releaseDateExact, else eolDate − 14 months. */
  releaseDate: string;
  /** Derived: releaseDate + 12 months, clamped within the support window. */
  maintenanceStartDate: string;
  /** True when releaseDate is an exact calendar date, false when policy-derived. */
  releaseDateExact: boolean;
  /** Origin of the EOL date + final patch. */
  eolSource: 'kubernetes' | 'kube-api';
  note?: string;
}

export interface Milestone {
  date: string;
  label: string;
}

/** The next, not-yet-released minor version (from sig-release). */
export interface UpcomingRelease {
  version: string;
  /** Planned GA date of x.y.0. */
  releaseDate: string;
  /** Projected: releaseDate + 12 months. */
  projectedMaintenanceStartDate: string;
  /** Projected: releaseDate + 14 months. */
  projectedEolDate: string;
  /** First day of the release cycle, when known. */
  cycleStart: string | null;
  /** Ordered key dates of the cycle. */
  milestones: Milestone[];
  /** True when releaseDate is a cadence projection rather than a published date. */
  estimated: boolean;
  /** URL the schedule was read from. */
  source: string;
}

/** An upcoming patch-release day across all supported branches. */
export interface UpcomingPatch {
  targetDate: string;
  cherryPickDeadline?: string;
}

export interface SnapshotSources {
  schedule: string;
  eol: string;
  upcoming: string;
  kubeApi: string;
}

export interface Snapshot {
  /** ISO timestamp of when the snapshot was generated. */
  generatedAt: string;
  /** Whether the last fetch succeeded (false => served from a previous snapshot). */
  fresh: boolean;
  sources: SnapshotSources;
  supported: SupportedRelease[];
  eol: EolRelease[];
  upcoming: UpcomingRelease | null;
  upcomingPatches: UpcomingPatch[];
}
