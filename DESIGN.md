# AI Conferences Map — Design

Status: implemented. This document records the product and behaviour decisions **as built**: what
the app does and why, including the decisions that changed during implementation. It started as
the agreed design (grilling session, 2026-10-22). How the code is organized (components, data
flow, CI and deployment) is in [system-architecture.md](system-architecture.md).
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

## 2. Data

### 2.1 Upstream conferences

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

### 2.2 Satellites — `data/satellites.yml`

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

**Curation:** only the owner edits YAML. The discovery agent (§3) proposes changes via PR.

### 2.3 Locations, geocoding, overrides

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

### 2.4 History & archive

- Past events are first-class (history view, "Past 5y" preset).
- **Archive-and-freeze:** once an event's `end` < today, its current state is written to
  `data/archive/`. The sync **adds and updates, never removes**, so upstream pruning cannot erase
  history. Since the archive never shrinks, every correction or removal must land before an entry
  reaches `main`; afterwards it can only be corrected, not removed. A postponed edition stays in
  its nominal year (`icpr20` and `ijcai20`, held January 2021, warn but stay in `2020.json`).
- **Past editions — `data/past_conferences.yml`**. Main
  editions that upstream no longer lists (2000–2025 today), one entry per edition, validated by
  `PastConferencesFileSchema`. Each entry has a `format` (`in_person | virtual | hybrid`; place
  fields are required unless virtual, forbidden if virtual), no deadlines, a `source`
  (`pwc | curated`) and evidence URLs in `sources` (required for curated).
- **Ids of past editions** (`pastEditionId` in `scripts/lib/past-id.ts`; the discovery agent's
  `past_ids.py` implements the same rule, and both test against
  `scripts/__fixtures__/past-id-vectors.json`). Take the newest upstream (`source: hf`) conference
  of the series that is not a track. If its id ends in the year's 4 or 2 digits, reuse its stem and
  digit style (`neurips18`, `icdar2019`). Otherwise use the series without dashes and 2 digits
  (`siggraphasia22`). An id already used by another edition is an error; ids are never suffixed.
  If upstream later lists an old edition, the ids collide and upstream wins.
- **Series aliases:** historical titles stay as written (e.g. "NIPS"), and `SERIES_ALIASES` in
  `scripts/lib/normalize.ts` rolls them up to today's series (`nips→neurips`, `naacl-hlt→naacl`,
  `mm→acm-mm`, …), so editions still link by series. The agent's Python copy must match (a test
  checks it). A title belongs to one series only, so `lrec-coling` (2024) stays its own series.
- **Precedence:** HF upstream > past entry > archive copy, then overrides. A past id that
  upstream also has is shadowed with a warning ("HF wins; remove it"). A past entry starting after
  today is an error (upcoming editions come from upstream). Overrides on `<id>@main` work as for
  HF, but cannot set place fields on a virtual location.
- **Source of truth:** the file was seeded once by the PwC import (`pnpm data:import-pwc`),
  which reads every version of `paperswithcode/ai-deadlines` in its
  git history; its exclusions and corrections live in `scripts/pwc/fixes.ts`. Since then the file
  is edited by hand or by the discovery agent (§3), and those corrections are not encoded in the
  importer. A forced re-import (`--force`) rebuilds the file from PwC alone and discards every
  curated correction, so it is never run on the committed file (`--force --dry-run` regenerates
  the import report safely).
- **Review-marker gate:** the importer marks suspicious entries with an end-of-line
  `# review: <reasons>` comment: `covid` (in person between 2020-03 and 2021-12), `stale` (PwC
  never updated after the event), `multi-id`, `fixes-applied`. `pnpm data:validate` fails while
  any marker remains.
- **Research-based resolution:** the import's markers were resolved by research with cited
  sources. COVID-era editions are `virtual` (planned host kept in `notes`, e.g. "Held online
  (planned: Seattle, United States).") or `hybrid`. A cancelled edition (LREC 2020) and
  non-conferences (AES, AI World Barcelona, AABI, WMT) are excluded in `EXCLUDE`. Later checks use
  the discovery agent's `--recheck` (§3).
- **Links of past editions** point to a Wayback Machine snapshot of the edition's site taken
  around the event (`https://web.archive.org/web/<timestamp>/<original>`, a 200 capture from
  18 months before the end to 6 months after), because lapsed conference domains get hijacked
  (gambling, link farms, injected spam). Without such a capture: a stable proceedings page (ACL
  Anthology, IEEE Xplore, …), else the live site if it still shows that edition. The detail
  panel labels a snapshot "Archived site · <original host>". `sources` hold only URLs that
  currently load and support the facts, or snapshots. The discovery agent archives the link of
  each new edition the same way (closest capture in that window); with none, it writes the live
  link marked `UNARCHIVED` and opens its PR as a draft. It makes no snapshot lookup, and sets no
  `UNARCHIVED` flag, for an edition that ended before 1996-06-01 (the archive has no earlier
  captures) or whose link is on a proceedings host (`dblp.org`, `aclanthology.org`, and the
  like; `PROCEEDINGS_HOSTS` in `past.py`). A stable proceedings page is an accepted link.
- **2022–23 hybrid sweep:** every 2022–23 edition was checked against its own site or proceedings for a
  hybrid format; those with a cited quote are marked `hybrid`, the rest are left as they were.
- **Past satellites:** the discovery agent runs in a backfill mode for past editions
  (e.g. NeurIPS 2025 Mexico City, EurIPS 2025 Copenhagen); same PR + evidence review.
- History grouping: a conference **series key** = normalized `title` (e.g. `icml`), so editions
  across years and sources link together.
- **Series start years — `data/series.yml`.** The repo owns this file. It maps a series key (such
  as `neurips`) to `{first_year, sources, notes?}`. `first_year` is the year the series was first
  held. It is counted from the series' own official edition numbering, so gaps in the numbering
  stay gaps. If the series has no numbering, it is the first event under the current name.
  `sources` is a list of at least one http(s) URL and is required. A series without a sourced
  year has no entry. The app does not show this file and `data.json` does not contain it. The
  discovery agent reads it for `--since-creation` (§3). A missing file counts as empty.
  `pnpm data:validate` reports an error when a key is not a known series, or when `first_year` is
  later than the earliest edition of that series in the dataset.
  An entry can also hold `not_held`, a list of `{year, source}` items. Each item names a year in
  which the series held no edition, and `source` is an http(s) URL that shows it. The discovery
  agent writes these items (§3) and skips the years they name. `pnpm data:validate` reports an
  error when a `not_held` year is before `first_year`, when a year is listed twice, or when the
  dataset has an edition of that series in that year.

### 2.5 Normalized output — `data/build/data.json`

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

## 3. Discovery agent

Purpose: find satellites the owner would never hear about, especially community events.

- **Runtime:** Python (`scripts/discover`, uv project) in GitHub Actions. Not Claude Code Action, not
  Managed Agents. **Dispatch-only for now**: the weekly `schedule:` in `discover.yml` stays commented
  out until a dry run has measured the cost.
- **Model:** `claude-opus-5-5`, effort `medium` (satellite modes; past mode uses
  `claude-sonnet-5-5`, see below), adaptive thinking, with the server-side
  `web_search_20260318` (max 8 uses) and `web_fetch_20260318` (max 10 uses) tools, **structured output**
  and server-side refusal fallback (`fallbacks: "default"`). Paused turns are resumed up to 3 times.
  Both modes mark the end of the system prompt as a cache breakpoint, so the batches of a run
  reuse the cached prefix.
- **Scope per run:** one call per conference starting within the next ~12 months
  (`--mode upcoming`); `--mode backfill --since YEAR` covers past editions. Editions sharing link and
  dates (EMNLP and its tracks) are researched once. Backfill skips virtual editions (no satellites
  to look for) but now also sees the ≈340 past editions, so restrict it with `--only ID[,ID…]`.
- **Past main editions (`--mode past`):**
  `--mode past --series neurips,icml --since 1987 [--until YYYY] [--recheck] [--dry-run]`
  (`--until` defaults to last year). `--since-creation` replaces `--since`: each series then
  starts at its own `first_year` in `data/series.yml` (§2.4). The two flags exclude each other,
  and past mode needs exactly one of them. With `--since-creation`, `--series` is optional and
  defaults to every series in `series.yml`; a named series with no entry is skipped with a
  warning. A run without `--series` can go back decades for many series. `--random-order`
  shuffles the batches before the requests start. Requests start in list order and stop at
  `--max-usd`, so without it a capped run always spends its budget on the same series first.
  `--dry-run` still calls
  the API (it only skips writing files and the PR), so run one series first and set `--max-usd`
  deliberately. Targets the years of each series with no known edition (in `data.json` or
  `past_conferences.yml`) and not recorded as `not_held` in `series.yml`; one call per series and
  batch of up to 6 years. Past mode runs on `claude-sonnet-5-5` at effort `medium` (`PAST_MODEL`,
  `PAST_EFFORT` in `past_agent.py`), with `web_search` (10 uses) and `web_fetch` (12 uses).
  Past mode uses the basic tool versions (`web_search_20250305`, `web_fetch_20250910`), without
  dynamic filtering: with filtering, the model read only the slices of results and pages that
  its own code printed, and missed editions on pages it had found. The log of each request
  lists the URLs each search returned. The prompt lists the series' known editions and the
  dblp titles of the target years. It sets an order of work: first the series' own list of past
  conferences or proceedings, then a search by edition name ("AAAI-87") for each year the list
  does not settle. A dblp title is enough only when it gives exact dates.
  The model returns `{editions, not_held}`. Each edition has one `source_url` and one `quote` for
  all its fields, a required `link`, and plain values for the fields it found. The model
  should use one trustworthy source per edition, such as a Wikipedia table, a dblp listing or
  the edition's site. Code checks each field against that quote and page with the satellite
  rules, plus: a `title` that is not in the quote but that the series already uses (its latest
  title or a recorded edition's) is accepted without a human check; `start ≤ end`, at most 21
  days, and `start` in the year or the next. A date quote without the year counts when the date
  is in the edition's year. `virtual`/`hybrid` need
  a 20+ character quote saying so, in a clause that is neither negated nor hedged, with no
  other format asserted. `country` is derived from the geocoded city only when the city is
  verified (its value is in the quote) and the country's value is not in the quote. When the
  city is a model judgement, the city is still geocoded, but the country stays a model
  judgement.
  - **A failed check is a flag, not a drop.** The value stays as a model judgement, and the PR
    shows the reason next to it. One edition flag, "quote not confirmed on its source page",
    marks an edition whose quote is not on its page, or whose page is unreadable.
  - **Fields that are dropped:** a malformed value, malformed evidence, or an unsafe URL. An
    edition is dropped when its year is not a target, a required field is missing (`start`,
    `end`, `link`, and `city` and `country` unless virtual), `start` is after `end`, it lasts
    more than 21 days, it is not over yet, `start` is outside the year and the next, or the
    geocoder does not find its city in its country.
  - `in_person` is derived for an edition that starts before 2020-03 and has no other format.
    Otherwise it needs a judgement quote, else it is written `# UNVERIFIED default` and the PR
    is a draft (as it is when a cancellation is reported).
  - **Years not held.** The model reports target years with no edition in `not_held`. Code
    records a year in `data/series.yml` (§2.4) only when all of these hold: it is a target
    year; no edition of the series exists in that year; its source is readable; the source
    names years within 5 years on each side of it (a list cut off before or after the year
    proves nothing); the source names no edition of the series in that year (such as
    "AAAI-89", "AAAI 1989" or a dblp title of that year; the bare year in a citation does not
    count); the series has editions within 5 years on each side, counting this run's
    (so a year before the earliest known edition is never recorded); and the series has an
    entry in `series.yml`. The PR body lists them under "Years recorded as not held", and the
    others under "Not recorded" with the reason. A recorded year does not make the PR a draft.
  Additions are inserted in (year, id) order as `source: curated`, with the evidence URLs in
  `sources` and the series' latest tags. `--recheck` also re-verifies the
  `source: pwc` editions in range and **applies** verified format/place/date changes to them
  (a switch to virtual drops the place); on curated entries differences are only suggested. A
  reported cancellation is never applied: it is listed under "Needs human removal (before merge)".
  PR title `Past editions: N addition(s), M update(s)`.
- **Output schema:** candidate satellites matching §2.2, where **every field is
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
  - **dblp (past mode):** dblp's pages are behind a bot check, but its open SPARQL endpoint
    (CC0 metadata) is the interface it offers to programs. A dblp page the agent cites is read
    from that data first, then from Wayback. The text is then the proceedings titles the page
    lists, which usually state the edition's name, city, country and dates. The usual checks run
    on it, with one more rule: the quote must fit inside a single title that states only the
    edition's year.
    The cited source stays the dblp page URL. The PR evidence table notes that the
    text came from dblp's SPARQL data. The prompt also lists the titles of the target years, so
    the agent can quote one exactly without opening the page.
- **Unverified defaults:** `satellites.yml` requires `official`, `presents_papers` and `access`.
  Where no evidence exists an addition gets the conservative defaults `official: false`,
  `presents_papers: false`, `access: authors_only`, marked `# UNVERIFIED default` in the YAML and
  listed in the PR. Such a PR is opened as a **draft**. Existing entries only receive start/end
  updates; other differences are suggested in the PR body, not applied.
- **Deterministic code owns all writes:** diff against `satellites.yml` (dedupe by `parent` + city,
  within 25 km), write YAML with comments preserved, validate with `pnpm data:validate` (geocoding
  new cities), and produce one PR title/body with an evidence table per run.
- **Never auto-merges.** The same CI (§8) runs on the PR.
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
  report on them with no API calls. Past-mode results saved in the old per-field format are
  not replayed: their editions are dropped as an internal error (`KeyError`).
- **Security:** fetched pages are untrusted. The model has no repo access or write tools. The script
  fetches pages itself with **SSRF protections**: only public IPs (loopback, private, link-local,
  reserved and metadata ranges refused), canonical hostnames only (no numeric/hex IPv4 forms),
  the vetted address pinned for the connection, redirects followed manually and each hop vetted,
  no environment proxies, size/time/fetch-count caps. GitHub tokens and `ANTHROPIC_*` are stripped
  from the environment of subprocesses; log lines are prefixed so page text cannot inject workflow
  commands.
- **Workflow (`discover.yml`):** `workflow_dispatch` inputs `mode` (`upcoming | backfill | past`),
  `series`, `since`, `since_creation`, `until`, `recheck`, `max_usd`, passed through `env` and
  validated by the CLI.
  Two jobs. `research` runs in the `discovery` environment (the only
  place `ANTHROPIC_API_KEY` exists), with a read-only token; it validates and uploads the proposal as
  an artifact. `propose` has no Anthropic key and runs no repository code (git, gh, jq only): it
  commits the allowlisted generated files (`satellites.yml`, `past_conferences.yml` and `series.yml` in
  past mode, `geocache.json`, `build/data.json`, `archive/NNNN.json`), pushes a branch and opens the PR.
- **CI on agent PRs:** PRs opened with `GITHUB_TOKEN` do not trigger `pull_request` workflows, so the
  `propose` job runs `gh workflow run ci.yml --ref <branch>` (`ci.yml` has `workflow_dispatch`). A
  GitHub App token or fine-grained PAT would make this unnecessary.

## 4. CO₂ estimation

### 4.1 Principle: estimates, orders of magnitude

All CO₂ figures are **estimates**. Wording must convey orders of magnitude, not precision:

- Always `~` + rounded to 2 significant figures: "~50 kg", "~1.4 t". Never "49.7 kg".
- Labels: "Estimated CO₂e" / "Rough footprint", never bare "CO₂".
- Comparisons emphasize scale: "Paris: roughly 54× less than flying to Sydney".
- Filter label: "Estimated footprint under ~X kg".
- Methodology note starts with "These are order-of-magnitude estimates…".

### 4.2 Method

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

### 4.3 Cross-check link

- Flight estimates link to **myclimate** ("Cross-check this flight on myclimate"), with one line:
  "Different methods give different figures — same order of magnitude is expected."
- myclimate does prefill via `?from=BER&to=SYD`, but only accepts airport names or **IATA codes**
  ("Paris" is rejected), and the app has no airport data. So the link is **plain** for now;
  `myclimateUrl(from, to)` prefills as soon as IATA codes are supplied.
- Accepted for now; replace if a better recognized calculator appears.

## 5. Frontend

### 5.1 Stack

Svelte 5 (runes) + Vite + TypeScript, **MapLibre GL JS**, **OpenFreeMap** vector tiles
(no key, no quota). Restyled muted basemap with light and dark variants.

### 5.2 Scope

Map-first, attendance-oriented. Deadlines appear as a quiet line in the detail panel
("Paper deadline: passed" / date) with a link to the HF site for countdowns.

### 5.3 Filters (extensible)

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
| `dates` | `{from, to}` window | Same state as the timeline (§5.4); test uses `end ≥ from && start ≤ to` |
| `subject` | conference tags | Upstream's free-form tags grouped into subjects with short URL codes (`sub=ML,CV`; e.g. `ML` machine learning, `RL`, `LLM`); near-duplicate tags merge; unknown tags become their own subject under "Other" |
| `search` | text match on title/full name | aideadlin.es-style; commas = any of several, spaces = all words |
| `radius` | within X km/mi of home | Needs home; greyed with "Set your city" otherwise. Virtual editions pass; hybrid ones use their city |
| `co2` | estimated footprint under ~X kg | Needs home; uses global mode/threshold. Virtual editions count as 0 kg and pass; hybrid ones use their city |
| `access` | open / registration / authors only | |
| `kind` | official / community | |
| `open` | submission still open | Next upstream deadline (abstract or paper) after today |

The filter panel renders only registered filters, so adding a filter still means adding a file. In
the sidebar it is a **search field** (the `search` filter's control, always visible) above a row of
**chips**, one per other filter. A chip shows a dot when its filter is active. Clicking a chip opens
that filter's control in a tray under the row. Only one tray is open at a time. Esc closes it and
returns focus to the chip. In the mobile filters panel (§5.7) there are no trays: every filter is a
stacked section with its control shown (multi-selects as fields, see below). Once any filter is
active, the sidebar shows **"Clear all"** with the active-filter count, and the filters panel shows
"Clear all" in its header.

**Multi-select filters** (`subject`, `access`) use one component, `MultiSelect`. It is a list of
native checkboxes in a fieldset. Tab moves between them and Space toggles one. Topics shows its
subject groups as headings. A hint above the list says how the choices combine. A "Clear" link
beside the hint empties the selection. In a sidebar tray the checklist shows at once. In the mobile
layout the control is a **field**: a button that shows the current choice. A tap on the field opens
the checklist in a **dropdown**. The dropdown is a small modal dialog anchored under the field, over
the rest of the filters panel. The field stays in place. The dropdown opens above the field when
there is less than 200 px below it and more room above. It stays inside the filters panel and
scrolls when the list is taller. When neither side has 200 px (phones held sideways), the panel
first scrolls the field to its top. Opening the dropdown focuses the first checkbox. "Done", a tap
outside or Escape closes only the dropdown, and focus returns to the field. A resize (a rotation)
closes it. Choices apply at once, as in a tray. With nothing selected, the field reads "Any topic"
or "Any access level". Otherwise it shows the first two choices in display order and "+N" for the
rest. The names shorten with an ellipsis when the field is too narrow. "+N" always shows. `kind`
stays a segmented control, because it is a single choice. `open` stays one checkbox.

### 5.4 Timeline / scrubber

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
- On phones the compact scrubber sits in the top bar, outside the sheet (§5.7).

### 5.5 Home location & privacy

- Home is set from the **home pill** at the top of the sidebar, which shows the city (or "Set your
  city") and opens a panel. The panel holds the **city autocomplete** (GeoNames cities with
  population ≥ 50,000, `public/cities.json`, lazy-loaded), **"Use my location"** (browser
  geolocation), a one-line privacy note and the travel preferences. On phones the same content
  sits in the logo panel (§5.7), with the travel preferences folded under a "Travel preferences"
  disclosure that shows the current choice.
- Geolocation results are **snapped to the nearest city on-device**; only the city is used/stored.
- Home is stored as a **GeoNames city** (id, name, country, coordinates) in `localStorage`
  (`confmaps:home`) only (wrapped in try/catch; app works without it).
- **Not in URLs by default.** Share dialog has an opt-in "Include my city in the link", which adds
  `home=<geonameid>` (the id only). A recipient's `home` applies **for that visit only**: it is
  not persisted and is stripped from the address bar afterwards. Likewise, shared CO₂ views carry all
  travel settings (`mode`, `thr`, `units`), applied for that visit only with a notice and a "Use mine"
  button. A link that only repeats the viewer's own travel settings (their own address after a
  reload) or their own saved city is not treated as shared. Third-party licences and attributions are shown in-app at `#credits` ("Data & credits").
- Lines from home to visible sites when home is set; detail shows nearest site per conference.

### 5.6 URL state

Filters, window, selection and history mode live in the URL so views are shareable, e.g.
`?c=neurips26&sub=ML,CV&radius=1000&co2=300&from=2026-11&to=2027-10`.
Units, mode and threshold are also persisted in `localStorage`. Home is in the URL only via opt-in
(`home=<geonameid>`, §5.5). `h` and `home` are reserved params that no filter may own.

### 5.7 Layout

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
│ (☰ brand) (Filters)  │  ← opens home, travel, legend, theme, share, credits
│ (▶ ▁▂█▂▁ ├window┤)   │  ← compact scrubber, a glass capsule under the top bar
│        MAP           │
│ ╭──────────────────╮ │
│ │═══ glass sheet ══│ │
│ │ list / detail    │ │  ← detail replaces list on select
└─┴──────────────────┴─┘

MOBILE, filters open (anchored under Filters, right-aligned with it)
┌────────────────────────┐
│ (☰ brand)   (Filters)  │
│  ╭───────────────────╮ │
│  │Filters Clear all ✕│ │  ← header stays put
│  │[ search         ] │ │  ← the rest scrolls
│  │Dates · Topics ▾   │ │
│  │Distance · …       │ │
│  │(Show 23 confs.)   │ │  ← footer stays put
│  ╰───────────────────╯ │
└────────────────────────┘

PHONE HELD SIDEWAYS (landscape, at most 500 px tall)
┌──────────────────────────────────────────┐
│ (☰ brand)(Filters)(▶ ▁▂█▂▁ ├window┤)     │
│ ╭────────────╮                           │
│ │ list /     │‹           MAP            │
│ │ detail     │                       (i) │
│ ╰────────────╯                           │
└──────────────────────────────────────────┘

PHONE HELD SIDEWAYS, panel folded (‹ folds it into a pill; the pill opens it again)
┌──────────────────────────────────────────┐
│ (☰ brand)(Filters)(▶ ▁▂█▂▁ ├window┤)     │
│                                          │
│                    MAP                   │
│ (23 conferences ›)                   (i) │
└──────────────────────────────────────────┘
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
- **Mobile layout:** the top bar holds the logo pill and Filters. Filters opens the filters panel.
  The compact timeline is a glass capsule on a second row under them. From 640 px wide, it joins the
  first row and takes the width left after Filters. The sheet has three snaps: peek (the grip and
  the list heading, 68 px plus the bottom safe area), half (50%) and full (up to the top bar).
  Tapping the grip cycles the snaps, and dragging it moves the sheet. Dragging the heading under the
  grip (the list heading, or the detail's title row) moves the sheet too, at every snap; a tap on
  the heading does not cycle the snaps. At peek the content is locked and shows its top. At half
  and full, pulling the content down with a finger lowers the sheet, but only if the content is
  already at its top when the finger lands. Otherwise the content scrolls. A swipe that starts
  upwards always scrolls the content. History mode lowers the sheet to peek. Selecting a
  conference raises a peek sheet to half. In the sheet the detail's header has a 12 px top padding,
  so its title and close button show at peek.
- **Phones held sideways** (`(orientation: landscape) and (max-height: 500px)`, below 1024 px
  wide): the sheet becomes a glass side panel on the left, from under the top bar to the bottom
  gap, `clamp(300px, 42vw, 360px)` wide. It has no snaps: it shows the list, or the detail in its
  place, and scrolls. The panel, the top bar and the attribution keep clear of the notch and the
  home indicator (safe-area insets). The map reserves the panel's width on the left. On phones the
  map can zoom out below 0 in both orientations.
- **Folding the side panel:** a small tab (‹) on the panel's right edge, "Hide panel", folds the
  panel for an almost full map. The panel then becomes a glass pill at the bottom-left. The pill
  shows the conference count, or the selected conference. It is one button that opens the panel
  again. The panel fades out first, then the pill fades in. On unfold, the pill goes at once and
  the panel fades in. The folded panel stays mounted, so list scroll survives. It is `inert` and
  hidden after its fade. Focus moves to the pill on fold and back to the tab on unfold. A new
  selection (a tapped pin) unfolds the panel to show the detail. The tab comes before the list
  rows in the tab order. With a selection, folding and unfolding move the map's padding but keep
  its zoom. With no selection, they fit the overview of every visible pin to the new free area,
  unless the viewer moved the map. In history mode they fit the editions' path. A panel that
  resizes, a rotation and a crossing of the desktop breakpoint fit the selection again; they are
  not folds. The state is not saved. It survives a rotation to portrait and back, unless a
  conference is selected meanwhile.
- **Logo panel (mobile):** the logo pill shows ☰, the logo and the wordmark; ☰ marks it as the
  button that opens the panel. The panel is anchored under the pill (a modal dialog). From top to
  bottom it holds the tagline and the close button, the home settings (the city or the city
  search, "Use my location", the privacy note and the shared-link notices) and the travel
  preferences in a disclosure, then the legend, the theme, Share and the footer links. It scrolls
  when it is taller than the window. Opening it focuses the close button, so the keyboard does not
  open. While the city or the travel settings of a shared link apply, a dot on ☰ shows it. Its
  close button, a tap outside or Escape closes it, and focus returns to the pill. Desktop has no
  logo panel.
- **Filters panel (mobile):** the Filters capsule opens a panel anchored under it (a modal dialog),
  like the logo panel. Its right edge lines up with the capsule's right edge. When that does not
  fit, on phones held sideways and from 640 px wide, its left edge lines up with the capsule's left
  edge. The panel then covers part of the side panel and the map. It is 340 px wide at most and
  reaches down to the bottom gap. Its header holds the title, "Clear all" (once a filter is active)
  and the close button. Its footer holds one button, "Show N conferences", with the number of
  conferences that pass. The header and the footer stay in place, and the body between them scrolls:
  the search field, then every other filter as a stacked section. The list updates live behind the
  panel. "Show N conferences" only closes the panel, as the close button does; it confirms the
  choice. With no match it reads "Show 0 conferences". On phones held sideways the footer button is
  40 px tall instead of 44 px. Opening it focuses the close button, so the keyboard does not open.
  Its close button, "Show N conferences", a tap outside or Escape closes it, and focus returns to
  Filters. Only one of the two panels is open at a time, because both are modal. Both use the
  `.anchored-panel` class (`base.css`). Desktop has no filters panel.
- **Dialogs:** a tap outside a dialog closes it, as Escape does: the Share dialog, the documents
  (Methodology, Privacy, Third-party notices), the logo panel, the filters panel and the dropdowns
  of the multi-select filters in it. The press must start outside too, so a drag that starts inside
  (selecting text in a field) and ends outside keeps the dialog open. When a dialog opens over
  another (Share from the logo panel, a dropdown in the filters panel), a tap outside closes only
  the top one. One Svelte attachment, `lightDismiss` (`src/lib/dialog.ts`), does this for every
  dialog.
- **Map insets:** the map reserves space for the sidebar, the timeline and the open drawer (panel
  size plus the gap), so fitting to a conference and "back to selection" keep pins clear of every
  panel. The collapsed pill (desktop) and the folded pill (phones held sideways) float over the map
  like the legend, so they reserve nothing.
- **Attribution** is shown in full when the free map area is at least 560 px wide and in compact
  form below that. On phones it is always compact and collapsed from the start: only its (i)
  button shows, and a tap on it shows the credits. This departs from the OSMF attribution
  guidelines, which ask for the credits to show at first load; the owner chose it.
- **Legend:** it reads "Main venue", then "Satellites:" with its two kinds ("official",
  "community") as one inner list, then "Authors only" (an official satellite with the badge).
  Beside an open drawer it is hidden below 1280 px, because the strip of map is too narrow. It
  returns when the drawer closes. A "Satellite link" item (the dashed line) appears only while the
  map shows a main ↔ satellite line. On phones it is in the logo panel.
- **List order:** upcoming conferences come first, soonest first. A conference is upcoming while
  one of its visible sites has not ended (ending today counts). Finished conferences follow, most
  recent first. The rule is the same in every window, so the past presets open on the newest
  editions.
- Hover list row → highlight its pins. Click row → detail panel + fit map to the conference's sites.
- **Click pin** → detail panel at the same zoom. The map stays still, or pans to centre the pin if
  the drawer would cover it. **Double-click pin** → fit to the conference's sites; double-clicking
  it again (before zooming by hand) returns to the overview of every visible pin. Double-clicking
  empty map keeps MapLibre's zoom in.
- Detail: dates, deadline status, each site with access, distance, estimated CO₂, myclimate link,
  "View history". A flight estimate is nonstop, with a second line for one connection each way
  ("~4.6–4.0 t depending on layovers"; METHODOLOGY.md, Layovers). The list and filters use the
  nonstop figure.
- Selection stays highlighted while panning; "back to selection" control.
- Crowded areas cluster with counts; co-located events open a list.

### 5.8 Visual design

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

### 5.9 Virtual and hybrid editions

Past main editions can be virtual or hybrid (§2.4, §2.5).

- **Virtual:** listed with a "Virtual" badge (monitor icon + text, never colour alone) and place
  "Online"; **no pin**, no map focus or "back to selection", no home line. The detail panel says
  "Virtual event · Official", with no venue. Footprint: **"Online · ~0 kg"** (never estimated;
  "Attending online: no travel"), no mode toggle, myclimate link or comparison; "Nearest first"
  sorts it at distance 0.
- **Hybrid:** the normal pin and city plus a "Hybrid" tag; the trip estimate is shown with "Also
  online (~0 kg)". Distance and CO₂ filters use the physical city.
- Past editions without deadlines hide the deadline line (and the HF countdown link).
- Credits name paperswithcode/ai-deadlines (MIT) next to huggingface/ai-deadlines.

## 6. Analytics

GoatCounter (cookieless, no consent banner), page views + anonymous custom events only:
`filter_used:<id>`, `history_mode_opened`, `play_pressed`, `myclimate_clicked`, `share_opened`.
Never coordinates, cities, or free text. Event list documented in `PRIVACY.md`, linked from the footer.

As built: no third-party script. The app calls GoatCounter's documented **count endpoint** directly
(`src/lib/analytics.ts`), so nothing is stored in the browser. It is **off unless the `GOATCOUNTER_CODE`
Actions variable is set** (passed to the build as `VITE_GOATCOUNTER_CODE` by `deploy.yml`), off on
localhost, and **Do Not Track and Global Privacy Control are respected**. Each event is sent at most
once per page load; the page view carries only the referrer's origin.

## 7. Hosting

- GitHub Pages with the custom domain **confmaps.org**, set by `public/CNAME` (decided at build
  time, so shareable links never depended on the default URL).
- Footer attribution: OpenStreetMap / OpenFreeMap, huggingface/ai-deadlines (MIT), DESNZ factors,
  GeoNames.

## 8. Testing & CI

| Tier | What | Tool | Blocks merge |
|---|---|---|---|
| Data validation | satellites/overrides schema, `parent` ids exist, `start ≤ end`, all locations geocoded, unique ids, archive never shrinks | Zod + Node script | ✅ |
| Unit | CO₂ model with **golden values** hand-computed from the official DESNZ table (e.g. Berlin→Paris rail, Berlin→Sydney flight; round trip, RF), haversine, each filter's `test()` + URL round-trip, `end ≥ today` boundaries, timezone-safe dates | Vitest | ✅ |
| Build | type check + production build | `svelte-check`, `vite build` | ✅ |
| E2E smoke (~5 tests) | load, set home, radius filter changes pin count, open detail, myclimate link present, play advances window | Playwright (1 browser) | ✅ |
| A11y | axe scan, both themes, desktop + phone (`pnpm test:a11y`; separate warn-only CI job) | `@axe-core/playwright` | ⚠️ warn only initially |

The discovery agent's PRs go through the same pipeline. The workflows that run these checks are
described in [system-architecture.md](system-architecture.md) §8.
