import { describe, expect, it } from 'vitest';
import { satellite } from './__fixtures__';
import {
  ConferenceSchema,
  EventLocationSchema,
  OverrideSchema,
  SatelliteSchema,
  UpstreamConferenceSchema,
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
    expect(EventLocationSchema.shape.link.safeParse(url).success).toBe(false);
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
