import { describe, expect, it, vi } from 'vitest';
import { nominatimGeocoder, pickHit, retryAfterMs, USER_AGENT } from './geocode';

const r = (over: Record<string, unknown>) => ({
  lat: '1',
  lon: '2',
  display_name: 'X',
  addresstype: 'city',
  place_rank: 16,
  address: { country_code: 'it' },
  ...over,
});

describe('pickHit', () => {
  it('prefers a settlement over a county/state centroid ranked first', () => {
    const hit = pickHit(
      [
        r({
          addresstype: 'county',
          place_rank: 12,
          lat: '44.01',
          lon: '10.45',
          display_name: 'Province',
        }),
        r({ addresstype: 'town', lat: '43.84', lon: '10.50', display_name: 'Lucca' }),
      ],
      'it',
    );
    expect(hit).toEqual({ lat: 43.84, lng: 10.5, display_name: 'Lucca' });
  });

  it('accepts a hamlet (e.g. Stanford, CA) and ignores hits in other countries', () => {
    const hit = pickHit(
      [
        r({ addresstype: 'city', address: { country_code: 'fr' }, display_name: 'Elsewhere' }),
        r({ addresstype: 'hamlet', display_name: 'Here' }),
      ],
      'it',
    );
    expect(hit?.display_name).toBe('Here');
    expect(hit?.warning).toBeUndefined();
    expect(pickHit([r({ address: { country_code: 'fr' } })], 'it')).toBeUndefined();
  });

  it('warns when only non-settlement hits exist', () => {
    const hit = pickHit([r({ addresstype: 'neighbourhood', display_name: 'Mai Khao' })], 'it');
    expect(hit?.display_name).toBe('Mai Khao');
    expect(hit?.warning).toMatch(/no settlement among the hits \(neighbourhood\/16\)/);
  });

  it('warns when the settlement is far from the top hit (same name, other place)', () => {
    const hit = pickHit(
      [
        r({ addresstype: 'census', lat: '37.42', lon: '-122.17', display_name: 'Stanford, CA' }),
        r({ addresstype: 'city', lat: '37.53', lon: '-84.66', display_name: 'Stanford, KY' }),
      ],
      'it',
    );
    expect(hit?.display_name).toBe('Stanford, KY');
    expect(hit?.warning).toMatch(/km from the top hit "Stanford, CA"/);
  });
});

describe('retryAfterMs', () => {
  it('parses seconds and HTTP dates', () => {
    expect(retryAfterMs('7', 0)).toBe(7000);
    expect(retryAfterMs(new Date(5000).toUTCString(), 1000)).toBe(4000);
    expect(retryAfterMs(null, 0)).toBeUndefined();
    expect(retryAfterMs('soon', 0)).toBeUndefined();
  });
});

describe('nominatimGeocoder', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const setup = (responses: (Response | Error)[]) => {
    let t = 0;
    const sleeps: number[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      void init;
      const next = responses.shift()!;
      if (next instanceof Error) throw next;
      return next;
    });
    const geocode = nominatimGeocoder({
      fetchImpl: fetchImpl as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
      now: () => t,
    });
    return { geocode, fetchImpl, sleeps };
  };

  it('asks for 5 results with the identifying User-Agent and a timeout', async () => {
    const { geocode, fetchImpl } = setup([ok([r({})])]);
    expect(await geocode('Lucca', 'Italy', 'it')).toEqual({ lat: 1, lng: 2, display_name: 'X' });
    const [url, init] = fetchImpl.mock.calls[0];
    const params = new URL(String(url)).searchParams;
    expect(params.get('limit')).toBe('5');
    expect(params.get('countrycodes')).toBe('it');
    expect(params.get('q')).toBe('Lucca, Italy');
    expect((init?.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps requests ≥ minIntervalMs apart', async () => {
    const { geocode, sleeps } = setup([ok([r({})]), ok([r({})])]);
    await geocode('A', 'Italy', 'it');
    await geocode('B', 'Italy', 'it');
    expect(sleeps).toEqual([1100]);
  });

  it('retries 429 (honouring Retry-After) and 5xx/network errors with backoff', async () => {
    const { geocode, fetchImpl, sleeps } = setup([
      new Response('', { status: 429, headers: { 'Retry-After': '30' } }),
      new Response('', { status: 503 }),
      new TypeError('fetch failed'),
      ok([r({})]),
    ]);
    expect(await geocode('A', 'Italy', 'it')).toMatchObject({ lat: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    // Retry-After 30 s, then 4 s and 8 s backoff (each already ≥ the 1.1 s rate limit).
    expect(sleeps).toEqual([30_000, 4000, 8000]);
  });

  it('gives up after maxAttempts, and does not retry other 4xx', async () => {
    const down = setup(Array.from({ length: 4 }, () => new Response('', { status: 502 })));
    await expect(down.geocode('A', 'Italy', 'it')).rejects.toThrow(/failed 4×: HTTP 502/);
    const bad = setup([new Response('', { status: 400 })]);
    await expect(bad.geocode('A', 'Italy', 'it')).rejects.toThrow(/HTTP 400/);
    expect(bad.fetchImpl).toHaveBeenCalledTimes(1);
  });
});
