# CO₂ estimation methodology

These figures are order-of-magnitude estimates, not measurements. They help you compare venues ("is
Paris roughly 50× less than Sydney?"), not account for your exact trip. The app always presents them
as estimates: rounded to two significant figures, shown with a `~`, and labelled "estimated" or
"roughly".

## Data source

The factors come from **UK DESNZ, _Greenhouse gas reporting: conversion factors 2026_** (published
11 June 2026; the 31 July revision changed none of the values used here):
<https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026>. The
values come from the official flat file and were checked against the full set.
[`data/co2-factors.json`](data/co2-factors.json) records the sheet, cell, flat-file ID and row
labels of each value. The method follows DESNZ's _2026 methodology paper_, cited below as "DESNZ
§x.y". Everything runs in your browser from that static file, and no API is called.

Each mode adds two factors: the direct emissions of the trip, and the well-to-tank (WTT) emissions
of producing the fuel or electricity. Values in kg CO₂e per passenger.km:

| Used for           | DESNZ row (direct and WTT)                      | Direct (RF incl.) | WTT     | Total   |
| ------------------ | ----------------------------------------------- | ----------------- | ------- | ------- |
| Flights < 3,700 km | Flights › Short-haul, to/from UK › Economy › RF | 0.12576           | 0.02249 | 0.14825 |
| Flights ≥ 3,700 km | Flights › Long-haul, to/from UK › Economy › RF  | 0.11704           | 0.02461 | 0.14165 |
| Rail               | Rail › National rail                            | 0.03092           | 0.00897 | 0.03989 |

## Key choices

- **Round trip, one traveller, economy class.** Premium seats take more space, so they carry a
  larger share of the emissions: long-haul business class is about 2.9× economy (DESNZ §8.18–8.20).
- **Non-CO₂ effects of flying included.** Contrails, water vapour and NOx at altitude add warming
  on top of CO₂ (this is called radiative forcing, RF). DESNZ's "With RF" factors multiply the CO₂
  component by 1.7 (DESNZ §8.42–8.43, after Lee et al. 2021). DESNZ recommends including them,
  while noting large scientific uncertainty. Without RF, flight figures would be about a third
  lower.
- **Well-to-tank included.** Extracting, refining and transporting fuel happens because of the
  trip, so leaving it out would undercount every mode. It adds about 18–21% to flights and 29% to
  rail.
- **Nonstop flights along the great circle** (haversine, Earth radius 6,371 km, city centre to city
  centre). DESNZ's flight factors are for direct flights only (DESNZ §8.10). The app shows this
  one-way distance. The [uncertainty range](#uncertainty-range) covers connections.
- **No routing uplift added to flights.** DESNZ's 8% uplift for indirect routes, holding and
  circling is already inside its factors (DESNZ §8.36–8.38), so adding it again would count it
  twice. Check: long-haul economy CO₂ 63.2 g/pkm (DESNZ §8.20) × 1.08 × 1.70 = 0.116 kg, which
  matches the published CO₂ component (0.11604).
- **Short-haul below 3,700 km, long-haul from 3,700 km.** DESNZ now defines haul by geography
  relative to the UK (DESNZ §8.9), which makes no sense for a traveller from Berlin or Tokyo. We use
  the distance rule DESNZ used before, based on the range of a Boeing 737 (DESNZ §8.8). Short
  flights emit more per km because take-off and landing weigh more. We do not use DESNZ's
  "International, to/from non-UK" factor, because it blends short-haul and long-haul into one
  average with no distance dependence (DESNZ §8.10, footnote 24). Its economy value with RF plus
  WTT (0.10916 + 0.01656 = 0.12572) is 11–15% below our totals, so our choice slightly overestimates.
- **Rail distance is great-circle × 1.2 (our assumption).** Tracks rarely follow the great circle,
  and DESNZ publishes no detour factor. Our spot checks of European routes range from about 1.1
  (Amsterdam–Berlin) to 1.4 (London–Paris), and other tools use 1.0 to 1.3.
- **National rail, not International rail (Eurostar).** The Eurostar factor covers one electrified
  line and counts only UK-side electricity consumption, using UK grid intensity (DESNZ §5.66). National rail averages a mixed diesel and electric network
  (DESNZ §5.68), closer to a typical train elsewhere. It avoids exaggerating the benefit of rail.

## Mode selection

- **Auto (default):** rail under the threshold, flight at or above it. The threshold is **1,000
  km** of great-circle distance by default and can be changed in settings.
- **Always fly:** every trip is a flight, for places where rail is not a realistic option.
- **Per-trip toggle:** in a conference's detail panel, you can switch one trip between rail and
  flight. It changes only that figure. Filters always use the global setting.

**Why 1,000 km.** Within Europe, many people take the train for trips up to about 1,000 km
great-circle (about 1,200 km of track): a long day on high-speed lines, or one night on a sleeper.
Paris → Berlin (~880 km) and London → Berlin (~930 km) are examples. Beyond that, most people fly.

## Formulas

```
d       = great-circle distance home → event (km)
rail    = d × 1.2 × 2 × (0.03092 + 0.00897)             kg CO₂e   (= 0.03989)
flight  = d < 3700 ? d × 2 × (0.12576 + 0.02249)        kg CO₂e   (= 0.14825, short-haul)
                   : d × 2 × (0.11704 + 0.02461)        kg CO₂e   (= 0.14165, long-haul)
```

Worked examples (these are the golden tests in `src/lib/co2/model.test.ts`):

| Trip            | Mode                              | d (km) | Estimate                                          |
| --------------- | --------------------------------- | ------ | ------------------------------------------------- |
| Berlin → Paris  | rail (auto, default 1,000 km)     | 877    | 877.46 × 1.2 × 2 × 0.03989 = 84.0 → **~84 kg 🚆** |
| Berlin → Paris  | flight (threshold lowered to 700) | 877    | 877.46 × 2 × 0.14825 = 260.2 → **~260 kg ✈️**     |
| Berlin → Sydney | flight, long-haul                 | 16,094 | 16,094.5 × 2 × 0.14165 = 4,560 → **~4.6 t ✈️**    |
| Paris → London  | rail (auto)                       | 344    | 343.56 × 1.2 × 2 × 0.03989 = 32.9 → **~33 kg 🚆** |
| Paris → London  | flight ("always fly")             | 344    | 343.56 × 2 × 0.14825 = 101.9 → **~100 kg ✈️**     |

From Berlin, Paris by train is therefore roughly 54× less than flying to Sydney. The detail panel
also shows the Berlin → Sydney flight as "~4.6–6.1 t depending on route and method" (4,560 × 1.33 =
6,064 kg; see below).

### Uncertainty range

Under each flight estimate, the detail panel shows a range "depending on route and method". It goes
from the nonstop figure up to 50% more for short-haul flights (under 3,700 km) and 33% more for
long-haul flights. Rail has no range, and the list and the footprint filter use the nonstop figure.
The range is our own judgement, not a published factor, and it does not try to match any one
calculator. It covers two things. It is illustrative: a real itinerary can fall below the nonstop
figure (on very long trips a stop near the midpoint can save fuel, Poll 2011, _The Aeronautical
Journal_ 115:273–283; aircraft type and how full it is often matter more) or above the range.

**Route.** A connection adds a detour through the hub and one more take-off and landing. Through a
well-placed hub, the detour is typically 0–6% (Paris → Singapore → Sydney is 0.4% longer than the
great circle). A badly placed hub adds more (Berlin → New York → Vancouver is 29% longer). One
take-off and landing burns about 770 kg of fuel for an A320 and 2,560 kg for a Boeing 777 (IPCC
2006 Guidelines, Vol. 2, Ch. 3, Table 3.6.9). With 80% of seats filled, that is about 17–29 kg of
CO₂ per passenger for each extra stop (our arithmetic). On US domestic routes, nonstop flights used
about 10% less fuel than connections (Jamin et al. 2004, _Transportation Research Part D_
9:295–317, cited by Baumeister 2017, same journal, 57:1–9). The extra take-off and landing weighs
more on a short trip, so the short-haul range is wider.

**Method.** Calculators count the non-CO₂ effects of flying differently, and this causes most of
the disagreement between them. DESNZ, and therefore this app, multiplies the CO₂ component by 1.7.
[myclimate](https://www.myclimate.org/en/information/about-myclimate/downloads/flight-emission-calculator/)
multiplies total aircraft CO₂ by 3 (up from 2 in November 2023), and also counts upstream fuel,
aircraft production and maintenance, and airport infrastructure.
[atmosfair](https://www.atmosfair.de/en/faqs/on_co2_calculation/) multiplies the CO₂ emitted above
9 km by 3. Google's [Travel Impact Model](https://support.google.com/travel/answer/11116147) reports
well-to-wake CO₂ and shows the contrail impact separately, not as a multiplier.

For example, Paris → Sydney is about 16,960 km great-circle. This app estimates ~4.8 t nonstop, with
a range of ~4.8–6.4 t. myclimate gives about 6.8 t via Singapore (round trip, economy), about 40%
more. The Singapore stop adds little. With our factors, a multiplier of 3 instead of 1.7 would on
its own add about 60% to a long-haul figure, so the larger multiplier can explain most of the
difference. The horizons also differ: myclimate justifies its factor of 3 with a 30-year horizon,
while DESNZ's 1.7 follows the 100-year Global Warming Potential (DESNZ §8.40, §8.42). Other tools
can therefore land outside our range, and that is expected.

## Assumptions and limitations

- **Great-circle, city to city, nonstop.** Real routes are longer, and many trips need a connection
  (see [Uncertainty range](#uncertainty-range)).
- **Travel only.** Accommodation, food, the venue and local transport to airports or stations are
  not counted. Online attendance is ~0 kg: streaming, data-centre and device emissions are not
  counted.
- **Train availability is not checked.** Auto mode assumes a train exists for any trip under the
  threshold, even across seas. Use "Always fly" or the per-trip toggle where that is wrong.
- **British averages.** Aircraft, load factors and fleets are those of UK airlines in 2023 (DESNZ
  §8.7), and the rail factor averages British trains. Other airlines and countries differ.
- **Very short flights are probably underestimated.** DESNZ's higher domestic factor covers UK
  flights only, so we don't use it. In auto mode, such trips are rail.
- **RF is uncertain.** The 1.7 multiplier is a simplified estimate applied equally to all flights
  (DESNZ §8.43–8.44).

## How to cross-check

Use an independent calculator such as [myclimate](https://co2.myclimate.org/en/flight_calculators/new)
for flights. The app links to it from each flight estimate. Expect a different figure, for the
reasons in [Uncertainty range](#uncertainty-range). Differences of up to about 2× are common. A
factor of 10 means something is wrong, so please report it.

## Update procedure (yearly)

DESNZ publishes new factors each June. The next set is due in June 2027.

1. On the gov.uk collection page, open the new "Greenhouse gas reporting: conversion factors
   <year>" publication. Download the **flat file**, the **full set** and the **methodology paper**.
2. For each entry in `data/co2-factors.json`, find the same row (same labels; the flat-file ID
   usually changes only its row number). Update `value`, `row`, `cell` and the `source` block (year,
   URLs, retrieval date). Note any change history from the publication page.
3. Read the "major changes" report and the air and rail sections of the methodology paper. Check
   that the 8% uplift is still inside the factors, that RF is still a separate column, that the WTT
   air "With RF" and "Without RF" values are still identical (we record the "With RF" rows), and
   that the haul and rail definitions are unchanged. Update this document if any of these changed.
4. Run `pnpm test`. `src/lib/co2/factors.test.ts` **will fail on purpose**. Update its frozen
   table, recompute the golden values in `src/lib/co2/model.test.ts` by hand (keep the arithmetic in
   the comments) and update the worked examples above.
5. Commit with the DESNZ year in the message, so the diff of `data/co2-factors.json` serves as the
   audit trail.
