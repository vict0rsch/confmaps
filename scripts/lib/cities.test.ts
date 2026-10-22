import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildCities, parseAdmin1, unzipFirstEntry } from './cities';

/** A GeoNames dump line: id, name, ascii, alt, lat, lng, class, code, cc, cc2, admin1, ..., pop. */
const line = (
  id: number,
  name: string,
  ascii: string,
  lat: number,
  lng: number,
  code: string,
  cc: string,
  admin1: string,
  pop: number,
) =>
  [id, name, ascii, '', lat, lng, 'P', code, cc, '', admin1, '', '', '', pop, 0, 0, 'tz', 'd'].join(
    '\t',
  );

const dump = [
  line(2950159, 'Berlin', 'Berlin', 52.52437, 13.41053, 'PPLC', 'DE', '16', 3426354),
  line(2886242, 'Köln', 'Koln', 50.93333, 6.95, 'PPLA2', 'DE', '07', 1073096),
  line(2873779, 'Mitte', 'Mitte', 52.51667, 13.4, 'PPLX', 'DE', '16', 80000),
  line(2820000, 'Smalltown', 'Smalltown', 50.0, 8.0, 'PPL', 'DE', '07', 20000),
  'garbage line',
].join('\n');

const admin1 = parseAdmin1(
  'DE.16\tBerlin\tBerlin\t2950157\nDE.07\tNorth Rhine-Westphalia\tNorth Rhine-Westphalia\t2861876\n',
);

describe('buildCities', () => {
  const file = buildCities(dump, { minPopulation: 50000, admin1, source: 'test' });

  it('keeps cities above the cut, skipping city sections and bad lines', () => {
    expect(file.cities.map((c) => c[1])).toEqual(['Berlin', 'Köln']);
  });

  it('writes compact rows: ascii only when different, rounded coords, population in thousands', () => {
    const [berlin, koeln] = file.cities;
    expect(berlin).toEqual([2950159, 'Berlin', '', 'DE', 1, 52.524, 13.411, 3426]);
    expect(koeln.slice(0, 5)).toEqual([2886242, 'Köln', 'Koln', 'DE', 2]);
    expect(file.regions).toEqual(['', 'Berlin', 'North Rhine-Westphalia']);
  });

  it('adds English country names', () => {
    expect(file.countries).toEqual({ DE: 'Germany' });
  });

  it('sorts by population, descending', () => {
    const pops = file.cities.map((c) => c[7]);
    expect(pops).toEqual([...pops].sort((a, b) => b - a));
  });
});

describe('unzipFirstEntry', () => {
  /** Minimal one-entry ZIP (deflate), as GeoNames serves. */
  function zip(name: string, content: Buffer): Buffer {
    const data = deflateRawSync(content);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(content.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt32LE(0, 42);
    const cdOffset = local.length + n.length + data.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cd.length + n.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    return Buffer.concat([local, n, data, cd, n, eocd]);
  }

  it('extracts the entry', () => {
    const text = 'a\tb\nc\td\n'.repeat(100);
    expect(unzipFirstEntry(zip('cities15000.txt', Buffer.from(text))).toString()).toBe(text);
  });

  it('rejects non-zip data', () => {
    expect(() => unzipFirstEntry(Buffer.from('<html>not found</html>'.repeat(5)))).toThrow();
  });
});
