import { describe, expect, it } from 'vitest';
import { joinData, loadData } from '../src/lib/data/load';
import type { DataFile } from '../src/lib/data/types';
import { ctx } from '../src/lib/filters/fixtures';
import { createFilters } from '../src/lib/filters';
import { composePredicate } from '../src/lib/filters/store.svelte';
import { AppState } from '../src/lib/state/app.svelte';
import { defaultRows, escapeHtml, sitemapXml, summaryHtml } from './seo';

const rowIds = (rows: { conference: { id: string }; sites: { id: string }[] }[]) =>
  rows.map((r) => [r.conference.id, r.sites.map((s) => s.id)]);

describe('defaultRows', () => {
  it("matches the app's default list: every filter at its default state", () => {
    // Real data, fixed clock: 2026-10-22 local.
    const app = new AppState({ now: new Date(2026, 9, 22, 12) });
    const filters = createFilters(app.today);
    const defaults = Object.fromEntries(filters.map((f) => [f.id, f.defaultState]));
    app.predicate = composePredicate(filters, defaults, ctx({ today: app.today }));
    const rows = defaultRows(app.data, app.today);
    expect(rows.length).toBeGreaterThan(0);
    expect(rowIds(rows)).toEqual(rowIds(app.listItems));
  });
});

describe('summaryHtml', () => {
  const file: DataFile = {
    generatedAt: '2026-10-29T11:39:38.725Z',
    conferences: [
      {
        id: 'x26',
        series: 'x',
        title: 'X<script>',
        year: 2026,
        fullName: 'Conf "&" \'quoted\'',
        link: 'javascript:alert(1)',
        tags: [],
        deadlines: [],
        start: '2026-12-06',
        end: '2026-12-12',
        source: 'hf',
      },
      {
        id: 'old20',
        series: 'old',
        title: 'Old',
        year: 2020,
        link: 'https://old.example/',
        tags: [],
        deadlines: [],
        start: '2020-12-06',
        end: '2020-12-12',
        source: 'pwc',
      },
    ],
    locations: [
      {
        id: 'x26@main',
        conferenceId: 'x26',
        role: 'main',
        name: 'X 2026',
        city: 'Sydney</li>',
        country: 'Australia',
        lat: -33.9,
        lng: 151.2,
        start: '2026-12-06',
        end: '2026-12-12',
        official: true,
        presentsPapers: true,
        access: 'registration',
        link: 'javascript:alert(1)',
      },
      {
        id: 'x26-paris',
        conferenceId: 'x26',
        role: 'satellite',
        name: 'X Paris',
        city: 'Paris',
        country: 'France',
        lat: 48.9,
        lng: 2.35,
        start: '2026-12-01',
        end: '2026-12-04',
        official: true,
        presentsPapers: true,
        access: 'open',
        link: 'https://x.example/paris?a=1&b=2',
      },
      {
        id: 'old20@main',
        conferenceId: 'old20',
        role: 'main',
        name: 'Old 2020',
        format: 'virtual',
        start: '2020-12-06',
        end: '2020-12-12',
        official: true,
        presentsPapers: true,
        access: 'registration',
        link: 'https://old.example/',
      },
    ],
  };
  const html = summaryHtml(joinData(file), '2026-11-04');

  it('lists upcoming conferences with their sites, and no past editions', () => {
    expect(html).toContain('<h1>');
    expect(html).toContain('Upcoming conferences, Nov 4, 2026 – Nov 4, 2027');
    expect(html).toContain('Main venue: Sydney&lt;/li&gt;, Australia, Dec 6–12, 2026');
    expect(html).toContain(
      'Satellite: <a href="https://x.example/paris?a=1&amp;b=2">X Paris</a>, Paris, France, Dec 1–4, 2026',
    );
    expect(html).not.toContain('Old');
    expect(html).toContain('Data last updated Oct 29, 2026.');
    expect(html).not.toMatch(/CO₂|CO2/);
  });

  it('escapes data and drops non-http(s) links', () => {
    expect(html).toContain('X&lt;script&gt; 2026 (Conf &quot;&amp;&quot; &#39;quoted&#39;)');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
  });

  it('says so when nothing is upcoming', () => {
    expect(summaryHtml(joinData(file), '2030-01-01')).toContain('No upcoming conferences.');
  });

  it('renders the real data', () => {
    expect(summaryHtml(loadData(), '2026-10-22')).toMatch(/<li><a href="https:\/\//);
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('sitemapXml', () => {
  it('lists the site with the data date', () => {
    expect(sitemapXml('2026-10-29T11:39:38.725Z')).toContain(
      '<url><loc>https://confmaps.org/</loc><lastmod>2026-10-29</lastmod></url>',
    );
  });
});
