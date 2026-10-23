// PwC dates (docs/backfill-spec.md §3.2): `start`/`end` (sometimes unpadded) or free-text `date`.

export interface DateRange {
  start: string;
  end: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` if the calendar date exists, else undefined. */
function isoDate(y: number, m: number, d: number): string | undefined {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Zero-pad a `Y-M-D` date (`2025-2-28` → `2025-02-28`); undefined if it is not one. */
export function padIsoDate(s: string): string | undefined {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  return m ? isoDate(Number(m[1]), Number(m[2]), Number(m[3])) : undefined;
}

// Full names, three-letter abbreviations, and `Sept`; an optional trailing dot.
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const MONTH_INDEX = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const DASH = String.raw`\s*[-–—]\s*`;
// `Month[,] D[ - [Month[,]] D][,] YYYY`
const DATE_TEXT = new RegExp(
  String.raw`^${MONTH},?\s*(\d{1,2})(?:${DASH}(?:${MONTH},?\s*)?(\d{1,2}))?\s*,?\s*(\d{4})$`,
  'i',
);

const monthNumber = (name: string) => MONTH_INDEX.indexOf(name.slice(0, 3).toLowerCase()) + 1;

/**
 * Parse PwC's free-text `date`: `Aug 9-12, 2019`, `Sept 9–12, 2017`, `October, 9-12, 2022`,
 * `August 3-4 2017`, `July 30-August 4, 2017`, `May 29- June 2, 2023`, `April 30, 2020`. In a range
 * whose end month is before its start month (`December 30 - January 2, 2021`), the year is the end's.
 */
export function parseDateText(text: string): DateRange | undefined {
  const m = DATE_TEXT.exec(text.trim().replace(/\s+/g, ' '));
  if (!m) return;
  const [, m1, d1, m2, d2, y] = m;
  const year = Number(y);
  const startMonth = monthNumber(m1);
  const endMonth = m2 ? monthNumber(m2) : startMonth;
  const start = isoDate(endMonth < startMonth ? year - 1 : year, startMonth, Number(d1));
  const end = isoDate(year, endMonth, Number(d2 ?? d1));
  if (!start || !end || start > end) return;
  return { start, end };
}
