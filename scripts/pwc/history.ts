// Every version of paperswithcode/ai-deadlines `_data/conferences.yml` (docs/backfill-spec.md §3.1).
// The clone is untrusted data: it is only read through `git log` / `git show` and parsed as YAML,
// never checked out or executed.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

export const PWC_REPO = 'https://github.com/paperswithcode/ai-deadlines.git';
export const PWC_BRANCH = 'gh-pages';
export const PWC_PATH = '_data/conferences.yml';
/** Branch tip the import was reviewed against (the repo is stale since 2024-09). */
export const PWC_HEAD = 'b230d24719088a769e6938704a826e5084b4cb34';

/** One entry of one version, keys normalized (the fields the importer reads). */
export interface PwcEntry {
  id?: string;
  title?: string;
  year?: number;
  link?: string;
  start?: string;
  end?: string;
  date?: string;
  place?: string;
  sub?: string[];
  full_name?: string;
}

/** A PwC id across history: its latest version plus where it first and last appeared. */
export interface PwcRecord {
  /** PwC id, or `title+year` for an entry without one. */
  key: string;
  entry: PwcEntry;
  /** Position of the first version it appears in (orders records that share a date). */
  first_index: number;
  first_sha: string;
  first_date: string;
  last_sha: string;
  last_date: string;
}

export interface Version {
  sha: string;
  /** Commit date, YYYY-MM-DD (as committed). */
  date: string;
  text: string;
}

const git = (gitDir: string, ...args: string[]) =>
  execFileSync('git', ['--git-dir', gitDir, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });

/** Bare clone of the `gh-pages` branch into a temp dir (nothing is checked out). */
export function clonePwc(warn: (m: string) => void = console.warn): {
  gitDir: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), 'pwc-ai-deadlines-'));
  const gitDir = join(root, 'repo.git');
  execFileSync(
    'git',
    ['clone', '--quiet', '--bare', '--single-branch', `--branch=${PWC_BRANCH}`, PWC_REPO, gitDir],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  checkHead(gitDir, warn);
  return { gitDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** The `gh-pages` tip; warns if it is not PWC_HEAD. */
export function checkHead(gitDir: string, warn: (m: string) => void = console.warn): string {
  const tip = git(gitDir, 'rev-parse', PWC_BRANCH).trim();
  if (tip !== PWC_HEAD)
    warn(`PwC ${PWC_BRANCH} is at ${tip}, not the reviewed ${PWC_HEAD}: review the new versions`);
  return tip;
}

/** Every version of `_data/conferences.yml` on `gh-pages`, oldest first. */
export function readVersions(gitDir: string): Version[] {
  const log = git(gitDir, 'log', '--reverse', '--format=%H %cI', PWC_BRANCH, '--', PWC_PATH);
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, iso] = line.split(' ');
      return { sha, date: iso.slice(0, 10), text: git(gitDir, 'show', `${sha}:${PWC_PATH}`) };
    });
}

const parseList = (text: string): unknown[] | undefined => {
  const doc: unknown = parse(text, { uniqueKeys: false });
  return Array.isArray(doc) ? doc : undefined;
};

/**
 * The raw entries of one version: the whole file if it parses, else each `- ` chunk on its own,
 * skipping chunks that still fail (`chunked` tells which path was taken).
 */
export function parseVersion(text: string): { entries: unknown[]; chunked: boolean } {
  try {
    const whole = parseList(text);
    if (whole) return { entries: whole, chunked: false };
  } catch {
    // fall through to the per-chunk parse
  }
  const entries: unknown[] = [];
  for (const chunk of text.split(/^- /m).slice(1)) {
    try {
      entries.push(...(parseList(`- ${chunk}`) ?? []));
    } catch {
      // a broken entry: skip it
    }
  }
  return { entries, chunked: true };
}

const str = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
};

/** Key-normalize one raw entry (`name`, `Id`, `data`, `long` variants). */
export function normalizeEntry(raw: unknown): PwcEntry | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const year = Number(r.year);
  const sub = r.sub;
  const e: PwcEntry = {
    id: str(r.id ?? r.Id),
    title: str(r.title ?? r.name),
    year: Number.isInteger(year) ? year : undefined,
    link: str(r.link),
    start: str(r.start),
    end: str(r.end),
    date: str(r.date ?? r.data),
    place: str(r.place),
    sub:
      sub === undefined || sub === null
        ? undefined
        : (Array.isArray(sub) ? sub : [sub]).map((s) => String(s).trim()),
    full_name: str(r.full_name ?? r.long),
  };
  for (const k of Object.keys(e) as (keyof PwcEntry)[]) if (e[k] === undefined) delete e[k];
  return e;
}

/** The key an entry is unioned under: its id, else `title+year`. */
export const entryKey = (e: PwcEntry): string | undefined =>
  e.id ?? (e.title && e.year !== undefined ? `${e.title}+${e.year}` : undefined);

/** Union of every version per key; the latest version of each wins. */
export function unionHistory(versions: readonly Version[]): {
  records: Map<string, PwcRecord>;
  chunked: string[];
} {
  const records = new Map<string, PwcRecord>();
  const chunked: string[] = [];
  versions.forEach((v, index) => {
    const parsed = parseVersion(v.text);
    if (parsed.chunked) chunked.push(v.sha);
    for (const raw of parsed.entries) {
      const entry = normalizeEntry(raw);
      const key = entry && entryKey(entry);
      if (!entry || !key) continue;
      const prev = records.get(key);
      records.set(key, {
        key,
        entry,
        first_index: prev?.first_index ?? index,
        first_sha: prev?.first_sha ?? v.sha,
        first_date: prev?.first_date ?? v.date,
        last_sha: v.sha,
        last_date: v.date,
      });
    }
  });
  return { records, chunked };
}
