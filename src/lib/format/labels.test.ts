import { describe, expect, it } from 'vitest';
import { hybridLocation, location, virtualLocation } from '../filters/fixtures';
import { FORMAT_LABEL, placeLabel, roleLabel } from './labels';

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
