# AI Conferences Map — Design

Status: agreed design (grilling session, 2026-10-22). Nothing built yet.
Build will be driven by `/orchestrate` from this document.

## 1. Purpose

A map-first single-page app showing where AI conferences **and their regional satellite events**
(e.g. [NeurIPS 2026 Paris](https://neurips-europe.cc/)) take place, so researchers can attend the
location closest to them and travel less. Think [aideadlin.es](https://aideadlin.es), but organized
around *where and when* rather than submission countdowns.

Personal, non-commercial project.

### Non-goals

- Re-implementing deadline countdowns (link to the HF site instead).
- Venue-precise pins, route planning, booking.
- Any backend, accounts, or server-side state.

## 2. Architecture overview

Fully static site on GitHub Pages. All data work happens at build time in GitHub Actions; all
per-viewer computation (distance, CO₂, filters) happens in the browser.

```
huggingface/ai-deadlines (GitHub, MIT)          data/satellites.yml   (hand-curated)
  src/data/conferences/*.yml                    data/overrides.yml    (manual lat/lng etc.)
            │                                   data/archive/         (frozen past events)
            │  daily cron: sync                 data/geocache.json    (reviewed coordinates)
            ▼                                              │
   scripts/build-data.ts ◄─────────────────────────────────┘
     normalize → merge archive → freeze ended events → apply overrides
     → geocode new keys (Nominatim) → validate (Zod) → data/build/data.json
            │  commit only if changed
            ▼
   vite build → GitHub Pages (Svelte 5 SPA, MapLibre, OpenFreeMap tiles)

weekly cron: scripts/discover/ (Python, Claude API) ──► PR to data/satellites.yml (never auto-merged)
```

### Proposed repo layout

```
data/
  satellites.yml          # curated satellites (schema §3.2)
  overrides.yml           # per-location overrides, keyed by location id
  geocache.json           # "city|country" (normalized) → {lat, lng, display_name}
  co2-factors.json        # extracted DESNZ factors, versioned by year (§5)
  archive/                # frozen past events, never deleted (§3.4)
  build/data.json         # generated, committed (diff = audit trail)
scripts/
  build-data.ts           # sync + merge + freeze + geocode + validate + emit
  schema.ts               # Zod schemas, shared with the app's types
  discover/               # Python discovery agent (uv project, §4)
  backfill-pwc.ts         # one-off historical import (§3.4, deferred)
src/
  lib/filters/            # one file per filter (§6.3)
  lib/co2/                # CO₂ model (§5)
  lib/geo/                # haversine, city search, geolocation snapping
  lib/state/              # app state, URL + localStorage sync
  components/             # map, list, detail, timeline, filter panel, settings
public/cities.json        # GeoNames cities subset for home-city autocomplete (lazy-loaded)
.github/workflows/        # ci.yml, sync.yml (daily), discover.yml (weekly), deploy.yml
METHODOLOGY.md            # CO₂ estimation method, linked from the app
PRIVACY.md                # what is (not) collected, linked from the footer
```

Data scripts are TypeScript so the Zod schema is shared with the app. The discovery agent is
Python (managed with `uv`).

## 3. Data

### 3.1 Upstream conferences

- Source: GitHub repo `huggingface/ai-deadlines`, `src/data/conferences/*.yml` (68 files at time of
  writing; years 2025–2027). Pull from the GitHub repo, not the HF Space.
- `paperswithcode/ai-deadlines` (the original aideadlin.es source) is stale since 2024-09 and is only
  used for the historical backfill.
- Relevant upstream fields: `title`, `year`, `id` (e.g. `neurips26`), `full_name`, `link`,
  `deadlines[]` (type/label/date/timezone), `city`, `country`, `venue` (free text, may list several
  places), `start`, `end`, `tags`.
- Upstream `city`/`country` is the conference's implicit **main** location.

### 3.2 Satellites — `data/satellites.yml`

Satellites are regional events tied to a parent conference, held in a different city.

**Inclusion rule:** official satellites (endorsed/run by the parent conference) **and** substantial
community-run events — those with their own program tied to the parent conference's accepted work,
with at least a date, a city, and a public page. Meetups, watch parties and reading groups are out of scope.

```yaml
- id: neurips26-paris            # required, unique, stable; used in URLs and dedup
  parent: neurips26              # upstream conference id (must exist)
  name: NeurIPS Europe – Paris
  link: https://neurips-europe.cc/
  city: Paris
  country: France
  venue: <optional>
  start: '2026-12-09'
  end: '2026-12-13'
  official: true                 # endorsed by the parent conference
  presents_papers: true          # accepted papers can be presented here
  access: authors_only           # open | registration | authors_only
  notes: Waitlist for non-presenters closed
  sources: [https://neurips-europe.cc/]   # optional; evidence URLs
```

`id` and `sources` were added during write-up (needed for dedup/URLs and auditability).

**Curation:** only the owner edits YAML. The discovery agent (§4) proposes changes via PR.

### 3.3 Locations, geocoding, overrides

- Pins are **city-level** (city centroid). Distance/CO₂ do not need more precision.
- Geocoding: **Nominatim at build time**, max 1 req/s, identifying User-Agent (per its usage
  policy), cached in `data/geocache.json` keyed by normalized `"city|country"`.
- New cache keys appear in the sync commit / PR diff so every new coordinate is reviewed.
- **CI fails** on any unresolved location (never emit a pin at 0,0).
- `data/overrides.yml`: optional manual `lat`/`lng` (and other field fixes) keyed by location id.
  Used for multi-venue upstream strings like NeurIPS 2025 (San Diego & Mexico City).

### 3.4 History & archive

- Past events are first-class (history view, "Past 5y" preset).
- **Archive-and-freeze:** once an event's `end` < today, its current state is written to
  `data/archive/`. The sync **adds and updates, never removes**, so upstream pruning cannot erase history.
- **Backfill (deferred):** one-time import of ~2017–2024 from `paperswithcode/ai-deadlines`
  `conferences.yml` (free-text `place` → geocode + manual review, dedupe against HF ids).
- **Past satellites:** the discovery agent runs in a backfill mode for past editions
  (e.g. NeurIPS 2025 Mexico City, EurIPS 2025 Copenhagen); same PR + evidence review.
- History grouping: a conference **series key** = normalized `title` (e.g. `icml`), so editions
  across years and sources link together.

### 3.5 Normalized output — `data/build/data.json`

```ts
type Conference = {
  id: string; series: string; title: string; year: number; fullName?: string;
  link: string; tags: string[]; deadlines: Deadline[]; start: string; end: string;
  source: "hf" | "pwc" | "archive";
};
type EventLocation = {
  id: string;                 // `${conferenceId}@main` or satellite id
  conferenceId: string;
  role: "main" | "satellite";
  name: string; city: string; country: string; venue?: string;
  lat: number; lng: number;
  start: string; end: string; // satellites use their own dates
  official: boolean; presentsPapers: boolean;
  access: "open" | "registration" | "authors_only";
  link: string; notes?: string;
};
```

Main locations default to `official: true`, `presentsPapers: true`, `access: "registration"`.

### 3.6 Seed satellites (verify before committing)

- NeurIPS 2026 Paris — Dec 9–13 (main conf 9–11, workshops 12–13), authors only, official.
  Note: NeurIPS 2026's main venue is **Sydney**.
- NeurIPS 2025 Mexico City — from upstream `venue` string.
- EurIPS 2025 Copenhagen — endorsed by NeurIPS.

## 4. Discovery agent

Purpose: find satellites the owner would never hear about, especially community events.

- **Runtime:** Python script in GitHub Actions, weekly cron. Not Claude Code Action, not Managed
  Agents.
- **Model:** `claude-opus-5-5`, effort `medium`, with server-side `web_search_20260209` and
  `web_fetch_20260209` tools and **structured output**. Enable server-side refusal fallback.
- **Scope per run:** one call per conference starting within the next ~12 months; a separate
  backfill mode for past editions.
- **Output schema:** a list of candidate satellites matching §3.2, where **every field is
  `{value, source_url, quote}`**. Fields without a supporting quote are omitted, never guessed.
- **Deterministic code owns all writes:** validate JSON → diff against `satellites.yml`
  (dedupe by `parent` + city) → propose additions **and updates** (e.g. access changed) →
  write YAML → open one PR per run with `gh`, evidence table in the PR body.
- **Never auto-merges.** The same CI validation (§9) runs on the PR.
- **Security:** fetched pages are untrusted. The model has no repo access or write tools; worst case
  of injection is a bogus candidate that still needs a real quote and human review.
- **Cost:** measure on a dry run before enabling the schedule. Secret: `ANTHROPIC_API_KEY`.

## 5. CO₂ estimation

### 5.1 Principle: estimates, orders of magnitude

All CO₂ figures are **estimates**. Wording must convey orders of magnitude, not precision:

- Always `~` + rounded to 2 significant figures: "~50 kg", "~1.4 t". Never "49.7 kg".
- Labels: "Estimated CO₂e" / "Rough footprint", never bare "CO₂".
- Comparisons emphasize scale: "Paris: roughly 25× less than flying to Sydney".
- Filter label: "Estimated footprint under ~X kg".
- Methodology note starts with "These are order-of-magnitude estimates…".

### 5.2 Method

- **Data:** official UK DESNZ (formerly BEIS/DEFRA) GHG conversion factors, latest year, extracted
  into `data/co2-factors.json` (versioned; updated yearly). Computed in-browser. No API, no proxy.
  (Climatiq rejected: free tier is non-commercial-only with vague limits, and rail can silently fall
  back to car routes.)
- **Distance:** great-circle (haversine) between home and location.
- **Mode (global setting):** `auto` = rail if distance < threshold, else flight; or `always fly`.
  Threshold default **700 km**, user-changeable. Per-trip toggle exists only in the detail panel and
  never affects filtering.
- **Flights:** economy class, **radiative forcing included** (labeled), DESNZ haul band chosen by
  distance, plus routing uplift per DESNZ guidance.
- **Round trip:** always.
- Mode is shown on every figure: "~50 kg 🚆", "~1.4 t ✈️".
- Exact factor rows, haul thresholds, routing uplift and any rail detour factor are chosen and
  justified in `METHODOLOGY.md` during implementation (see §11).

### 5.3 Cross-check link

- Flight estimates link to **myclimate** ("Cross-check this flight on myclimate"), with one line:
  "Different methods give different figures — same order of magnitude is expected."
- Prefill origin/destination via URL if myclimate supports it; otherwise a plain link.
- Accepted for now; replace if a better recognized calculator appears.

## 6. Frontend

### 6.1 Stack

Svelte 5 (runes) + Vite + TypeScript, **MapLibre GL JS**, **OpenFreeMap** vector tiles
(no key, no quota). Restyled muted basemap with light and dark variants.

### 6.2 Scope

Map-first, attendance-oriented. Deadlines appear as a quiet line in the detail panel
("Paper deadline: passed" / date) with a link to the HF site for countdowns.

### 6.3 Filters (extensible)

Filters test **individual locations**. The map shows only passing pins; the list shows a conference
if ≥1 of its locations passes, with the passing sites. Conference-level filters (e.g. subject) test
`loc.conference`. Filters combine with AND.

```ts
// One file per filter in src/lib/filters/; registered in a list. Adding a filter = adding a file.
interface Filter<S> {
  id: string;
  label: string;
  defaultState: S;
  isActive(s: S): boolean;                               // inactive → skipped, omitted from URL
  test(loc: EventLocation, ctx: Ctx, s: S): boolean;     // per-location predicate
  Control: Component<{ state: S; set(s: S): void; ctx: Ctx }>;
  toURL(s: S): string; fromURL(v: string): S;
}
// ctx = { home?: LatLng, units: "km"|"mi", mode: "auto"|"fly", threshold: number,
//         co2: Co2Model, today: Date }
```

Initial filters:

| id | What | Notes |
|---|---|---|
| `dates` | `{from, to}` window | Same state as the timeline (§6.4); test uses `end ≥ from && start ≤ to` |
| `subject` | conference tags | aideadlin.es-style; match the HF site's filter set |
| `search` | text match on title/full name | aideadlin.es-style |
| `radius` | within X km/mi of home | Needs home; greyed with "Set your location" otherwise |
| `co2` | estimated footprint under ~X kg | Needs home; uses global mode/threshold |
| `access` | open / registration / authors only | |
| `kind` | official / community | |
| `open` | submission still open | Next upstream deadline (abstract or paper) after today |

Filter panel renders only registered filters, collapsed by default, with an active-count badge.

### 6.4 Timeline / scrubber

The scrubber **is** the `dates` filter (one `{from, to}` state, two presentations).

```
 ▁▂▁▃▅▂▁▁▂█▃▁▁▂▁▃▆▂▁▁▂█▄▁▁▂▁▃▅▂▁▁▂█▃   ← events/month histogram
                ├────────────────────┤     ← window, both handles draggable
 [▶ play]  [Plan: 6m | 12m]  [Past 5y]  [speed 1×]
```

- **Plan mode (default on load):** window = today → +12 months, static. Presets 6m / 12m.
- **Play mode:** ▶ slides the current window forward (~1 month/s, speed control, pause, drag to
  scrub). Window width is whatever the viewer set.
  - Pins fade + scale in when entering, pulse while live (`start ≤ t ≤ end`), fade out when leaving.
  - Main↔satellite lines draw in when both ends are visible.
  - Pins never move position; simultaneous entries are **staggered** (attention/tracking limits).
- **History presets** ("Past 5y") only set the handles.
- **History mode:** from a conference's detail ("View history"), show all editions of its series,
  linked chronologically by a curved path with year labels; play travels the path. URL `?h=icml`.
- **Reduced motion:** play steps month by month with crossfades only.

### 6.5 Home location & privacy

- Home set via **city autocomplete** (GeoNames cities subset, lazy-loaded) or **"Use my location"**
  (browser geolocation).
- Geolocation results are **snapped to the nearest city on-device**; only the city is used/stored.
- Stored in `localStorage` only (wrap in try/catch; app works without it).
- **Not in URLs by default.** Share dialog has an opt-in "Include my city in the link" (city name only).
- Lines from home to visible sites when home is set; detail shows nearest site per conference.

### 6.6 URL state

Filters, window, selection and history mode live in the URL so views are shareable, e.g.
`?c=neurips26&sub=ML,CV&radius=1000&co2=300&from=2026-11&to=2027-10`.
Units, mode and threshold are also persisted in `localStorage`. Home is in the URL only via opt-in.

### 6.7 Layout

```
DESKTOP (≥ 1024px)
┌───────────────┬──────────────────────────────────────────┐
│ 📍 Berlin ▾ km│                                          │
│ 🚆<700km ✈️   │                                          │
├───────────────┤                 MAP                      │
│ FILTERS  [3]  │        (full bleed, clustered pins,      │
│ ▸ Subject     │         home→site lines when set)        │
│ ▸ Within km   │                                          │
│ ▸ CO₂ budget  │                               ┌────────┐ │
│ ▸ ...         │                               │ DETAIL │ │
├───────────────┤                               │ drawer │ │
│ LIST (n)      │                               └────────┘ │
│ NeurIPS · Paris 880km ~50kg🚆                            │
├───────────────┴──────────────────────────────────────────┤
│ ▁▂▃█▂▁ timeline / scrubber  ├──────window──────┤  ▶      │
└──────────────────────────────────────────────────────────┘

MOBILE
┌──────────────────────┐
│ 📍Berlin  [Filters 3]│  ← filters open as full-screen sheet
│        MAP           │
│ ▁▂█▂▁ ├──window──┤ ▶ │  ← compact scrubber
├──────────────────────┤
│ ═══ bottom sheet ═══ │  ← list; detail replaces list on select
└──────────────────────┘
```

- Hover list row → highlight its pins. Click pin/row → detail panel + fit map to the conference's sites.
- Detail: dates, deadline status, each site with access, distance, estimated CO₂, myclimate link,
  "View history".
- Selection stays highlighted while panning; "back to selection" control.
- Crowded areas cluster with counts; co-located events open a list.

### 6.8 Visual design

Tone: **calm and neutral** (Apple Maps × Linear). Modern, simple, clear.

- **Quiet basemap:** muted grayscale, POIs / most roads / minor labels removed. Data is the only
  saturated element.
- **Never color alone:** official = filled pin, community = outlined; main venue = larger pin;
  access = icon (🔒 authors only). Color reinforces only (~8% of men have color-vision impairment).
- Pins legible on both themes (halo/outline).
- **Single accent color** with contrast in both themes — deep teal or indigo, **not** eco-green.
- **Design tokens:** primitives → semantic tokens (`--surface`, `--ink`, `--accent`,
  `--pin-official`, …) as CSS custom properties, redefined per theme.
- **Themes:** follow system, with a toggle. Dark mode designed, not inverted (dark gray canvas, not
  pure black); basemap swaps to its dark variant.
- One typeface; **tabular numerals** for distance/CO₂ columns.
- WCAG AA: 4.5:1 text, 3:1 UI components.
- **Motion:** UI transitions 150–250 ms, ease-out on enter / ease-in on exit, no bounce/elastic.
  Respect `prefers-reduced-motion`.

## 7. Analytics

GoatCounter (cookieless, no consent banner), page views + anonymous custom events only:
`filter_used:<id>`, `history_mode_opened`, `play_pressed`, `myclimate_clicked`, `share_opened`.
Never coordinates, cities, or free text. Event list documented in `PRIVACY.md`, linked from the footer.

## 8. Hosting

- GitHub Pages at the default URL during development.
- **Choose a custom domain before any public announcement** (shareable links must not break).
- Footer attribution: OpenStreetMap / OpenFreeMap, huggingface/ai-deadlines (MIT), DESNZ factors,
  GeoNames.

## 9. Testing & CI

| Tier | What | Tool | Blocks merge |
|---|---|---|---|
| Data validation | satellites/overrides schema, `parent` ids exist, `start ≤ end`, all locations geocoded, unique ids, archive never shrinks | Zod + Node script | ✅ |
| Unit | CO₂ model with **golden values** hand-computed from the official DESNZ table (e.g. Berlin→Paris rail, Berlin→Sydney flight; round trip, RF), haversine, each filter's `test()` + URL round-trip, `end ≥ today` boundaries, timezone-safe dates | Vitest | ✅ |
| Build | type check + production build | `svelte-check`, `vite build` | ✅ |
| E2E smoke (~5 tests) | load, set home, radius filter changes pin count, open detail, myclimate link present, play advances window | Playwright (1 browser) | ✅ |
| A11y | axe scan, both themes | `@axe-core/playwright` | ⚠️ warn only initially |

The discovery agent's PRs go through the same pipeline.

### Workflows

- `ci.yml` — on PR/push: all tiers above.
- `sync.yml` — daily: build-data, commit if changed, trigger deploy.
- `discover.yml` — weekly (enabled after dry-run cost check): agent → PR.
- `deploy.yml` — on push to default branch: build + publish to Pages.

## 10. Suggested build phases

1. Scaffold (Svelte/Vite/TS, lint, Vitest, Playwright, CI skeleton, Pages deploy).
2. Data pipeline: schema, upstream sync, archive-freeze, geocoding + cache, overrides, validation,
   `data.json`; seed satellites (§3.6).
3. CO₂ model: extract DESNZ factors, `METHODOLOGY.md`, golden tests.
4. App shell: map (basemap styles, pins, clustering), list, detail, themes/tokens.
5. Filter framework + initial filters + URL state.
6. Timeline: Plan, Play, history mode, reduced motion.
7. Home location: city search, geolocation snapping, share dialog.
8. Analytics + `PRIVACY.md`.
9. Discovery agent (+ dry run, then schedule).
10. *(Deferred)* PwC historical backfill.

## 11. Open items

- PwC backfill cleanup effort — **deferred**.
- Exact DESNZ factor rows, haul-band thresholds, flight routing uplift, rail distance/detour
  handling — decide and document in `METHODOLOGY.md`.
- Whether myclimate supports prefilled routes via URL.
- Custom domain name (before announcement).
- Discovery agent cost per run (measure on dry run).
