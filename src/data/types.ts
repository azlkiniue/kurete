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
  /** Most recent already-released patch, if any. */
  latestPatch: PatchRef | null;
  /** Next scheduled patch, if any. */
  nextPatch: PatchRef | null;
  /** Number of patches released so far. */
  patchCount: number;
  /** False: dates come straight from upstream and are exact. */
  derived: false;
}

/**
 * An end-of-life minor release (from eol.yaml).
 * eolDate + finalPatch are exact. releaseDate/maintenanceStartDate are derived
 * from Kubernetes' documented support policy (~14 months) and flagged as such.
 */
export interface EolRelease {
  version: string;
  eolDate: string;
  finalPatch: string;
  /** Derived: eolDate − 14 months. */
  releaseDate: string;
  /** Derived: eolDate − 2 months. */
  maintenanceStartDate: string;
  /** True: release/maintenance dates are derived, not exact. */
  derived: true;
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
