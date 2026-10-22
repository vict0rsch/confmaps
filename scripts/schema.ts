// Zod schemas for the data pipeline (DESIGN.md §3), shared with the app's types
// (re-exported from src/lib/data/types.ts).
import { z } from 'zod';

const isoDate = z.iso.date(); // YYYY-MM-DD
const access = z.enum(['open', 'registration', 'authors_only']);

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
  link: z.string().min(1),
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
  link: z.url(),
  city: z.string().min(1),
  country: z.string().min(1),
  venue: z.string().optional(),
  start: isoDate,
  end: isoDate,
  official: z.boolean(),
  presents_papers: z.boolean(),
  access,
  notes: z.string().optional(),
  sources: z.array(z.url()).optional(),
});
export const SatellitesFileSchema = z.array(SatelliteSchema);

/**
 * One entry of `data/overrides.yml`, keyed by location id (`neurips25@main` or a satellite id).
 * Every field is optional and replaces the computed value. On a `…@main` location, `start`/`end`
 * also replace the conference's dates. `lat`/`lng` (both or neither) skip geocoding.
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
    link: z.url().optional(),
    notes: z.string().optional(),
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
  link: z.string().min(1),
  tags: z.array(z.string()),
  deadlines: z.array(DeadlineSchema),
  start: isoDate,
  end: isoDate,
  source: z.enum(['hf', 'pwc', 'archive']),
});

export const EventLocationSchema = z.strictObject({
  id: z.string().min(1),
  conferenceId: z.string().min(1),
  role: z.enum(['main', 'satellite']),
  name: z.string().min(1),
  city: z.string().min(1),
  country: z.string().min(1),
  venue: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  start: isoDate,
  end: isoDate,
  official: z.boolean(),
  presentsPapers: z.boolean(),
  access,
  link: z.string().min(1),
  notes: z.string().optional(),
});

/** `data/build/data.json`. */
export const DataFileSchema = z.strictObject({
  generatedAt: z.iso.datetime(),
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
export type Override = z.infer<typeof OverrideSchema>;
export type Overrides = z.infer<typeof OverridesFileSchema>;
export type GeocacheEntry = z.infer<typeof GeocacheEntrySchema>;
export type Geocache = z.infer<typeof GeocacheSchema>;
export type Deadline = z.infer<typeof DeadlineSchema>;
export type Conference = z.infer<typeof ConferenceSchema>;
export type EventLocation = z.infer<typeof EventLocationSchema>;
export type DataFile = z.infer<typeof DataFileSchema>;
export type ArchiveFile = z.infer<typeof ArchiveFileSchema>;
