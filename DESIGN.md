# AI Conferences Map — Design

Status: implemented. This document started as the agreed design (grilling session, 2026-10-22);
it now records the **as-built decisions**, including those that changed during implementation.
Live at <https://confmaps.org>.

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

manual (weekly schedule pending): scripts/discover/ (Python, Claude API) ──► draft/PR to data/satellites.yml (never auto-merged)
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
  build-cities.ts         # GeoNames → public/cities.json
  validate-data.ts        # offline checks of the committed data (§9)
  backfill-pwc.ts         # one-off historical import (§3.4, deferred; not written)
src/
  lib/filters/            # one file per filter (§6.3)
  lib/co2/                # CO₂ model (§5)
  lib/geo/                # haversine, city search, geolocation snapping
  lib/state/              # app state, URL + localStorage sync
  components/             # map, list, detail, timeline, filter panel, settings
public/cities.json        # GeoNames cities (pop. ≥ 50k) for home-city autocomplete (lazy-loaded)
public/CNAME              # custom domain confmaps.org (§8)
.github/workflows/        # ci.yml, sync.yml (daily), discover.yml (manual), deploy.yml
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
- Deadline timezones are converted to absolute instants. `AoE`, `UTC`, `UTC±N` and IANA names are
  understood; regional abbreviations map to IANA zones (`PST`/`PDT`/`PT` → Los Angeles, `EST`/`EDT`/`ET`
  → New York, `CDT`/`CT` → Chicago, `CET`/`CEST` → Paris), so they follow DST. **`CST` is rejected**
  as ambiguous (US Central vs China Standard Time): fix it with an override. Anything unknown fails
  the build rather than being guessed.
- **Series aliases:** upstream lists some tracks as separate conferences. `SERIES_ALIASES` rolls
  the EMNLP Industry and System Demonstrations tracks up into series `emnlp`.

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
  policy), cached in `data/geocache.json` keyed by normalized `"city|country"`. Among the hits in
  the expected country the geocoder **prefers settlements** (city/town/village) over other
  features, and warns when only non-settlements exist or the chosen settlement is far from
  Nominatim's top hit.
- New cache keys appear in the sync commit / PR diff so every new coordinate is reviewed.
- **CI fails** on any unresolved location (never emit a pin at 0,0).
- `data/overrides.yml`: optional manual `lat`/`lng` (and other field fixes) keyed by location id.
  Used for multi-venue upstream strings like NeurIPS 2025 (San Diego & Mexico City). On a
  `…@main` id it can also replace the conference's `start`/`end` and its whole `deadlines` list
  (upstream form; `[]` drops them), and carries an optional free-text `reason` (documentation only,
  not emitted).
- **Provenance:** `data.json` records `upstream: {repo, sha}`, the upstream commit the build used;
  the sync commit message cites it.
- **Sanity checks** (`sanityCheck`) run on every build. Errors block: a deadline after the
  conference ends. Warnings are printed for review: year/start mismatch, far-off deadline years,
  the same edition listed twice, satellites far outside their parent's dates, override coordinates
  far from their country.
- **Mass-drop guard:** the build fails if upstream conferences fall by more than 20% against the
  previous `data.json` (`--allow-mass-drop` after review).
- **Offline consistency check:** `pnpm data:validate` re-derives from the committed inputs
  (satellites, overrides, geocache, archive) everything that does not need upstream and fails if
  `data.json` differs, so a hand-edited or stale `data.json` cannot merge.

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

**Track grouping (frontend, `groupTracks`):** conferences with the same series, year and main-venue
city and overlapping dates are tracks of one event (e.g. EMNLP 2026 and its Industry and System
Demonstrations tracks). They show as **one list row** and **one pin**; the lead is the untitled main
event, else the shortest title.

### 3.6 Seed satellites (verify before committing)

- NeurIPS 2026 Paris — Dec 9–13 (main conf 9–11, workshops 12–13), authors only, official.
  Note: NeurIPS 2026's main venue is **Sydney**.
- NeurIPS 2025 Mexico City — from upstream `venue` string.
- EurIPS 2025 Copenhagen — endorsed by NeurIPS.

## 4. Discovery agent

Purpose: find satellites the owner would never hear about, especially community events.

- **Runtime:** Python (`scripts/discover`, uv project) in GitHub Actions. Not Claude Code Action, not
  Managed Agents. **Dispatch-only for now**: the weekly `schedule:` in `discover.yml` stays commented
  out until a dry run has measured the cost (§11).
- **Model:** `claude-opus-5-5`, effort `medium`, adaptive thinking, with the server-side
  `web_search_20260318` (max 8 uses) and `web_fetch_20260318` (max 10 uses) tools, **structured output**
  and server-side refusal fallback (`fallbacks: "default"`). Paused turns are resumed up to 3 times.
- **Scope per run:** one call per conference starting within the next ~12 months
  (`--mode upcoming`); `--mode backfill --since YEAR` covers past editions. Editions sharing link and
  dates (EMNLP and its tracks) are researched once.
- **Output schema:** candidate satellites matching §3.2, where **every field is
  `{value, source_url, quote}`**. Fields without a supporting quote are omitted, never guessed.
- **Evidence verification (deterministic code, independent of the model).** Each `source_url` is
  downloaded by the script and each field is checked by a rule:
  - `name`, `city`, `venue`, `country`: the quote is on the page **and contains the value**
    (`country` may instead be derived from the geocoded city);
  - `start`, `end`: the quote is on the page and contains the date's day, month and year; dates
    must fall within 60 days of the parent edition;
  - `link`: a link on the source page, or on the same site (registrable domain);
  - `official`, `presents_papers`, `access`, `notes`: the quote (at least 20 characters) is on the
    page, but whether it supports the value is **model judgement**. Labelled as such in the PR and
    never allowed to overwrite curated entries.
  Failing fields are dropped; candidates missing `name`, `link`, `city`, `country`, `start` or `end`
  afterwards are dropped.
- **Unverified defaults:** `satellites.yml` requires `official`, `presents_papers` and `access`.
  Where no evidence exists an addition gets the conservative defaults `official: false`,
  `presents_papers: false`, `access: authors_only`, marked `# UNVERIFIED default` in the YAML and
  listed in the PR. Such a PR is opened as a **draft**. Existing entries only receive start/end
  updates; other differences are suggested in the PR body, not applied.
- **Deterministic code owns all writes:** diff against `satellites.yml` (dedupe by `parent` + city,
  within 25 km), write YAML with comments preserved, validate with `pnpm data:validate` (geocoding
  new cities), and produce one PR title/body with an evidence table per run.
- **Never auto-merges.** The same CI (§9) runs on the PR.
- **Cost control:** `--max-usd` (default 5) stops further API calls once the estimated cost passes
  it. `--dry-run` writes nothing and prints evidence, cost, tool calls and the diff.
- **Results persistence:** each conference's raw API result is saved (`--results-dir`) and uploaded
  as an `api-results` artifact (14 days). `--from-results DIR` re-runs verification, merge and
  report on them with no API calls.
- **Security:** fetched pages are untrusted. The model has no repo access or write tools. The script
  fetches pages itself with **SSRF protections**: only public IPs (loopback, private, link-local,
  reserved and metadata ranges refused), canonical hostnames only (no numeric/hex IPv4 forms),
  the vetted address pinned for the connection, redirects followed manually and each hop vetted,
  no environment proxies, size/time/fetch-count caps. GitHub tokens and `ANTHROPIC_*` are stripped
  from the environment of subprocesses; log lines are prefixed so page text cannot inject workflow
  commands.
- **Workflow (`discover.yml`):** two jobs. `research` runs in the `discovery` environment (the only
  place `ANTHROPIC_API_KEY` exists), with a read-only token; it validates and uploads the proposal as
  an artifact. `propose` has no Anthropic key and runs no repository code (git, gh, jq only): it
  commits the two data files, pushes a branch and opens the PR.
- **CI on agent PRs:** PRs opened with `GITHUB_TOKEN` do not trigger `pull_request` workflows, so the
  `propose` job runs `gh workflow run ci.yml --ref <branch>` (`ci.yml` has `workflow_dispatch`). A
  GitHub App token or fine-grained PAT would make this unnecessary (§11).

## 5. CO₂ estimation

### 5.1 Principle: estimates, orders of magnitude

All CO₂ figures are **estimates**. Wording must convey orders of magnitude, not precision:

- Always `~` + rounded to 2 significant figures: "~50 kg", "~1.4 t". Never "49.7 kg".
- Labels: "Estimated CO₂e" / "Rough footprint", never bare "CO₂".
- Comparisons emphasize scale: "Paris: roughly 54× less than flying to Sydney".
- Filter label: "Estimated footprint under ~X kg".
- Methodology note starts with "These are order-of-magnitude estimates…".

### 5.2 Method

- **Data:** official UK DESNZ (formerly BEIS/DEFRA) GHG conversion factors, latest year, extracted
  into `data/co2-factors.json` (versioned; updated yearly). Computed in-browser. No API, no proxy.
  (Climatiq rejected: free tier is non-commercial-only with vague limits, and rail can silently fall
  back to car routes.)
- **Distance:** great-circle (haversine) between home and location.
- **Mode (global setting):** `auto` = rail if distance < threshold, else flight; or `always fly`.
  Threshold default **1,000 km**, user-changeable. Per-trip toggle exists only in the detail panel and
  never affects filtering.
- **Flights:** economy class, **radiative forcing included** (labeled), DESNZ haul band chosen by
  distance. DESNZ factors already include the 8% routing uplift (not added again).
- **Well-to-tank emissions included** for all modes (DESNZ WTT factors added to the direct ones).
- **Round trip:** always.
- Mode is shown on every figure: "~50 kg 🚆", "~1.4 t ✈️".
- Exact factor rows, haul thresholds, routing uplift and any rail detour factor are chosen and
  justified in `METHODOLOGY.md`.

### 5.3 Cross-check link

- Flight estimates link to **myclimate** ("Cross-check this flight on myclimate"), with one line:
  "Different methods give different figures — same order of magnitude is expected."
- myclimate does prefill via `?from=BER&to=SYD`, but only accepts airport names or **IATA codes**
  ("Paris" is rejected), and the app has no airport data. So the link is **plain** for now;
  `myclimateUrl(from, to)` prefills as soon as IATA codes are supplied.
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
  appliesWhenInactive?: boolean;                         // default state still constrains (dates)
  test(loc: JoinedLocation, ctx: Ctx, s: S): boolean;    // per-location predicate (loc.conference)
  Control: Component<{ state: S; set(s: S): void; ctx: Ctx }>;
  params: readonly string[];                             // URL params owned (collision-tested)
  toURL(s: S): string;                                   // query-string fragment, e.g. "sub=ML%2CCV"
  fromURL(v: string): S;                                 // gets the WHOLE query string; never throws
}
// ctx = { home?: LatLng, units: "km"|"mi", mode: "auto"|"fly", threshold: number,
//         co2: Co2Model, today: string /* local YYYY-MM-DD */, now: Date }
```

Deviations from the original sketch: `test` receives a `JoinedLocation` (location + its
conference); `params` lists the URL params a filter owns (`dates` owns `from` and `to`);
`toURL`/`fromURL` work on query-string fragments so a filter can own several params;
`appliesWhenInactive` exists because the default `dates` window (Plan: today → +12 months) hides
past events yet is not "a filter the viewer turned on" (no badge, not in the URL); `Ctx.today` is a
local-date string, with `now` for deadline instants.

Initial filters:

| id | What | Notes |
|---|---|---|
| `dates` | `{from, to}` window | Same state as the timeline (§6.4); test uses `end ≥ from && start ≤ to` |
| `subject` | conference tags | Upstream's free-form tags grouped into subjects with short URL codes (`sub=ML,CV`; e.g. `ML` machine learning, `RL`, `LLM`); near-duplicate tags merge; unknown tags become their own subject under "Other" |
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
  - Pins fade + scale in when entering, pulse while live, fade out when leaving. **Live** means
    `start ≤ t ≤ end` where t is the window's `from` edge (in Plan mode that is today, so Play moves a
    simulated "today").
  - **Clustering is off during Play and history travel**: per-pin fades cannot be clustered, so an
    unclustered presentation of every location replaces the clustered one and crossfades back once
    motion settles.
  - Main↔satellite lines draw in when both ends are visible.
  - Pins never move position; simultaneous entries are **staggered** (attention/tracking limits).
- **History presets** ("Past 5y") only set the handles.
- **History mode:** from a conference's detail ("View history"), show all editions of its series,
  linked chronologically by a curved path with year labels (consecutive editions in the same place
  share a stop); play travels the path stop by stop. URL `?h=<series>`, e.g. `?h=icml`.
  **Predicate layering:** history mode shows that series' editions of **all years** that pass every
  filter *except* `dates`; the dates window is ignored but left untouched, so exiting restores the
  previous view.
- **Reduced motion:** play steps month by month with crossfades only.

### 6.5 Home location & privacy

- Home set via **city autocomplete** (GeoNames cities with population ≥ 50,000, `public/cities.json`, lazy-loaded) or **"Use my location"**
  (browser geolocation).
- Geolocation results are **snapped to the nearest city on-device**; only the city is used/stored.
- Home is stored as a **GeoNames city** (id, name, country, coordinates) in `localStorage`
  (`confmaps:home`) only (wrapped in try/catch; app works without it).
- **Not in URLs by default.** Share dialog has an opt-in "Include my city in the link", which adds
  `home=<geonameid>` (the id only). A recipient's `home` applies **for that visit only**: it is
  not persisted and is stripped from the address bar afterwards.
- Lines from home to visible sites when home is set; detail shows nearest site per conference.

### 6.6 URL state

Filters, window, selection and history mode live in the URL so views are shareable, e.g.
`?c=neurips26&sub=ML,CV&radius=1000&co2=300&from=2026-11&to=2027-10`.
Units, mode and threshold are also persisted in `localStorage`. Home is in the URL only via opt-in
(`home=<geonameid>`, §6.5). `h` and `home` are reserved params that no filter may own.

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
├──────────────────────┤
│ ═══ bottom sheet ═══ │
│ ▶ ▁▂█▂▁ ├──window──┤ │  ← compact scrubber, docked in the sheet (visible at every snap)
│ list / detail        │  ← detail replaces list on select
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
- **Single accent color** with contrast in both themes: **indigo** (chosen over teal), **not** eco-green.
- **Design tokens:** primitives → semantic tokens (`--surface`, `--ink`, `--accent`,
  `--pin-official`, …) as CSS custom properties, redefined per theme.
- **Themes:** follow system, with a toggle. Dark mode designed, not inverted (dark gray canvas, not
  pure black); basemap swaps to its dark variant.
- One typeface: **Inter Variable**, self-hosted (`@fontsource-variable/inter`, no font CDN); **tabular numerals** for distance/CO₂ columns.
- WCAG AA: 4.5:1 text, 3:1 UI components.
- **Motion:** UI transitions 150–250 ms, ease-out on enter / ease-in on exit, no bounce/elastic.
  Respect `prefers-reduced-motion`.
- **Performance:** MapLibre GL loads in its own lazy chunk (`Map.svelte` is a dynamic import), so the
  shell, list and filters render before the map library arrives.

## 7. Analytics

GoatCounter (cookieless, no consent banner), page views + anonymous custom events only:
`filter_used:<id>`, `history_mode_opened`, `play_pressed`, `myclimate_clicked`, `share_opened`.
Never coordinates, cities, or free text. Event list documented in `PRIVACY.md`, linked from the footer.

As built: no third-party script. The app calls GoatCounter's documented **count endpoint** directly
(`src/lib/analytics.ts`), so nothing is stored in the browser. It is **off unless the `GOATCOUNTER_CODE`
Actions variable is set** (passed to the build as `VITE_GOATCOUNTER_CODE` by `deploy.yml`), off on
localhost, and **Do Not Track and Global Privacy Control are respected**. Each event is sent at most
once per page load; the page view carries only the referrer's origin.

## 8. Hosting

- GitHub Pages with the custom domain **confmaps.org**, set by `public/CNAME` (decided at build
  time, so shareable links never depended on the default URL).
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

All third-party actions are pinned to commit SHAs.

- `ci.yml` — on `pull_request`, push to `main` and `workflow_dispatch` (so agent PR branches can be
  checked, §4): lint, `svelte-check`, data validation, unit tests, build, Playwright. The
  validation step passes `--require-against <base>` (PR base, previous commit on push, merge-base on
  manual runs) so the **archive-shrink check** compares against the base commit's archive.
- `deploy.yml` — runs via `workflow_run` **after a green CI on a push to `main`** (never for PRs),
  via `workflow_call` from `sync.yml` (its `GITHUB_TOKEN` push triggers no CI), and manually.
  Builds with `VITE_GOATCOUNTER_CODE` and publishes to Pages.
- `sync.yml` — daily cron + manual. Two jobs: `build` (read-only token; runs `data:build`,
  `data:validate --require-against HEAD`, tests; uploads `data/`) and `commit` (write token, runs
  no project code: commits the data if changed, citing the upstream SHA, and pushes). Then calls
  `deploy.yml` when something changed.
- `discover.yml` — `workflow_dispatch` only (schedule commented out until the dry-run cost check):
  `research` + `propose` jobs, §4.

## 10. Build phases

All done except the deferred item.

1. ~~Scaffold~~ (Svelte/Vite/TS, lint, Vitest, Playwright, CI, Pages deploy).
2. ~~Data pipeline~~: schema, upstream sync, archive-freeze, geocoding + cache, overrides, validation,
   `data.json`; seed satellites (§3.6).
3. ~~CO₂ model~~: DESNZ factors, `METHODOLOGY.md`, golden tests.
4. ~~App shell~~: map (basemap styles, pins, clustering), list, detail, themes/tokens.
5. ~~Filter framework~~ + initial filters + URL state.
6. ~~Timeline~~: Plan, Play, history mode, reduced motion.
7. ~~Home location~~: city search, geolocation snapping, share dialog.
8. ~~Analytics~~ + `PRIVACY.md`.
9. ~~Discovery agent~~ (built and hardened; dry run and schedule still open, §11).
10. *(Deferred)* PwC historical backfill.

## 11. Open items

- **PwC backfill** (~2017–2024 history) cleanup effort: deferred.
- **Discovery agent dry run:** measure cost per run (`--dry-run`, `--max-usd`), then enable the
  weekly `schedule:` in `discover.yml`.
- **GoatCounter account:** create the site and set the `GOATCOUNTER_CODE` Actions variable
  (analytics stay off until then).
- **GitHub App or fine-grained PAT** for the agent's PRs (optional): they would trigger CI normally,
  replacing the `gh workflow run ci.yml` dispatch.
- **Atlanta satellite:** to be added through the discovery agent's PR.
