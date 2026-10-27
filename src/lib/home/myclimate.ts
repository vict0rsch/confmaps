// Cross-check link (DESIGN §4.3).
//
// Finding (checked Oct 2026): myclimate's flight calculator form is a POST with a CSRF token, but
// `/en/flight_calculators/new?from=BER&to=SYD` does prefill the two fields. They only accept
// airport names or IATA codes ("Paris" and "Sydney" are rejected with "Could not find airport"),
// and we have no airport data (the city list has no IATA codes). So the link is plain unless the
// caller supplies IATA codes, which nothing does yet.

export const MYCLIMATE_URL = 'https://co2.myclimate.org/en/flight_calculators/new';

const IATA = /^[A-Z]{3}$/;

/** The calculator URL, prefilled when both IATA airport codes are given and valid. */
export function myclimateUrl(from?: string, to?: string): string {
  if (!from || !to || !IATA.test(from) || !IATA.test(to)) return MYCLIMATE_URL;
  const q = new URLSearchParams({ from, to });
  return `${MYCLIMATE_URL}?${q}`;
}
