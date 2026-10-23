// One-time import of past editions from paperswithcode/ai-deadlines (docs/backfill-spec.md §3):
// `pnpm data:import-pwc` → data/past_conferences.yml, plus a PR-body report on stdout.
//
//   --pwc-dir <dir>   use an existing bare clone of the PwC repo instead of cloning
//   --data-dir <dir>  default: data
//   --force           overwrite a non-empty past_conferences.yml (never one with curated entries)
//   --dry-run         print the report, write nothing
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { canonicalCountry } from './lib/countries';
import { geocacheKey } from './lib/geocode';
import { seriesOf } from './lib/normalize';
import { padIsoDate, parseDateText, type DateRange } from './pwc/dates';
import { emitPastFile } from './pwc/emit';
import * as defaultFixes from './pwc/fixes';
import type { FieldFix, PlaceFix } from './pwc/fixes';
import { checkHead, clonePwc, readVersions, unionHistory, type PwcRecord } from './pwc/history';
import { editionKey, groupEditions, pastEditionId, type Candidate } from './pwc/ids';
import { parsePlace, type Place } from './pwc/place';
import { subToTags } from './pwc/tags';
import {
  PastConferenceSchema,
  PastConferencesFileSchema,
  type Conference,
  type PastConference,
} from './schema';

export type KnownConference = Pick<Conference, 'id' | 'series' | 'title' | 'year' | 'source'>;

export interface Fixes {
  TITLE_FIXES: Record<string, string>;
  EXCLUDE: Record<string, string>;
  PLACE_FIXES: Record<string, PlaceFix>;
  FIELD_FIXES: Record<string, FieldFix>;
}

export type Flag = 'covid' | 'stale' | 'multi-id' | 'fixes-applied';

export interface ConvertResult {
  /** Sorted by (year, id). */
  entries: PastConference[];
  /** Entry id → review reasons. */
  review: Map<string, Flag[]>;
  /** `<pwc id(s)>: <why>` — the import must not be written while any remain. */
  unresolved: string[];
  excluded: { id: string; reason: string }[];
  /** Editions already in data.json (by series|year). */
  collisions: { id: string; ids: string[]; existing: string }[];
  /** `start`/`end` kept although the free-text `date` says otherwise. */
  dateDisagreements: string[];
}

interface Prepared extends Candidate {
  title: string;
  start: string;
  end: string;
  fixes: string[];
}

/** The pandemic window in which a PwC "in person" place is suspicious. */
const COVID = { from: '2020-03-01', to: '2021-12-31' };

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const isHttpUrl = (s: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(s).protocol);
  } catch {
    return false;
  }
};

const describePlace = (p: Place) =>
  p.format === 'virtual'
    ? 'virtual'
    : [p.venue, p.city, p.country].filter(Boolean).join(', ') +
      (p.format === 'hybrid' ? ' (hybrid)' : '');

/** Title, year and dates of one PwC id (fixes applied), or the reason it cannot be used. */
function prepare(record: PwcRecord, fixes: Fixes): Prepared | { error: string } {
  const e = record.entry;
  const log: string[] = [];
  const fix = fixes.FIELD_FIXES[record.key];

  if (!e.title) return { error: 'no title' };
  let title = stripHtml(e.title);
  if (title !== e.title) log.push(`title: ${e.title} → ${title}`);
  const fixedTitle = fixes.TITLE_FIXES[title];
  if (fixedTitle) {
    log.push(`title: ${title} → ${fixedTitle}`);
    title = fixedTitle;
  }

  let range: DateRange | undefined;
  const fromText = e.date ? parseDateText(e.date) : undefined;
  if (e.start && e.end) {
    const [start, end] = [padIsoDate(e.start), padIsoDate(e.end)];
    if (start && end) range = { start, end };
    else if (!fix?.start || !fix.end) return { error: `invalid start/end ${e.start}/${e.end}` };
  } else range = fromText;

  let year = e.year;
  if (fix) {
    const why = ` (${fix.reason})`;
    if (fix.year !== undefined) log.push(`year: ${year} → ${fix.year}${why}`);
    if (fix.start) log.push(`start: ${range?.start ?? 'none'} → ${fix.start}${why}`);
    if (fix.end) log.push(`end: ${range?.end ?? 'none'} → ${fix.end}${why}`);
    if (fix.keepYear) log.push(`year: ${year} kept although the edition starts later${why}`);
    year = fix.year ?? year;
    if (fix.start || fix.end) {
      const start = fix.start ?? range?.start;
      const end = fix.end ?? range?.end;
      if (!start || !end) return { error: 'a date fix needs both start and end' };
      range = { start, end };
    }
  }
  if (!range) return { error: `no start/end and unparseable date "${e.date ?? ''}"` };
  if (range.start > range.end) return { error: `start ${range.start} is after end ${range.end}` };
  if (year === undefined) return { error: 'no year' };
  if (Number(range.start.slice(0, 4)) !== year && !fix?.keepYear)
    return { error: `year ${year} but start ${range.start} (add a FIELD_FIXES entry)` };

  return { record, series: seriesOf(title), year, title, ...range, fixes: log };
}

/** PwC history records → past_conferences.yml entries (docs/backfill-spec.md §3.2–§3.5). */
export function convert(
  records: Iterable<PwcRecord>,
  conferences: readonly KnownConference[],
  fixes: Fixes = defaultFixes,
): ConvertResult {
  const result: ConvertResult = {
    entries: [],
    review: new Map(),
    unresolved: [],
    excluded: [],
    collisions: [],
    dateDisagreements: [],
  };
  const sorted = [...records].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const keys = new Set(sorted.map((r) => r.key));
  for (const [table, entries] of Object.entries({
    EXCLUDE: fixes.EXCLUDE,
    PLACE_FIXES: fixes.PLACE_FIXES,
    FIELD_FIXES: fixes.FIELD_FIXES,
  }))
    for (const k of Object.keys(entries))
      if (!keys.has(k)) result.unresolved.push(`${k}: ${table} entry for an unknown PwC id`);

  // Per PwC id: exclusions, title/year/date checks (before dedupe, §3.2).
  const prepared: Prepared[] = [];
  for (const record of sorted) {
    const excluded = fixes.EXCLUDE[record.key];
    if (excluded) {
      result.excluded.push({ id: record.key, reason: excluded });
      continue;
    }
    const p = prepare(record, fixes);
    if ('error' in p) result.unresolved.push(`${record.key}: ${p.error}`);
    else prepared.push(p);
  }

  const usedPlaceFixes = new Set<string>();
  for (const group of groupEditions(prepared)) {
    const best = group[0];
    const { entry: e } = best.record;
    const ids = group.map((c) => c.record.key);
    const label = ids.join('/');
    const id = pastEditionId(best.series, best.year, conferences);
    const known = conferences.find(
      (c) => editionKey(c.series, c.year) === editionKey(best.series, best.year),
    );
    if (known) {
      result.collisions.push({ id, ids, existing: known.id });
      continue;
    }
    const sameId = conferences.find((c) => c.id === id);
    if (sameId) {
      result.unresolved.push(
        `${label}: id ${id} is already data.json's ${sameId.series} ${sameId.year}`,
      );
      continue;
    }

    const log = [...best.fixes];
    const errors: string[] = [];
    const fieldFix = fixes.FIELD_FIXES[best.record.key];
    const link = fieldFix?.link ?? e.link;
    if (fieldFix?.link)
      log.push(`link: ${e.link ?? 'none'} → ${fieldFix.link} (${fieldFix.reason})`);
    if (!link || !isHttpUrl(link)) errors.push(`link "${link ?? ''}" is not an http(s) URL`);
    if (fieldFix?.full_name)
      log.push(`full_name: ${e.full_name ?? 'none'} → ${fieldFix.full_name} (${fieldFix.reason})`);
    const fullName = fieldFix?.full_name ?? e.full_name;

    let place: Place | undefined;
    const placeFix = fixes.PLACE_FIXES[best.record.key];
    if (placeFix) {
      usedPlaceFixes.add(best.record.key);
      const { reason, ...fixed } = placeFix;
      place = fixed;
      if (fixed.country) {
        const country = canonicalCountry(fixed.country);
        if (country) place = { ...fixed, country };
        else errors.push(`PLACE_FIXES country "${fixed.country}" is unknown`);
      }
      log.push(`place: ${e.place ?? 'none'} → ${describePlace(place)} (${reason})`);
    } else {
      const parsed = parsePlace(e.place ?? '');
      if ('unresolved' in parsed)
        errors.push(`place "${e.place ?? ''}": ${parsed.unresolved} (add PLACE_FIXES or EXCLUDE)`);
      else place = parsed.place;
    }

    const tags = subToTags(e.sub ?? []);
    errors.push(...tags.errors);
    if (errors.length || !place) {
      for (const err of errors) result.unresolved.push(`${label}: ${err}`);
      continue;
    }

    const first = group.reduce((a, c) => (c.record.first_index < a.record.first_index ? c : a));
    const entry: PastConference = {
      id,
      title: best.title,
      year: best.year,
      ...(fullName && { full_name: fullName }),
      link: link!,
      start: best.start,
      end: best.end,
      format: place.format,
      ...(place.city && { city: place.city }),
      ...(place.country && { country: place.country }),
      ...(place.venue && { venue: place.venue }),
      tags: tags.tags,
      ...(place.notes && { notes: place.notes }),
      source: 'pwc',
      pwc: {
        ids,
        first_sha: first.record.first_sha,
        first_date: first.record.first_date,
        last_sha: best.record.last_sha,
        last_date: best.record.last_date,
        ...(log.length ? { fixes: log } : {}),
      },
    };
    const valid = PastConferenceSchema.safeParse(entry);
    if (!valid.success) {
      for (const issue of valid.error.issues)
        result.unresolved.push(`${label}: ${issue.path.join('.')}: ${issue.message}`);
      continue;
    }

    const fromText = e.date ? parseDateText(e.date) : undefined;
    const datesFixed = fieldFix?.start || fieldFix?.end;
    if (!datesFixed && fromText && (fromText.start !== entry.start || fromText.end !== entry.end))
      result.dateDisagreements.push(
        `${id}: ${entry.start}…${entry.end} kept; PwC date text says "${e.date}"`,
      );

    const flags: Flag[] = [];
    if (entry.format === 'in_person' && entry.start >= COVID.from && entry.start <= COVID.to)
      flags.push('covid');
    if (entry.pwc!.last_date < entry.start) flags.push('stale');
    if (ids.length > 1) flags.push('multi-id');
    if (log.length) flags.push('fixes-applied');
    if (flags.length) result.review.set(id, flags);
    result.entries.push(entry);
  }
  for (const k of Object.keys(fixes.PLACE_FIXES))
    if (keys.has(k) && !usedPlaceFixes.has(k))
      result.unresolved.push(`${k}: PLACE_FIXES entry not used (not the edition's best id)`);

  const seen = new Map<string, string>();
  for (const e of result.entries) {
    const other = seen.get(e.id);
    if (other) result.unresolved.push(`${e.pwc!.ids.join('/')}: id ${e.id} also used by ${other}`);
    seen.set(e.id, e.pwc!.ids.join('/'));
  }
  result.entries.sort((a, b) => a.year - b.year || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}

export interface ReportContext {
  head: string;
  versions: number;
  chunked: number;
  records: number;
  geocache: Record<string, unknown>;
}

/** Markdown for the PR body. */
export function formatReport(r: ConvertResult, ctx: ReportContext): string {
  const out: string[] = [];
  const list = (items: readonly string[]) =>
    items.length ? items.map((i) => `- ${i}`) : ['- none'];
  out.push('## PwC import (paperswithcode/ai-deadlines)', '');
  out.push(
    `Source: \`gh-pages\` @ \`${ctx.head}\`, ${ctx.versions} versions of \`_data/conferences.yml\` ` +
      `(${ctx.chunked} parsed per entry), ${ctx.records} PwC ids.`,
    '',
  );
  const byYear = new Map<number, number>();
  const byFormat = { in_person: 0, virtual: 0, hybrid: 0 };
  for (const e of r.entries) {
    byYear.set(e.year, (byYear.get(e.year) ?? 0) + 1);
    byFormat[e.format]++;
  }
  out.push(
    `**${r.entries.length} editions** (${byFormat.in_person} in person, ${byFormat.virtual} virtual, ` +
      `${byFormat.hybrid} hybrid); ${r.excluded.length} PwC ids excluded; ` +
      `${r.collisions.length} editions already in data.json.`,
    '',
    '| Year | Editions |',
    '| ---- | -------- |',
    ...[...byYear].sort(([a], [b]) => a - b).map(([y, n]) => `| ${y} | ${n} |`),
    '',
  );
  out.push('### Excluded', ...list(r.excluded.map((x) => `\`${x.id}\`: ${x.reason}`)), '');
  out.push(
    '### Already in data.json (dropped)',
    ...list(r.collisions.map((c) => `\`${c.id}\` (PwC ${c.ids.join(', ')}) = \`${c.existing}\``)),
    '',
  );
  const fixed = r.entries.filter((e) => e.pwc?.fixes?.length);
  out.push(`### Fixes applied (${fixed.length} editions)`);
  for (const e of fixed) for (const f of e.pwc!.fixes!) out.push(`- \`${e.id}\`: ${f}`);
  if (!fixed.length) out.push('- none');
  out.push('', '### start/end kept over the PwC date text', ...list(r.dateDisagreements), '');
  const flags: Flag[] = ['covid', 'stale', 'multi-id', 'fixes-applied'];
  out.push('### Review flags');
  for (const f of flags) {
    const ids = [...r.review].filter(([, fs]) => fs.includes(f)).map(([id]) => id);
    out.push(`- **${f}** (${ids.length}): ${ids.join(', ') || '—'}`);
  }
  const keys = [
    ...new Set(
      r.entries
        .filter((e) => e.format !== 'virtual')
        .map((e) => geocacheKey(e.city!, e.country!))
        .filter((k) => !(k in ctx.geocache)),
    ),
  ].sort();
  out.push('', `### New geocache keys (${keys.length})`, ...list(keys.map((k) => `\`${k}\``)), '');
  if (r.unresolved.length)
    out.push(`### Unresolved (${r.unresolved.length})`, ...list(r.unresolved), '');
  return out.join('\n');
}

/** Why the existing past_conferences.yml must not be overwritten, if it must not. */
export function refusal(text: string | undefined, force: boolean): string | undefined {
  if (text === undefined) return;
  if (/^\s*source:\s*['"]?curated\b/m.test(text))
    return 'past_conferences.yml has source: curated entries; the importer never overwrites them';
  const content = text
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .join('\n')
    .trim();
  if (content && content !== '[]' && !force)
    return 'past_conferences.yml is not empty; rerun with --force to overwrite it';
}

export async function main(argv: string[], fixes: Fixes = defaultFixes): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'pwc-dir': { type: 'string' },
      'data-dir': { type: 'string', default: 'data' },
      force: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const dataDir = values['data-dir'];
  const outPath = join(dataDir, 'past_conferences.yml');
  const existing = existsSync(outPath) ? readFileSync(outPath, 'utf8') : undefined;
  const refused = refusal(existing, values.force);
  if (refused) {
    console.error(`data:import-pwc: ${refused}`);
    return 1;
  }
  const data = JSON.parse(readFileSync(join(dataDir, 'build', 'data.json'), 'utf8'));
  const geocache = JSON.parse(readFileSync(join(dataDir, 'geocache.json'), 'utf8'));

  const clone = values['pwc-dir'] ? undefined : clonePwc();
  let result: ConvertResult;
  let ctx: ReportContext;
  try {
    const gitDir = values['pwc-dir'] ?? clone!.gitDir;
    const head = checkHead(gitDir);
    const versions = readVersions(gitDir);
    const { records, chunked } = unionHistory(versions);
    result = convert(records.values(), data.conferences as KnownConference[], fixes);
    ctx = {
      head,
      versions: versions.length,
      chunked: chunked.length,
      records: records.size,
      geocache,
    };
  } finally {
    clone?.cleanup();
  }

  console.log(formatReport(result, ctx));
  if (result.unresolved.length) {
    console.error(`data:import-pwc: ${result.unresolved.length} unresolved; nothing written`);
    return 1;
  }
  const text = emitPastFile(result.entries, result.review);
  const check = PastConferencesFileSchema.safeParse(parse(text));
  if (!check.success) throw new Error(`emitted YAML does not validate: ${check.error.message}`);
  if (values['dry-run']) console.error(`data:import-pwc: dry run, ${outPath} not written`);
  else {
    writeFileSync(outPath, text);
    console.error(`data:import-pwc: wrote ${outPath} (${result.entries.length} editions)`);
  }
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
