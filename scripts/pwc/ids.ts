// Edition identity (DESIGN.md §2.4): PwC ids of one edition are grouped by
// `series|year`; the best one supplies the fields; our id comes from `pastEditionId`.
import type { PwcRecord } from './history';

export { pastEditionId } from '../lib/past-id';

/** One PwC id after title/year/date checks, ready to be grouped. */
export interface Candidate {
  record: PwcRecord;
  series: string;
  year: number;
}

const hasStartEnd = (c: Candidate) => Boolean(c.record.entry.start && c.record.entry.end);

/**
 * Best first: latest `last_date`, then has `start`/`end`, then the shorter id, then the id
 * (so the order is total and the output deterministic).
 */
export function compareCandidates(a: Candidate, b: Candidate): number {
  const [x, y] = [a.record, b.record];
  if (x.last_date !== y.last_date) return x.last_date > y.last_date ? -1 : 1;
  if (hasStartEnd(a) !== hasStartEnd(b)) return hasStartEnd(a) ? -1 : 1;
  if (x.key.length !== y.key.length) return x.key.length - y.key.length;
  return x.key < y.key ? -1 : x.key > y.key ? 1 : 0;
}

export const editionKey = (series: string, year: number) => `${series}|${year}`;

/** Group candidates by `series|year`; each group is sorted best first. Groups in key order. */
export function groupEditions<C extends Candidate>(candidates: readonly C[]): C[][] {
  const groups = new Map<string, C[]>();
  for (const c of candidates) {
    const k = editionKey(c.series, c.year);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return [...groups.keys()].sort().map((k) => groups.get(k)!.sort(compareCandidates));
}
