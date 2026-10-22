// Upstream / satellites / overrides → normalized records (DESIGN.md §3.5), before geocoding.
import type {
  Conference,
  Deadline,
  EventLocation,
  Override,
  Overrides,
  Satellite,
  UpstreamConference,
} from '../schema';
import { canonicalCountry } from './countries';
import { toUtcIso } from './timezone';

/** A location whose coordinates are not resolved yet. */
export type PendingLocation = Omit<EventLocation, 'lat' | 'lng'> & { lat?: number; lng?: number };

export const mainLocationId = (conferenceId: string) => `${conferenceId}@main`;

/** Series key = normalized title: `ICML` → `icml`, `ECML PKDD` → `ecml-pkdd`. */
export function seriesKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

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

function normalizeDeadlines(entry: UpstreamConference, errors: string[]): Deadline[] {
  const raw: { type: string; label: string; date: string; timezone?: string | null }[] =
    entry.deadlines
      ? entry.deadlines.map((d) => ({ ...d, label: d.label ?? d.type }))
      : LEGACY_DEADLINES.flatMap(([field, type, label]) => {
          const date = entry[field];
          return date ? [{ type, label, date, timezone: entry.timezone }] : [];
        });
  const out: Deadline[] = [];
  for (const d of raw) {
    if (!d.timezone) {
      errors.push(`upstream ${entry.id}: deadline "${d.type}" has no timezone`);
      continue;
    }
    try {
      out.push({
        type: d.type,
        label: d.label,
        date: toUtcIso(d.date, d.timezone),
        timezone: d.timezone.trim(),
      });
    } catch (e) {
      errors.push(`upstream ${entry.id}: deadline "${d.type}": ${(e as Error).message}`);
    }
  }
  return out;
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
      series: seriesKey(e.title),
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
  const { presents_papers, reason, ...rest } = o;
  void reason;
  return { ...rest, ...(presents_papers !== undefined ? { presentsPapers: presents_papers } : {}) };
}

/**
 * Apply overrides in place (they win over upstream, satellites and archive). Start/end on a
 * `@main` location also set the conference's dates. Returns errors for unknown location ids.
 */
export function applyOverrides(
  conferences: Map<string, Conference>,
  locations: Map<string, PendingLocation>,
  overrides: Overrides,
): string[] {
  const errors: string[] = [];
  for (const [id, o] of Object.entries(overrides)) {
    const loc = locations.get(id);
    if (!loc) {
      errors.push(`overrides.yml: "${id}" matches no location`);
      continue;
    }
    Object.assign(loc, overrideFields(o));
    const conf = loc.role === 'main' ? conferences.get(loc.conferenceId) : undefined;
    if (conf) {
      if (o.start) conf.start = o.start;
      if (o.end) conf.end = o.end;
    }
  }
  return errors;
}

/** Replace each location's country by its canonical name. Returns errors for unknown ones. */
export function canonicalizeCountries(locations: Iterable<PendingLocation>): string[] {
  const errors: string[] = [];
  for (const loc of locations) {
    const c = canonicalCountry(loc.country);
    if (c) loc.country = c;
    else
      errors.push(
        `${loc.id}: unknown country "${loc.country}" (add it to scripts/lib/countries.ts)`,
      );
  }
  return errors;
}
