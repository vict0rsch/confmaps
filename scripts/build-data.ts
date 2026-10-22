// Data pipeline entry point (DESIGN.md §2, §3): `pnpm data:build`.
//
//   --upstream <dir>     use a local ai-deadlines checkout (or a folder of *.yml) instead of cloning
//   --today YYYY-MM-DD   freeze events ending before this date (default: today, UTC)
//   --offline            never call Nominatim; a geocache miss is an error
//   --data-dir <dir>     default: data
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { mergeArchiveFiles, writeArchiveDir } from './lib/archive';
import { dataPaths, loadInputs, writeDataJson, writeIfChanged } from './lib/files';
import { nominatimGeocoder } from './lib/geocode';
import { stableStringify } from './lib/json';
import { buildDataset } from './lib/pipeline';
import { fetchUpstream, readUpstreamDir } from './lib/upstream';
import { validateDataset } from './lib/validate';

export async function main(argv: string[], now = new Date()): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      upstream: { type: 'string' },
      today: { type: 'string' },
      offline: { type: 'boolean', default: false },
      'data-dir': { type: 'string', default: 'data' },
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

  const fetched = values.upstream ? undefined : fetchUpstream();
  let upstream;
  try {
    upstream = readUpstreamDir(values.upstream ?? fetched!.dir);
  } finally {
    fetched?.cleanup();
  }
  if (upstream.errors.length) return fail(upstream.errors);
  console.log(`upstream: ${upstream.entries.length} conferences`);

  const result = await buildDataset({
    upstream: upstream.entries,
    satellites: inputs.satellites,
    overrides: inputs.overrides,
    archive: inputs.archive,
    geocache: inputs.geocache,
    today,
    geocoder: values.offline ? undefined : nominatimGeocoder(),
    log: (m) => console.log(m),
  });
  // Keep successful lookups even if the build fails, so a retry does not re-query them.
  if (writeIfChanged(paths.geocache, stableStringify(inputs.geocache))) {
    console.log('wrote geocache.json');
  }
  for (const w of result.warnings) console.warn(`  ⚠ ${w}`);
  if (result.errors.length) return fail(result.errors);

  const archive = mergeArchiveFiles(result.archive);
  const data = {
    generatedAt: now.toISOString(),
    conferences: result.conferences,
    locations: result.locations,
  };
  const errors = validateDataset({
    data,
    satellites: inputs.satellites,
    overrides: inputs.overrides,
    geocache: inputs.geocache,
    archive,
    previousArchive: { ids: result.previousArchive, label: 'the archive before this build' },
  });
  if (errors.length) return fail(errors);

  const written = writeArchiveDir(paths.archive, result.archive);
  if (written.length) console.log(`wrote archive/${written.join(', archive/')}`);
  const wrote = writeDataJson(paths.output, result.conferences, result.locations, now);
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
