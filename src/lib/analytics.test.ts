import { describe, expect, it } from 'vitest';
import { createAnalytics, type AnalyticsEnv } from './analytics';

const ID = '0f1e2d3c-4b5a-4968-8778-a6b5c4d3e2f1';

function setup(over: Partial<AnalyticsEnv> = {}) {
  const sent: string[] = [];
  const a = createAnalytics({
    websiteId: ID,
    hostname: 'confmaps.org',
    origin: 'https://confmaps.org',
    referrer: '',
    doNotTrack: null,
    globalPrivacyControl: undefined,
    send: (u) => sent.push(u),
    ...over,
  });
  return { a, sent, payloads: () => sent.map((b) => JSON.parse(b).payload) };
}

describe('analytics', () => {
  it('is a no-op without a website id', () => {
    for (const websiteId of [undefined, '', '  ']) {
      const { a, sent } = setup({ websiteId });
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

  it('rejects a malformed website id', () => {
    const { a, sent } = setup({ websiteId: 'evil.com/x?' });
    a.pageView();
    expect(sent).toEqual([]);
  });

  it('sends the page view with url / only and the referrer origin', () => {
    const { a, sent } = setup({ referrer: 'https://news.example.org/a/b?q=secret#frag' });
    a.pageView();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toEqual({
      type: 'event',
      payload: {
        website: ID,
        hostname: 'confmaps.org',
        url: '/',
        referrer: 'https://news.example.org',
      },
    });
  });

  it('omits an own-origin or invalid referrer', () => {
    for (const referrer of ['https://confmaps.org/?home=paris', 'nonsense']) {
      const { a, payloads } = setup({ referrer });
      a.pageView();
      expect(payloads()[0]).not.toHaveProperty('referrer');
    }
  });

  it('sends events with the name and nothing else', () => {
    const { a, payloads } = setup();
    a.track('filter_used:continent');
    expect(payloads()).toEqual([
      { website: ID, hostname: 'confmaps.org', url: '/', name: 'filter_used:continent' },
    ]);
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
