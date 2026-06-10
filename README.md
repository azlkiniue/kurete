# Kubernetes Release Timeline

A fast, static dashboard that tracks the Kubernetes release lifecycle — support
windows, end-of-life dates, and the next release — with **countdowns that tick
live in the browser**.

Built with [Astro](https://astro.build) and [Bun](https://bun.sh). No backend,
no Node.js — deploys to **GitHub Pages** or **Cloudflare Pages** as plain static
files.

![Kubernetes Release Timeline](https://kubernetes.io/images/favicon.png)

## Features

- **Timeline (Gantt) chart** of Active Support and Maintenance Support windows
  for recent, current, and upcoming releases, with a live "today" marker.
- **Supported-releases table** colour-coded like a traffic light — green / yellow
  (deadline within 90 days) / red (passed) — for both support phases.
- **Upcoming release panel** for the next minor version: a live countdown to GA
  plus the full release-cycle milestone schedule (freezes, KubeCons, etc.).
- **End-of-life archive** of every release back to **v1.2 (2016)**, with a
  "time since EOL" counter for historical documentation.
- **Live countdowns** to the next release, the next end-of-life, and the next
  patch day — updated every second, client-side.
- **Light / dark theme**, fully responsive, accessible, and zero client
  frameworks (just a small vanilla-JS enhancement script).

## Data sources

All data comes from the official repositories that back
<https://kubernetes.io/releases/>:

| File | Repository | Provides |
| --- | --- | --- |
| `data/releases/schedule.yaml` | `kubernetes/website` | Supported releases, patch history, upcoming patch days |
| `data/releases/eol.yaml` | `kubernetes/website` | Full end-of-life history |
| `releases/release-<next>/README.md` | `kubernetes/sig-release` | The next, not-yet-released minor and its milestones |

Supported and upcoming releases use **exact** upstream dates. EOL releases only
publish their EOL date and final patch upstream, so their release/maintenance
dates are **derived** from Kubernetes' documented ~14-month support policy and
flagged in the UI with a `≈`.

## How the data pipeline works

```
bun run fetch   →  scripts/fetch-data.ts  →  src/data/snapshot.json  →  Astro build
```

- `bun run fetch` downloads and normalizes the sources into
  `src/data/snapshot.json`.
- `snapshot.json` is **committed** so the build is reproducible, works offline,
  and never breaks if the upstream repos are unavailable.
- If a fetch fails, the previous snapshot is kept and the build continues
  (the footer shows "served from cache").
- `bun run build` runs the fetch first, then `astro build`, so every deploy ships
  fresh data.

## Local development

```bash
bun install      # install dependencies
bun run dev      # dev server at http://localhost:4321
bun run fetch    # refresh src/data/snapshot.json from upstream
bun run build    # fetch + production build into dist/
bun run preview  # serve the production build locally
bun run check    # type-check (astro check)
```

## Deployment

The site is host-agnostic. Base path and canonical URL are read from environment
variables at build time:

| Variable | Default | Use |
| --- | --- | --- |
| `BASE_PATH` | `/` | Sub-path the site is served from (e.g. `/my-repo`) |
| `SITE` | `https://example.github.io` | Canonical origin for metadata |

### GitHub Pages (automated)

A workflow is included at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

1. Push this project to a GitHub repository.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Done. The workflow builds with Bun and deploys on every push to `main`,
   **daily at 06:00 UTC** (to keep countdowns fresh), and on manual dispatch.
   It sets `BASE_PATH` / `SITE` automatically via `actions/configure-pages`.

### Cloudflare Pages

Connect the repo in the Cloudflare dashboard with:

- **Build command:** `bun run build`
- **Build output directory:** `dist`
- **Base path:** leave unset (served from root)

Cloudflare detects Bun automatically from `bun.lock`. To keep data fresh, add a
[Deploy Hook](https://developers.cloudflare.com/pages/configuration/deploy-hooks/)
and trigger it on a schedule (e.g. a GitHub Action `curl`-ing the hook daily).

### Any other static host

```bash
bun run build          # outputs to dist/
# upload dist/ to Netlify, S3, Vercel, nginx, ...
```

## Project structure

```
scripts/fetch-data.ts          # build-time data fetch + normalization
src/
  data/
    types.ts                   # snapshot type definitions
    snapshot.json              # committed data snapshot (generated)
    releases.ts                # view model + timeline chart geometry
  lib/
    dates.ts                   # date math, durations, status, colors (shared)
    countdown.client.ts        # live countdowns / colors / today line / toggles
  components/
    TimelineChart.astro        # Gantt chart
    ReleaseTable.astro         # supported + recent EOL table
    UpcomingReleases.astro     # next minor + milestones + patch days
    EolReleases.astro          # historical EOL archive
  layouts/Base.astro           # shell, global styles, theming
  pages/index.astro            # the page
```

## Notes

- Countdowns and traffic-light colours are computed **client-side** from ISO
  dates, so they stay correct between rebuilds; server-rendered values are the
  no-JS fallback.
- This project is **not affiliated** with the Kubernetes project. Kubernetes and
  its logo are trademarks of the Linux Foundation.
