/**
 * Build-time view model: loads the committed snapshot and derives the geometry
 * for the timeline (Gantt) chart. Status text / colors / countdowns are computed
 * in the components (and refreshed live on the client) via src/lib/dates.ts.
 */
import snapshotJson from './snapshot.json';
import type { Snapshot, SupportedRelease, EolRelease } from './types';
import { parseISODate, MS_PER_DAY } from '../lib/dates';

export const snapshot = snapshotJson as Snapshot;

export const supported = snapshot.supported;
export const eolReleases = snapshot.eol;
export const upcoming = snapshot.upcoming;

/** Most recent EOL releases, shown in the main table for at-a-glance context. */
export const recentEol = eolReleases.slice(0, 3);

/** Patch days that are still in the future (drops any already past at build time). */
const todayISO = new Date().toISOString().slice(0, 10);
const futurePatches = snapshot.upcomingPatches.filter((p) => p.targetDate >= todayISO);
export const upcomingPatches = futurePatches.length > 0 ? futurePatches : snapshot.upcomingPatches;

/** The next patch-release day across supported branches. */
export const nextPatch = upcomingPatches[0] ?? null;

/** Supported release whose EOL is nearest in the future (for the headline countdown). */
export const nextEol: SupportedRelease | null =
  [...supported]
    .filter((r) => parseISODate(r.eolDate).getTime() > Date.now())
    .sort((a, b) => a.eolDate.localeCompare(b.eolDate))[0] ?? null;

// ---------------------------------------------------------------------------
// timeline chart geometry
// ---------------------------------------------------------------------------

export interface ChartBar {
  kind: 'active' | 'maintenance';
  startPct: number;
  widthPct: number;
  startISO: string;
  endISO: string;
}

export interface ChartRow {
  version: string;
  /** 'upcoming' rows are drawn with a projected (dashed) style. */
  kind: 'upcoming' | 'supported' | 'eol';
  releaseDate: string;
  maintenanceStartDate: string;
  eolDate: string;
  derived: boolean;
  bars: ChartBar[];
}

export interface YearLine {
  year: number;
  pct: number;
}

export interface ChartModel {
  rangeStartISO: string;
  rangeEndISO: string;
  rows: ChartRow[];
  yearLines: YearLine[];
  /** "Today" position at build time; refreshed live on the client. */
  todayPct: number;
}

interface RowInput {
  version: string;
  kind: ChartRow['kind'];
  releaseDate: string;
  maintenanceStartDate: string;
  eolDate: string;
  derived: boolean;
}

function buildChart(rowInputs: RowInput[]): ChartModel {
  const allDates = rowInputs.flatMap((r) => [
    parseISODate(r.releaseDate).getTime(),
    parseISODate(r.eolDate).getTime(),
  ]);
  const PAD = 45 * MS_PER_DAY;
  const startMs = Math.min(...allDates) - PAD;
  const endMs = Math.max(...allDates) + PAD;
  const span = endMs - startMs;
  const pct = (iso: string) => ((parseISODate(iso).getTime() - startMs) / span) * 100;

  const rows: ChartRow[] = rowInputs.map((r) => ({
    version: r.version,
    kind: r.kind,
    releaseDate: r.releaseDate,
    maintenanceStartDate: r.maintenanceStartDate,
    eolDate: r.eolDate,
    derived: r.derived,
    bars: [
      {
        kind: 'active' as const,
        startPct: pct(r.releaseDate),
        widthPct: pct(r.maintenanceStartDate) - pct(r.releaseDate),
        startISO: r.releaseDate,
        endISO: r.maintenanceStartDate,
      },
      {
        kind: 'maintenance' as const,
        startPct: pct(r.maintenanceStartDate),
        widthPct: pct(r.eolDate) - pct(r.maintenanceStartDate),
        startISO: r.maintenanceStartDate,
        endISO: r.eolDate,
      },
    ],
  }));

  const startYear = new Date(startMs).getUTCFullYear();
  const endYear = new Date(endMs).getUTCFullYear();
  const yearLines: YearLine[] = [];
  for (let y = startYear + 1; y <= endYear; y++) {
    const p = pct(`${y}-01-01`);
    if (p >= 0 && p <= 100) yearLines.push({ year: y, pct: p });
  }

  const todayPct = ((Date.now() - startMs) / span) * 100;

  return {
    rangeStartISO: new Date(startMs).toISOString().slice(0, 10),
    rangeEndISO: new Date(endMs).toISOString().slice(0, 10),
    rows,
    yearLines,
    todayPct,
  };
}

function eolToRow(r: EolRelease): RowInput {
  return {
    version: r.version,
    kind: 'eol',
    releaseDate: r.releaseDate,
    maintenanceStartDate: r.maintenanceStartDate,
    eolDate: r.eolDate,
    derived: r.derived,
  };
}

/** Rows for the chart: upcoming (top) → supported → recent EOL (bottom). */
export const chart: ChartModel = buildChart([
  ...(upcoming
    ? [
        {
          version: upcoming.version,
          kind: 'upcoming' as const,
          releaseDate: upcoming.releaseDate,
          maintenanceStartDate: upcoming.projectedMaintenanceStartDate,
          eolDate: upcoming.projectedEolDate,
          derived: true,
        },
      ]
    : []),
  ...supported.map((r) => ({
    version: r.version,
    kind: 'supported' as const,
    releaseDate: r.releaseDate,
    maintenanceStartDate: r.maintenanceStartDate,
    eolDate: r.eolDate,
    derived: r.derived,
  })),
  ...recentEol.map(eolToRow),
]);
