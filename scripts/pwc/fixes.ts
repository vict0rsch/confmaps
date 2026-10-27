// Hand-maintained corrections for the PwC import. Keys are PwC
// ids; every entry says why. Applied fixes are listed in the entry's `pwc.fixes` and flagged for
// review.
import type { Place } from './place';

/** Replaces the PwC place (any format; country is canonicalized). */
export type PlaceFix = Place & { reason: string };

/** Field corrections, applied before the year check and dedupe. */
export interface FieldFix {
  year?: number;
  start?: string;
  end?: string;
  full_name?: string;
  link?: string;
  /** Accept a `year` that differs from the start's year (an edition postponed into the next). */
  keepYear?: true;
  reason: string;
}

/** Title noise (after HTML tags are stripped) → title. Historical names stay (series aliases). */
export const TITLE_FIXES: Record<string, string> = {
  WWWW: 'WWW',
  ICDM2021: 'ICDM',
  MM: 'ACM MM',
  LOG: 'LoG',
};

/** PwC ids left out of the import. */
export const EXCLUDE: Record<string, string> = {
  cal19: 'fictional conference (CAL 2019, "Schiaparelli, Mars")',
  aaaisss24cfm: 'AAAI 2024 Spring Symposium, not a main conference',
  aia24: 'AAAI 2024 Spring Symposium, not a main conference',
  neurips24DBT: 'NeurIPS 2024 Datasets and Benchmarks track, not a separate conference',
  wacv25_2: 'duplicate of wacv25',
  AI4science22: 'AI for Science NASSMA workshop, not a main conference (and no http(s) link)',
  kil24: 'KDD 2024 workshop (Knowledge-infused Learning), not a main conference',
  // Excluded after the review-flag research (sources in the backfill PR).
  lrec20: 'LREC 2020 (Marseille) was cancelled; only the proceedings were published',
  aes2018: 'AES Convention: audio engineering trade/professional event, outside AI/CS scope',
  aes2019:
    'AES conference on immersive and interactive audio: audio engineering, outside AI/CS scope',
  aiworldbarcelona23: 'AI World Barcelona: industry/business event, not a scholarly conference',
  aabi24: 'AABI 2024: one-day symposium co-located with ICML, not a main conference',
  wmt20: 'WMT 2020: satellite of EMNLP 2020 (co-located; not a main conference)',
};

const PWC_VENUE = 'PwC gives the venue in place of the city';
const NO_COUNTRY = 'PwC gives no country';
const NO_CITY = 'PwC gives only the state';

export const PLACE_FIXES: Record<string, PlaceFix> = {
  'automl-conf23': {
    format: 'in_person',
    city: 'Potsdam',
    country: 'Germany',
    venue: 'Hasso Plattner Institute',
    reason:
      '"Potsdam/Berlin": held at the Hasso Plattner Institute, Potsdam, per PMLR v224 and dblp',
  },
  bmvc2018: {
    format: 'in_person',
    city: 'Newcastle upon Tyne',
    country: 'United Kingdom',
    reason: NO_COUNTRY,
  },
  bmvc22: { format: 'in_person', city: 'London', country: 'United Kingdom', reason: NO_COUNTRY },
  siggraph22: { format: 'in_person', city: 'Vancouver', country: 'Canada', reason: NO_COUNTRY },
  chi24: { format: 'in_person', city: 'Honolulu', country: 'United States', reason: NO_CITY },
  icml23: { format: 'in_person', city: 'Honolulu', country: 'United States', reason: NO_CITY },
  www23: {
    format: 'in_person',
    city: 'Austin',
    country: 'United States',
    reason: `${NO_CITY}; WWW '23 was in Austin, Texas`,
  },
  icml22: {
    format: 'in_person',
    city: 'Baltimore',
    country: 'United States',
    reason: '"Maryland USA" lacks a comma',
  },
  icwsm22: {
    format: 'hybrid',
    city: 'Atlanta',
    country: 'United States',
    reason: '"Georgia" is the US state here, not the country',
  },
  ijcai23: {
    format: 'in_person',
    city: 'Macao',
    country: 'China',
    reason: '"S.A.R." is not a country; spelled as in the geocache, macao|china',
  },
  colt17: {
    format: 'in_person',
    city: 'Amsterdam',
    country: 'Netherlands',
    venue: 'University of Amsterdam',
    reason: PWC_VENUE,
  },
  fsr2017: {
    format: 'in_person',
    city: 'Zurich',
    country: 'Switzerland',
    venue: 'ETH Zurich',
    reason: PWC_VENUE,
  },
  icaps22: {
    format: 'in_person',
    city: 'Singapore',
    country: 'Singapore',
    venue: 'Singapore Management University',
    reason: PWC_VENUE,
  },
  l4dc22: {
    format: 'in_person',
    city: 'Stanford',
    country: 'United States',
    venue: 'Stanford University',
    reason: PWC_VENUE,
  },
  icra23: {
    format: 'in_person',
    city: 'London',
    country: 'United Kingdom',
    venue: 'ExCeL London',
    reason: PWC_VENUE,
  },
  nips17: {
    format: 'in_person',
    city: 'Long Beach',
    country: 'United States',
    venue: 'Long Beach Convention Center',
    reason: PWC_VENUE,
  },
  neurips19: {
    format: 'in_person',
    city: 'Vancouver',
    country: 'Canada',
    venue: 'Vancouver Convention Centre',
    reason: PWC_VENUE,
  },
  neurips20: {
    format: 'in_person',
    city: 'Vancouver',
    country: 'Canada',
    venue: 'Vancouver Convention Centre',
    reason: `${PWC_VENUE}; the planned place, see the covid flag`,
  },
  rss20: {
    format: 'in_person',
    city: 'Corvallis',
    country: 'United States',
    venue: 'Oregon State University',
    reason: `${PWC_VENUE}; the planned place, see the covid flag`,
  },
  uai21: {
    format: 'virtual',
    reason: 'PwC place is "TBD"; UAI 2021 was held online, per auai.org/uai2021',
  },
};

export const FIELD_FIXES: Record<string, FieldFix> = {
  cvpr23: {
    start: '2023-06-17',
    end: '2023-06-23',
    reason: 'start/end say 2022; the PwC date text says June 17-23, 2023',
  },
  www23: {
    start: '2023-04-30',
    end: '2023-05-04',
    reason: "start/end and date text say 2022; WWW '23 ran April 30 - May 4, 2023",
  },
  eccv20: {
    start: '2020-08-23',
    end: '2020-08-28',
    reason: 'the date text says 2022; eccv2020, the same edition, says August 23-28, 2020',
  },
  slt2018: {
    start: '2018-12-18',
    end: '2018-12-21',
    reason: 'the date text says 2019; SLT 2018 ran December 18-21, 2018',
  },
  icra21: {
    year: 2021,
    reason: 'year says 2020, but the dates and place are those of ICRA 2021',
  },
  icpr20: {
    keepYear: true,
    reason: 'ICPR 2020 was postponed to January 2021; it stays the 2020 edition',
  },
  interspeech23: {
    start: '2023-08-20',
    end: '2023-08-24',
    reason:
      'start/end say August 30 - September 3; Interspeech 2023 ran August 20-24, as the date text says',
  },
  satml24: {
    start: '2024-04-09',
    end: '2024-04-11',
    reason: 'start/end are a placeholder for "April 2024"; SaTML 2024 ran April 9-11, per dblp',
  },
  aistats17: {
    link: 'https://www.aistats.org/aistats2017/',
    reason: 'the PwC link is the AAAI-17 page',
  },
  chi24: {
    full_name: 'ACM CHI Conference on Human Factors in Computing Systems',
    reason: 'the PwC full name is the AAAI one',
  },
};
