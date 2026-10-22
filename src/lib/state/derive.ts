// Pure derivations behind the app state (no runes; unit-tested in derive.test.ts).
import type { JoinedLocation } from '../data/load';
import type { Conference, Deadline } from '../data/types';

/** Local calendar date as `YYYY-MM-DD`. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Add calendar months to a `YYYY-MM-DD` date, clamping the day (Jan 31 + 1 → Feb 28). */
export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  first.setUTCDate(Math.min(d, lastDay.getUTCDate()));
  return first.toISOString().slice(0, 10);
}

export type DateWindow = { from: string; to: string };

/** The Plan default (DESIGN §6.4): today → today + `months`. */
export function planWindow(today: string, months = 12): DateWindow {
  return { from: today, to: addMonthsISO(today, months) };
}

/** A location overlaps the window: `end ≥ from && start ≤ to` (inclusive, DESIGN §6.3). */
export function inWindow(loc: { start: string; end: string }, w: DateWindow): boolean {
  return loc.end >= w.from && loc.start <= w.to;
}

export type LocationPredicate = (loc: JoinedLocation) => boolean;

export function windowPredicate(w: DateWindow): LocationPredicate {
  return (loc) => inWindow(loc, w);
}

export type ListItem = {
  conference: Conference;
  /** The conference's visible locations, main first. */
  sites: JoinedLocation[];
};

/**
 * Group visible locations by conference (a conference is listed if ≥1 location passes) and sort
 * by the earliest visible site's start date, then conference start, then title.
 */
export function groupByConference(visible: readonly JoinedLocation[]): ListItem[] {
  const byId = new Map<string, ListItem>();
  for (const loc of visible) {
    const item = byId.get(loc.conferenceId);
    if (item) item.sites.push(loc);
    else byId.set(loc.conferenceId, { conference: loc.conference, sites: [loc] });
  }
  const items = [...byId.values()];
  for (const item of items) {
    item.sites.sort(
      (a, b) =>
        (a.role === 'main' ? 0 : 1) - (b.role === 'main' ? 0 : 1) || a.start.localeCompare(b.start),
    );
  }
  const firstStart = (i: ListItem) => i.sites.reduce((m, s) => (s.start < m ? s.start : m), '9999');
  return items.sort(
    (a, b) =>
      firstStart(a).localeCompare(firstStart(b)) ||
      a.conference.start.localeCompare(b.conference.start) ||
      a.conference.title.localeCompare(b.conference.title),
  );
}

/** Upstream deadline types that mean "the paper deadline". */
export const PAPER_DEADLINE_TYPES: readonly string[] = ['paper', 'submission'];

export type DeadlineSummary = {
  /** The paper deadline: the next upcoming one, else the latest passed one. */
  paper?: { deadline: Deadline; passed: boolean };
  /** The next upcoming deadline of any type (may be the paper deadline itself). */
  next?: Deadline;
};

/** Deadlines are UTC instants (`date` is ISO 8601 with `Z`), compared against `now`. */
export function deadlineSummary(conference: Conference, now: Date): DeadlineSummary {
  const t = now.getTime();
  const sorted = [...conference.deadlines].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const upcoming = sorted.filter((d) => Date.parse(d.date) > t);
  const papers = sorted.filter((d) => PAPER_DEADLINE_TYPES.includes(d.type));
  const nextPaper = papers.find((d) => Date.parse(d.date) > t);
  const paperDeadline = nextPaper ?? papers.at(-1);
  return {
    paper: paperDeadline ? { deadline: paperDeadline, passed: !nextPaper } : undefined,
    next: upcoming[0],
  };
}
