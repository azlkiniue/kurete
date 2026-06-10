#!/usr/bin/env bun
/**
 * Fetches the official Kubernetes release data and normalizes it into
 * src/data/snapshot.json, which the Astro build consumes.
 *
 * Sources (all from the repos that back https://kubernetes.io/releases/):
 *   - schedule.yaml  (kubernetes/website) -> supported releases + upcoming patches
 *   - eol.yaml       (kubernetes/website) -> end-of-life release history
 *   - sig-release    (kubernetes/sig-release) -> the next, unreleased minor
 *
 * Resilience: on any network/parse failure this script logs a warning and
 * leaves the previously-committed snapshot untouched (exit 0), so the build
 * never breaks and works offline.
 *
 * Run with:  bun run fetch
 */

import yaml from 'js-yaml';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  Snapshot,
  SupportedRelease,
  EolRelease,
  UpcomingRelease,
  UpcomingPatch,
  PatchRef,
  Milestone,
} from '../src/data/types.ts';

const SCHEDULE_URL =
  'https://raw.githubusercontent.com/kubernetes/website/main/data/releases/schedule.yaml';
const EOL_URL =
  'https://raw.githubusercontent.com/kubernetes/website/main/data/releases/eol.yaml';
const SIG_RELEASE_README = (v: string) =>
  `https://raw.githubusercontent.com/kubernetes/sig-release/master/releases/release-${v}/README.md`;
// kube-api.ninja (by xrstf) provides exact historical release dates that the
// official sources drop once a release reaches EOL. Used only to fill that gap.
const KUBE_API_SITE = 'https://kube-api.ninja/';
const KUBE_API_RAW =
  'https://codeberg.org/xrstf/kube-api.ninja/raw/branch/main/data/releases';
// Releases older than the official eol.yaml archive (which starts at 1.2).
const PRE_OFFICIAL_VERSIONS = ['1.1', '1.0'];

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(HERE, '..', 'src', 'data', 'snapshot.json');

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'kubernetes-release-timeline (build script)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/** Coerce a YAML scalar (string or Date) into an ISO calendar date. */
function asISO(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonths(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return toISODate(d);
}

/** Parse "1.34" -> [1, 34] for numeric comparison. */
function parseVersion(v: string): [number, number] {
  const [maj, min] = v.split('.').map((n) => parseInt(n, 10));
  return [maj || 0, min || 0];
}

function compareVersionDesc(a: string, b: string): number {
  const [am, an] = parseVersion(a);
  const [bm, bn] = parseVersion(b);
  return bm - am || bn - an;
}

function comparePatchDesc(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Parse the first "26th August 2026"-style date out of a string. */
function parseLongDate(text: string): string | null {
  const m = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = MONTHS[m[2].toLowerCase()];
  const year = parseInt(m[3], 10);
  if (!month || !day || !year) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Strip markdown link syntax: [text][ref] / [text](url) -> text. */
function stripMdLinks(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Derive maintenance-mode start from an exact release date, clamped to the EOL window. */
function deriveMaintStart(releaseISO: string, eolISO: string): string {
  let ms = addMonths(releaseISO, 12); // standard support ≈ 12 months
  if (ms >= eolISO) ms = addMonths(eolISO, -2); // older/short-lived releases
  if (ms <= releaseISO) ms = releaseISO;
  return ms;
}

/** Run `fn` over `items` with bounded concurrency, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Fetch a single kube-api.ninja data file (e.g. "released"), or null on any failure. */
async function fetchKubeFile(version: string, file: string): Promise<string | null> {
  try {
    const v = (await fetchText(`${KUBE_API_RAW}/${version}/${file}.txt`, 12000)).trim();
    if (!v) return null;
    if ((file === 'released' || file === 'eol') && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    return v;
  } catch {
    return null;
  }
}

function readPriorSnapshot(): Snapshot | null {
  try {
    return JSON.parse(readFileSync(OUT_PATH, 'utf8')) as Snapshot;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// parsers
// ---------------------------------------------------------------------------

interface RawPatch {
  release?: string;
  targetDate?: unknown;
  cherryPickDeadline?: unknown;
  note?: string;
}
interface RawSchedule {
  release?: string;
  releaseDate?: unknown;
  maintenanceModeStartDate?: unknown;
  endOfLifeDate?: unknown;
  next?: RawPatch;
  previousPatches?: RawPatch[];
}
interface RawScheduleFile {
  schedules?: RawSchedule[];
  upcoming_releases?: RawPatch[];
}

function parseSchedule(text: string): {
  supported: SupportedRelease[];
  upcomingPatches: UpcomingPatch[];
} {
  const doc = yaml.load(text) as RawScheduleFile;
  const schedules = doc.schedules ?? [];

  const supported: SupportedRelease[] = schedules
    .filter((s) => s.release)
    .map((s) => {
      const prev = (s.previousPatches ?? [])
        .filter((p) => p.release)
        .sort((a, b) => comparePatchDesc(a.release!, b.release!));

      const latestPatch: PatchRef | null = prev[0]
        ? {
            version: prev[0].release!,
            date: asISO(prev[0].targetDate),
            ...(prev[0].cherryPickDeadline
              ? { cherryPickDeadline: asISO(prev[0].cherryPickDeadline) }
              : {}),
            ...(prev[0].note ? { note: prev[0].note } : {}),
          }
        : null;

      const nextPatch: PatchRef | null = s.next?.release
        ? {
            version: s.next.release,
            date: asISO(s.next.targetDate),
            ...(s.next.cherryPickDeadline
              ? { cherryPickDeadline: asISO(s.next.cherryPickDeadline) }
              : {}),
            ...(s.next.note ? { note: s.next.note } : {}),
          }
        : null;

      return {
        version: s.release!,
        releaseDate: asISO(s.releaseDate),
        maintenanceStartDate: asISO(s.maintenanceModeStartDate),
        eolDate: asISO(s.endOfLifeDate),
        latestPatch,
        nextPatch,
        patchCount: prev.length,
        derived: false as const,
      };
    })
    .sort((a, b) => compareVersionDesc(a.version, b.version));

  const upcomingPatches: UpcomingPatch[] = (doc.upcoming_releases ?? [])
    .filter((p) => p.targetDate)
    .map((p) => ({
      targetDate: asISO(p.targetDate),
      ...(p.cherryPickDeadline ? { cherryPickDeadline: asISO(p.cherryPickDeadline) } : {}),
    }))
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate));

  return { supported, upcomingPatches };
}

interface RawEolBranch {
  release?: string;
  endOfLifeDate?: unknown;
  finalPatchRelease?: unknown;
  note?: string;
}
interface RawEolFile {
  branches?: RawEolBranch[];
}

/**
 * Build the EOL release list. The official eol.yaml supplies the EOL date and
 * final patch; the exact release date is taken from kube-api.ninja (the official
 * sources drop it once a release is EOL). Releases predating the official archive
 * (1.0, 1.1) are sourced entirely from kube-api.ninja.
 *
 * Exact release dates already known from a prior snapshot — or from the official
 * schedule while the release was still supported — are reused, so kube-api.ninja
 * is generally only queried for the one-time historical backfill.
 */
async function buildEol(
  eolText: string,
  prior: Snapshot | null,
  excludeVersions: Set<string>,
): Promise<EolRelease[]> {
  const doc = yaml.load(eolText) as RawEolFile;
  const official = (doc.branches ?? []).filter((b) => b.release);
  const today = new Date().toISOString().slice(0, 10);

  // Cache of exact release dates we already have (immutable history).
  const knownRelease = new Map<string, string>();
  for (const r of prior?.supported ?? []) knownRelease.set(r.version, r.releaseDate);
  for (const r of prior?.eol ?? []) {
    if (r.releaseDateExact) knownRelease.set(r.version, r.releaseDate);
  }
  const priorEol = new Map((prior?.eol ?? []).map((r) => [r.version, r] as const));

  // Official EOL branches: keep eol/finalPatch, fill release date.
  const officialRecords = await mapLimit(official, 6, async (b): Promise<EolRelease> => {
    const version = b.release!;
    const eolDate = asISO(b.endOfLifeDate);
    let releaseDate = knownRelease.get(version);
    let releaseDateExact = releaseDate !== undefined;
    if (releaseDate === undefined) {
      const fetched = await fetchKubeFile(version, 'released');
      if (fetched) {
        releaseDate = fetched;
        releaseDateExact = true;
      } else {
        releaseDate = addMonths(eolDate, -14); // policy fallback
        releaseDateExact = false;
      }
    }
    return {
      version,
      eolDate,
      finalPatch: String(b.finalPatchRelease ?? ''),
      releaseDate,
      maintenanceStartDate: deriveMaintStart(releaseDate, eolDate),
      releaseDateExact,
      eolSource: 'kubernetes',
      ...(b.note ? { note: b.note } : {}),
    };
  });

  // Pre-archive historical releases (1.0, 1.1), entirely from kube-api.ninja.
  const officialVersions = new Set(official.map((b) => b.release!));
  const extraRecords: EolRelease[] = [];
  for (const version of PRE_OFFICIAL_VERSIONS) {
    if (officialVersions.has(version) || excludeVersions.has(version)) continue;
    const cached = priorEol.get(version);
    if (cached?.eolSource === 'kube-api') {
      extraRecords.push(cached);
      continue;
    }
    const [released, eol, latest] = await Promise.all([
      fetchKubeFile(version, 'released'),
      fetchKubeFile(version, 'eol'),
      fetchKubeFile(version, 'latest'),
    ]);
    if (released && eol && latest && eol < today) {
      extraRecords.push({
        version,
        eolDate: eol,
        finalPatch: latest,
        releaseDate: released,
        maintenanceStartDate: deriveMaintStart(released, eol),
        releaseDateExact: true,
        eolSource: 'kube-api',
      });
    }
  }

  return [...officialRecords, ...extraRecords].sort((a, b) =>
    compareVersionDesc(a.version, b.version),
  );
}

/** Best-effort parse of a sig-release README "## Summary" milestone list. */
function parseUpcomingReadme(
  text: string,
  version: string,
  url: string,
): UpcomingRelease | null {
  const milestones: Milestone[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const m = line.match(/^[-*]\s+\*\*(.+?)\*\*\s*[:\-—]\s*(.+)$/);
    if (!m) continue;
    const date = parseLongDate(m[1]);
    if (!date) continue;
    milestones.push({ date, label: stripMdLinks(m[2]) });
  }
  if (milestones.length === 0) return null;

  milestones.sort((a, b) => a.date.localeCompare(b.date));

  const releaseMilestone =
    milestones.find((x) => /released/i.test(x.label)) ??
    milestones[milestones.length - 1];
  const cycleStart =
    milestones.find((x) => /(cycle begins|release cycle begins|week 1\b)/i.test(x.label))
      ?.date ?? milestones[0]?.date ?? null;

  const releaseDate = releaseMilestone.date;
  return {
    version,
    releaseDate,
    projectedMaintenanceStartDate: addMonths(releaseDate, 12),
    projectedEolDate: addMonths(releaseDate, 14),
    cycleStart,
    milestones,
    estimated: false,
    source: url,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  console.log('▸ Fetching Kubernetes release data…');

  // schedule.yaml + eol.yaml are required; sig-release is best-effort.
  const [scheduleText, eolText] = await Promise.all([
    fetchText(SCHEDULE_URL),
    fetchText(EOL_URL),
  ]);

  const { supported, upcomingPatches } = parseSchedule(scheduleText);

  if (supported.length === 0) {
    throw new Error('schedule.yaml produced 0 supported releases — refusing to overwrite snapshot');
  }

  // Next minor = latest supported minor + 1.
  const [maj, min] = parseVersion(supported[0].version);
  const nextVersion = `${maj}.${min + 1}`;
  const upcomingUrl = SIG_RELEASE_README(nextVersion);

  let upcoming: UpcomingRelease | null = null;
  try {
    const readme = await fetchText(upcomingUrl);
    upcoming = parseUpcomingReadme(readme, nextVersion, upcomingUrl);
    if (upcoming) {
      console.log(
        `  ✓ upcoming ${nextVersion}: ${upcoming.releaseDate} (${upcoming.milestones.length} milestones)`,
      );
    }
  } catch (err) {
    console.warn(`  ! could not read sig-release schedule for ${nextVersion}: ${(err as Error).message}`);
  }

  // Fallback: project the next minor from the cadence (~4 months) if needed.
  if (!upcoming) {
    const releaseDate = addMonths(supported[0].releaseDate, 4);
    upcoming = {
      version: nextVersion,
      releaseDate,
      projectedMaintenanceStartDate: addMonths(releaseDate, 12),
      projectedEolDate: addMonths(releaseDate, 14),
      cycleStart: null,
      milestones: [],
      estimated: true,
      source: upcomingUrl,
    };
    console.log(`  ~ upcoming ${nextVersion}: ${releaseDate} (projected from cadence)`);
  }

  // EOL list: official eol.yaml + exact historical release dates from kube-api.ninja.
  const prior = readPriorSnapshot();
  const excludeVersions = new Set<string>([...supported.map((r) => r.version), nextVersion]);
  const eol = await buildEol(eolText, prior, excludeVersions);
  const enriched = eol.filter((r) => r.releaseDateExact).length;
  console.log(`  ✓ EOL: ${eol.length} releases (${enriched} with exact release dates)`);

  const snapshot: Snapshot = {
    generatedAt: new Date().toISOString(),
    fresh: true,
    sources: {
      schedule: SCHEDULE_URL,
      eol: EOL_URL,
      upcoming: upcomingUrl,
      kubeApi: KUBE_API_SITE,
    },
    supported,
    eol,
    upcoming,
    upcomingPatches,
  };

  writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(
    `✓ Wrote snapshot.json — ${supported.length} supported, ${eol.length} EOL, next minor ${nextVersion}`,
  );
}

main().catch((err) => {
  console.error(`✗ Fetch failed: ${(err as Error).message}`);
  if (existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, 'utf8')) as Snapshot;
      prev.fresh = false;
      writeFileSync(OUT_PATH, JSON.stringify(prev, null, 2) + '\n');
    } catch {
      /* leave the file as-is */
    }
    console.error('  → keeping previously-committed snapshot.json (build will continue).');
    process.exit(0);
  }
  console.error('  → no existing snapshot.json to fall back to.');
  process.exit(1);
});
