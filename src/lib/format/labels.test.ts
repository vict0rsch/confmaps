import { describe, expect, it } from 'vitest';
import { hybridLocation, location, virtualLocation } from '../filters/fixtures';
import { FORMAT_LABEL, mapTipLines, placeLabel, roleLabel, websiteLabel } from './labels';

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

describe('map tooltip lines', () => {
  it("a pin: the conference and its site's own dates", () => {
    const site = location(
      { id: 'neurips25@paris', role: 'satellite', start: '2025-12-01', end: '2025-12-04' },
      { id: 'neurips25', year: 2025, start: '2025-11-30', end: '2025-12-07' },
    );
    expect(mapTipLines([site])).toEqual(['NeurIPS 2025 · Dec 1–4']);
  });

  it('a cluster: one line per conference, soonest first, its earliest site', () => {
    const icml = { id: 'icml26', title: 'ICML', start: '2026-07-06', end: '2026-07-11' };
    const sites = [
      location({ start: '2026-12-06', end: '2026-12-12' }),
      location({ id: 'icml26@main', conferenceId: 'icml26' }, icml),
      location({ id: 'neurips26@sat', start: '2026-11-30', end: '2026-12-02' }),
    ];
    expect(mapTipLines(sites)).toEqual(['ICML 2026 · Jul 6–11', 'NeurIPS 2026 · Nov 30 – Dec 2']);
  });

  it('at most 10 conferences, then "[...]"', () => {
    const sites = (n: number) =>
      Array.from({ length: n }, (_, i) => {
        const day = String(i + 1).padStart(2, '0');
        const conf = {
          id: `c${i}`,
          title: `C${i}`,
          start: `2026-05-${day}`,
          end: `2026-05-${day}`,
        };
        return location({ id: `c${i}@main`, conferenceId: `c${i}` }, conf);
      });
    expect(mapTipLines(sites(10))).toHaveLength(10);
    const lines = mapTipLines(sites(12).toReversed());
    expect(lines).toHaveLength(11);
    expect(lines[0]).toBe('C0 2026 · May 1');
    expect(lines[9]).toBe('C9 2026 · May 10');
    expect(lines[10]).toBe('[...]');
  });
});
