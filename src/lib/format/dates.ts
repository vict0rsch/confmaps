// Date display. Event dates are calendar dates (`YYYY-MM-DD`, no time zone): format them in UTC so
// they never shift by a day. Deadlines are UTC instants: format them in the viewer's time zone.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(iso: string): { y: number; m: string; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m: MONTHS[m - 1], d };
}

/** "Dec 9–13, 2026", "Nov 30 – Dec 5, 2025", "Dec 30, 2026 – Jan 2, 2027", "Dec 9, 2026". */
export function formatDateRange(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${a.m} ${a.d}, ${a.y}`;
  if (a.y !== b.y) return `${a.m} ${a.d}, ${a.y} – ${b.m} ${b.d}, ${b.y}`;
  if (a.m !== b.m) return `${a.m} ${a.d} – ${b.m} ${b.d}, ${a.y}`;
  return `${a.m} ${a.d}–${b.d}, ${a.y}`;
}

/** Same as `formatDateRange` without the year: "Dec 9–13", "Nov 30 – Dec 5". */
export function formatDateRangeShort(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${a.m} ${a.d}`;
  if (a.m !== b.m || a.y !== b.y) return `${a.m} ${a.d} – ${b.m} ${b.d}`;
  return `${a.m} ${a.d}–${b.d}`;
}

/** "Oct 2026". */
export function formatMonthYear(iso: string): string {
  const a = parts(iso);
  return `${a.m} ${a.y}`;
}

/** A UTC instant in the viewer's time zone: "Jan 24, 2027, 12:59 CET". */
export function formatInstant(isoInstant: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
    timeZone,
  }).format(new Date(isoInstant));
}
