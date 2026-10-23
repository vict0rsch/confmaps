# Historical backfill spec — PwC import, past-editions discovery, virtual/hybrid editions

## Owner decisions (2026-10-23)

1. Import past main conferences **as far back as possible**, including every historical version of
   `paperswithcode/ai-deadlines` `_data/conferences.yml` in that repo's git history.
2. **Virtual editions** are listed with a "Virtual" badge and **no pin**; hybrid editions get their
   in-person pin plus a "Hybrid" note.
3. Virtual editions **pass** distance/CO₂ filters and footprint display as **"Online · ~0 kg"**.
4. Accepted recommendations: hybrid editions use their physical city for radius/CO₂; the timeline
   axis defaults to the last 5 years plus an "All years" preset.
5. COVID/stale `# review:` flags are resolved by research subagents with cited sources (no Claude
   API key is available locally); the discovery `--recheck` mode is still implemented.

## 0. Findings (PwC history, verified)

- **964 commits** touch `_data/conferences.yml` on `gh-pages`, `c9d3f7b6` (2016‑11‑18) → `b230d247…`
  (2024‑09‑15, current HEAD; repo stale since). 34 versions are not whole-file-parseable YAML (broken
  quotes/indent); the only edition that exists _only_ in those is `3dv19` — recovered by a per-entry
  fallback parse (§3.1).
- **Field set** (occurrences across all versions): `year, deadline, place, id, link, sub, date`,
  `timezone` (63k), `title` (59.9k) **or `name`** (2016–2018, 4.5k), `hindex`, `start`/`end` (36.5k),
  `note`, `abstract_deadline`, `paperslink`, `full_name`, `pwclink`, `long` (variant of full_name),
  typos `data` (for `date`, e.g. CIKM24), `Note`, `Id`, `host`.
- **388 distinct ids → 364 distinct editions** (`seriesKey(title)|year`): 2016:4, 2017:27, 2018:33,
  2019:34, 2020:50, 2021:44, 2022:49, 2023:50, 2024:59, 2025:14; 116 series keys. **Recoverable range
  2016–2024.** All 13 collisions with HF are 2025 editions (by id _and_ series|year): aaai25, icra25,
  icassp25, wsdm25, wacv25, coling25, chi25, aamas25, ecir25, iclr25, naacl25, cvpr25, aistats25.
  **≈345 net new editions** after HF collisions + exclusions (§3.6).
- `start`/`end` present on only 204/387 latest entries; the rest have free-text `date` in many forms
  (`Aug 9-12, 2019`, `Sept 9–12`, `October, 9-12, 2022`, `August 3-4 2017`, unpadded `2025-2-28`).
- `place`: 233 distinct strings; mostly `City, [Region,] Country`, plus venue prefixes
  (`Palais des Congrès de Montréal, Montréal, Canada`, `Hilton Hawaiian Village, Honolulu, Hawaii, USA`),
  missing country (`London`, `Vancouver`, `Honolulu, Hawaii`, `Newcastle upon Tyne`), missing city
  (`Texas, USA`, `Hawaii, EEUU`, `Long Beach Convention Center, California`), multi-city
  (`Potsdam/Berlin, Germany`), `TBD`, a joke entry (`cal19` "Schiaparelli, Mars"), virtual (`Online`,
  `online`, `Virtual conference`, `Virtual, free to attend`, `Online (Kyiv, Ukraine)`), hybrid
  (`…; and virtual`, `…, and virtual`, `… AND Online`, `Hybrid (Dubrovnik, Croatia)`).
- `sub` codes (from `types.yml`): ML, CV, CG, NLP, RO, SP, DM, AP (Automated Planning), KR, HCI; plus
  `GR` (siggraph17 = CG), `AI`/`Statistic` (only in aistats2025, an HF collision). `sub` is a string
  or a list.
- `timezone` forms: IANA (`America/Los_Angeles`, `Etc/GMT+12`, `US/Pacific`), `UTC±N`, `UTC-0`, `GMT`,
  `EST`, `CET`, invalid `PCT`, and 21 entries without timezone — irrelevant because deadlines are
  dropped (§1.4).
- PwC ids: 322 `<stem><yy>`, 49 `<stem><yyyy>`, 17 irregular (`UAI17`, `ACMMultimedia`, `CIKM24`,
  `wacv25_2`, `neurips24DBT`, `cscw24_january`, …). HF ids mix both (`neurips25`, `iclr26` but
  `icdar2027`, `alt2025`, `ijcnn2025`, `cec2025`, `inlg2026`).
- **Data errors that matter**: same edition under several ids (24 cases: `icra2020`/`icra20`/`icra21`,
  `alt2020`/`alt20`, `ACMMultimedia`/`mm20`, `UAI17`/`uai17`, `3dv18`/`threedv18`, …); year typos
  (`icra21` has `year: 2020` but dates/place of ICRA 2021; `cvpr23` and `www23` have a 2022 `start`;
  `eccv20` date text says 2022; `naacl20` titled "ACL"); title noise (`<span>*</span>SEM`, `WWWW`,
  `ICDM2021`, `LOG`/`LoG`, `MM`); historical names (`NIPS`, `NAACL-HLT`, `EMNLP-IJCNLP`,
  `IJCAI-PRICAI`, `IJCAI-ECAI`, `AACL-IJCNLP`, `AutoML-Conf`); non-main-conferences (two AAAI 2024
  spring symposia `aaaisss24cfm`, `aia24`; `neurips24DBT` track).
- **COVID staleness is the biggest risk**: entries were usually pruned _before_ the event, so many
  2020–2021 editions keep their **planned** city (icassp20 Barcelona, acl20 Seattle, eccv20 Glasgow,
  icra20 Paris, iros20 Las Vegas, rss20 Corvallis, siggraph20 DC, coling20 Barcelona, mm20 Seattle…)
  and some were cancelled outright (LREC 2020 Marseille). 194 ids were last seen in 2024, the rest
  earlier — last-seen-before-`start` is a reliable "never updated after the event" signal.

## 1. `data/past_conferences.yml` — the interface between all workstreams

Architecture confirmed with one refinement: entries are **frozen into the archive like everything
else**, so **every correction/removal must happen before the backfill PR merges** (after merge, a
removal breaks archive-never-shrinks).

### 1.1 Zod (add to `scripts/schema.ts`, workstream A, first commit)

```ts
export const PastFormatSchema = z.enum(['in_person', 'virtual', 'hybrid']);
const sha40 = z.string().regex(/^[0-9a-f]{40}$/);

/** Where an imported entry came from in paperswithcode/ai-deadlines `_data/conferences.yml`. */
export const PwcProvenanceSchema = z.strictObject({
  ids: z.array(z.string().min(1)).min(1), // PwC ids merged into this edition; [0] = the one used
  first_sha: sha40,
  first_date: isoDate, // first commit any of them appears in
  last_sha: sha40,
  last_date: isoDate, // last commit (the version the fields come from)
  fixes: z.array(z.string().min(1)).optional(), // importer cleanups applied, e.g. "title: WWWW → WWW"
});

/** One past main edition (DESIGN §3.4). Deadlines are deliberately not represented. */
export const PastConferenceSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+$/, 'lowercase letters and digits only'),
    title: z.string().min(1), // as named that year ("NIPS"); series = seriesOf(title)
    year: z.number().int().min(1950).max(2100),
    full_name: z.string().min(1).optional(),
    link: httpUrl,
    start: isoDate,
    end: isoDate,
    format: PastFormatSchema,
    city: z.string().min(1).optional(), // required unless virtual; forbidden if virtual
    country: z.string().min(1).optional(), // ditto
    venue: z.string().min(1).optional(), // forbidden if virtual
    tags: z.array(z.string().min(1)), // HF-style slugs; may be []
    notes: z.string().min(1).optional(),
    source: z.enum(['pwc', 'curated']),
    pwc: PwcProvenanceSchema.optional(), // required iff source = pwc
    sources: z.array(httpUrl).optional(), // evidence URLs; ≥1 required iff source = curated
  })
  .superRefine((e, ctx) => {
    const bad = (message: string, path: string) =>
      ctx.addIssue({ code: 'custom', message, path: [path] });
    if (e.format === 'virtual') {
      for (const k of ['city', 'country', 'venue'] as const)
        if (e[k] !== undefined) bad('not allowed on a virtual edition', k);
    } else {
      if (!e.city) bad('required unless format is virtual', 'city');
      if (!e.country) bad('required unless format is virtual', 'country');
    }
    if (e.source === 'pwc' && !e.pwc) bad('required when source is pwc', 'pwc');
    if (e.source === 'curated' && e.pwc) bad('only for source pwc', 'pwc');
    if (e.source === 'curated' && !e.sources?.length)
      bad('curated entries need evidence URLs', 'sources');
    if (e.start > e.end) bad('start is after end', 'start');
    const yy = String(e.year % 100).padStart(2, '0');
    if (!e.id.endsWith(String(e.year)) && !e.id.endsWith(yy))
      bad(`must end with ${e.year} or ${yy}`, 'id');
  });
export const PastConferencesFileSchema = z.array(PastConferenceSchema);
export type PastConference = z.infer<typeof PastConferenceSchema>;
```

YAML conventions: key order `id, title, year, full_name, link, start, end, format, city, country,
venue, tags, notes, source, pwc, sources`; dates single-quoted; header comment documents fields;
importer writes entries sorted by `(year, id)`; discovery agent appends at the end. Optional
`# review: <reason>` end-of-line comment marks an entry the importer wants a human to check.

### 1.2 Id convention (identical algorithm in TS and Python)

1. Stem from HF: among `data.json` conferences with `source === 'hf'`, same `series`, and no track
   (`trackName(c) === null`), take the newest; match `/^(.*?)(\d{4}|\d{2})$/`; accept only if the
   digits equal `year` (4) or `year % 100` (2) → `stem`, style 4|2.
2. Fallback: `stem = series.replace(/-/g, '')`, style 2.
3. `id = stem + (style 4 ? year : pad2(year % 100))`.
4. If that id is already used by a different edition → error resolved via a fixes-table entry
   (never auto-suffix).

Shared test vectors: neurips/2018 → `neurips18` (title "NIPS"); icdar/2019 → `icdar2019`;
alt/2020 → `alt2020`; acm-mm/2020 → `acm20`; ecml-pkdd/2019 → `ecmlpkdd19`; ijcnlp-aacl/2020 →
`ijcnlpaacl20`; 3dv/2018 → `3dv18`; siggraph-asia/2022 (no HF series) → `siggraphasia22`;
emnlp/2019 (from "EMNLP-IJCNLP" via alias) → `emnlp19`. If HF ever backfills an old edition, the ids
collide cleanly and HF wins.

### 1.3 Series aliases (workstream A adds to `SERIES_ALIASES` in `scripts/lib/normalize.ts`)

`nips→neurips`, `naacl-hlt→naacl`, `emnlp-ijcnlp→emnlp`, `ijcai-pricai→ijcai`, `ijcai-ecai→ijcai`,
`aacl-ijcnlp→ijcnlp-aacl`, `mm→acm-mm`, `automl-conf→automl`. Historical titles stay as written;
`series === seriesOf(title)` remains the single rule (no change to archive re-derivation or the
consistency check). `lrec-coling` (2024) stays its own series (can't belong to two).

### 1.4 Deadlines and tags

Past conferences get `deadlines: []` — avoids the `PCT`/missing-timezone failures and
deadline-after-end sanity errors; the PwC SHA keeps them recoverable. Tags: explicit in each entry
(HF-style slugs); the importer derives them from `sub`, the agent copies the series' latest edition
tags from `data.json`.

## 2. Data model, pipeline, validation (workstream A)

### 2.1 Output types (`scripts/schema.ts`)

`ConferenceSchema.source` → `z.enum(['hf', 'pwc', 'curated', 'archive'])` (`pwc`/`curated` copy the
YAML `source`; the pipeline never rewrites them to `archive` — only `hf → archive` as today).

`EventLocation` becomes a union:

```ts
const locationBase = {
  id,
  conferenceId,
  role: z.enum(['main', 'satellite']),
  name,
  start: isoDate,
  end: isoDate,
  official: z.boolean(),
  presentsPapers: z.boolean(),
  access,
  link: httpUrl,
  notes: z.string().optional(),
};
export const PinnedLocationSchema = z.strictObject({
  ...locationBase,
  format: z.literal('hybrid').optional(), // absent = in person (all existing records unchanged)
  city: z.string().min(1),
  country: z.string().min(1),
  venue: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export const VirtualLocationSchema = z.strictObject({
  ...locationBase,
  role: z.literal('main'),
  format: z.literal('virtual'),
});
export const EventLocationSchema = z.union([PinnedLocationSchema, VirtualLocationSchema]);
export type PinnedLocation = z.infer<typeof PinnedLocationSchema>;
export type VirtualLocation = z.infer<typeof VirtualLocationSchema>;
export const isVirtual = <L extends { format?: string }>(l: L): boolean => l.format === 'virtual';
```

Backward compatible: `format` absent for in-person, so every current `data.json`/archive record is
byte-identical. Decisions: `format` lives on the **location**, not the conference; only main
locations may be virtual; virtual carries no city/country/venue/lat/lng; overrides can't set `format`
(curated entries are edited directly).

`PendingLocation`: `Omit` doesn't distribute over unions — define

```ts
type DOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type PendingLocation =
  (DOmit<PinnedLocation, 'lat' | 'lng'> & { lat?: number; lng?: number }) | VirtualLocation;
```

### 2.2 Pipeline (new `scripts/lib/past.ts`; `pipeline.ts`, `files.ts`, `geocode.ts`, `normalize.ts`)

- `past.ts`: `pastToConference(e)` →
  `{id, series: seriesOf(title), title, year, fullName?, link, tags, deadlines: [], start, end, source}`;
  `pastToLocation(e)` → `id: '<id>@main', role: 'main', name: '<title> <year>', official: true,
presentsPapers: true, access: 'registration', link, notes?`, `format` only when virtual/hybrid,
  city/country/venue unless virtual.
- `files.ts`: `dataPaths.past = data/past_conferences.yml`; `loadInputs` parses with
  `PastConferencesFileSchema` (missing file = `[]`).
- `BuildInputs.past`; merge order in `buildDataset`: archive → **past entries (overwriting their
  archive copies)** → HF upstream → satellites → overrides → countries → geocode → freeze. Precedence
  **HF > past entry > archive copy**, overrides on top. A past id equal to an upstream id → HF wins
  and the build **warns** `past_conferences.yml: "<id>" is also upstream (HF wins); remove it` (not
  an error — would break the daily sync). `fresh` includes past `@main` ids not shadowed by HF.
- Build-time errors: past entry with `start > today` (upcoming editions come from upstream); an
  override on a virtual location that sets lat/lng/city/country/venue.
- Virtual locations are skipped by `canonicalizeCountries` and `resolveCoordinates` (no geocoder
  call). Overrides on `<pastId>@main` work as for HF (incl. lat/lng for geocoding fixes).
- Archive: `freeze`/`writeArchiveDir` unchanged; past records land in `archive/<conference.year>.json`
  (creating 2016…2024 files). A postponed edition stays in its nominal year file (`icpr20`, held
  Jan 2021 → `2020.json`).
- Mass-drop guard unchanged (counts only `hf`).

### 2.3 Validation (`validate.ts`)

`validateDataset`: duplicate past ids, duplicate `series|year` within the past file, past id equal to
a satellite id → errors; a non-virtual past entry must be geocoded unless an override sets lat/lng
(mirrors satellites); the "not geocoded" check runs only on pinned locations; `satellites.yml`
`parent` may now be a past id (no code change). `sanityCheck`: the same-edition warning keys on
`c.series` instead of `seriesKey(c.title)` (catches NIPS/NeurIPS duplicates); the year/start
mismatch warning stays.

### 2.4 Consistency (`consistency.ts`)

Past entries are fully re-derivable offline (like satellites): for each entry not shadowed by an `hf`
conference in `data.json`, rebuild expected conference + location (`pastTo*` → overrides incl.
`@main` start/end → canonical country → geocache/override coordinates) and diff field by field. A
conference with `source` `pwc`|`curated` must be in `past_conferences.yml` or the archive. Virtual
locations skip the canonical-country and geocache checks; the `@main` default checks (name, link,
dates, official, presentsPapers, access) still apply.

### 2.5 `validate-data.ts`

Fail if `past_conferences.yml` still contains `/#\s*review:/i` — forces every importer flag to be
resolved before merge.

## 3. PwC importer (workstream B)

Files: `scripts/import-pwc.ts`, `scripts/pwc/{history,place,dates,ids,tags,fixes,emit}.ts` + tests,
`scripts/pwc/__fixtures__/`, `package.json` script `data:import-pwc`; output
`data/past_conferences.yml`. Read-only imports: `PastConferencesFileSchema` (`scripts/schema.ts`),
`seriesOf` (`scripts/lib/normalize.ts`), `canonicalCountry` (`scripts/lib/countries.ts`),
`geocacheKey` (`scripts/lib/geocode.ts`), `trackName` logic (copy the regex). `countries.ts` is not
edited; regions/aliases live in the importer.

CLI: `pnpm data:import-pwc [--pwc-dir <bare clone>] [--data-dir data] [--force] [--dry-run]`.
Refuses to write if `past_conferences.yml` exists and is non-empty unless `--force`; always refuses
if any `source: curated` entry exists (one-time writer). Exits 1 and writes nothing while any entry
is unresolved. Prints a PR-body report: counts, exclusions, fixes applied, flags, new geocache keys
(keys absent from `geocache.json`).

### 3.1 Reading history (`history.ts`)

Bare clone `https://github.com/paperswithcode/ai-deadlines.git` (`gh-pages`, small) into a temp dir
(mirror `upstream.ts`); pin `PWC_HEAD = 'b230d24719088a769e6938704a826e5084b4cb34'` and warn if the
branch tip differs. `git log --format='%H %cI' gh-pages -- _data/conferences.yml` (oldest first);
`git show <sha>:_data/conferences.yml` per version — no GitHub API, no rate limit. Parse with
`yaml.parse(text, { uniqueKeys: false })` (core schema, dates stay strings); if the whole file fails,
split on `/^- /m` and parse each chunk, skipping chunks that still fail (recovers `3dv19`). Normalize
keys: `title ?? name`, `id ?? Id`, `start/end`, `date ?? data`, `full_name ?? long`. Union per PwC id
— the **latest version wins**; record first/last SHA + date. Entries without id get key
`title+year` (only `KIL2024`, a duplicate of `kil24`).

### 3.2 Field mapping

| PwC                                                                                                   | →                                                                               | Rule                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`/`name`                                                                                        | `title`                                                                         | strip HTML tags; `TITLE_FIXES`: `WWWW→WWW`, `ICDM2021→ICDM`, `MM→ACM MM`, `LOG→LoG`, `*SEM` stays; historical names stay (aliases §1.3)                                                                                                                                                                           |
| `year`                                                                                                | `year`                                                                          | must equal year of `start`; mismatch → error unless `fixes.ts` entry (e.g. `icpr20` allowed, `icra21 → year 2021`, `cvpr23`/`www23` start fixes). Checked **before** dedupe                                                                                                                                       |
| `id`                                                                                                  | `pwc.ids`                                                                       | our id from §1.2                                                                                                                                                                                                                                                                                                  |
| `link`                                                                                                | `link`                                                                          | must be http(s), else unresolved                                                                                                                                                                                                                                                                                  |
| `start`/`end`                                                                                         | `start`/`end`                                                                   | zero-pad (`2025-2-28`→`2025-02-28`); if missing, parse `date` with `dates.ts` (full/abbr. months incl. `Sept`, `-`/`–`/`-`, optional comma after month or before year, cross-month ranges, single days); if both exist and disagree, use `start/end` and report                                                   |
| `place`                                                                                               | `format`, `city`, `country`, `venue`, `notes`                                   | §3.3                                                                                                                                                                                                                                                                                                              |
| `sub`                                                                                                 | `tags`                                                                          | `ML→machine-learning`, `CV→computer-vision`, `NLP→natural-language-processing`, `RO→robotics`, `SP→speech,signal-processing`, `DM→data-mining`, `CG`/`GR→computer-graphics`, `AP→automated-planning`, `KR→knowledge-representation`, `HCI→human-computer-interaction`; any other code → error; dedupe, keep order |
| `full_name`/`long`                                                                                    | `full_name`                                                                     | trim                                                                                                                                                                                                                                                                                                              |
| `deadline`, `abstract_deadline`, `timezone`, `hindex`, `note`/`Note`, `paperslink`, `pwclink`, `host` | —                                                                               | dropped (documented in the header comment)                                                                                                                                                                                                                                                                        |
| —                                                                                                     | `source: pwc`, `pwc: {ids, first_sha, first_date, last_sha, last_date, fixes?}` |                                                                                                                                                                                                                                                                                                                   |

### 3.3 `place` parsing (`place.ts`, deterministic; anything not covered → unresolved)

1. Virtual: `^(online|virtual)\b` or `^virtual conference$` (case-insensitive) → `virtual`;
   `Online (X)` → virtual + `notes: "Held online (nominal host: X)."`.
2. Hybrid: `^hybrid\s*\((.+)\)$` → hybrid with inner text; `/[;,]?\s*(and|&)\s+(virtual|online)\s*$/i`
   → hybrid with the prefix. Then continue on the prefix.
3. `TBD`/`TBA`/empty → unresolved.
4. `X (Country)` → `X, Country`.
5. Split on commas, trim, drop empty tokens.
6. Country = last token via `canonicalCountry`, then importer `COUNTRY_ALIASES` (`EEUU`, `U.S.`,
   `Macedonia→North Macedonia`, `Scotland`/`Wales→United Kingdom`). If the last token is a region in
   `REGIONS` (US states incl. the typo `Lousiana`, Alberta, Ontario, Nova Scotia, Quebec, Queensland,
   Western Australia, Basque Country, Sicily, Tuscany, Okinawa) → its country (token consumed). A
   single-token city-state (Singapore, Hong Kong, Macao, Luxembourg) → city = country. Else
   unresolved.
7. Strip region tokens between city and country.
8. City = last remaining token; earlier tokens joined with ", " = venue. If the city token looks like
   a venue (`/University|Cent(er|re)|Convention|Hotel|ExCeL/`) or contains `/` → unresolved.
9. `CITY_ALIASES` reuse existing geocache spellings: `New York City→New York`, `Milano→Milan`,
   `Torino→Turin`, `Bangaluru→Bangalore`, `Santiago de Compostella→Santiago de Compostela`,
   `Jeju Island→Jeju`, `Rhodes Island→Rhodes`, `Luebeck→Lübeck`, `Washington`+`D.C.→Washington DC`,
   `Waikoloa Village→Waikoloa`.

Unresolved entries need `PLACE_FIXES[pwcId] = { format, city?, country?, venue?, notes?, reason }`
in `fixes.ts`, or `EXCLUDE[pwcId] = reason`. Golden test: every one of the 233 distinct
latest-version place strings with its expected output or "unresolved" (fixture derived from the
PwC history).

### 3.4 Dedupe

1. Group ids by `seriesOf(cleanTitle)|year` (after year checks/fixes).
2. Within a group, the id with the latest `last_date` wins (ties: has `start/end`, then shorter id);
   all ids go into `pwc.ids`. Example: `corl2020` (Cambridge, last seen 2020‑03) loses to `corl20`
   (Online, last seen 2021‑04) — correct.
3. Drop any edition whose id or `series|year` exists in `data/build/data.json` (any source); report
   the 13 HF 2025 collisions.
4. `EXCLUDE`: `cal19` (fictional), `aaaisss24cfm`, `aia24` (symposia, not main conferences),
   `neurips24DBT` (track), `wacv25_2` (duplicate). Cancelled editions (e.g. `lrec20`) are excluded
   once confirmed in review.

### 3.5 Flags (`# review:` comments; all must be resolved before merge)

- `covid`: PwC says in person and `start` ∈ [2020‑03‑01, 2021‑12‑31] (≤ ~80 editions).
- `stale`: `pwc.last_date < start` (never updated after the event).
- `multi-id`: the edition merged >1 PwC id.
- `fixes-applied`: so a reviewer eyeballs each fix.

Resolution: via the agent (§5, `--recheck`) or by hand with a source URL (append to `sources`, set
`notes`), then delete the comment.

### 3.6 Expected output

≈345 entries for 2016–2024 (+ ≤ a few non-colliding 2025); ≈20 virtual + 6 hybrid before the COVID
pass; ≈100–130 new geocache keys (89 exist today, ~50 overlap).

## 4. Frontend semantics (workstream C; `src/**`, `e2e/**`)

1. **Data layer** (`src/lib/data/types.ts`, `load.ts`): re-export `PinnedLocation`, `VirtualLocation`,
   `isVirtual`; add `type PinnedJoined = Extract<JoinedLocation, { lat: number }>` and
   `AppData.pinnedLocations`. `groupTracks`: a virtual main has no city → never grouped (acceptable).
2. **App state** (`app.svelte.ts`): `mapLocations` gets an extra `.filter(l => !isVirtual(l))`; new
   `selectedPins` derived from `selectedSites` (`selectedSites` stays complete for Detail).
3. **Map** (`Map.svelte`, `geojson.ts`, `choreography.ts`): `pinFeatures`/`linkFeatures`/`animFeatures`
   take `readonly PinnedJoined[]` (the type system enforces "no pin"); `animFeatures(app.data.pinnedLocations)`;
   focus, home lines, `fitSelection` and `updateOffscreen` use `selectedPins` — no pins → no camera
   move, no "back to selection". Clustering, co-located lists and links only see pins (a link needs a
   pinned main).
4. **List row** (`ConferenceList.svelte`, `labels.ts`, new `VirtualBadge.svelte`): `placeLabel(virtual)`
   → `"Online"`; `FORMAT_LABEL = { virtual: 'Virtual', hybrid: 'Hybrid' }`. A virtual site renders a
   "Virtual" badge (monitor icon + text, never colour alone) instead of `SiteMarker`, place reads
   "Online"; a hybrid site renders the normal marker + city plus a "Hybrid" tag (like "Satellite").
   Access badge unchanged.
5. **Footprint** (`src/lib/home/footprint.ts`): replace `nearestTrip` with

   ```ts
   export type SiteOption<S> =
     { kind: 'trip'; site: S; trip: TripEstimate } | { kind: 'online'; site: S };
   export function nearestOption<S extends JoinedLocation>(
     home,
     sites: readonly S[],
     opts,
   ): SiteOption<S> | undefined;
   ```

   Any virtual site → `online`; otherwise the nearest pinned trip. `estimateTrip`/`safeTrip` are
   never called for virtual. The row shows **"Online · ~0 kg"** (`formatCo2(0)` → `~0 kg`) with a
   visually hidden "attend online, estimated"; "Nearest first" sorts online at distance 0.

6. **Detail / SiteFootprint**: virtual site → role line "Virtual event · Official", place "Online" +
   badge, no venue; `SiteFootprint` shows "Online · ~0 kg" and "Attending online: no travel"; no mode
   toggle, no myclimate, no comparison. Hybrid → normal trip + "Also online (~0 kg)". `isNearest`
   and the comparison consider pinned sites only; the comparison needs a pinned main. Deadline fact:
   hidden (incl. the HF countdown link) when `deadlines.length === 0 && conference.end < app.today`.
7. **Filters**: `radius.test`: no home → true; virtual → true; else distance. `co2.tripKg`: no home →
   `undefined`; virtual → `0`; else estimate. Hybrid uses its physical city for both (accepted). The
   current code would already pass virtual by accident (NaN/throw) — an explicit branch + tests are
   required. `open`, `access`, `kind`, `subject`, `dates` unchanged. `subject.ts`: add
   `automated-planning` to the `KR` subject's tags.
8. **History** (`history.ts`, `timeline.svelte.ts`, `Timeline.svelte`): `historyStops` filters
   `role === 'main' && !isVirtual` — the path skips virtual editions (the leg joins the neighbouring
   stops); hybrid editions are normal stops. `HistoryState.onlineYears` (virtual main years) shown
   next to the history title as "Online: 2020 · 2021"; `years` still counts every edition.
9. **Timeline**: the histogram counts virtual editions (events, not pins) — no change. Axis domain
   (accepted): cover `{ from: max(span.from, monthStart(today − 60 months)), to: span.to }` ∪ the
   current window, plus an "All years" preset `{ from: span.from, to: today }` in `datePresets`
   (grows the domain back to 2016). Play keeps using the full `scope.span`.
10. **Search**: no change (the haystack includes `series`, so "neurips" finds NIPS editions).
    `Footer.svelte` credits: add paperswithcode/ai-deadlines (MIT).

## 5. Discovery "past" mode (workstream D; `scripts/discover/**`, `.github/workflows/discover.yml`)

### 5.1 CLI

`discover --mode past --series neurips[,icml] --since 1987 [--until YYYY] [--recheck] [--dry-run]
[--max-usd N] [--results-dir/--from-results/--out-dir]`. `--series` and `--since` required (series
`^[a-z0-9-]+$`); `--until` defaults to the current year − 1. Targets: years in `[since, until]` with
no known edition of the series (known = in `data.json` (any source) or `past_conferences.yml`).
`--recheck` also targets existing `source: pwc` entries in range (the COVID pass). One API call per
(series, batch of ≤ 6 target years), chronological; `web_search max_uses: 8`, `web_fetch max_uses: 12`.
`--max-usd` default stays 5 (recommendation: dry-run one series first, then set it from the measured
cost). The existing `--mode backfill` now also sees ≈345 past editions — it must skip virtual
editions, and the docs should recommend `--only` (otherwise cost explodes).

### 5.2 Prompt inputs

User message: series key + latest title/full name; all known editions
`{year, id, title, city, country, format, start, end, link}` (avoid duplicates, naming context);
target years; for `--recheck`, the current values to verify. System prompt mirrors the satellite one
(same evidence/security rules) plus "If no edition was held that year (biennial, cancelled), omit it;
report `cancelled` only with a quote." and "Prefer the official past-conferences page or the
edition's own site (archived copies on web.archive.org are acceptable)."

### 5.3 Output schema

```
{ editions: [{ year: int, rationale: str,
   title?, full_name?, link?, city?, country?, venue?, start?, end?, format? (enum in_person|virtual|hybrid),
   cancelled? (boolean) }] }   // every field except year/rationale is {value, source_url, quote}
```

### 5.4 Evidence rules (reuse `verify.py` primitives; new `past_verify.py`)

- title/full_name/city/venue/country: value-in-quote (country may be derived from the geocoded city).
- start/end: date-in-quote; `start ≤ end`; duration ≤ 21 days; `start.year ∈ {year, year+1}`
  (year+1 flagged in the PR).
- link: linked from the source page or same site.
- format virtual/hybrid: quote on the page ≥ 20 chars matching `virtual|online` resp.
  `hybrid|in[- ]person…(online|virtual)` (new verified kind `FORMAT_IN_QUOTE`).
- format in_person: derived ("pre-2020 default") if the city is verified and `start < 2020‑03‑01`;
  otherwise a judgement quote is required; with no quote → `# UNVERIFIED default` and the PR is a draft.
- Required after checks: start, end, link, format, and city + country unless virtual; a virtual
  edition drops any city. A pinned city must geocode in its country (`geo.Geocoder`).

**As built (evidence rules).** A format claim passes only when the quote positively asserts the format
in a non-negated, non-hedged clause and no conflicting format is asserted. Negated or hedged quotes go
to model judgement; a plain conflict is dropped. Review markers survive field deletion.

### 5.5 Merge (new `past_merge.py`; shared ruamel helpers move from `merge.py` to `yamlio.py`)

Dedupe by `series|year` against `data.json`, the past file, and earlier candidates in the run.
Additions: id per §1.2, `source: curated`, `sources` = evidence URLs, `title` verified else the
series' latest title, `full_name` only if verified, `tags` copied from the series' latest edition,
appended to `past_conferences.yml`. `--recheck` updates: on `source: pwc` entries, verified `format`,
`city`, `country`, `venue`, `start`, `end` changes are **applied** (PwC is lower trust than evidence;
a switch to virtual deletes city/country/venue; new sources are appended); on `source: curated`,
differences are suggestions only. **As built:** `--recheck` never applies a change that turns a virtual
entry into a physical one (suggestion only). `cancelled` is never applied — listed under "Needs human removal
(before merge)". PR flow: `proposed_files` adds `data/past_conferences.yml`; PR title
`Past editions: N addition(s), M update(s)`; `report.py` generalized for edition evidence tables.
`discover.yml`: `workflow_dispatch` inputs `mode` (choice), `series`, `since`, `until`, `max_usd`,
passed via `env` only (never interpolated into `run:`) and validated with argparse; the `propose`
job copies/`git add`s `data/past_conferences.yml`. `agent.research` is generalized to take
`system`, `schema`, `user`, `tools`; the satellite call stays as a wrapper.

## 6. File ownership and sequencing

| Workstream            | Owns (exclusively)                                                                                                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A pipeline/schema** | `scripts/schema.ts`(+test), `scripts/lib/{past,normalize,pipeline,consistency,validate,files,geocode}.ts`(+tests), `scripts/build-data.ts`(+test), `scripts/validate-data.ts`, `scripts/__fixtures__/`                                                                |
| **B PwC importer**    | `scripts/import-pwc.ts`, `scripts/pwc/**`, `package.json` (script line), `data/past_conferences.yml` (generated)                                                                                                                                                      |
| **C frontend**        | `src/**` (incl. `subject.ts`, `fixtures.ts`, `Footer.svelte`), `e2e/**`                                                                                                                                                                                               |
| **D discovery**       | `scripts/discover/**`, `.github/workflows/discover.yml`                                                                                                                                                                                                               |
| **Integrator (last)** | `DESIGN.md` (§3.4, §3.5, §4, §6, §10, §11), `METHODOLOGY.md` (one line: online attendance shown as ~0 kg, excludes streaming), `THIRD_PARTY_NOTICES.md` + `README.md` (PwC MIT), `data/geocache.json`, `data/overrides.yml`, `data/archive/*`, `data/build/data.json` |

Sequencing:

1. **A1** (small, first): §1.1 + §2.1 schemas + §1.3 aliases — the interface commit.
2. **B, C, D** in parallel against it (B tests against fixtures; C uses fixture locations, with
   virtual/hybrid added to `src/lib/filters/fixtures.ts`; D works against the YAML schema only).
3. **A2**: the rest of A, in parallel with them.
4. **Integration** (feature branch): `pnpm data:import-pwc` → iterate `fixes.ts` until the importer
   passes → `pnpm data:build` (geocodes ≈100–130 keys, ≈2–3 min at 1.1 s/req) → review geocoding
   warnings, add overrides/city fixes (e.g. Bali, Lanzarote, Stanford) → resolve COVID/stale flags
   (`discover --mode past --recheck …` or research with cited sources) → resolve all `# review:`
   markers, remove cancelled editions → optionally run earlier-years discovery → rebuild →
   `pnpm data:validate` → **one PR**.

## 7. Tests and risks

### Tests

- **A**: schema refinements (virtual with city, curated without sources, pwc without `pwc`, id
  suffix); the union rejects a virtual location with lat, a pinned one without lat, a virtual
  satellite; pipeline: defaults + source kept, a virtual location triggers no geocoder call (spy),
  HF collision → HF wins + warning, past entry overrides its archive copy, freeze into `2018.json`,
  `start > today` error, override on a past `@main`, override of city on a virtual location → error;
  consistency: tampered past fields, orphan `source: pwc`; validate: duplicate ids/`series|year`;
  sanity: NIPS vs NeurIPS duplicates; `files.ts` missing file = `[]`; `build-data` end to end with a
  fixture `past_conferences.yml` (offline geocache), snapshotting `data.json` + archive files; the
  `# review:` gate.
- **B**: golden place-string table (all 233), date forms, `sub` → tags, id vectors (shared with D),
  history union (rename `icra2020`→`icra20`, the `icra21` year-typo error, chunk-parse recovery of
  `3dv19` (synthetic), HF collision skip), determinism (two runs → identical bytes), refusal to
  overwrite curated entries, output validates against the schema; a manual network run against the
  pinned HEAD asserting ≈345 entries.
- **C**: radius/CO₂ — virtual passes with a tiny limit, `estimateTrip` spy not called, hybrid uses
  the city; `nearestOption` → online; `historyStops` skips virtual; `onlineYears`; `mapLocations`
  excludes virtual while list items include it; `placeLabel` → "Online"; `groupTracks` ignores
  virtual; the histogram counts virtual; axis domain + "All years" preset. E2E: `?h=neurips` shows a
  NIPS 2017 stop and "Online: 2020 · 2021"; `?from=2020-01&to=2020-12` with a home set shows the
  Virtual badge and "Online · ~0 kg"; `radius=50` keeps virtual rows; axe check on the badge.
- **D**: the prompt contains known editions; format rules; pre-2020 derivation; year+1 flag; virtual
  drops the city; dedupe vs `data.json` and the file; id vectors; ruamel round trip keeps comments;
  `--recheck` applies only to pwc entries; `cancelled` never applied; `--from-results` replay;
  `proposed_files` includes the past file; argparse rules.

### Risks

- **PwC errors** (§0) — especially stale COVID-era locations and cancelled editions. Mitigated by
  importer flags, the `# review:` merge gate, and the recheck pass; everything must be fixed before
  merge (the archive never shrinks).
- **Huge diff**: ≈345 YAML entries (~6k lines), 9 new archive year files + `data.json` growth (~30k
  derived lines), ≈110 geocache keys. Reviewers read the YAML, the geocache keys and the importer
  report; archive/`data.json` are derived and covered by the consistency check.
- **Nominatim**: ≈100–130 sequential lookups — within policy; expect "non-settlement"/"divergent"
  warnings for islands/campuses; fix with overrides.
- **Bundle**: `data.json` minified grows ~139 KB → ~380 KB (~22 KB → ~55 KB gzip). Acceptable, noted.
- **Timeline axis stretching**: see §4 item 9.
- **Existing behaviour**: the daily sync is unaffected (only `hf` is counted); the discovery
  `backfill` cost changes as noted in §5.1.
- **Licensing**: PwC is MIT — attribution needed in the footer, `THIRD_PARTY_NOTICES.md`, `README.md`.
