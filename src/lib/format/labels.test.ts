import { describe, expect, it } from 'vitest';
import { hybridLocation, location, virtualLocation } from '../filters/fixtures';
import { FORMAT_LABEL, placeLabel, roleLabel, websiteLabel } from './labels';

describe('place and role labels', () => {
  it('a virtual edition is "Online", a "Virtual event"', () => {
    expect(placeLabel(virtualLocation())).toBe('Online');
    expect(roleLabel(virtualLocation())).toBe('Virtual event');
    expect(FORMAT_LABEL.virtual).toBe('Virtual');
  });

  it('a hybrid edition keeps its city and role', () => {
    expect(placeLabel(hybridLocation())).toBe('New Orleans, USA');
    expect(roleLabel(hybridLocation())).toBe('Main venue');
    expect(FORMAT_LABEL.hybrid).toBe('Hybrid');
  });

  it('in person: "City, Country"', () => {
    expect(placeLabel(location())).toBe('San Diego, USA');
    expect(roleLabel(location({ role: 'satellite' }))).toBe('Satellite');
  });
});

describe('website label', () => {
  it('is the hostname without www', () => {
    expect(websiteLabel('https://www.icml.cc/Conferences/2022')).toEqual({ text: 'icml.cc' });
  });

  it('a Wayback Machine snapshot is an "Archived site" of the original hostname', () => {
    expect(
      websiteLabel('https://web.archive.org/web/20201019154619/https://www.cikm2020.org/'),
    ).toEqual({ text: 'Archived site', archivedHost: 'cikm2020.org' });
  });

  it('falls back to the raw link when it is not a URL', () => {
    expect(websiteLabel('not a url')).toEqual({ text: 'not a url' });
  });
});
