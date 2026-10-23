import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import {
  convert,
  formatReport,
  main,
  refusal,
  type Fixes,
  type KnownConference,
} from './import-pwc';
import { emitPastFile } from './pwc/emit';
import {
  clonePwc,
  PWC_HEAD,
  readVersions,
  unionHistory,
  type PwcEntry,
  type PwcRecord,
} from './pwc/history';
import { makePwcRepo } from './pwc/__fixtures__/repo';
import { PastConferencesFileSchema } from './schema';

const sha = (n: number) => n.toString(16).padStart(40, '0');
let index = 0;
/** A record first seen at `first`, last at `last` (dates); SHAs are distinct per record. */
const rec = (entry: PwcEntry & { id: string }, first: string, last: string): PwcRecord => {
  const i = index++;
  return {
    key: entry.id,
    entry,
    first_index: i,
    first_sha: sha(i + 1),
    first_date: first,
    last_sha: sha(i + 1001),
    last_date: last,
  };
};

const base = { sub: ['RO'], link: 'https://icra2020.org/' };
const icra2020 = rec(
  {
    ...base,
    id: 'icra2020',
    title: 'ICRA',
    year: 2020,
    date: 'May 31-June 4, 2020',
    place: 'Paris, France',
  },
  '2019-06-24',
  '2019-10-09',
);
const icra20 = rec(
  {
    ...base,
    id: 'icra20',
    title: 'ICRA',
    year: 2020,
    date: 'May 31-June 4, 2020',
    place: 'Paris, France',
  },
  '2019-10-09',
  '2020-09-16',
);
// Year typo: dates and place of ICRA 2021.
const icra21 = rec(
  {
    ...base,
    id: 'icra21',
    title: 'ICRA',
    year: 2020,
    date: 'May 30-June 5, 2021',
    place: "Xi'an, China",
  },
  '2020-09-18',
  '2021-06-09',
);
const aistats25 = rec(
  {
    id: 'aistats25',
    title: 'AISTATS',
    year: 2025,
    start: '2025-05-03',
    end: '2025-05-05',
    place: 'Phuket, Thailand',
    sub: ['ML', 'Statistic'],
    link: 'https://aistats.org/',
  },
  '2024-09-15',
  '2024-09-15',
);
const www21 = rec(
  {
    id: 'WWW21',
    title: 'WWWW',
    year: 2021,
    date: 'April 19-23, 2021',
    place: 'Ljubljana, Slovenia',
    sub: ['DM'],
    link: 'http://www2021.thewebconf.org/',
  },
  '2020-08-18',
  '2021-05-15',
);
const sem17 = rec(
  {
    id: 'starsem17',
    title: '<span>*</span>SEM',
    year: 2017,
    date: 'August 3-4 2017',
    place: 'Vancouver, Canada',
    sub: ['NLP'],
    link: 'http://x.org/',
  },
  '2017-02-08',
  '2017-08-09',
);
const conferences: KnownConference[] = [
  { id: 'aistats25', series: 'aistats', title: 'AISTATS', year: 2025, source: 'hf' },
  { id: 'icra26', series: 'icra', title: 'ICRA', year: 2026, source: 'hf' },
];
const noFixes: Fixes = {
  TITLE_FIXES: { WWWW: 'WWW' },
  EXCLUDE: {},
  PLACE_FIXES: {},
  FIELD_FIXES: {},
};
const withFixes: Fixes = {
  ...noFixes,
  FIELD_FIXES: { icra21: { year: 2021, reason: 'dates are those of ICRA 2021' } },
};

describe('convert', () => {
  it('rejects a year that differs from the start year (icra21) until fixed', () => {
    const r = convert([icra21], conferences, noFixes);
    expect(r.unresolved).toEqual([
      'icra21: year 2020 but start 2021-05-30 (add a FIELD_FIXES entry)',
    ]);
    expect(r.entries).toEqual([]);
    const fixed = convert([icra21], conferences, withFixes);
    expect(fixed.unresolved).toEqual([]);
    expect(fixed.entries[0]).toMatchObject({ id: 'icra21', year: 2021, start: '2021-05-30' });
    expect(fixed.entries[0].pwc?.fixes).toEqual([
      'year: 2020 → 2021 (dates are those of ICRA 2021)',
    ]);
    expect(fixed.review.get('icra21')).toEqual(['covid', 'fixes-applied']);
  });

  it('merges a renamed id (icra2020 → icra20) into one edition', () => {
    const r = convert([icra2020, icra20], conferences, noFixes);
    expect(r.unresolved).toEqual([]);
    expect(r.entries).toEqual([
      {
        id: 'icra20',
        title: 'ICRA',
        year: 2020,
        link: 'https://icra2020.org/',
        start: '2020-05-31',
        end: '2020-06-04',
        format: 'in_person',
        city: 'Paris',
        country: 'France',
        tags: ['robotics'],
        source: 'pwc',
        pwc: {
          ids: ['icra20', 'icra2020'],
          first_sha: icra2020.first_sha,
          first_date: '2019-06-24',
          last_sha: icra20.last_sha,
          last_date: '2020-09-16',
        },
      },
    ]);
    expect(r.review.get('icra20')).toEqual(['covid', 'multi-id']);
  });

  it('drops editions already in data.json (by series|year) before checking sub codes', () => {
    const r = convert([aistats25], conferences, noFixes);
    expect(r.entries).toEqual([]);
    expect(r.unresolved).toEqual([]);
    expect(r.collisions).toEqual([{ id: 'aistats25', ids: ['aistats25'], existing: 'aistats25' }]);
  });

  it('refuses an id that data.json uses for another edition', () => {
    const r = convert(
      [icra20],
      [{ id: 'icra20', series: 'other', title: 'X', year: 2020, source: 'hf' }],
      noFixes,
    );
    expect(r.unresolved).toEqual(["icra20: id icra20 is already data.json's other 2020"]);
  });

  it('applies title cleanups and flags them; stale when never updated after the event', () => {
    const r = convert([www21, sem17], conferences, noFixes);
    expect(r.entries.map((e) => [e.id, e.title, e.pwc?.fixes])).toEqual([
      ['sem17', '*SEM', ['title: <span>*</span>SEM → *SEM']],
      ['www21', 'WWW', ['title: WWWW → WWW']],
    ]);
    expect(r.review.get('www21')).toEqual(['covid', 'fixes-applied']);
    const stale = convert([{ ...sem17, last_date: '2017-05-01' }], conferences, noFixes);
    expect(stale.review.get('sem17')).toEqual(['stale', 'fixes-applied']);
  });

  it('reports unresolved places, unknown sub codes and bad links', () => {
    const bad = rec(
      {
        id: 'x19',
        title: 'X',
        year: 2019,
        date: 'May 1, 2019',
        place: 'TBD',
        sub: ['ZZ'],
        link: 'x.org',
      },
      '2018-01-01',
      '2019-06-01',
    );
    expect(convert([bad], conferences, noFixes).unresolved).toEqual([
      'x19: link "x.org" is not an http(s) URL',
      'x19: place "TBD": no place ("TBD") (add PLACE_FIXES or EXCLUDE)',
      'x19: unknown sub code "ZZ"',
    ]);
  });

  it('applies PLACE_FIXES (canonical country) and EXCLUDE; flags unknown fix keys', () => {
    const fixes: Fixes = {
      ...noFixes,
      EXCLUDE: { icra2020: 'test', nope20: 'stale entry' },
      PLACE_FIXES: {
        icra20: {
          format: 'in_person',
          city: 'Paris',
          country: 'FRANCE',
          venue: 'Palais',
          reason: 'r',
        },
      },
    };
    const r = convert([icra2020, icra20], conferences, fixes);
    expect(r.excluded).toEqual([{ id: 'icra2020', reason: 'test' }]);
    expect(r.unresolved).toEqual(['nope20: EXCLUDE entry for an unknown PwC id']);
    expect(r.entries[0]).toMatchObject({
      country: 'France',
      venue: 'Palais',
      pwc: { ids: ['icra20'] },
    });
    expect(r.entries[0].pwc?.fixes).toEqual(['place: Paris, France → Palais, Paris, France (r)']);
  });

  it('is deterministic: input order does not matter, bytes are stable', () => {
    const records = [icra21, www21, sem17, icra20, icra2020, aistats25];
    const emit = (rs: PwcRecord[]) => {
      const r = convert(rs, conferences, withFixes);
      return emitPastFile(r.entries, r.review);
    };
    const a = emit(records);
    expect(emit([...records].reverse())).toBe(a);
    expect(emit(records)).toBe(a);
    const doc = parse(a);
    expect(PastConferencesFileSchema.safeParse(doc).success).toBe(true);
    expect(doc.map((e: { id: string }) => e.id)).toEqual(['sem17', 'icra20', 'icra21', 'www21']);
  });

  it('reports counts, flags and new geocache keys', () => {
    const r = convert([icra20, www21], conferences, noFixes);
    const report = formatReport(r, {
      head: PWC_HEAD,
      versions: 2,
      chunked: 0,
      records: 2,
      geocache: { 'paris|france': {} },
    });
    expect(report).toContain('**2 editions** (2 in person, 0 virtual, 0 hybrid)');
    expect(report).toContain('- **covid** (2): icra20, www21');
    expect(report).toContain('### New geocache keys (1)\n- `ljubljana|slovenia`');
  });
});

describe('refusal', () => {
  it('allows a missing, empty or comment-only file', () => {
    expect(refusal(undefined, false)).toBeUndefined();
    expect(refusal('', false)).toBeUndefined();
    expect(refusal('# header\n[]\n', false)).toBeUndefined();
  });
  it('needs --force to overwrite entries', () => {
    expect(refusal('- id: a20\n  source: pwc\n', false)).toMatch(/--force/);
    expect(refusal('- id: a20\n  source: pwc\n', true)).toBeUndefined();
  });
  it('never overwrites curated entries', () => {
    expect(refusal('- id: a20\n  source: curated\n', true)).toMatch(/curated/);
  });
});

describe('main (local PwC repo)', () => {
  const version = `- title: ICRA
  year: 2020
  id: icra20
  link: https://icra2020.org/
  date: May 31-June 4, 2020
  place: Paris, France
  sub: RO
`;
  const repo = makePwcRepo([version]);
  const broken = makePwcRepo([version.replace('Paris, France', 'TBD')]);
  const dataDir = mkdtempSync(join(tmpdir(), 'pwc-main-test-'));
  const out = join(dataDir, 'past_conferences.yml');
  mkdirSync(join(dataDir, 'build'));
  writeFileSync(join(dataDir, 'build', 'data.json'), JSON.stringify({ conferences }));
  writeFileSync(join(dataDir, 'geocache.json'), '{}');
  afterAll(() => {
    repo.cleanup();
    broken.cleanup();
    rmSync(dataDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    for (const m of ['log', 'warn', 'error'] as const)
      vi.spyOn(console, m).mockImplementation(() => {});
  });
  const run = (gitDir: string, ...flags: string[]) =>
    main(['--pwc-dir', gitDir, '--data-dir', dataDir, ...flags], noFixes);

  it('writes nothing while an entry is unresolved', async () => {
    expect(await run(broken.gitDir)).toBe(1);
    expect(existsSync(out)).toBe(false);
  });

  it('writes nothing on a dry run', async () => {
    expect(await run(repo.gitDir, '--dry-run')).toBe(0);
    expect(existsSync(out)).toBe(false);
  });

  it('writes, refuses to overwrite without --force, rewrites identical bytes with it', async () => {
    expect(await run(repo.gitDir)).toBe(0);
    const first = readFileSync(out, 'utf8');
    expect(PastConferencesFileSchema.parse(parse(first))).toHaveLength(1);
    expect(await run(repo.gitDir)).toBe(1);
    expect(await run(repo.gitDir, '--force')).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe(first);
  });

  it('never overwrites curated entries', async () => {
    const curated = readFileSync(out, 'utf8').replace('source: pwc', 'source: curated');
    writeFileSync(out, curated);
    expect(await run(repo.gitDir, '--force')).toBe(1);
    expect(readFileSync(out, 'utf8')).toBe(curated);
  });
});

describe('data/past_conferences.yml', () => {
  const path = join(import.meta.dirname, '..', 'data', 'past_conferences.yml');
  it.runIf(existsSync(path))('validates, is sorted by (year, id) and has unique ids', () => {
    const entries = PastConferencesFileSchema.parse(parse(readFileSync(path, 'utf8')));
    const keys = entries.map((e) => [e.year, e.id] as const);
    const sorted = [...keys].sort(([ya, a], [yb, b]) => ya - yb || (a < b ? -1 : a > b ? 1 : 0));
    expect(keys).toEqual(sorted);
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });
});

// Manual: PWC_NETWORK=1 pnpm vitest run scripts/import-pwc.test.ts
describe.runIf(process.env.PWC_NETWORK)('network run against the pinned PwC HEAD', () => {
  it('imports ≈345 editions with nothing unresolved', { timeout: 300_000 }, () => {
    const data = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'data', 'build', 'data.json'), 'utf8'),
    );
    const clone = clonePwc();
    try {
      const { records } = unionHistory(readVersions(clone.gitDir));
      const r = convert(records.values(), data.conferences);
      expect(r.unresolved).toEqual([]);
      expect(r.entries.length).toBeGreaterThan(330);
      expect(r.entries.length).toBeLessThan(360);
    } finally {
      clone.cleanup();
    }
  });
});
