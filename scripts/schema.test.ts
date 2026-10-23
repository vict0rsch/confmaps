import { describe, expect, it } from 'vitest';
import { satellite } from './__fixtures__';
import {
  ConferenceSchema,
  DataFileSchema,
  EventLocationSchema,
  isVirtual,
  OverrideSchema,
  PastConferenceSchema,
  PinnedLocationSchema,
  SatelliteSchema,
  UpstreamConferenceSchema,
  VirtualLocationSchema,
  type EventLocation,
  type PastConference,
} from './schema';

const BAD = [
  'javascript:alert(1)',
  'ftp://example.org/x',
  'example.org',
  'data:text/html,x',
  '//x.org',
];

describe('link schemes', () => {
  it.each(BAD)('rejects %j in every input and output link/sources field', (url) => {
    expect(SatelliteSchema.safeParse({ ...satellite(), link: url }).success).toBe(false);
    expect(SatelliteSchema.safeParse({ ...satellite(), sources: [url] }).success).toBe(false);
    expect(OverrideSchema.safeParse({ link: url }).success).toBe(false);
    expect(UpstreamConferenceSchema.shape.link.safeParse(url).success).toBe(false);
    expect(ConferenceSchema.shape.link.safeParse(url).success).toBe(false);
    expect(PinnedLocationSchema.shape.link.safeParse(url).success).toBe(false);
    expect(VirtualLocationSchema.shape.link.safeParse(url).success).toBe(false);
  });

  it.each(['https://neurips.cc/', 'http://example.org/a?b=c#d', 'HTTPS://EXAMPLE.ORG'])(
    'accepts %j',
    (url) => {
      expect(SatelliteSchema.safeParse({ ...satellite(), link: url, sources: [url] }).success).toBe(
        true,
      );
      expect(ConferenceSchema.shape.link.safeParse(url).success).toBe(true);
    },
  );
});

const SHA = 'b230d24719088a769e6938704a826e5084b4cb34';
const pwcEntry = (over: Partial<PastConference> = {}): PastConference => ({
  id: 'neurips18',
  title: 'NIPS',
  year: 2018,
  link: 'https://nips.cc/Conferences/2018',
  start: '2018-12-02',
  end: '2018-12-08',
  format: 'in_person',
  city: 'Montréal',
  country: 'Canada',
  tags: ['machine-learning'],
  source: 'pwc',
  pwc: {
    ids: ['nips18'],
    first_sha: SHA,
    first_date: '2017-12-01',
    last_sha: SHA,
    last_date: '2018-11-01',
  },
  ...over,
});
const curated = (over: Partial<PastConference> = {}) =>
  pwcEntry({ source: 'curated', pwc: undefined, sources: ['https://nips.cc/'], ...over });

/** Paths of the issues a past entry fails with ([] = valid). */
const pastIssues = (e: unknown) =>
  (PastConferenceSchema.safeParse(e).error?.issues ?? []).map((i) => i.path.join('.'));

describe('PastConferenceSchema', () => {
  it('accepts pwc, curated, virtual and hybrid entries', () => {
    expect(pastIssues(pwcEntry())).toEqual([]);
    expect(pastIssues(curated())).toEqual([]);
    expect(
      pastIssues(pwcEntry({ format: 'virtual', city: undefined, country: undefined })),
    ).toEqual([]);
    expect(pastIssues(pwcEntry({ format: 'hybrid', venue: 'Palais des congrès' }))).toEqual([]);
    expect(pastIssues(pwcEntry({ id: 'icdar2018' }))).toEqual([]);
  });

  it('rejects a virtual edition with a city, country or venue', () => {
    expect(pastIssues(pwcEntry({ format: 'virtual', country: undefined }))).toEqual(['city']);
    expect(pastIssues(pwcEntry({ format: 'virtual', venue: 'Hall A' }))).toEqual([
      'city',
      'country',
      'venue',
    ]);
  });

  it('requires city and country unless virtual', () => {
    expect(pastIssues(pwcEntry({ city: undefined }))).toEqual(['city']);
    expect(pastIssues(pwcEntry({ format: 'hybrid', country: undefined }))).toEqual(['country']);
  });

  it('ties provenance to the source', () => {
    expect(pastIssues(pwcEntry({ pwc: undefined }))).toEqual(['pwc']);
    expect(pastIssues(curated({ sources: undefined }))).toEqual(['sources']);
    expect(pastIssues(curated({ sources: [] }))).toEqual(['sources']);
    expect(pastIssues(curated({ pwc: pwcEntry().pwc }))).toEqual(['pwc']);
  });

  it('requires the id to end with the year (4 or 2 digits)', () => {
    expect(pastIssues(pwcEntry({ id: 'neurips' }))).toEqual(['id']);
    expect(pastIssues(pwcEntry({ id: 'neurips19' }))).toEqual(['id']);
    expect(pastIssues(pwcEntry({ id: 'neurips2019' }))).toEqual(['id']);
    expect(pastIssues(pwcEntry({ id: 'NeurIPS18' }))).toEqual(['id']);
    expect(pastIssues(pwcEntry({ id: 'neurips2018', year: 2018 }))).toEqual([]);
    expect(
      pastIssues(pwcEntry({ id: 'x05', year: 2005, start: '2005-12-02', end: '2005-12-08' })),
    ).toEqual([]);
  });

  it('rejects start after end, unknown keys, bad SHAs and formats', () => {
    expect(pastIssues(pwcEntry({ start: '2018-12-09' }))).toEqual(['start']);
    expect(pastIssues({ ...pwcEntry(), deadline: '2018-05-18' })).toEqual(['']);
    expect(pastIssues(pwcEntry({ pwc: { ...pwcEntry().pwc!, last_sha: 'abc' } }))).toEqual([
      'pwc.last_sha',
    ]);
    expect(pastIssues({ ...pwcEntry(), format: 'online' })).toEqual(['format']);
  });
});

const pinned = (over: Record<string, unknown> = {}) => ({
  id: 'neurips18@main',
  conferenceId: 'neurips18',
  role: 'main',
  name: 'NIPS 2018',
  city: 'Montréal',
  country: 'Canada',
  lat: 45.5,
  lng: -73.57,
  start: '2018-12-02',
  end: '2018-12-08',
  official: true,
  presentsPapers: true,
  access: 'registration',
  link: 'https://nips.cc/',
  ...over,
});
const virtual = (over: Record<string, unknown> = {}) => {
  const { city, country, lat, lng, ...rest } = pinned();
  void [city, country, lat, lng];
  return { ...rest, format: 'virtual', ...over };
};
const locOk = (l: unknown) => EventLocationSchema.safeParse(l).success;

describe('EventLocationSchema', () => {
  it('accepts in-person (no format), hybrid and virtual main locations', () => {
    expect(locOk(pinned())).toBe(true);
    expect(locOk(pinned({ format: 'hybrid', venue: 'Palais' }))).toBe(true);
    expect(locOk(virtual())).toBe(true);
  });

  it('rejects a virtual location with coordinates or a city', () => {
    expect(locOk(virtual({ lat: 1, lng: 2 }))).toBe(false);
    expect(locOk(virtual({ city: 'Montréal', country: 'Canada' }))).toBe(false);
  });

  it('rejects a pinned location without coordinates, and other formats', () => {
    const { lat, ...noLat } = pinned();
    void lat;
    expect(locOk(noLat)).toBe(false);
    expect(locOk(pinned({ format: 'in_person' }))).toBe(false);
    expect(locOk(pinned({ format: 'virtual' }))).toBe(false);
  });

  it('rejects a virtual satellite', () => {
    expect(locOk(virtual({ role: 'satellite', id: 'x-online' }))).toBe(false);
  });

  it('isVirtual narrows to the virtual member', () => {
    const locs = [pinned(), virtual()].map((l) => EventLocationSchema.parse(l));
    const cities = locs.map((l: EventLocation) => (isVirtual(l) ? 'Online' : l.city));
    expect(cities).toEqual(['Montréal', 'Online']);
  });
});

describe('ConferenceSchema.source', () => {
  it.each(['hf', 'pwc', 'curated', 'archive'])('accepts %s', (source) => {
    expect(ConferenceSchema.shape.source.safeParse(source).success).toBe(true);
  });
});

describe('existing data', () => {
  it('data/build/data.json still validates', async () => {
    const { default: data } = await import('../data/build/data.json');
    expect(DataFileSchema.safeParse(data).success).toBe(true);
  });
});
