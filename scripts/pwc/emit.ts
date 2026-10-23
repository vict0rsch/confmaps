// Deterministic YAML for data/past_conferences.yml (docs/backfill-spec.md §1.1): fixed key order,
// quoted dates and SHAs, one blank line between entries, review flags as end-of-line comments.
import { stringify } from 'yaml';
import type { PastConference } from '../schema';

// The header must not contain the review marker itself: `pnpm data:validate` fails on any.
export const HEADER = `# Past main editions of AI conferences (docs/backfill-spec.md §1), validated by
# PastConferencesFileSchema (scripts/schema.ts). Written once by \`pnpm data:import-pwc\` from every
# version of paperswithcode/ai-deadlines \`_data/conferences.yml\` (MIT); after that, entries are
# edited by hand or appended by the discovery agent (source: curated).
#
# Fields: id (docs/backfill-spec.md §1.2), title (as named that year), year, full_name, link,
# start/end (YYYY-MM-DD), format (in_person | virtual | hybrid), city/country/venue (never on a
# virtual edition), tags (HF-style slugs), notes, source (pwc | curated), pwc (provenance: the PwC
# ids merged into this edition, the first and last commit they appear in, importer fixes), sources
# (evidence URLs). Not imported from PwC: deadline, abstract_deadline, timezone, hindex, note,
# paperslink, pwclink, host (recoverable from pwc.last_sha).
#
# An entry the importer wants a human to check carries an end-of-line review marker listing its
# reasons (covid, stale, multi-id, fixes-applied). \`pnpm data:validate\` fails while any remains.
`;

const KEY_ORDER = [
  'id',
  'title',
  'year',
  'full_name',
  'link',
  'start',
  'end',
  'format',
  'city',
  'country',
  'venue',
  'tags',
  'notes',
  'source',
  'pwc',
  'sources',
] as const;
const PWC_ORDER = ['ids', 'first_sha', 'first_date', 'last_sha', 'last_date', 'fixes'] as const;
/** Always single-quoted: dates, and SHAs (an all-digit SHA would otherwise parse as a number). */
const QUOTED = new Set(['start', 'end', 'first_sha', 'first_date', 'last_sha', 'last_date']);
const FLOW = new Set(['tags', 'ids']);
const SAFE_FLOW_ITEM = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

function scalar(value: unknown, key: string): string {
  if (typeof value === 'number') return String(value);
  const s = String(value);
  if (QUOTED.has(key)) return quote(s);
  const out = stringify(s, { singleQuote: true, lineWidth: 0 }).trimEnd();
  if (out.includes('\n')) throw new Error(`emit: multi-line value for ${key}: ${s}`);
  return out;
}

function field(key: string, value: unknown, indent: string): string[] {
  if (Array.isArray(value)) {
    if (FLOW.has(key)) {
      const items = value.map((v) => (SAFE_FLOW_ITEM.test(String(v)) ? String(v) : quote(v)));
      return [`${indent}${key}: [${items.join(', ')}]`];
    }
    if (value.length === 0) return [`${indent}${key}: []`];
    return [`${indent}${key}:`, ...value.map((v) => `${indent}  - ${scalar(v, key)}`)];
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = PWC_ORDER.filter((k) => obj[k] !== undefined);
    const extra = Object.keys(obj).filter((k) => !(PWC_ORDER as readonly string[]).includes(k));
    if (extra.length) throw new Error(`emit: unexpected ${key} keys ${extra.join(', ')}`);
    return [`${indent}${key}:`, ...keys.flatMap((k) => field(k, obj[k], `${indent}  `))];
  }
  return [`${indent}${key}: ${scalar(value, key)}`];
}

/**
 * The whole file: header, then each entry in the given order. `review` maps an entry id to its
 * flag reasons, written as a comment on the entry's first line.
 */
export function emitPastFile(
  entries: readonly PastConference[],
  review: ReadonlyMap<string, readonly string[]> = new Map(),
): string {
  if (entries.length === 0) return `${HEADER}[]\n`;
  const blocks = entries.map((e) => {
    const obj = e as Record<string, unknown>;
    const extra = Object.keys(obj).filter((k) => !(KEY_ORDER as readonly string[]).includes(k));
    if (extra.length) throw new Error(`emit: unexpected keys ${extra.join(', ')} on ${e.id}`);
    const lines = KEY_ORDER.filter((k) => obj[k] !== undefined).flatMap((k) =>
      field(k, obj[k], '  '),
    );
    lines[0] = `- ${lines[0].slice(2)}`;
    const reasons = review.get(e.id);
    if (reasons?.length) lines[0] += ` # review: ${reasons.join(', ')}`;
    return lines.join('\n');
  });
  return `${HEADER}\n${blocks.join('\n\n')}\n`;
}
