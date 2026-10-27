// PwC `place` → format/city/country/venue/notes. Deterministic: a
// string the rules do not cover is unresolved and needs a PLACE_FIXES / EXCLUDE entry (fixes.ts).
import { canonicalCountry } from '../lib/countries';
import type { PastConference } from '../schema';

export interface Place {
  format: PastConference['format'];
  city?: string;
  country?: string;
  venue?: string;
  notes?: string;
}
export type PlaceResult = { place: Place } | { unresolved: string };

/** Lowercase, no diacritics, apostrophes or dots, single spaces (`Hawai'i` → `hawaii`). */
const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'.]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const US = 'United States';
const US_STATES: Record<string, string> = {
  alabama: 'al',
  alaska: 'ak',
  arizona: 'az',
  arkansas: 'ar',
  california: 'ca',
  colorado: 'co',
  connecticut: 'ct',
  delaware: 'de',
  florida: 'fl',
  georgia: 'ga',
  hawaii: 'hi',
  idaho: 'id',
  illinois: 'il',
  indiana: 'in',
  iowa: 'ia',
  kansas: 'ks',
  kentucky: 'ky',
  louisiana: 'la',
  maine: 'me',
  maryland: 'md',
  massachusetts: 'ma',
  michigan: 'mi',
  minnesota: 'mn',
  mississippi: 'ms',
  missouri: 'mo',
  montana: 'mt',
  nebraska: 'ne',
  nevada: 'nv',
  'new hampshire': 'nh',
  'new jersey': 'nj',
  'new mexico': 'nm',
  'new york': 'ny',
  'north carolina': 'nc',
  'north dakota': 'nd',
  ohio: 'oh',
  oklahoma: 'ok',
  oregon: 'or',
  pennsylvania: 'pa',
  'rhode island': 'ri',
  'south carolina': 'sc',
  'south dakota': 'sd',
  tennessee: 'tn',
  texas: 'tx',
  utah: 'ut',
  vermont: 'vt',
  virginia: 'va',
  washington: 'wa',
  'west virginia': 'wv',
  wisconsin: 'wi',
  wyoming: 'wy',
  'district of columbia': 'dc',
};

/** Region (normalized) → its canonical country. US states also by their postal code. */
export const REGIONS: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(US_STATES).flatMap(([s, code]) => [
      [s, US],
      [code, US],
    ]),
  ),
  lousiana: US, // typo seen in PwC
  alberta: 'Canada',
  ontario: 'Canada',
  'nova scotia': 'Canada',
  quebec: 'Canada',
  queensland: 'Australia',
  'western australia': 'Australia',
  'basque country': 'Spain',
  sicily: 'Italy',
  tuscany: 'Italy',
  okinawa: 'Japan',
};

/** Country spellings `canonicalCountry` does not know (normalized → name it does). */
export const COUNTRY_ALIASES: Record<string, string> = {
  eeuu: US,
  us: US, // `U.S.`
  macedonia: 'North Macedonia',
  scotland: 'United Kingdom',
  wales: 'United Kingdom',
  england: 'United Kingdom',
};

/** City spellings → the ones already used in data/geocache.json (normalized → city). */
export const CITY_ALIASES: Record<string, string> = {
  'new york city': 'New York',
  milano: 'Milan',
  torino: 'Turin',
  bangaluru: 'Bangalore',
  'santiago de compostella': 'Santiago de Compostela',
  'jeju island': 'Jeju',
  'rhodes island': 'Rhodes',
  luebeck: 'Lübeck',
  'washington dc': 'Washington DC',
  'waikoloa village': 'Waikoloa',
  macau: 'Macao', // geocache: macao|china
};

/** A single-token place that is both the city and the country. */
const CITY_STATES = new Set(['Singapore', 'Hong Kong', 'Macao', 'Luxembourg']);
/** Cities named like a region: a lone `New York` is the city. */
const CITIES_NAMED_LIKE_REGIONS = new Set(['new york']);
const VENUE_LIKE = /University|Cent(?:er|re)|Convention|Hotel|ExCeL|\bETH\b/;

const countryOf = (token: string): string | undefined => {
  const alias = COUNTRY_ALIASES[norm(token)];
  return canonicalCountry(token) ?? (alias && canonicalCountry(alias));
};
const regionOf = (token: string): string | undefined => REGIONS[norm(token)];

export function parsePlace(raw: string): PlaceResult {
  const fail = (reason: string): PlaceResult => ({ unresolved: reason });
  let s = raw.trim().replace(/\s+/g, ' ');

  // 1. Virtual.
  const nominal = /^online\s*\((.+)\)$/i.exec(s);
  if (nominal)
    return {
      place: { format: 'virtual', notes: `Held online (nominal host: ${nominal[1].trim()}).` },
    };
  if (/^(online|virtual)\b/i.test(s) || /^virtual conference$/i.test(s))
    return { place: { format: 'virtual' } };

  // 2. Hybrid: the physical place is the prefix (or the parenthesized part).
  let format: Place['format'] = 'in_person';
  const hybrid =
    /^hybrid\s*\((.+)\)$/i.exec(s) ?? /^(.*?)[;,]?\s*(?:and|&)\s+(?:virtual|online)\s*$/i.exec(s);
  if (hybrid) [format, s] = ['hybrid', hybrid[1].trim()];

  // 3. No place yet.
  if (/^(tbd|tba)?$/i.test(s)) return fail(`no place ("${raw}")`);

  // 4–5. `X (Y)` → `X, Y`; comma tokens.
  const tokens = s
    .replace(/\s*\(([^()]+)\)/g, ', $1')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  // 6. Country: the last token (a country, or a region standing for its country).
  const last = tokens[tokens.length - 1];
  const asCountry = countryOf(last);
  const asRegion = regionOf(last);
  if (asCountry && asRegion && asCountry !== asRegion)
    return fail(`"${last}" is both a country and a region of ${asRegion}`);
  const country = asCountry ?? asRegion;
  if (!country) return fail(`unknown country "${last}"`);
  tokens.pop();
  if (tokens.length === 0) {
    if (CITY_STATES.has(country)) return { place: { format, city: country, country } };
    return fail(`no city in "${raw}"`);
  }

  // 7. Strip region tokens (or other names of the country) between city and country.
  const stripped: string[] = [];
  const sameCountry = (t: string) => regionOf(t) === country || countryOf(t) === country;
  while (tokens.length > 1 && sameCountry(tokens[tokens.length - 1])) stripped.push(tokens.pop()!);

  // 8. City = last remaining token; earlier ones are the venue.
  let city = tokens.pop()!;
  const venue = tokens.length ? tokens.join(', ') : undefined;
  if (VENUE_LIKE.test(city)) return fail(`city "${city}" looks like a venue`);
  if (city.includes('/')) return fail(`several cities in "${city}"`);
  if (norm(city) === 'washington' && stripped.some((t) => norm(t) === 'dc')) city = 'Washington DC';
  else if (regionOf(city) && !CITIES_NAMED_LIKE_REGIONS.has(norm(city)))
    return fail(`"${city}" is a region, not a city`);

  // 9. Spellings already in the geocache.
  city = CITY_ALIASES[norm(city)] ?? city;
  return { place: { format, city, country, ...(venue && { venue }) } };
}
