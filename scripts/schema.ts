// Zod schemas for the data pipeline (DESIGN.md §3), shared with the app's types
// (re-exported from src/lib/data/types.ts).
import { z } from 'zod';

const isoDate = z.iso.date(); // YYYY-MM-DD
const access = z.enum(['open', 'registration', 'authors_only']);
/** Every `link`/`sources` URL must be http(s): `link` is rendered as an `<a href>` in the app. */
const httpUrl = z
  .url({ protocol: /^https?$/, error: 'must be an http(s):// URL' })
  .regex(/^https?:\/\/\S+$/i, 'must be an http(s):// URL');

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One deadline in an upstream `deadlines[]` list. `date` is local wall time in `timezone`. */
export const UpstreamDeadlineSchema = z.looseObject({
  type: z.string(),
  label: z.string().optional(),
  date: z.string(),
  timezone: z.string().optional(),
});

/**
 * One entry of huggingface/ai-deadlines `src/data/conferences/*.yml`. Unknown keys are allowed
 * (upstream has many we ignore). Older entries use top-level `deadline`/`abstract_deadline`/…
 * with a top-level `timezone` instead of `deadlines[]`, and some have only free-text `date`.
 */
export const UpstreamConferenceSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().min(1),
  year: z.number().int(),
  full_name: z.string().nullish(),
  link: httpUrl,
  deadlines: z.array(UpstreamDeadlineSchema).nullish(),
  deadline: z.string().nullish(),
  abstract_deadline: z.string().nullish(),
  review_release_date: z.string().nullish(),
  rebuttal_period_end: z.string().nullish(),
  final_decision_date: z.string().nullish(),
  timezone: z.string().nullish(),
  city: z.string().min(1),
  country: z.string().min(1),
  venue: z.string().nullish(),
  date: z.string().nullish(),
  start: isoDate.nullish(),
  end: isoDate.nullish(),
  tags: z.array(z.string()).nullish(),
});

/** One entry of `data/satellites.yml` (DESIGN.md §3.2). */
export const SatelliteSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes only')
    .refine((s) => !s.endsWith('@main')),
  parent: z.string().min(1),
  name: z.string().min(1),
  link: httpUrl,
  city: z.string().min(1),
  country: z.string().min(1),
  venue: z.string().optional(),
  start: isoDate,
  end: isoDate,
  official: z.boolean(),
  presents_papers: z.boolean(),
  access,
  notes: z.string().optional(),
  sources: z.array(httpUrl).optional(),
});
export const SatellitesFileSchema = z.array(SatelliteSchema);

export const PastFormatSchema = z.enum(['in_person', 'virtual', 'hybrid']);
const sha40 = z.string().regex(/^[0-9a-f]{40}$/);

/** Where an imported entry came from in paperswithcode/ai-deadlines `_data/conferences.yml`. */
export const PwcProvenanceSchema = z.strictObject({
  ids: z.array(z.string().min(1)).min(1), // PwC ids merged into this edition; [0] = the one used
  first_sha: sha40,
  first_date: isoDate, // first commit any of them appears in
  last_sha: sha40,
  last_date: isoDate, // last commit (the version the fields come from)
  fixes: z.array(z.string().min(1)).optional(), // importer cleanups applied, e.g. "title: WWWW → WWW"
});

/** One past main edition (DESIGN §3.4). Deadlines are deliberately not represented. */
export const PastConferenceSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+$/, 'lowercase letters and digits only'),
    title: z.string().min(1), // as named that year ("NIPS"); series = seriesOf(title)
    year: z.number().int().min(1950).max(2100),
    full_name: z.string().min(1).optional(),
    link: httpUrl,
    start: isoDate,
    end: isoDate,
    format: PastFormatSchema,
    city: z.string().min(1).optional(), // required unless virtual; forbidden if virtual
    country: z.string().min(1).optional(), // ditto
    venue: z.string().min(1).optional(), // forbidden if virtual
    tags: z.array(z.string().min(1)), // HF-style slugs; may be []
    notes: z.string().min(1).optional(),
    source: z.enum(['pwc', 'curated']),
    pwc: PwcProvenanceSchema.optional(), // required iff source = pwc
    sources: z.array(httpUrl).optional(), // evidence URLs; ≥1 required iff source = curated
  })
  .superRefine((e, ctx) => {
    const bad = (message: string, path: string) =>
      ctx.addIssue({ code: 'custom', message, path: [path] });
    if (e.format === 'virtual') {
      for (const k of ['city', 'country', 'venue'] as const)
        if (e[k] !== undefined) bad('not allowed on a virtual edition', k);
    } else {
      if (!e.city) bad('required unless format is virtual', 'city');
      if (!e.country) bad('required unless format is virtual', 'country');
    }
    if (e.source === 'pwc' && !e.pwc) bad('required when source is pwc', 'pwc');
    if (e.source === 'curated' && e.pwc) bad('only for source pwc', 'pwc');
    if (e.source === 'curated' && !e.sources?.length)
      bad('curated entries need evidence URLs', 'sources');
    if (e.start > e.end) bad('start is after end', 'start');
    const yy = String(e.year % 100).padStart(2, '0');
    if (!e.id.endsWith(String(e.year)) && !e.id.endsWith(yy))
      bad(`must end with ${e.year} or ${yy}`, 'id');
  });
/** `data/past_conferences.yml`. */
export const PastConferencesFileSchema = z.array(PastConferenceSchema);

/**
 * One entry of `data/overrides.yml`, keyed by location id (`neurips25@main` or a satellite id).
 * Every field is optional and replaces the computed value. On a `…@main` location, `start`/`end`
 * also replace the conference's dates. `lat`/`lng` (both or neither) skip geocoding.
 * `deadlines` (only on `…@main`) replaces the conference's whole deadline list, in upstream form
 * (`[]` drops them all).
 */
export const OverrideSchema = z
  .strictObject({
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    name: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    country: z.string().min(1).optional(),
    venue: z.string().optional(),
    start: isoDate.optional(),
    end: isoDate.optional(),
    official: z.boolean().optional(),
    presents_papers: z.boolean().optional(),
    access: access.optional(),
    link: httpUrl.optional(),
    notes: z.string().optional(),
    deadlines: z.array(z.strictObject(UpstreamDeadlineSchema.shape)).optional(),
    reason: z.string().optional(), // free-text justification, not emitted
  })
  .refine((o) => (o.lat === undefined) === (o.lng === undefined), 'lat and lng go together');
export const OverridesFileSchema = z.record(z.string(), OverrideSchema);

export const GeocacheEntrySchema = z.strictObject({
  lat: z.number(),
  lng: z.number(),
  display_name: z.string(),
});
/** `data/geocache.json`: normalized `"city|country"` → coordinates. */
export const GeocacheSchema = z.record(z.string(), GeocacheEntrySchema);

// ---------------------------------------------------------------------------
// Normalized output (DESIGN.md §3.5)
// ---------------------------------------------------------------------------

export const DeadlineSchema = z.strictObject({
  type: z.string(),
  label: z.string(),
  /** Absolute instant, ISO 8601 UTC (`2025-05-16T11:59:59Z`). */
  date: z.iso.datetime(),
  /** Timezone as written upstream (e.g. `AoE`), for display only. */
  timezone: z.string(),
});

export const ConferenceSchema = z.strictObject({
  id: z.string().min(1),
  series: z.string().min(1),
  title: z.string().min(1),
  year: z.number().int(),
  fullName: z.string().optional(),
  link: httpUrl,
  tags: z.array(z.string()),
  deadlines: z.array(DeadlineSchema),
  start: isoDate,
  end: isoDate,
  source: z.enum(['hf', 'pwc', 'curated', 'archive']),
});

const locationBase = {
  id: z.string().min(1),
  conferenceId: z.string().min(1),
  role: z.enum(['main', 'satellite']),
  name: z.string().min(1),
  start: isoDate,
  end: isoDate,
  official: z.boolean(),
  presentsPapers: z.boolean(),
  access,
  link: httpUrl,
  notes: z.string().optional(),
};
/** A location with a map pin: in person, or hybrid (its physical city). */
export const PinnedLocationSchema = z.strictObject({
  ...locationBase,
  format: z.literal('hybrid').optional(), // absent = in person (all existing records unchanged)
  city: z.string().min(1),
  country: z.string().min(1),
  venue: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
/** A virtual main edition: no city, venue or coordinates (no pin). */
export const VirtualLocationSchema = z.strictObject({
  ...locationBase,
  role: z.literal('main'),
  format: z.literal('virtual'),
});
/** Discriminated on `format` (absent or hybrid → pinned) so issues name the bad field. */
export const EventLocationSchema = z.discriminatedUnion('format', [
  PinnedLocationSchema,
  VirtualLocationSchema,
]);

/** Upstream commit the dataset was built from (updated only when the dataset changes). */
export const UpstreamRefSchema = z.strictObject({
  repo: z.string().min(1),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
});

/** `data/build/data.json`. */
export const DataFileSchema = z.strictObject({
  generatedAt: z.iso.datetime(),
  upstream: UpstreamRefSchema.optional(),
  conferences: z.array(ConferenceSchema),
  locations: z.array(EventLocationSchema),
});

/** `data/archive/<year>.json`: frozen events whose conference has that `year`. */
export const ArchiveFileSchema = z.strictObject({
  conferences: z.array(ConferenceSchema),
  locations: z.array(EventLocationSchema),
});

export type UpstreamDeadline = z.infer<typeof UpstreamDeadlineSchema>;
export type UpstreamConference = z.infer<typeof UpstreamConferenceSchema>;
export type Satellite = z.infer<typeof SatelliteSchema>;
export type PastConference = z.infer<typeof PastConferenceSchema>;
export type Override = z.infer<typeof OverrideSchema>;
export type Overrides = z.infer<typeof OverridesFileSchema>;
export type GeocacheEntry = z.infer<typeof GeocacheEntrySchema>;
export type Geocache = z.infer<typeof GeocacheSchema>;
export type Deadline = z.infer<typeof DeadlineSchema>;
export type Conference = z.infer<typeof ConferenceSchema>;
export type PinnedLocation = z.infer<typeof PinnedLocationSchema>;
export type VirtualLocation = z.infer<typeof VirtualLocationSchema>;
export type EventLocation = z.infer<typeof EventLocationSchema>;
export type DataFile = z.infer<typeof DataFileSchema>;
export type UpstreamRef = z.infer<typeof UpstreamRefSchema>;
export type ArchiveFile = z.infer<typeof ArchiveFileSchema>;

export { isVirtual } from './lib/virtual';
