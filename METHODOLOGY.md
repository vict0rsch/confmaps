# CO₂ estimation methodology

These are order-of-magnitude estimates, not measurements. They help compare locations ("is
Paris roughly 50× less than Sydney?"), not account for your exact trip. Every figure is
rounded to two significant figures and shown with a `~`.

## Data source

- **UK DESNZ, _Greenhouse gas reporting: conversion factors 2026_** (published 11 June 2026,
  flat file revised 31 July 2026; the revision only touched WTT car and hotel factors, none of
  the values used here).
  <https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026>
- Values were taken from the official flat file (sheet _Factors by Category_, column _GHG
  Conversion Factor 2026_) and checked against the full set. The sheet, cell, flat-file ID and
  row labels of every value are recorded in [`data/co2-factors.json`](data/co2-factors.json).
- The method follows the accompanying _2026 methodology paper_ (cited below as "DESNZ §x.y").
- Everything runs in your browser from that static file. No API is called.

| Used for           | DESNZ row (sheet _Business travel- air_ / _- land_)        | kg CO₂e per passenger.km |
| ------------------ | ---------------------------------------------------------- | ------------------------ |
| Flights < 3,700 km | Flights › Short-haul, to/from UK › Economy class › With RF | 0.12576                  |
| Flights ≥ 3,700 km | Flights › Long-haul, to/from UK › Economy class › With RF  | 0.11704                  |
| Rail               | Rail › National rail                                       | 0.03092                  |

The file also keeps a few rows for reference that the model does not use: the without-RF
versions of the flight factors, _International, to/from non-UK_ (economy), _Domestic, to/from
UK_ (average passenger) and _International rail_ (Eurostar).

## What's included

- **Round trip.** Every figure is home → event → home, for one traveller.
- **Economy class.** Premium seats take more space per passenger, so they carry a larger share
  of the emissions (DESNZ §8.18–8.20). Business class long-haul is about 2.9× economy.
- **Radiative forcing (RF) included.** Aviation's non-CO₂ effects (contrails, water vapour,
  NOx) are counted with DESNZ's "With RF" factors, which apply a 70% uplift to the CO₂
  component (a 1.7 multiplier, DESNZ §8.42–8.43, after Lee et al. 2021). DESNZ recommends
  including these effects to capture the full climate impact of air travel, while noting large
  scientific uncertainty about their size (DESNZ §8.39–8.44 and the _Business travel- air_ sheet
  guidance). Without RF, flight figures would be about 40% lower.
- **Direct emissions only.** The _Business travel_ factors cover fuel burnt or electricity
  used. Well-to-tank (fuel production) emissions are a separate DESNZ table and are not added
  (see limitations).

## Mode selection

- **Auto (default):** rail if the great-circle distance is under the threshold, flight
  otherwise. The threshold defaults to **700 km** and can be changed in settings. A trip exactly
  at the threshold counts as a flight.
- **Always fly:** every trip is a flight. This is useful where rail is not a realistic option.
- **Per-trip toggle:** in a conference's detail panel you can switch one trip between rail and
  flight. It changes only that figure. Filters always use the global setting.

With the default 700 km threshold, Berlin → Paris (~880 km) counts as a flight. Raise the
threshold to about 1,000 km to compare it by train.

## Distances and uplifts

- **Distance:** great-circle (haversine, mean Earth radius 6,371 km) between city centres. The
  distance shown in the app is this one-way great-circle figure.
- **Haul band (flights):** DESNZ defines short-haul and long-haul by geography relative to the
  UK (Europe and North Africa are short-haul, everything else long-haul; DESNZ §8.9). That
  makes no sense for a traveller starting in Berlin or Tokyo, so we use the distance rule that
  DESNZ itself used before: **< 3,700 km → short-haul, ≥ 3,700 km → long-haul**, based on the
  maximum range of a Boeing 737 (DESNZ §8.8). It also fits DESNZ's own example distances, which
  run up to 3,300 km for short-haul and start at 5,500 km for long-haul (illustrative distances
  table under DESNZ §8.9).
  Short flights emit more per km (take-off and landing weigh more), and banding by distance
  keeps that difference. At 3,700 km the figure drops by about 7% because the factor changes.
- **Why not "International, to/from non-UK"?** DESNZ offers this factor for flights between
  two non-UK airports (DESNZ §8.10), so it might seem to fit most of our users. But it blends
  short-haul and long-haul flights into one average (DESNZ footnote 24), with no distance
  dependence. Its economy value with RF (0.10916) is 7–13% below the two banded factors we use,
  so our choice slightly overestimates, which is negligible at order-of-magnitude precision.
  The value is kept in the data file for comparison.
- **Domestic band not used.** DESNZ's domestic factor (0.22928, average passenger) covers
  flights within the UK only, and DESNZ gives no distance threshold for it. Very short flights
  (a few hundred km) are therefore probably underestimated. In auto mode such trips are rail.
- **Flight routing uplift: none added.** DESNZ recommends adding 8% to great-circle distances
  for indirect routing, holding and circling, and that 8% is **already built into the
  published factors** (DESNZ §8.36–8.38; the _Business travel- air_ sheet FAQ says "All the
  factors include the distance uplift of 8%"). Multiplying great-circle distance directly by
  the factor applies the uplift exactly once. Check: long-haul economy CO₂ 63.2 g/pkm
  (seating-class table under DESNZ §8.20) × 1.08 × 1.70 = 0.116 kg, matching the published CO₂ component (0.11604).
- **Rail detour factor: × 1.2 (our assumption).** Tracks rarely follow the great circle, and
  DESNZ publishes no detour factor because its rail factors are meant for actual distances. We
  multiply the great-circle distance by **1.2** for rail. This is our own estimate, based on
  approximate spot checks of European intercity routes (for example London–Paris by Eurostar is
  about 490 km of track for 344 km great-circle, a ratio of about 1.4; Amsterdam–Berlin is
  closer to 1.1). Other tools range from 1.0 (a GLEC-based freight tool applies no rail
  adjustment) to about 1.3 (proposed for the IRAP travel-footprint tool). Changing it moves rail figures proportionally. Rail stays an order of
  magnitude below flying either way.
- **Rail factor: National rail, not International rail (Eurostar).** The Eurostar factor
  (0.01135) covers one electrified high-speed line, counting UK-side electricity only and using
  UK grid intensity (DESNZ §5.66). The National rail factor (0.03092) averages a mixed diesel
  and electric network (DESNZ §5.68), which is closer to a "typical train" on a continental or
  intercontinental trip. Many grids are more carbon-intensive than the UK's and many routes
  are not electrified. It is the cautious choice: it avoids understating rail, which would
  exaggerate how much better the train is.

### Formulas

```
d       = great-circle distance home → event (km)
rail    = d × 1.2 × 2 × 0.03092                         kg CO₂e
flight  = d × 2 × (d < 3700 ? 0.12576 : 0.11704)        kg CO₂e
```

Worked examples (these are the golden tests in `src/lib/co2/model.test.ts`):

| Trip            | Mode                                | d (km) | Estimate                                          |
| --------------- | ----------------------------------- | ------ | ------------------------------------------------- |
| Berlin → Paris  | rail (threshold raised to 1,000 km) | 877    | 877.46 × 1.2 × 2 × 0.03092 = 65.1 → **~65 kg 🚆** |
| Berlin → Paris  | flight (default 700 km)             | 877    | 877.46 × 2 × 0.12576 = 220.7 → **~220 kg ✈️**     |
| Berlin → Sydney | flight, long-haul                   | 16,094 | 16,094.5 × 2 × 0.11704 = 3,767 → **~3.8 t ✈️**    |
| Paris → London  | rail (auto)                         | 344    | 343.56 × 1.2 × 2 × 0.03092 = 25.5 → **~25 kg 🚆** |
| Paris → London  | flight ("always fly")               | 344    | 343.56 × 2 × 0.12576 = 86.4 → **~86 kg ✈️**       |

Paris by train is therefore roughly 58× less than flying to Sydney.

## Assumptions and limitations

- **Great-circle, city to city.** Real routes, connections and stopovers are longer. A
  connecting flight adds an extra take-off and landing, which DESNZ's direct-flight factors do
  not capture (DESNZ §8.10).
- **No accommodation**, food or conference venue emissions. DESNZ publishes hotel factors, but
  stay length varies too much to guess.
- **No local transport** to and from airports or stations.
- **Train availability is not checked.** Auto mode assumes a train exists for any trip under
  the threshold, even across seas or where no line exists. Use "Always fly" or the per-trip
  toggle where that is wrong.
- **Average aircraft, load factors and fleets** are those of UK-registered airlines in 2023
  (DESNZ §8.7), and the rail averages are British. Other airlines and countries differ.
- **Well-to-tank emissions are excluded.** Adding DESNZ's WTT factors would raise flights by
  about 18–21% and national rail by about 29% (2026 WTT economy: 0.02249 / 0.02461 per
  passenger.km for short- and long-haul; 0.00897 for national rail).
- **RF uncertainty.** The 70% non-CO₂ uplift is a simplified, uncertain multiplier applied
  equally to all flights (DESNZ §8.43–8.44).
- **One traveller, economy, round trip.** Premium cabins, one-way trips or groups scale the
  figure.

## How to cross-check

Use an independent calculator such as [myclimate](https://co2.myclimate.org/en/flight_calculators/new)
for flights (the app links to it from each flight estimate). Different methods give different
figures, but they should be in the same order of magnitude. Tools differ in their non-CO₂
multiplier, whether upstream fuel production is counted and how take-off and landing are
modelled. Differences of up to about 2× between tools are common. A factor of 10 means
something is wrong. Please report it.

## Update procedure (yearly)

DESNZ publishes new factors each June (the next set is due June 2027).

1. On the gov.uk collection page, open the new "Greenhouse gas reporting: conversion factors
   <year>" publication. Download the **flat file**, the **full set** and the **methodology
   paper**.
2. For each entry in `data/co2-factors.json`, find the same row (same labels; the flat-file ID
   usually stays the same apart from its row number). Update `value`, `row`, `cell`, the
   `source` block (year, URLs, retrieval date) and note any change history on the publication
   page.
3. Read the "major changes" report and the air and rail sections of the methodology paper.
   Check that the 8% uplift is still built into the factors, that RF is still a separate column
   and that the haul and rail definitions have not changed. Update this document if they have.
4. Run `pnpm test`. `src/lib/co2/factors.test.ts` **will fail on purpose**. Update its frozen
   table, recompute the golden values in `src/lib/co2/model.test.ts` by hand (keep the
   arithmetic in the comments) and update the worked examples above.
5. Commit with the DESNZ year in the message, so the diff of `data/co2-factors.json` serves as
   the audit trail.
