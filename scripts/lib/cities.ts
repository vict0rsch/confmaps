// GeoNames `cities15000` -> compact `public/cities.json` (DESIGN §5.5). Pure functions; the
// download and file writing live in scripts/build-cities.ts. The input is untrusted data: it is
// only ever parsed as text.
import { inflateRawSync } from 'node:zlib';
import type { CitiesFile, CityRow } from '../../src/lib/home/types';

/** Contents of the first entry of a ZIP archive (deflate or stored), without any external tool. */
export function unzipFirstEntry(zip: Buffer): Buffer {
  // End of central directory record: signature 0x06054b50, searched from the end.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const cd = zip.readUInt32LE(eocd + 16);
  if (zip.readUInt32LE(cd) !== 0x02014b50) throw new Error('bad zip central directory');
  const method = zip.readUInt16LE(cd + 10);
  const compSize = zip.readUInt32LE(cd + 20);
  const size = zip.readUInt32LE(cd + 24);
  const local = zip.readUInt32LE(cd + 42);
  if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('bad zip local header');
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const data = zip.subarray(start, start + compSize);
  const out = method === 0 ? data : method === 8 ? inflateRawSync(data) : undefined;
  if (!out || out.length !== size) throw new Error('unsupported or corrupt zip entry');
  return Buffer.from(out);
}

/** `admin1CodesASCII.txt` (`CC.code<TAB>name<TAB>asciiname<TAB>geonameid`) -> "CC.code" -> name. */
export function parseAdmin1(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split('\n')) {
    const f = line.split('\t');
    if (f.length >= 3 && f[0]) m.set(f[0], f[2] || f[1]);
  }
  return m;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export type BuildOptions = {
  minPopulation: number;
  admin1: Map<string, string>;
  source: string;
};

/**
 * Columns used (GeoNames dump format): 0 geonameid, 1 name, 2 asciiname, 4 lat, 5 lng,
 * 6 feature class, 7 feature code, 8 country code, 10 admin1 code, 14 population.
 */
export function buildCities(text: string, opts: BuildOptions): CitiesFile {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const regions = [''];
  const regionIndex = new Map<string, number>([['', 0]]);
  const countries: Record<string, string> = {};
  const cities: CityRow[] = [];

  for (const line of text.split('\n')) {
    const f = line.split('\t');
    if (f.length < 15) continue;
    const id = Number(f[0]);
    const lat = Number(f[4]);
    const lng = Number(f[5]);
    const pop = Number(f[14]);
    const cc = f[8];
    if (![id, lat, lng, pop].every(Number.isFinite) || f[6] !== 'P' || !/^[A-Z]{2}$/.test(cc)) {
      continue;
    }
    // PPLX = a section of a populated place (Berlin's "Mitte", a Paris arrondissement): skip, the
    // city itself is in the list.
    if (f[7] === 'PPLX') continue;
    if (pop < opts.minPopulation) continue;
    if (!(cc in countries)) {
      let n: string | undefined;
      try {
        n = names.of(cc);
      } catch {
        // Unknown code: fall back to the code itself below.
      }
      countries[cc] = n && n !== cc ? n : cc;
    }
    const region = opts.admin1.get(`${cc}.${f[10]}`) ?? '';
    let ri = regionIndex.get(region);
    if (ri === undefined) {
      ri = regions.push(region) - 1;
      regionIndex.set(region, ri);
    }
    cities.push([
      id,
      f[1],
      f[2] === f[1] ? '' : f[2],
      cc,
      ri,
      round3(lat),
      round3(lng),
      Math.max(1, Math.round(pop / 1000)),
    ]);
  }
  cities.sort((a, b) => b[7] - a[7] || a[0] - b[0]);
  return {
    v: 1,
    source: opts.source,
    minPopulation: opts.minPopulation,
    countries: Object.fromEntries(Object.entries(countries).sort(([a], [b]) => a.localeCompare(b))),
    regions,
    cities,
  };
}
