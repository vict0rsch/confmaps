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
  past_conferences.yml    # past main editions, PwC import + curated (§3.4)
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
  import-pwc.ts           # one-time PwC import → data/past_conferences.yml (§3.4)
  pwc/                    # importer modules; fixes.ts = hand-maintained corrections
src/
  lib/filters/            # one file per filter (§6.3)
  lib/co2/                # CO₂ model (§5)
  lib/geo/                # haversine, city search, geolocation snapping
  lib/state/              # app state, URL + localStorage sync
  components/             # map, list, detail, timeline, filter panel, settings
public/cities.json        # GeoNames cities (pop. ≥ 50k) for home-city autocomplete (lazy-loaded)
public/CNAME              # custom domain confmaps.org (§8)
public/favicon.svg        # the brand mark, light and dark (prefers-color-scheme)
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
- **Past editions — `data/past_conferences.yml`** (spec: `docs/backfill-spec.md`). Main editions
  that upstream no longer lists (2016–2025 today), validated by `PastConferencesFileSchema`. One
  entry per edition: `id, title` (as named that year, e.g. "NIPS"), `year, full_name?, link,
  start, end, format` (`in_person | virtual | hybrid`), `city`/`country`/`venue?` (required unless
  virtual, forbidden if virtual), `tags, notes?, source` (`pwc | curated`), `pwc` (provenance:
  merged PwC ids, first/last commit) and `sources` (evidence URLs; required for curated). No
  deadlines (`deadlines: []`). Historical names roll up through `SERIES_ALIASES` (`nips→neurips`,
  `naacl-hlt→naacl`, `emnlp-ijcnlp→emnlp`, `mm→acm-mm`, …), so `series = seriesOf(title)` still
  links editions. Ids follow the series' HF stem (`neurips18`, `icdar2019`).
  - **Merge:** archive → past entries (overwriting their archive copies) → HF upstream →
    satellites → overrides. Precedence **HF > past entry > archive copy**; a past id that
    upstream also has is shadowed with a warning ("HF wins; remove it"). A past
    entry starting after today is an error (upcoming editions come from upstream). Overrides on
    `<id>@main` work as for HF, but cannot set place fields on a virtual location.
  - **Archive:** past entries freeze into `archive/<year>.json` like everything else; a postponed
    edition stays in its nominal year (`icpr20` and `ijcai20`, held January 2021, warn but stay in
    `2020.json`). Since the archive never shrinks, every correction or removal must land before
    the entry reaches `main`; afterwards it can only be corrected, not removed.
  - **Consistency:** past entries are re-derived offline like satellites; a `pwc`/`curated`
    conference must come from the file or the archive.
- **PwC import (done once):** `pnpm data:import-pwc` reads every version of
  `paperswithcode/ai-deadlines` `_data/conferences.yml` in its git history (bare clone, pinned
  `gh-pages` HEAD `b230d247`, per-entry fallback for unparseable versions), keeps the latest value
  per PwC id, parses free-text `place`/`date` deterministically, dedupes by series|year (several
  PwC ids → one edition) and drops editions upstream already has (data.json's own `pwc`
  editions, and `curated` ones under the same id, are the import's earlier output and do not
  count, so a re-import reproduces the PwC set). Corrections live in
  `scripts/pwc/fixes.ts` (`TITLE_FIXES`, `EXCLUDE`, `PLACE_FIXES`, `FIELD_FIXES`, each with a
  reason; an entry for an unknown or unused PwC id is an error). It is a **one-time writer**: it
  refuses a non-empty file without `--force` and always refuses one with curated entries; after
  the import the file is edited by hand or by the discovery agent (§4), and the research
  corrections below are not encoded in the importer (only its exclusions are, in `EXCLUDE`).
  **After the import, `data/past_conferences.yml` is the source of truth:** a forced re-import
  (`--force`) rebuilds it from PwC alone and discards every curated correction, so it should
  not be run on the committed file (`--force --dry-run` regenerates the report safely).
- **Review-marker gate:** the importer marks suspicious entries with an end-of-line
  `# review: <reasons>` comment: `covid` (in person between 2020-03 and 2021-12), `stale` (PwC
  never updated after the event), `multi-id`, `fixes-applied`. `pnpm data:validate` fails while
  any marker remains.
- **Research-based resolution:** the markers of the initial import (and a few inclusion
  questions) were resolved by research with cited sources: COVID-era editions switched to
  `virtual` (planned host kept in `notes`, e.g. "Held online (planned: Seattle, United States).")
  or `hybrid`, dates, places, titles and links corrected, evidence URLs appended to `sources`;
  a cancelled edition (LREC 2020) and non-conferences (AES, AI World Barcelona, AABI, WMT) were
  removed and added to `EXCLUDE`. Later checks use the discovery agent's `--recheck` (§4).
- **Links of past editions** point to a Wayback Machine snapshot of the edition's site taken
  around the event (`https://web.archive.org/web/<timestamp>/<original>`, a 200 capture from
  18 months before the end to 6 months after), because lapsed conference domains get hijacked
  (gambling, link farms, injected spam). Without such a capture: a stable proceedings page (ACL
  Anthology, IEEE Xplore, …), else the live site if it still shows that edition. The detail
  panel labels a snapshot "Archived site · <original host>". `sources` hold only URLs that
  currently load and support the facts, or snapshots. The discovery agent archives the link of
  each new edition the same way (closest capture in that window); with none, it writes the live
  link marked `UNARCHIVED` and opens its PR as a draft.
- **2022–23 hybrid sweep:** every 2022–23 edition was checked against its own site or proceedings for a
  hybrid format; those with a cited quote are marked `hybrid`, the rest are left as they were.
- **Past satellites:** the discovery agent runs in a backfill mode for past editions
  (e.g. NeurIPS 2025 Mexico City, EurIPS 2025 Copenhagen); same PR + evidence review.
- History grouping: a conference **series key** = normalized `title` (e.g. `icml`), so editions
  across years and sources link together.

### 3.5 Normalized output — `data/build/data.json`

```ts
type Conference = {
  id: string; series: string; title: string; year: number; fullName?: string;
  link: string; tags: string[]; deadlines: Deadline[]; start: string; end: string;
  source: "hf" | "pwc" | "curated" | "archive"; // pwc/curated: past_conferences.yml, never → archive
};
type LocationBase = {
  id: string;                 // `${conferenceId}@main` or satellite id
  conferenceId: string;
  role: "main" | "satellite";
  name: string;
  start: string; end: string; // satellites use their own dates
  official: boolean; presentsPapers: boolean;
  access: "open" | "registration" | "authors_only";
  link: string; notes?: string;
};
type PinnedLocation = LocationBase & {
  format?: "hybrid";          // absent = in person
  city: string; country: string; venue?: string;
  lat: number; lng: number;
};
type VirtualLocation = LocationBase & { role: "main"; format: "virtual" }; // no place, no pin
type EventLocation = PinnedLocation | VirtualLocation;
```

Main locations default to `official: true`, `presentsPapers: true`, `access: "registration"`.
`format` lives on the location: only past main editions are virtual or hybrid (in-person records
are unchanged). Virtual locations skip country canonicalization and geocoding; hybrid ones are
pinned at their physical city.

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
  dates (EMNLP and its tracks) are researched once. Backfill skips virtual editions (no satellites
  to look for) but now also sees the ≈340 past editions, so restrict it with `--only ID[,ID…]`.
- **Past main editions (`--mode past`, `docs/backfill-spec.md` §5):**
  `--mode past --series neurips,icml --since 1987 [--until YYYY] [--recheck] [--dry-run]`
  (`--until` defaults to last year). Targets the years of each series with no known edition (in
  `data.json` or `past_conferences.yml`); one call per series and batch of up to 6 years
  (`web_search` 8, `web_fetch` 12 uses). The prompt lists the series' known editions and asks to
  omit years with no edition (biennial, cancelled). Each edition field is `{value, source_url,
  quote}`, verified as for satellites, plus: `start ≤ end`, at most 21 days, `start` in the year
  or the next (flagged); `virtual`/`hybrid` need a 20+ character quote saying so; `in_person` is
  derived for a verified city before 2020-03, else needs a judgement quote, else it is written
  `# UNVERIFIED default` and the PR is a draft (as it is when a cancellation is reported).
  Additions are inserted in (year, id) order as `source: curated`, with the evidence URLs in
  `sources` and the series' latest tags. `--recheck` also re-verifies the
  `source: pwc` editions in range and **applies** verified format/place/date changes to them
  (a switch to virtual drops the place); on curated entries differences are only suggested. A
  reported cancellation is never applied: it is listed under "Needs human removal (before merge)".
  PR title `Past editions: N addition(s), M update(s)`.
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
  afterwards are dropped. A bot-check page (Anubis, Cloudflare) counts as unreadable, not as a
  page without the quote. In past mode, an unreadable page is checked on its latest Wayback copy,
  which then becomes the cited source, and a failed quote on a page the agent never opened says
  so (the quote may come from a search result).
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
  it. `--workers N` (default 4) researches N conferences at once; a request starts only if the
  cost so far, plus the average cost of a finished request for each one in flight, stays under the
  cap, so requests in flight can still take the total past it. `--dry-run` writes nothing and
  prints evidence, cost, tool calls and the diff.
- **Progress:** on a terminal, a rich display shows the run's progress and cost and one row per
  request in flight. In CI logs, each request gets a start line and an end line (candidates,
  turns, tool calls, cost), all prefixed like every other log line.
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
- **Workflow (`discover.yml`):** `workflow_dispatch` inputs `mode` (`upcoming | backfill | past`),
  `series`, `since`, `until`, `recheck`, `max_usd`, passed through `env` and validated by the CLI.
  Two jobs. `research` runs in the `discovery` environment (the only
  place `ANTHROPIC_API_KEY` exists), with a read-only token; it validates and uploads the proposal as
  an artifact. `propose` has no Anthropic key and runs no repository code (git, gh, jq only): it
  commits the allowlisted generated files (`satellites.yml`, `past_conferences.yml` in past mode,
  `geocache.json`, `build/data.json`, `archive/NNNN.json`), pushes a branch and opens the PR.
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
| `radius` | within X km/mi of home | Needs home; greyed with "Set your city" otherwise. Virtual editions pass; hybrid ones use their city |
| `co2` | estimated footprint under ~X kg | Needs home; uses global mode/threshold. Virtual editions count as 0 kg and pass; hybrid ones use their city |
| `access` | open / registration / authors only | |
| `kind` | official / community | |
| `open` | submission still open | Next upstream deadline (abstract or paper) after today |

The filter panel renders only registered filters, so adding a filter still means adding a file.
In the sidebar it is a **search field** (the `search` filter's control, always visible) above a row
of **chips**, one per other filter. A chip shows a dot when its filter is active. Clicking a chip
opens that filter's control in a tray under the row, and only one tray is open at a time (Esc closes
it and returns focus to the chip). In the mobile full-screen dialog there are no trays: every
filter is a stacked section with its control open. Both layouts show **"Clear all"** with the
active-filter count once any filter is active.

### 6.4 Timeline / scrubber

The scrubber **is** the `dates` filter (one `{from, to}` state, two presentations).

```
 ▁▂▁▃▅▂▁▁▂█▃▁▁▂▁▃▆▂▁▁▂█▄▁▁▂▁▃▅▂▁▁▂█▃   ← events/month histogram
                ├────────────────────┤     ← window, both handles draggable
 [▶ play]  [Since 2017 | Past 5 years | Next 6 months | Next 12 months]  [speed 1×]
```

- **Preset order:** the presets run in time order, like the axis: the past ones, then the future
  ones. Each label says which side of today it covers ("Past", "Next", "Since"). In a narrow
  timeline, "Next 6 mo" / "Next 12 mo" stand in visually; the full label stays the accessible name.
- **Plan mode (default on load):** window = today → +12 months, static. Presets "Next 6 months" /
  "Next 12 months". The range label always shows the window's dates, whichever preset is active.
- **Play mode:** ▶ slides the current window forward (~1 month/s, speed control, pause, drag to
  scrub). Window width is whatever the viewer set.
  - Pins fade + scale in when entering, pulse while live, fade out when leaving. **Live** means
    `start ≤ t ≤ end` where t is the window's `to` edge, so a pin pulses as it enters.
  - While Play runs, a pin dims as it crosses the window: full opacity when its start enters at the
    `to` edge, down to 30% as it reaches the `from` edge and leaves.
  - **Clustering is off during Play and history travel**: per-pin fades cannot be clustered, so an
    unclustered presentation of every location replaces the clustered one and crossfades back once
    motion settles.
  - Main↔satellite lines draw in when both ends are visible.
  - Pins never move position; simultaneous entries are **staggered** (attention/tracking limits).
- **History presets** ("Past 5 years", "Since <year>" back to the oldest edition) only set the
  handles. The axis covers at most the last 5 years plus the current window, so the 2016–2019
  editions do not squeeze it; "Since <year>" (or history mode) extends it. Play spans all data.
- **History mode:** from a conference's detail ("View history"), show all editions of its series,
  linked chronologically by a curved path with year labels (consecutive editions in the same place
  share a stop); play travels the path stop by stop. URL `?h=<series>`, e.g. `?h=icml`.
  **Predicate layering:** history mode shows that series' editions of **all years** that pass every
  filter *except* `dates`; the dates window is ignored but left untouched, so exiting restores the
  previous view. The path skips virtual editions (the leg joins the neighbouring stops; hybrid
  editions are normal stops), and the years held online are listed beside the title
  ("Online: 2020 · 2021").
- **Reduced motion:** play steps month by month with crossfades only.
- On phones the compact scrubber sits under the top bar, outside the sheet (§6.7).

### 6.5 Home location & privacy

- Home is set from the **home pill** at the top of the sidebar, which shows the city (or "Set your
  city") and opens a panel. The panel holds the **city autocomplete** (GeoNames cities with
  population ≥ 50,000, `public/cities.json`, lazy-loaded), **"Use my location"** (browser
  geolocation), a one-line privacy note and the travel preferences. On mobile the same content
  opens in a full-screen sheet.
- Geolocation results are **snapped to the nearest city on-device**; only the city is used/stored.
- Home is stored as a **GeoNames city** (id, name, country, coordinates) in `localStorage`
  (`confmaps:home`) only (wrapped in try/catch; app works without it).
- **Not in URLs by default.** Share dialog has an opt-in "Include my city in the link", which adds
  `home=<geonameid>` (the id only). A recipient's `home` applies **for that visit only**: it is
  not persisted and is stripped from the address bar afterwards. Likewise, shared CO₂ views carry all
  travel settings (`mode`, `thr`, `units`), applied for that visit only with a notice and a "Use mine"
  button. Third-party licences and attributions are shown in-app at `#credits` ("Data & credits").
- Lines from home to visible sites when home is set; detail shows nearest site per conference.

### 6.6 URL state

Filters, window, selection and history mode live in the URL so views are shareable, e.g.
`?c=neurips26&sub=ML,CV&radius=1000&co2=300&from=2026-11&to=2027-10`.
Units, mode and threshold are also persisted in `localStorage`. Home is in the URL only via opt-in
(`home=<geonameid>`, §6.5). `h` and `home` are reserved params that no filter may own.

### 6.7 Layout

```
DESKTOP (≥ 1024px): the map fills the window; every panel floats above it
┌─────────────────────────────────────────────────────────────────────┐
│ ╭───────────────╮ ╭─ legend ─────╮                                  │
│ │brand share ◐ ☰│                          MAP (full window,        │
│ │ 📍 Berlin · km│                          clustered pins,          │
│ │ [ search     ]│                          home→site lines)  ╭────╮ │
│ │ (Topics)(Open)│                                            │DET.│ │
│ │ ...  Clear all│                                            │    │ │
│ │ 23 conferences│                                            ╰────╯ │
│ │ NeurIPS Paris │                            [+][−] attribution      │
│ │  880km ~50kg🚆│ ╭─ timeline ───────────────────────────────────╮   │
│ │ footer links  │ │ ▁▂▃█▂▁ ├──window──┤  ▶  Oct 2026 – Oct 2027  │   │
│ ╰───────────────╯ ╰──────────────────────────────────────────────╯   │
└─────────────────────────────────────────────────────────────────────┘

DESKTOP, sidebar collapsed (☰ folds it into a pill; the pill opens it again)
┌─────────────────────────────────────────────────────────────────────┐
│ (brand ☰) ╭─ legend ─────╮                                          │
│                        MAP                                          │
│ ╭─ timeline ──────────────────────────────────────────────────────╮ │
│ ╰─────────────────────────────────────────────────────────────────╯ │
└─────────────────────────────────────────────────────────────────────┘

MOBILE
┌──────────────────────┐
│ (brand)(📍Berlin)(≡) │  ← brand opens legend, theme, share, credits
│ (▶ ▁▂█▂▁ ├window┤)   │  ← compact scrubber, a glass capsule under the top bar
│        MAP           │
│ ╭──────────────────╮ │
│ │═══ glass sheet ══│ │
│ │ list / detail    │ │  ← detail replaces list on select
└─┴──────────────────┴─┘
```

- **Floating panels:** the sidebar sits top-left, the timeline bottom-right of the sidebar, the
  detail drawer on the right and the legend at the top-left of the free map area. Zoom controls and
  the attribution sit bottom-right, above the timeline.
- **Collapsible sidebar (desktop):** the menu button (☰) at the end of the sidebar's brand row folds
  the sidebar into a glass pill at its top-left corner. The pill shows the logo, the wordmark and ☰,
  and it is one button that opens the sidebar again. It is as tall as the legend chip, and the
  legend sits just right of it. The timeline then starts at the left gap. Every visit starts with
  the sidebar open; the state is not saved. The collapsed sidebar stays mounted, so search, filters
  and list scroll survive. It is `inert` and hidden after its fade. Focus moves to the pill on
  collapse and back to ☰ on expand. Toggling moves the map's padding but keeps its zoom, even with
  a conference selected.
- **Mobile layout:** the top bar holds the logo pill, the home button and Filters. The compact
  timeline is a glass capsule on a second row under them. From 760 px wide, it joins the first row
  and takes the width left after Filters. The sheet has three snaps: peek (the grip and the list
  heading, 84 px plus the bottom safe area), half (50%) and full (up to the top bar). Tapping the
  grip cycles the snaps, and dragging it moves the sheet. At peek the content is locked and shows
  its top, and dragging the visible heading moves the sheet too. History mode lowers the sheet to peek. Selecting a conference raises a peek sheet to
  half.
- **Logo panel (mobile):** the logo pill is a button. It opens a panel anchored under it (a modal
  dialog) with the tagline, the legend, the theme, Share and the footer links. Its close button,
  a tap outside or Escape closes it, and focus returns to the pill. Desktop has no logo panel.
- **Dialogs:** a tap outside a dialog closes it, as Escape does: the Share dialog, the documents
  (Methodology, Privacy, Third-party notices) and the logo panel. The press must start outside too,
  so a drag that starts inside (selecting text in a field) and ends outside keeps the dialog open.
  When a dialog opens over another (Share from the logo panel), a tap outside closes only the top
  one. The full-screen filters sheet has no outside area. One Svelte attachment, `lightDismiss`
  (`src/lib/dialog.ts`), does this for every dialog.
- **Map insets:** the map reserves space for the sidebar, the timeline and the open drawer (panel
  size plus the gap), so fitting to a conference and "back to selection" keep pins clear of every
  panel. The collapsed pill floats over the map like the legend, so it reserves nothing.
- **Attribution** is shown in full when the free map area is at least 560 px wide and in compact
  form below that.
- **Legend:** it reads "Main venue", then "Satellites:" with its two kinds ("official",
  "community") as one inner list, then "Authors only" (an official satellite with the badge).
  Beside an open drawer it is hidden below 1280 px, because the strip of map is too narrow. It
  returns when the drawer closes. A "Satellite link" item (the dashed line) appears only while the
  map shows a main ↔ satellite line. On phones it is in the logo panel.
- Hover list row → highlight its pins. Click row → detail panel + fit map to the conference's sites.
- **Click pin** → detail panel at the same zoom. The map stays still, or pans to centre the pin if
  the drawer would cover it. **Double-click pin** → fit to the conference's sites; double-clicking
  it again (before zooming by hand) returns to the overview of every visible pin. Double-clicking
  empty map keeps MapLibre's zoom in.
- Detail: dates, deadline status, each site with access, distance, estimated CO₂, myclimate link,
  "View history". A flight estimate is nonstop, with a second line for one connection each way
  ("~4.6–5.0 t depending on layovers"; METHODOLOGY.md, Layovers). The list and filters use the
  nonstop figure.
- Selection stays highlighted while panning; "back to selection" control.
- Crowded areas cluster with counts; co-located events open a list.

### 6.8 Visual design

Tone: **calm and soft**, inspired by Apple's Liquid Glass. The map is the content and controls
float above it as translucent glass panels. Modern, simple, clear.

- **Glass material:** semantic `--glass-*` tokens (fill, thick fill, solid fill, stroke, highlight,
  shadow, hover and press tints), redefined per theme. Two classes in `base.css` apply them.
  - `.glass` is the frosted panel: blur plus saturation. It is the only place that declares
    `backdrop-filter`, with literal values because Safari ignores `var()` there.
  - `.glass-thick` is opaque, with no blur. Use it for anything that sits over text, such as trays,
    the home panel and dialogs. A nested `.glass` would blur only its glass parent, not the map.
  - Fallbacks: without `backdrop-filter` support, and under `prefers-reduced-transparency` or
    `prefers-contrast: more`, both classes use the solid fill (the contrast case adds a strong
    border). Under `forced-colors` they use system colours.
  - CSS only. There is no SVG refraction, because it works only in Chromium and is heavy on the GPU.

- **Quiet basemap:** warm land (`#f3f2ee` light, `#1f2124` dark) with soft blue water (`#d6e2ec`
  light, `#15191e` dark); POIs / most roads / minor labels removed. Data is the only saturated
  element.
- **Never color alone:** a main venue is a filled pin and a satellite is a ring. The main pin is
  also larger, about 1.4 times the ring's width. An official satellite's ring has a centre dot; a
  community satellite's ring is empty. Colour repeats the official / community split (indigo /
  orange). Authors-only sites carry a dot badge. Colour reinforces only (~8% of men have
  color-vision impairment). Both pin colours keep at least 3:1 on land and water in both themes,
  and stay distinct under simulated colour blindness.
- Pins are soft and legible on both themes (halo/outline); clusters get a halo ring.
- **Single accent color** with contrast in both themes: a softer **indigo** (chosen over teal), **not** eco-green.
- **Design tokens:** primitives → semantic tokens (`--surface`, `--ink`, `--accent`,
  `--pin-official`, …) as CSS custom properties, redefined per theme.
- **Themes:** follow system, with a toggle. Dark mode designed, not inverted (dark gray canvas, not
  pure black); basemap swaps to its dark variant.
- **Shape and type:** 15 px base text and sentence-case headings. Controls are capsules. Radii are
  concentric: `--radius-panel` 24 px for floating panels, `--radius-card` 16 px for cards and trays
  inside them.
- One typeface: **Inter Variable**, self-hosted (`@fontsource-variable/inter`, no font CDN); **tabular numerals** for distance/CO₂ columns.
- WCAG AA: 4.5:1 text, 3:1 UI components.
- **Motion:** UI transitions 150–250 ms, ease-out on enter / ease-in on exit, no bounce/elastic.
  Respect `prefers-reduced-motion`.
- **Performance:** MapLibre GL loads in its own lazy chunk (`Map.svelte` is a dynamic import), so the
  shell, list and filters render before the map library arrives.

### 6.9 Virtual and hybrid editions

Past main editions can be virtual or hybrid (§3.4, §3.5).

- **Virtual:** listed with a "Virtual" badge (monitor icon + text, never colour alone) and place
  "Online"; **no pin**, no map focus or "back to selection", no home line. The detail panel says
  "Virtual event · Official", with no venue. Footprint: **"Online · ~0 kg"** (never estimated;
  "Attending online: no travel"), no mode toggle, myclimate link or comparison; "Nearest first"
  sorts it at distance 0.
- **Hybrid:** the normal pin and city plus a "Hybrid" tag; the trip estimate is shown with "Also
  online (~0 kg)". Distance and CO₂ filters use the physical city.
- Past editions without deadlines hide the deadline line (and the HF countdown link).
- Credits name paperswithcode/ai-deadlines (MIT) next to huggingface/ai-deadlines.

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
| A11y | axe scan, both themes, desktop + phone (`pnpm test:a11y`; separate warn-only CI job) | `@axe-core/playwright` | ⚠️ warn only initially |

The discovery agent's PRs go through the same pipeline.

### Workflows

All third-party actions are pinned to commit SHAs.

- `ci.yml` — on `pull_request`, push to `main` and `workflow_dispatch` (so agent PR branches can be
  checked, §4): lint, `svelte-check`, data validation, unit tests, build, Playwright. The
  validation step passes `--require-against <base>` (PR base, previous commit on push, merge-base on
  manual runs) so the **archive-shrink check** compares against the base commit's archive.
- `deploy.yml` — runs via `workflow_run` **after a green CI on a push to `main`** (never for PRs),
  via `workflow_call` from `sync.yml` (its `GITHUB_TOKEN` push triggers no CI), and manually.
  A gate job skips (with a notice) any SHA that is not the current tip of `main`, so a late CI
  completion cannot roll production back, and manual dispatch on a non-main ref; the check is
  repeated right before `deploy-pages`. Builds with `VITE_GOATCOUNTER_CODE` and publishes to Pages.
- `sync.yml` — daily cron + manual. Two jobs: `build` (read-only token; runs `data:build`,
  `data:validate --require-against HEAD`, tests; uploads `data/`) and `commit` (write token, runs
  no project code: commits the data if changed, citing the upstream SHA, and pushes). Then calls
  `deploy.yml` when something changed.
- `discover.yml` — `workflow_dispatch` only (schedule commented out until the dry-run cost check):
  `research` + `propose` jobs, §4.

## 10. Build phases

All done.

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
10. ~~PwC historical backfill~~: `past_conferences.yml` (§3.4), virtual/hybrid editions (§3.5,
    §6.9), discovery past mode (§4); review flags resolved by cited research.

## 11. Open items

- **Earlier editions** (before 2016) are not in PwC: add them with
  `discover --mode past --series <s> --since <year>` (dry-run one series first to set `--max-usd`).
- **Spot checks:** a few research resolutions are medium/low confidence (listed in the backfill
  PR); `discover --mode past --recheck` can re-verify them with quotes.
- **Discovery agent dry run:** measure cost per run (`--dry-run`, `--max-usd`), then enable the
  weekly `schedule:` in `discover.yml`.
- **GoatCounter account:** create the site and set the `GOATCOUNTER_CODE` Actions variable
  (analytics stay off until then).
- **GitHub App or fine-grained PAT** for the agent's PRs (optional): they would trigger CI normally,
  replacing the `gh workflow run ci.yml` dispatch.
- **Atlanta satellite:** to be added through the discovery agent's PR.
