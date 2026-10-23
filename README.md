# confmaps

A map of where AI conferences and their regional satellite events (e.g. NeurIPS Europe in Paris)
take place, so researchers can attend the location closest to them and travel less. Live at
**<https://confmaps.org>**.

It is a static site: data is built in GitHub Actions, and distance, CO₂ estimates and filters are
computed in the browser. Your home location never leaves your device.

- [DESIGN.md](DESIGN.md): architecture and as-built decisions
- [METHODOLOGY.md](METHODOLOGY.md): how CO₂ estimates are computed
- [PRIVACY.md](PRIVACY.md): what is (not) collected

## Development

Requires Node 24 (`.nvmrc`) and pnpm.

```sh
pnpm install
pnpm dev            # dev server
pnpm build          # production build to dist/
pnpm preview        # serve dist/
pnpm check          # svelte-check
pnpm lint           # eslint
pnpm test           # vitest
pnpm test:e2e       # playwright (pnpm exec playwright install chromium first)
pnpm data:build     # sync upstream, geocode, archive, validate → data/build/data.json
pnpm data:validate  # offline checks of the committed data files
pnpm cities:build   # regenerate public/cities.json from GeoNames
```

## Discovery agent

`scripts/discover` (Python, [uv](https://docs.astral.sh/uv/)) uses the Claude API to look for
satellite events and proposes changes to `data/satellites.yml` as a PR; it never merges anything.
Needs `ANTHROPIC_API_KEY`. Try it without writing anything:

```sh
uv run --project scripts/discover discover --mode upcoming --dry-run --max-usd 2
```

Past main editions (`data/past_conferences.yml`) have their own mode: it looks for years of a
series with no recorded edition and appends cited `source: curated` entries. `--recheck` also
re-verifies the imported (`source: pwc`) editions in the range. Dry-run one series first to
measure the cost:

```sh
uv run --project scripts/discover discover --mode past --series neurips,icml --since 1987 --dry-run --max-usd 2
uv run --project scripts/discover discover --mode past --series cvpr --since 2016 --until 2024 --recheck --dry-run
```

See DESIGN.md §4 for the evidence checks and the workflow (`discover.yml`, manual dispatch only).

## Analytics (optional)

Cookieless [GoatCounter](https://www.goatcounter.com), off unless configured (see
[PRIVACY.md](PRIVACY.md)). To enable it, create a GoatCounter site and add its code (the `xxx` in
`xxx.goatcounter.com`) as a repository **variable** named `GOATCOUNTER_CODE` (Settings, Secrets and
variables, Actions, Variables). `deploy.yml` passes it to the build as `VITE_GOATCOUNTER_CODE`.
Do Not Track and Global Privacy Control are respected.

## Data sources and licences

- Conferences: [huggingface/ai-deadlines](https://github.com/huggingface/ai-deadlines) (MIT),
  synced daily; satellites are curated in `data/satellites.yml`.
- Past editions (2016–2025): [paperswithcode/ai-deadlines](https://github.com/paperswithcode/ai-deadlines)
  (MIT), imported once from its git history into `data/past_conferences.yml`, deduplicated and
  corrected using cited sources (`pnpm data:import-pwc`, a one-time writer).
- Geocoding: [Nominatim](https://nominatim.org) / OpenStreetMap contributors (ODbL), cached in
  `data/geocache.json`.
- Map: [OpenFreeMap](https://openfreemap.org) tiles, rendered with MapLibre GL JS.
- Home-city search: [GeoNames](https://www.geonames.org) (CC BY 4.0).
- CO₂ factors: UK DESNZ greenhouse gas conversion factors (Open Government Licence v3.0).
- Font: Inter Variable via Fontsource (SIL OFL).

Full licence texts, attributions and the modification notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), also shown in the app under "Data & credits".

## License

Code: [Apache License 2.0](LICENSE). Third-party data, fonts and tiles keep their own licences; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
