import { describe, expect, it } from 'vitest';
import { createAnalytics, type AnalyticsEnv } from './analytics';

function setup(over: Partial<AnalyticsEnv> = {}) {
  const sent: string[] = [];
  const a = createAnalytics({
    code: 'confmaps',
    hostname: 'confmaps.org',
    origin: 'https://confmaps.org',
    referrer: '',
    doNotTrack: null,
    globalPrivacyControl: undefined,
    send: (u) => sent.push(u),
    ...over,
  });
  return { a, sent };
}

describe('analytics', () => {
  it('is a no-op without a site code', () => {
    for (const code of [undefined, '', '  ']) {
      const { a, sent } = setup({ code });
      a.pageView();
      a.track('play_pressed');
      expect(sent).toEqual([]);
    }
  });

  it('is a no-op with Do Not Track, GPC or on localhost', () => {
    for (const over of [
      { doNotTrack: '1' },
      { globalPrivacyControl: true },
      { hostname: 'localhost' },
      { hostname: '127.0.0.1' },
    ]) {
      const { a, sent } = setup(over);
      a.pageView();
      a.track('play_pressed');
      expect(sent).toEqual([]);
    }
  });

  it('rejects a malformed site code', () => {
    const { a, sent } = setup({ code: 'evil.com/x?' });
    a.pageView();
    expect(sent).toEqual([]);
  });

  it('sends the page view with path / only and no query or hash', () => {
    const { a, sent } = setup({ referrer: 'https://news.example.org/a/b?q=secret#frag' });
    a.pageView();
    expect(sent).toHaveLength(1);
    const url = new URL(sent[0]!);
    expect(url.origin).toBe('https://confmaps.goatcounter.com');
    expect(url.pathname).toBe('/count');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      p: '/',
      r: 'https://news.example.org',
    });
  });

  it('omits an own-origin or invalid referrer', () => {
    for (const referrer of ['https://confmaps.org/?home=paris', 'nonsense']) {
      const { a, sent } = setup({ referrer });
      a.pageView();
      expect([...new URL(sent[0]!).searchParams.keys()]).toEqual(['p']);
    }
  });

  it('sends events as e=true with the name as path and nothing else', () => {
    const { a, sent } = setup();
    a.track('filter_used:continent');
    const params = Object.fromEntries(new URL(sent[0]!).searchParams);
    expect(params).toEqual({ p: 'filter_used:continent', e: 'true' });
  });

  it('sends each event name at most once per page load', () => {
    const { a, sent } = setup();
    a.pageView();
    a.pageView();
    a.track('play_pressed');
    a.track('play_pressed');
    a.track('filter_used:a');
    a.track('filter_used:b');
    expect(sent).toHaveLength(4);
  });
});
