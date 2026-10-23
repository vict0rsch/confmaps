// Data pipeline entry point (DESIGN.md §2, §3): `pnpm data:build`.
//
//   --upstream <dir>     use a local ai-deadlines checkout (or a folder of *.yml) instead of cloning
//   --today YYYY-MM-DD   freeze events ending before this date (default: today, UTC)
//   --offline            never call Nominatim; a geocache miss is an error
//   --data-dir <dir>     default: data
//   --allow-mass-drop    accept losing > 20% of the upstream conferences (after reviewing why)
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { mergeArchiveFiles, writeArchiveDir } from './lib/archive';
import { checkConsistency } from './lib/consistency';
import {
  dataPaths,
  loadInputs,
  readPreviousData,
  writeDataJson,
  writeIfChanged,
} from './lib/files';
import { nominatimGeocoder } from './lib/geocode';
import { stableStringify } from './lib/json';
import { buildDataset, type BuildResult } from './lib/pipeline';
import { fetchUpstream, readUpstreamDir, UPSTREAM_NAME } from './lib/upstream';
import { sanityCheck, validateDataset } from './lib/validate';
import type { UpstreamRef } from './schema';

/** Largest tolerated drop in upstream (`source: hf`) conferences vs the previous data.json. */
export const MAX_UPSTREAM_DROP = 0.2;

/** Error if the number of upstream conferences fell by more than MAX_UPSTREAM_DROP. */
export function massDropError(previous: number, current: number): string | undefined {
  if (previous === 0 || current >= previous * (1 - MAX_UPSTREAM_DROP)) return undefined;
  return (
    `upstream conferences dropped from ${previous} to ${current} ` +
    `(> ${MAX_UPSTREAM_DROP * 100}%); check upstream, then rerun with --allow-mass-drop`
  );
}

export async function main(argv: string[], now = new Date()): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      upstream: { type: 'string' },
      today: { type: 'string' },
      offline: { type: 'boolean', default: false },
      'data-dir': { type: 'string', default: 'data' },
      'allow-mass-drop': { type: 'boolean', default: false },
    },
  });
  const today = values.today ?? now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today))
    throw new Error(`--today must be YYYY-MM-DD, got ${today}`);
  const dataDir = values['data-dir'];
  const paths = dataPaths(dataDir);
  const fail = (errors: string[]) => {
    console.error(`data:build failed with ${errors.length} error(s):`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    return 1;
  };

  const inputs = loadInputs(dataDir);
  if (inputs.errors.length) return fail(inputs.errors);

  for (const d of inputs.archiveDuplicates)
    console.warn(`  ⚠ ${d} (this build removes the stale copy)`);

  const fetched = values.upstream ? undefined : fetchUpstream();
  let upstream;
  try {
    upstream = readUpstreamDir(values.upstream ?? fetched!.dir);
  } finally {
    fetched?.cleanup();
  }
  if (upstream.errors.length) return fail(upstream.errors);
  // Provenance is only known for a fresh clone (a local --upstream dir may not be a checkout).
  const ref: UpstreamRef | undefined = fetched && { repo: UPSTREAM_NAME, sha: fetched.sha };
  console.log(`upstream: ${upstream.entries.length} conferences${ref ? ` @ ${ref.sha}` : ''}`);

  let result: BuildResult;
  try {
    result = await buildDataset({
      upstream: upstream.entries,
      satellites: inputs.satellites,
      past: inputs.past,
      overrides: inputs.overrides,
      archive: inputs.archive,
      geocache: inputs.geocache,
      today,
      geocoder: values.offline ? undefined : nominatimGeocoder(),
      log: (m) => console.log(m),
    });
  } finally {
    // Keep successful lookups even if the build fails or throws, so a retry does not re-query them.
    if (writeIfChanged(paths.geocache, stableStringify(inputs.geocache))) {
      console.log('wrote geocache.json');
    }
  }
  const data = {
    generatedAt: now.toISOString(),
    conferences: result.conferences,
    locations: result.locations,
  };
  const sanity = result.errors.length
    ? { errors: [], warnings: [] }
    : sanityCheck(data, inputs.overrides, inputs.geocache);
  for (const w of [...result.warnings, ...sanity.warnings]) console.warn(`  ⚠ ${w}`);
  if (result.errors.length) return fail(result.errors);
  if (sanity.errors.length) return fail(sanity.errors);

  const prev = readPreviousData(paths.output)?.conferences;
  const hfCount = (cs: unknown) =>
    Array.isArray(cs) ? cs.filter((c) => c?.source === 'hf').length : 0;
  const drop = massDropError(hfCount(prev), hfCount(result.conferences));
  if (drop && !values['allow-mass-drop']) return fail([drop]);

  const archive = mergeArchiveFiles(result.archive);
  const errors = validateDataset({
    data,
    satellites: inputs.satellites,
    past: inputs.past,
    overrides: inputs.overrides,
    geocache: inputs.geocache,
    archive,
    previousArchive: { ids: result.previousArchive, label: 'the archive before this build' },
  });
  if (errors.length === 0)
    errors.push(
      ...checkConsistency({
        data,
        satellites: inputs.satellites,
        past: inputs.past,
        overrides: inputs.overrides,
        geocache: inputs.geocache,
        archive,
      }),
    );
  if (errors.length) return fail(errors);

  const written = writeArchiveDir(paths.archive, result.archive);
  if (written.length) console.log(`wrote archive/${written.join(', archive/')}`);
  const wrote = writeDataJson(paths.output, result.conferences, result.locations, now, ref);
  console.log(
    `${wrote ? 'wrote' : 'unchanged'} ${paths.output}: ${result.conferences.length} conferences, ` +
      `${result.locations.length} locations (${archive.conferences.length} conferences archived)`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
