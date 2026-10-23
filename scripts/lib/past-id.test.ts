import { describe, expect, it } from 'vitest';
import vectors from '../__fixtures__/past-id-vectors.json';
import type { Conference } from '../schema';
import { seriesOf } from './normalize';
import { pastEditionId } from './past-id';

const conferences = vectors.conferences as Pick<
  Conference,
  'id' | 'series' | 'title' | 'year' | 'source'
>[];

describe('pastEditionId (shared vectors)', () => {
  it.each(vectors.vectors)('$title $year → $id', ({ title, series, year, id }) => {
    expect(seriesOf(title)).toBe(series);
    expect(pastEditionId(series, year, conferences)).toBe(id);
  });

  it('pads two-digit years', () => {
    expect(pastEditionId('foo-bar', 2005, [])).toBe('foobar05');
  });
});
