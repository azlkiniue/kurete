/**
 * Client-side enhancement: keeps every countdown, relative time, traffic-light
 * color, and the chart's "today" line live. Also wires the theme toggle and the
 * EOL "show more" expander. Server-rendered values are the no-JS fallback.
 */
import {
  endsText,
  cellLevel,
  sinceText,
  countdownParts,
  formatCountdown,
} from './dates';

const LEVELS = ['lvl-ok', 'lvl-soon', 'lvl-past'];

/** Precise, second-by-second countdowns. */
function tickCountdowns(): void {
  const now = Date.now();
  document.querySelectorAll<HTMLElement>('[data-countdown]').forEach((el) => {
    const target = el.dataset.countdown;
    if (!target) return;
    const p = countdownParts(target, now);
    if (p.isPast) {
      el.textContent = el.dataset.countdownPast ?? 'now';
      el.classList.add('is-past');
    } else {
      el.textContent = formatCountdown(p);
      el.classList.remove('is-past');
    }
  });
}

/** Humanized "Ends in / Ended ago", "time since", and cell colors. */
function refreshRelatives(): void {
  const now = new Date();

  document.querySelectorAll<HTMLElement>('[data-ends]').forEach((el) => {
    const target = el.dataset.ends;
    if (!target) return;
    el.textContent = endsText(target, now);
    const level = cellLevel(target, now);
    el.classList.remove(...LEVELS);
    el.classList.add(`lvl-${level}`);
  });

  document.querySelectorAll<HTMLElement>('[data-since]').forEach((el) => {
    const target = el.dataset.since;
    if (!target) return;
    el.textContent = sinceText(target, now);
  });

  refreshTodayLine();
}

/** Position the chart's "today" marker for the current instant. */
function refreshTodayLine(): void {
  const chart = document.querySelector<HTMLElement>('[data-chart]');
  if (!chart) return;
  const startISO = chart.dataset.rangeStart;
  const endISO = chart.dataset.rangeEnd;
  const line = chart.querySelector<HTMLElement>('[data-today-line]');
  if (!startISO || !endISO || !line) return;

  const start = Date.parse(`${startISO}T00:00:00Z`);
  const end = Date.parse(`${endISO}T00:00:00Z`);
  const pct = ((Date.now() - start) / (end - start)) * 100;
  if (pct < 0 || pct > 100) {
    line.style.display = 'none';
  } else {
    line.style.display = '';
    line.style.left = `${pct}%`;
  }
}

function initThemeToggle(): void {
  const btn = document.querySelector<HTMLElement>('[data-theme-toggle]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* ignore */
    }
  });
}

function initExpanders(): void {
  document.querySelectorAll<HTMLElement>('[data-toggle-extra]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const scope = btn.closest<HTMLElement>('[data-extra-scope]');
      if (!scope) return;
      const expanded = scope.classList.toggle('show-extra');
      const next = expanded ? btn.dataset.less : btn.dataset.more;
      if (next) btn.textContent = next;
      btn.setAttribute('aria-expanded', String(expanded));
    });
  });
}

function start(): void {
  tickCountdowns();
  refreshRelatives();
  initThemeToggle();
  initExpanders();
  window.setInterval(tickCountdowns, 1000);
  window.setInterval(refreshRelatives, 30_000);
}

if (document.readyState !== 'loading') start();
else document.addEventListener('DOMContentLoaded', start);
