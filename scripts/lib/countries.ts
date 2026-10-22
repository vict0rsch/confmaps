// Canonical country names and ISO 3166-1 alpha-2 codes. The code restricts Nominatim to the right
// country (no Vienna→Virginia) and is checked against the result. Upstream sometimes puts a US
// state or a region in `country`; ALIASES maps those to the country.
//
// COUNTRIES pins the canonical names already in use (they appear in geocache keys and data.json,
// so they must not drift). Any other country is recognized through Intl.DisplayNames over every
// ISO 3166-1 code (English long/short names, e.g. "Czechia", "Türkiye", "Kenya"), so a new host
// country does not halt the sync. A name that matches nothing still fails the build: add an alias.

const COUNTRIES: Record<string, string> = {
  Argentina: 'ar',
  Armenia: 'am',
  Australia: 'au',
  Austria: 'at',
  Belgium: 'be',
  Brazil: 'br',
  Canada: 'ca',
  Chile: 'cl',
  China: 'cn',
  Colombia: 'co',
  Croatia: 'hr',
  Cyprus: 'cy',
  'Czech Republic': 'cz',
  Denmark: 'dk',
  Egypt: 'eg',
  Estonia: 'ee',
  Finland: 'fi',
  France: 'fr',
  Germany: 'de',
  Greece: 'gr',
  'Hong Kong': 'cn', // Nominatim files Hong Kong and Macao under cn
  Hungary: 'hu',
  Iceland: 'is',
  India: 'in',
  Indonesia: 'id',
  Ireland: 'ie',
  Israel: 'il',
  Italy: 'it',
  Japan: 'jp',
  Lithuania: 'lt',
  Luxembourg: 'lu',
  Macao: 'cn',
  Malaysia: 'my',
  Mexico: 'mx',
  Morocco: 'ma',
  Netherlands: 'nl',
  'New Zealand': 'nz',
  Norway: 'no',
  Poland: 'pl',
  Portugal: 'pt',
  Qatar: 'qa',
  Romania: 'ro',
  Russia: 'ru',
  Singapore: 'sg',
  Slovenia: 'si',
  'South Africa': 'za',
  'South Korea': 'kr',
  Spain: 'es',
  Sweden: 'se',
  Switzerland: 'ch',
  Taiwan: 'tw',
  Thailand: 'th',
  Turkey: 'tr',
  'United Arab Emirates': 'ae',
  'United Kingdom': 'gb',
  'United States': 'us',
  Vietnam: 'vn',
};

const ALIASES: Record<string, string> = {
  usa: 'United States',
  us: 'United States',
  'united states of america': 'United States',
  uk: 'United Kingdom',
  'great britain': 'United Kingdom',
  'the netherlands': 'Netherlands',
  korea: 'South Korea',
  'republic of korea': 'South Korea',
  uae: 'United Arab Emirates',
  czechia: 'Czech Republic',
  macau: 'Macao',
  // US states / regions seen in upstream `country`
  hawaii: 'United States',
  'new mexico': 'United States',
  pennsylvania: 'United States',
  tennessee: 'United States',
  // Italian region seen upstream
  tuscany: 'Italy',
};

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

// Regions Intl names that are not countries.
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'QO', 'UN', 'XA', 'XB', 'ZZ']);

/** Every ISO 3166-1 alpha-2 code Intl knows → its English long and short names. */
function intlCountries(): { code: string; names: string[] }[] {
  const long = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  const short = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none', style: 'short' });
  const out: { code: string; names: string[] }[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (NOT_COUNTRIES.has(code)) continue;
      const name = long.of(code);
      // Skip deprecated codes (DD, SU, UK, …): they canonicalize to another code.
      if (!name || new Intl.Locale(`und-${code}`).region !== code) continue;
      out.push({ code: code.toLowerCase(), names: [name, short.of(code) ?? name] });
    }
  }
  return out;
}

/** normalized name → canonical name; canonical name → Nominatim country code. */
const BY_NAME = new Map<string, string>();
const CODES = new Map<string, string>(Object.entries(COUNTRIES));
{
  // Intl codes whose canonical name is pinned in COUNTRIES (Hong Kong/Macao keep their own ISO
  // code here even though Nominatim files them under cn).
  const pinned = new Map<string, string>([
    ['hk', 'Hong Kong'],
    ['mo', 'Macao'],
  ]);
  for (const [name, code] of Object.entries(COUNTRIES)) {
    if (![...pinned.values()].includes(name)) pinned.set(code, name);
  }
  for (const { code, names } of intlCountries()) {
    const canonical = pinned.get(code) ?? names[0];
    if (!CODES.has(canonical)) CODES.set(canonical, code);
    for (const n of names) if (!BY_NAME.has(norm(n))) BY_NAME.set(norm(n), canonical);
  }
  for (const name of Object.keys(COUNTRIES)) BY_NAME.set(norm(name), name);
  for (const [alias, name] of Object.entries(ALIASES)) BY_NAME.set(norm(alias), name);
}

/** Canonical country name, or `undefined` if unknown. */
export function canonicalCountry(raw: string): string | undefined {
  const key = norm(raw);
  return BY_NAME.get(key) ?? BY_NAME.get(key.replace(/^the /, ''));
}

/** ISO 3166-1 alpha-2 (lowercase) of a canonical country name, as Nominatim files it. */
export function countryCode(canonical: string): string | undefined {
  return CODES.get(canonical);
}
