# confmaps

confmaps.org is a map-first single-page app showing where AI conferences and their regional
satellite events (e.g. NeurIPS Europe in Paris) take place, so researchers can attend the location
closest to them and travel less. It is a static site: data is built in CI, and distance, CO₂ and
filters are computed in the browser. See [DESIGN.md](DESIGN.md) for the full spec.

## Development

Requires Node 24 (`.nvmrc`) and pnpm.

```sh
pnpm install
pnpm dev          # dev server
pnpm build        # production build to dist/
pnpm preview      # serve dist/
pnpm check        # svelte-check
pnpm lint         # eslint
pnpm format       # prettier
pnpm test         # vitest
pnpm test:e2e     # playwright (pnpm exec playwright install chromium first)
pnpm data:build   # sync upstream, geocode, archive, validate → data/build/data.json
pnpm data:validate  # offline checks of the committed data files
```

## Analytics (optional)

Cookieless [GoatCounter](https://www.goatcounter.com) counting, off unless configured (see
[PRIVACY.md](PRIVACY.md)). To enable it, create a GoatCounter site and add its code (the `xxx` in
`xxx.goatcounter.com`) as a repository **variable** named `GOATCOUNTER_CODE` (Settings, Secrets and
variables, Actions, Variables). `deploy.yml` passes it to the build as `VITE_GOATCOUNTER_CODE`.
