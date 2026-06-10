/**
 * Pure date/status helpers shared by the Astro build (server) and the
 * client-side countdown script. No DOM access — safe to import anywhere.
 */

export const MS_PER_DAY = 86_400_000;

/** Parse "YYYY-MM-DD" as UTC midnight. */
export function parseISODate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** Format "2026-06-28" -> "28 Jun 2026". */
const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
export function formatDate(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getUTCDate()} ${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface YMWD {
  years: number;
  months: number;
  weeks: number;
  days: number;
  /** Whole calendar days between the two dates (sign-less). */
  totalDays: number;
}

/**
 * Calendar difference between two instants, measured on their UTC date parts
 * (time-of-day ignored), always returned as a positive magnitude.
 */
export function calendarDiff(a: Date, b: Date): YMWD {
  let from = a;
  let to = b;
  if (from > to) [from, to] = [to, from];

  const fromUTC = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toUTC = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  const totalDays = Math.round((toUTC - fromUTC) / MS_PER_DAY);

  let years = to.getUTCFullYear() - from.getUTCFullYear();
  let months = to.getUTCMonth() - from.getUTCMonth();
  let days = to.getUTCDate() - from.getUTCDate();

  if (days < 0) {
    months -= 1;
    // number of days in the month preceding `to`
    const daysInPrevMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 0)).getUTCDate();
    days += daysInPrevMonth;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const weeks = Math.floor(days / 7);
  days = days % 7;

  return { years, months, weeks, days, totalDays };
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** Render a YMWD as the top `maxUnits` non-zero units, e.g. "6 months and 3 weeks". */
export function humanize(diff: YMWD, maxUnits = 2): string {
  const parts: string[] = [];
  if (diff.years) parts.push(plural(diff.years, 'year'));
  if (diff.months) parts.push(plural(diff.months, 'month'));
  if (diff.weeks) parts.push(plural(diff.weeks, 'week'));
  if (diff.days) parts.push(plural(diff.days, 'day'));

  if (parts.length === 0) return 'today';
  return parts.slice(0, maxUnits).join(' and ');
}

export interface Relative {
  isPast: boolean;
  /** Magnitude only, e.g. "6 months and 3 weeks". */
  human: string;
  totalDays: number;
}

/** Relative magnitude of `targetISO` vs `now` (date-part precision). */
export function relativeFromNow(targetISO: string, now: Date = new Date()): Relative {
  const target = parseISODate(targetISO);
  const diff = calendarDiff(now, target);
  const targetUTC = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const nowUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    isPast: targetUTC < nowUTC,
    human: humanize(diff),
    totalDays: diff.totalDays,
  };
}

/** Compose "time since/until" phrasing: "today" / "3 months ago" / "in 2 weeks". */
export function sinceText(targetISO: string, now: Date = new Date()): string {
  const rel = relativeFromNow(targetISO, now);
  if (rel.totalDays === 0) return 'today';
  return rel.isPast ? `${rel.human} ago` : `in ${rel.human}`;
}

/** Compose the table-cell phrasing: "Ends in X (date)" / "Ended X ago (date)". */
export function endsText(targetISO: string, now: Date = new Date()): string {
  const rel = relativeFromNow(targetISO, now);
  if (rel.totalDays === 0) return `Ends today (${formatDate(targetISO)})`;
  return rel.isPast
    ? `Ended ${rel.human} ago (${formatDate(targetISO)})`
    : `Ends in ${rel.human} (${formatDate(targetISO)})`;
}

export type CellLevel = 'ok' | 'soon' | 'past';

/** Traffic-light level for a deadline: red if past, yellow if within `soonDays`. */
export function cellLevel(targetISO: string, now: Date = new Date(), soonDays = 90): CellLevel {
  const target = parseISODate(targetISO);
  const targetUTC = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const nowUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (targetUTC <= nowUTC) return 'past';
  const days = Math.round((targetUTC - nowUTC) / MS_PER_DAY);
  return days <= soonDays ? 'soon' : 'ok';
}

export type ReleaseStatus = 'upcoming' | 'active' | 'maintenance' | 'eol';

export function releaseStatus(
  r: { releaseDate: string; maintenanceStartDate: string; eolDate: string },
  now: Date = new Date(),
): ReleaseStatus {
  const t = now.getTime();
  if (t < parseISODate(r.releaseDate).getTime()) return 'upcoming';
  if (t < parseISODate(r.maintenanceStartDate).getTime()) return 'active';
  if (t < parseISODate(r.eolDate).getTime()) return 'maintenance';
  return 'eol';
}

export interface CountdownParts {
  isPast: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
}

/** Precise ticking countdown to/from a target (used client-side, second precision). */
export function countdownParts(targetISO: string, nowMs: number = Date.now()): CountdownParts {
  const targetMs = parseISODate(targetISO).getTime();
  const delta = targetMs - nowMs;
  const isPast = delta < 0;
  let ms = Math.abs(delta);
  const days = Math.floor(ms / MS_PER_DAY);
  ms -= days * MS_PER_DAY;
  const hours = Math.floor(ms / 3_600_000);
  ms -= hours * 3_600_000;
  const minutes = Math.floor(ms / 60_000);
  ms -= minutes * 60_000;
  const seconds = Math.floor(ms / 1000);
  return { isPast, days, hours, minutes, seconds, totalMs: Math.abs(delta) };
}

/** "77d 04h 12m 09s" */
export function formatCountdown(p: CountdownParts): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.days}d ${pad(p.hours)}h ${pad(p.minutes)}m ${pad(p.seconds)}s`;
}
