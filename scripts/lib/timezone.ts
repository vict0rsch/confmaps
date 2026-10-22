// Convert upstream deadline wall times to absolute UTC instants.
//
// Forms seen upstream: `AoE`, `UTC`, `UTC±N`, `UTC±HH`, `GMT±HH`, `PST`, and IANA names
// (`Europe/London`, `Pacific/Honolulu`). Anything else throws: we never guess.

/** Fixed abbreviations, in minutes east of UTC. PST/PDT are taken literally (not DST-aware). */
const FIXED: Record<string, number> = {
  aoe: -12 * 60, // Anywhere on Earth = UTC−12
  utc: 0,
  gmt: 0,
  z: 0,
  pst: -8 * 60,
  pdt: -7 * 60,
};

// `UTC+2`, `UTC-08`, `UTC+05:30`, `GMT+02` (human convention: GMT+2 means UTC+2, not POSIX).
const OFFSET_RE = /^(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i;
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

export class TimezoneError extends Error {}

function isIanaZone(tz: string): boolean {
  if (!tz.includes('/')) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset (minutes east of UTC) of an IANA zone at a given instant. */
function ianaOffsetAt(utcMs: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((wall - utcMs) / 60000);
}

/** Fixed offset in minutes for non-IANA forms, or `undefined` if not a fixed form. */
export function fixedOffsetMinutes(tz: string): number | undefined {
  const t = tz.trim();
  const fixed = FIXED[t.toLowerCase()];
  if (fixed !== undefined) return fixed;
  const m = OFFSET_RE.exec(t);
  if (!m) return undefined;
  const hours = Number(m[2]);
  const minutes = Number(m[3] ?? 0);
  if (hours > 14 || minutes > 59) return undefined;
  return (m[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
}

/**
 * `toUtcIso('2025-05-15 23:59:59', 'AoE')` → `'2025-05-16T11:59:59Z'`.
 * Throws `TimezoneError` for an unknown timezone or a malformed local time.
 */
export function toUtcIso(local: string, timezone: string): string {
  const m = LOCAL_RE.exec(local.trim());
  if (!m) throw new TimezoneError(`malformed local time ${JSON.stringify(local)}`);
  const [y, mo, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0));
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(wall);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) {
    throw new TimezoneError(`invalid local time ${JSON.stringify(local)}`);
  }

  let utcMs: number;
  const fixed = fixedOffsetMinutes(timezone);
  if (fixed !== undefined) {
    utcMs = wall - fixed * 60000;
  } else if (isIanaZone(timezone.trim())) {
    const zone = timezone.trim();
    const guess = wall - ianaOffsetAt(wall, zone) * 60000;
    utcMs = wall - ianaOffsetAt(guess, zone) * 60000;
  } else {
    throw new TimezoneError(`unknown timezone ${JSON.stringify(timezone)}`);
  }
  return new Date(utcMs).toISOString().replace('.000Z', 'Z');
}
