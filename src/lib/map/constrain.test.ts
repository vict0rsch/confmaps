import { describe, expect, it } from 'vitest';
import { constrainLat } from './constrain';

describe('constrainLat', () => {
  it('leaves the centre alone when the world covers the visible area', () => {
    expect(constrainLat(48.85, 4, 600)).toBeCloseTo(48.85, 6);
  });

  it('keeps the world filling the area vertically (no band above the Arctic)', () => {
    // World 1024 px tall, area 600 px: the centre may not go above y = 300 px.
    const lat = constrainLat(84, 1, 600);
    expect(lat).toBeLessThan(84);
    expect(constrainLat(lat, 1, 600)).toBeCloseTo(lat, 6);
  });

  it('pins the top edge when the world is shorter than the area', () => {
    // World 362 px tall at z = -0.5, area 600 px: centre 300 px below the top edge.
    const world = 512 * 2 ** -0.5;
    const y = 300 / world;
    const expected = (360 / Math.PI) * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - 90;
    expect(constrainLat(20, -0.5, 600)).toBeCloseTo(expected, 6);
    expect(constrainLat(-60, -0.5, 600)).toBeCloseTo(expected, 6);
  });
});
