// Canonical country names and ISO 3166-1 alpha-2 codes. The code restricts Nominatim to the right
// country (no Vienna→Virginia) and is checked against the result. Upstream sometimes puts a US
// state or a region in `country`; ALIASES maps those to the country. An unknown name fails the
// build: add it here.

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

const BY_LOWER = new Map(Object.keys(COUNTRIES).map((name) => [name.toLowerCase(), name]));

/** Canonical country name, or `undefined` if unknown. */
export function canonicalCountry(raw: string): string | undefined {
  const key = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  return BY_LOWER.get(key) ?? ALIASES[key];
}

/** ISO 3166-1 alpha-2 (lowercase) of a canonical country name. */
export function countryCode(canonical: string): string | undefined {
  return COUNTRIES[canonical];
}
