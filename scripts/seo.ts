// Build-time pages for crawlers (DESIGN §5.10). The plugin in vite.config.ts calls `pages()`:
// - `summaryHtml`: plain HTML of the upcoming conferences, written into <div id="app"> of
//   index.html. Crawlers and visitors without JavaScript read it; src/main.ts clears it before
//   the app mounts.
// - `sitemapXml`: dist/sitemap.xml.
// Conference data is untrusted (upstream scrapes, model output): every string is escaped and
// only http(s) links become hrefs.
import { loadData, trackName, type AppData } from '../src/lib/data/load';
import { formatDateRange } from '../src/lib/format/dates';
import { placeLabel, roleLabel } from '../src/lib/format/labels';
import {
  foldTracks,
  groupByConference,
  planWindow,
  todayISO,
  windowPredicate,
  type ListItem,
} from '../src/lib/state/derive';

export const SITE_URL = 'https://confmaps.org/';
const REPO_URL = 'https://github.com/vict0rsch/confmaps';
const UPSTREAM_URL = 'https://github.com/huggingface/ai-deadlines';

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape text for HTML (and XML) content and attribute values. */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);

function isHttp(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** A link when `href` is http(s), plain text otherwise. */
function link(href: string, text: string): string {
  return isHttp(href) ? `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>` : escapeHtml(text);
}

/**
 * The rows the app lists in its default view: the Plan window (today → +12 months, DESIGN §5.4)
 * and no other filter, grouped and track-folded like `AppState.listItems`.
 */
export function defaultRows(data: AppData, today: string): ListItem[] {
  const visible = data.locations.filter(windowPredicate(planWindow(today)));
  return foldTracks(groupByConference(visible, today), data.trackGroups);
}

function row({ conference: c, sites, tracks }: ListItem): string {
  const full = c.fullName && c.fullName !== c.title ? ` (${escapeHtml(c.fullName)})` : '';
  const withTracks = tracks.length
    ? `, with ${tracks.map((t) => escapeHtml(trackName(t) ?? t.title)).join(', ')}`
    : '';
  const lines = sites.map((s) => {
    const what = s.role === 'satellite' ? `${link(s.link, s.name)}, ` : '';
    const where = `${escapeHtml(placeLabel(s))}, ${escapeHtml(formatDateRange(s.start, s.end))}`;
    return `<li>${escapeHtml(roleLabel(s))}: ${what}${where}</li>`;
  });
  return (
    `<li>${link(c.link, `${c.title} ${c.year}`)}${full}${withTracks}` +
    `<ul>${lines.join('')}</ul></li>`
  );
}

/** The static summary that fills <div id="app"> until the app mounts. */
export function summaryHtml(data: AppData, today: string): string {
  const updated = data.generatedAt.slice(0, 10);
  const rows = defaultRows(data, today);
  return [
    '<main style="height:100%;overflow:auto;padding:16px 24px;line-height:1.5">',
    '<h1>AI conferences and their satellite events</h1>',
    '<p>confmaps shows where and when AI conferences and their regional satellite events take ' +
      'place, so researchers can attend the location closest to them and travel less.</p>',
    `<h2>Upcoming conferences, ${escapeHtml(formatDateRange(today, planWindow(today).to))}</h2>`,
    rows.length ? `<ul>\n${rows.map(row).join('\n')}\n</ul>` : '<p>No upcoming conferences.</p>',
    `<p>Data last updated ${escapeHtml(formatDateRange(updated, updated))}. ` +
      `Sources: ${link(UPSTREAM_URL, 'huggingface/ai-deadlines')} and curated satellite events. ` +
      `Code and data: ${link(REPO_URL, 'github.com/vict0rsch/confmaps')}.</p>`,
    '</main>',
  ].join('\n');
}

/** A sitemap with the one page, last modified when the data last changed. */
export function sitemapXml(generatedAt: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${SITE_URL}</loc><lastmod>${escapeHtml(generatedAt.slice(0, 10))}</lastmod></url>`,
    '</urlset>',
    '',
  ].join('\n');
}

/** What the vite.config.ts plugin writes: the summary for `now`'s date, and the sitemap. */
export function pages(now = new Date()): { summary: string; sitemap: string } {
  const data = loadData();
  return { summary: summaryHtml(data, todayISO(now)), sitemap: sitemapXml(data.generatedAt) };
}
