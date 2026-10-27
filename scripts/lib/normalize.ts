// Upstream / satellites / overrides → normalized records (DESIGN.md §2.5), before geocoding.
import {
  isVirtual,
  type Conference,
  type Deadline,
  type Override,
  type Overrides,
  type PinnedLocation,
  type Satellite,
  type UpstreamConference,
  type VirtualLocation,
} from '../schema';
import { canonicalCountry } from './countries';
import { toUtcIso } from './timezone';

/** `Omit` distributed over each member of a union. */
type DOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A location whose coordinates are not resolved yet (a virtual one never has any). */
export type PendingLocation =
  (DOmit<PinnedLocation, 'lat' | 'lng'> & { lat?: number; lng?: number }) | VirtualLocation;

export const mainLocationId = (conferenceId: string) => `${conferenceId}@main`;

/** Normalized title: `ICML` → `icml`, `ECML PKDD` → `ecml-pkdd`. */
export function seriesKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Tracks / sub-events that upstream lists as separate conferences but belong to a parent series
 * (normalized title → series). Scanned upstream titles (2026-10): only EMNLP splits this way.
 */
export const SERIES_ALIASES: Record<string, string> = {
  'emnlp-industry-track': 'emnlp',
  'emnlp-system-demonstrations-track': 'emnlp',
  // Historical names of a series (past editions, DESIGN.md §2.4).
  nips: 'neurips',
  'naacl-hlt': 'naacl',
  'emnlp-ijcnlp': 'emnlp',
  'ijcai-pricai': 'ijcai',
  'ijcai-ecai': 'ijcai',
  'aacl-ijcnlp': 'ijcnlp-aacl',
  mm: 'acm-mm',
  'automl-conf': 'automl',
};

/** Series of a conference title: the normalized title, rolled up through SERIES_ALIASES. */
export const seriesOf = (title: string) => {
  const key = seriesKey(title);
  return SERIES_ALIASES[key] ?? key;
};

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const DATE_TEXT_RE = new RegExp(
  `^(${MONTHS.join('|')})\\s+(\\d{1,2})(?:\\s*[-–]\\s*(?:(${MONTHS.join('|')})\\s+)?(\\d{1,2}))?,\\s*(\\d{4})$`,
  'i',
);

/**
 * Fallback for upstream entries without `start`/`end`: parse free-text `date` such as
 * `June 10-17, 2025`, `June 30 - July 4, 2025` or `May 4, 2025`. Returns `undefined` if the text
 * is not in one of these forms (the caller reports it; fix with an override).
 */
export function parseDateText(text: string): { start: string; end: string } | undefined {
  const m = DATE_TEXT_RE.exec(text.trim());
  if (!m) return undefined;
  const [, m1, d1, m2, d2, y] = m;
  const iso = (month: string, day: string) => {
    const mi = MONTHS.indexOf(month.toLowerCase());
    const date = new Date(Date.UTC(Number(y), mi, Number(day)));
    if (date.getUTCMonth() !== mi) return undefined;
    return date.toISOString().slice(0, 10);
  };
  const start = iso(m1, d1);
  const end = iso(m2 ?? m1, d2 ?? d1);
  if (!start || !end || start > end) return undefined;
  return { start, end };
}

// Older upstream entries: top-level fields + top-level `timezone` instead of `deadlines[]`.
const LEGACY_DEADLINES = [
  ['abstract_deadline', 'abstract', 'Abstract submission deadline'],
  ['deadline', 'paper', 'Paper submission deadline'],
  ['review_release_date', 'review_release', 'Reviews released'],
  ['rebuttal_period_end', 'rebuttal_end', 'Rebuttal period ends'],
  ['final_decision_date', 'notification', 'Final decision'],
] as const;

type RawDeadline = { type: string; label?: string; date: string; timezone?: string | null };

/** Upstream-form deadlines → normalized ones. `where` prefixes error messages. */
export function convertDeadlines(raw: RawDeadline[], where: string, errors: string[]): Deadline[] {
  const out: Deadline[] = [];
  for (const d of raw) {
    if (!d.timezone) {
      errors.push(`${where}: deadline "${d.type}" has no timezone`);
      continue;
    }
    try {
      out.push({
        type: d.type,
        label: d.label ?? d.type,
        date: toUtcIso(d.date, d.timezone),
        timezone: d.timezone.trim(),
      });
    } catch (e) {
      errors.push(`${where}: deadline "${d.type}": ${(e as Error).message}`);
    }
  }
  return out;
}

function normalizeDeadlines(entry: UpstreamConference, errors: string[]): Deadline[] {
  const raw: RawDeadline[] = entry.deadlines
    ? entry.deadlines
    : LEGACY_DEADLINES.flatMap(([field, type, label]) => {
        const date = entry[field];
        return date ? [{ type, label, date, timezone: entry.timezone }] : [];
      });
  return convertDeadlines(raw, `upstream ${entry.id}`, errors);
}

export interface Normalized {
  conferences: Conference[];
  locations: PendingLocation[];
  errors: string[];
}

/**
 * Upstream entries → conferences + their `@main` locations. Entries without parseable dates still
 * produce records (with empty dates) so a main-location override can supply them; any remaining
 * gap is reported by validation.
 */
export function normalizeUpstream(entries: UpstreamConference[]): Normalized {
  const conferences: Conference[] = [];
  const locations: PendingLocation[] = [];
  const errors: string[] = [];
  for (const e of entries) {
    let start = e.start ?? undefined;
    let end = e.end ?? undefined;
    if (!start || !end) {
      const parsed = e.date ? parseDateText(e.date) : undefined;
      if (parsed) ({ start, end } = parsed);
    }
    const conf: Conference = {
      id: e.id,
      series: seriesOf(e.title),
      title: e.title,
      year: e.year,
      ...(e.full_name ? { fullName: e.full_name } : {}),
      link: e.link,
      tags: e.tags ?? [],
      deadlines: normalizeDeadlines(e, errors),
      start: start ?? '',
      end: end ?? '',
      source: 'hf',
    };
    conferences.push(conf);
    locations.push({
      id: mainLocationId(e.id),
      conferenceId: e.id,
      role: 'main',
      name: `${e.title} ${e.year}`,
      city: e.city.trim(),
      country: e.country.trim(),
      ...(e.venue?.trim() ? { venue: e.venue.trim() } : {}),
      start: conf.start,
      end: conf.end,
      official: true,
      presentsPapers: true,
      access: 'registration',
      link: e.link,
    });
  }
  return { conferences, locations, errors };
}

export function satelliteToLocation(s: Satellite): PendingLocation {
  return {
    id: s.id,
    conferenceId: s.parent,
    role: 'satellite',
    name: s.name,
    city: s.city,
    country: s.country,
    ...(s.venue ? { venue: s.venue } : {}),
    start: s.start,
    end: s.end,
    official: s.official,
    presentsPapers: s.presents_papers,
    access: s.access,
    link: s.link,
    ...(s.notes ? { notes: s.notes } : {}),
  };
}

function overrideFields(o: Override): Partial<PendingLocation> {
  const { presents_papers, reason, deadlines, ...rest } = o;
  void reason;
  void deadlines;
  return { ...rest, ...(presents_papers !== undefined ? { presentsPapers: presents_papers } : {}) };
}

/** Override fields that would give a virtual location a place. */
const VIRTUAL_FORBIDDEN = ['lat', 'lng', 'city', 'country', 'venue'] as const;

/**
 * Apply overrides in place (they win over upstream, satellites and archive). Start/end on a
 * `@main` location also set the conference's dates; `deadlines` replaces the conference's.
 * Returns errors for unknown location ids and for overrides that would place a virtual location
 * (not applied), and warnings for override fields that already equal
 * the computed value (stale: upstream was fixed). `fresh` holds the ids whose record came from
 * upstream or satellites.yml in this build; archive-only records already carry their overrides,
 * so they are not checked for staleness.
 */
export function applyOverrides(
  conferences: Map<string, Conference>,
  locations: Map<string, PendingLocation>,
  overrides: Overrides,
  fresh: Set<string> = new Set(locations.keys()),
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const [id, o] of Object.entries(overrides)) {
    const loc = locations.get(id);
    if (!loc) {
      errors.push(`overrides.yml: "${id}" matches no location`);
      continue;
    }
    if (isVirtual(loc)) {
      const placed = VIRTUAL_FORBIDDEN.filter((k) => o[k] !== undefined);
      if (placed.length) {
        errors.push(
          `overrides.yml: ${id}: ${placed.join(', ')} not allowed on a virtual location ` +
            `(edit its format in data/past_conferences.yml instead)`,
        );
        continue;
      }
    }
    const conf = loc.role === 'main' ? conferences.get(loc.conferenceId) : undefined;
    const fields = overrideFields(o);
    if (fresh.has(id)) {
      const same = Object.entries(fields)
        .filter(([k, v]) => loc[k as keyof PendingLocation] === v)
        .map(([k]) => k);
      if (o.deadlines && conf) {
        const converted = convertDeadlines(o.deadlines, '', []);
        if (JSON.stringify(converted) === JSON.stringify(conf.deadlines)) same.push('deadlines');
      }
      if (same.length)
        warnings.push(
          `overrides.yml: ${id}: ${same.join(', ')} already equal the computed value (stale override?)`,
        );
    }
    Object.assign(loc, fields);
    if (o.deadlines && loc.role !== 'main') {
      errors.push(`overrides.yml: ${id}: "deadlines" is only allowed on a "…@main" location`);
    }
    if (conf) {
      if (o.start) conf.start = o.start;
      if (o.end) conf.end = o.end;
      if (o.deadlines)
        conf.deadlines = convertDeadlines(o.deadlines, `overrides.yml: ${id}`, errors);
    }
  }
  return { errors, warnings };
}

/**
 * Replace each location's country by its canonical name (virtual ones have none). Returns errors
 * for unknown ones.
 */
export function canonicalizeCountries(locations: Iterable<PendingLocation>): string[] {
  const errors: string[] = [];
  for (const loc of locations) {
    if (isVirtual(loc)) continue;
    const c = canonicalCountry(loc.country);
    if (c) loc.country = c;
    else
      errors.push(
        `${loc.id}: unknown country "${loc.country}" (add it to scripts/lib/countries.ts)`,
      );
  }
  return errors;
}
