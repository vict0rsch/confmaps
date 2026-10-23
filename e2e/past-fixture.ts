// A build of the app over the real dataset plus fixture past editions (virtual, hybrid, an old
// "NIPS" title), for tests of the historical backfill before its data lands. The data module
// (`data/build/data.json`) is swapped at build time; the repo's data files are never touched.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, preview, type Plugin } from 'vite';
import {
  DataFileSchema,
  type Conference,
  type DataFile,
  type EventLocation,
} from '../scripts/schema';

const ROOT = resolve(import.meta.dirname, '..');

type Edition = {
  id: string;
  series: string;
  title: string;
  year: number;
  start: string;
  end: string;
  link: string;
  /** Omitted for a virtual edition. */
  place?: { city: string; country: string; lat: number; lng: number; venue?: string };
  hybrid?: boolean;
};

const nips = (e: Omit<Edition, 'series' | 'link' | 'title'> & { title?: string }): Edition => ({
  series: 'neurips',
  title: 'NeurIPS',
  link: `https://neurips.cc/Conferences/${e.year}`,
  ...e,
});

const LONG_BEACH = { city: 'Long Beach', country: 'United States', lat: 33.7701, lng: -118.1937 };
const VANCOUVER = { city: 'Vancouver', country: 'Canada', lat: 49.2827, lng: -123.1207 };
const NEW_ORLEANS = { city: 'New Orleans', country: 'United States', lat: 29.9511, lng: -90.0715 };

/** Past editions: NeurIPS 2017–2024 (as "NIPS" in 2017, online in 2020–2021), ICLR/ICML 2020, ACL 2022. */
export const PAST_EDITIONS: readonly Edition[] = [
  nips({
    id: 'neurips17',
    title: 'NIPS',
    year: 2017,
    start: '2017-12-04',
    end: '2017-12-09',
    place: { ...LONG_BEACH, venue: 'Long Beach Convention Center' },
  }),
  nips({
    id: 'neurips18',
    year: 2018,
    start: '2018-12-02',
    end: '2018-12-08',
    place: { city: 'Montréal', country: 'Canada', lat: 45.5019, lng: -73.5674 },
  }),
  nips({ id: 'neurips19', year: 2019, start: '2019-12-08', end: '2019-12-14', place: VANCOUVER }),
  nips({ id: 'neurips20', year: 2020, start: '2020-12-06', end: '2020-12-12' }),
  nips({ id: 'neurips21', year: 2021, start: '2021-12-06', end: '2021-12-14' }),
  nips({
    id: 'neurips22',
    year: 2022,
    start: '2022-11-28',
    end: '2022-12-09',
    place: NEW_ORLEANS,
    hybrid: true,
  }),
  nips({ id: 'neurips23', year: 2023, start: '2023-12-10', end: '2023-12-16', place: NEW_ORLEANS }),
  nips({ id: 'neurips24', year: 2024, start: '2024-12-10', end: '2024-12-15', place: VANCOUVER }),
  {
    id: 'iclr20',
    series: 'iclr',
    title: 'ICLR',
    year: 2020,
    start: '2020-04-26',
    end: '2020-04-30',
    link: 'https://iclr.cc/Conferences/2020',
  },
  {
    id: 'icml20',
    series: 'icml',
    title: 'ICML',
    year: 2020,
    start: '2020-07-12',
    end: '2020-07-18',
    link: 'https://icml.cc/Conferences/2020',
  },
  {
    id: 'acl22',
    series: 'acl',
    title: 'ACL',
    year: 2022,
    start: '2022-05-22',
    end: '2022-05-27',
    link: 'https://www.2022.aclweb.org/',
    place: { city: 'Dublin', country: 'Ireland', lat: 53.3498, lng: -6.2603 },
    hybrid: true,
  },
];

/**
 * The real dataset without its imported past editions, plus `PAST_EDITIONS` (tags copied from
 * each series' latest edition).
 */
export function fixtureData(): DataFile {
  const all = DataFileSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'data/build/data.json'), 'utf8')),
  );
  // Imported past editions (if the real data has them yet) are replaced by the fixture ones, so
  // the tests see the same history whatever the dataset holds.
  const past = new Set(
    all.conferences.filter((c) => c.source === 'pwc' || c.source === 'curated').map((c) => c.id),
  );
  const real = {
    ...all,
    conferences: all.conferences.filter((c) => !past.has(c.id)),
    locations: all.locations.filter((l) => !past.has(l.conferenceId)),
  };
  const tagsOf = (series: string) =>
    real.conferences.filter((c) => c.series === series).sort((a, b) => b.year - a.year)[0]?.tags ??
    [];
  const conferences: Conference[] = PAST_EDITIONS.map((e) => ({
    id: e.id,
    series: e.series,
    title: e.title,
    year: e.year,
    link: e.link,
    tags: tagsOf(e.series),
    deadlines: [],
    start: e.start,
    end: e.end,
    source: 'curated',
  }));
  const locations: EventLocation[] = PAST_EDITIONS.map((e) => {
    const base = {
      id: `${e.id}@main`,
      conferenceId: e.id,
      role: 'main' as const,
      name: `${e.title} ${e.year}`,
      start: e.start,
      end: e.end,
      official: true,
      presentsPapers: true,
      access: 'registration' as const,
      link: e.link,
    };
    if (!e.place) return { ...base, format: 'virtual' };
    return { ...base, ...e.place, ...(e.hybrid ? { format: 'hybrid' as const } : {}) };
  });
  const taken = new Set(real.conferences.flatMap((c) => [c.id, `${c.series}|${c.year}`]));
  for (const c of conferences) {
    if (taken.has(c.id) || taken.has(`${c.series}|${c.year}`)) {
      throw new Error(`fixture edition ${c.id} is also in the real data`);
    }
  }
  return DataFileSchema.parse({
    ...real,
    conferences: [...real.conferences, ...conferences],
    locations: [...real.locations, ...locations],
  });
}

/**
 * Build the app with `fixtureData()` into a temp dir and serve it (vite preview, a free port).
 * `close()` stops the server and removes the build.
 */
export async function startPastFixture(): Promise<{ url: string; close: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'confmaps-past-'));
  const dataFile = join(dir, 'data.json');
  writeFileSync(dataFile, JSON.stringify(fixtureData()));
  const swapData: Plugin = {
    name: 'past-fixture-data',
    enforce: 'pre',
    resolveId: (source) => (source.endsWith('/data/build/data.json') ? dataFile : undefined),
  };
  const outDir = join(dir, 'dist');
  const common = {
    root: ROOT,
    configFile: join(ROOT, 'vite.config.ts'),
    logLevel: 'warn' as const,
  };
  await build({ ...common, plugins: [swapData], build: { outDir, emptyOutDir: true } });
  const server = await preview({ ...common, build: { outDir }, preview: { port: 0 } });
  const { port } = server.httpServer.address() as AddressInfo;
  return {
    url: `http://localhost:${port}`,
    close: async () => {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
