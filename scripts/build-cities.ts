// Builds `public/cities.json` from GeoNames `cities15000.zip` (CC BY 4.0, https://www.geonames.org)
// for the home-location search (DESIGN §5.5): `pnpm cities:build`.
//
//   --min-population N   default 50000: keeps gzip size small yet covers university towns
//   --out <file>         default public/cities.json
//
// The download is untrusted data: it is read into memory, unzipped by a small in-process reader
// and parsed as text. Nothing from it is executed, and the only file written is the output.
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildCities, parseAdmin1, unzipFirstEntry } from './lib/cities';

const BASE = 'https://download.geonames.org/export/dump';
export const DEFAULT_MIN_POPULATION = 50000;

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'min-population': { type: 'string', default: String(DEFAULT_MIN_POPULATION) },
      out: { type: 'string', default: 'public/cities.json' },
    },
  });
  const minPopulation = Number(values['min-population']);
  if (!Number.isInteger(minPopulation) || minPopulation < 0) {
    throw new Error('bad --min-population');
  }

  const zip = await download(`${BASE}/cities15000.zip`);
  const cities = unzipFirstEntry(zip).toString('utf8');
  const admin1 = parseAdmin1((await download(`${BASE}/admin1CodesASCII.txt`)).toString('utf8'));
  const date = new Date().toISOString().slice(0, 10);
  const file = buildCities(cities, {
    minPopulation,
    admin1,
    source: `GeoNames cities15000 (CC BY 4.0, https://www.geonames.org), downloaded ${date}`,
  });
  if (file.cities.length < 500) throw new Error(`only ${file.cities.length} cities: bad download?`);
  await writeFile(values.out, JSON.stringify(file) + '\n');
  console.log(`${file.cities.length} cities (population >= ${minPopulation}) -> ${values.out}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
