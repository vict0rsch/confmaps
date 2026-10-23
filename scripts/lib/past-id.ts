// Id of a past edition (docs/backfill-spec.md §1.2). The Python discovery agent implements the
// same algorithm; both test against scripts/__fixtures__/past-id-vectors.json.
import type { Conference } from '../schema';

/** A track's own name, from a title like "EMNLP (Industry Track)" (same rule as the app). */
const isTrack = (title: string) => /\(([^)]+)\)\s*$/.test(title);

/**
 * Our id for the `year` edition of `series`: the stem and digit style (`2025` or `25`) of the
 * series' newest HF main conference in `conferences` (data.json), else the series without dashes
 * and two digits. Never suffixed: a clash with another edition's id is the caller's error.
 */
export function pastEditionId(
  series: string,
  year: number,
  conferences: readonly Pick<Conference, 'id' | 'series' | 'title' | 'year' | 'source'>[],
): string {
  let stem = series.replace(/-/g, '');
  let style: 2 | 4 = 2;
  const newest = conferences
    .filter((c) => c.source === 'hf' && c.series === series && !isTrack(c.title))
    .sort((a, b) => b.year - a.year || a.id.localeCompare(b.id))[0];
  const m = newest && /^(.*?)(\d{4}|\d{2})$/.exec(newest.id);
  if (m) {
    const [, s, digits] = m;
    if (digits.length === 4 && Number(digits) === newest.year) [stem, style] = [s, 4];
    else if (digits.length === 2 && Number(digits) === newest.year % 100) [stem, style] = [s, 2];
  }
  return stem + (style === 4 ? String(year) : String(year % 100).padStart(2, '0'));
}
