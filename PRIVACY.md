# Privacy

confmaps is a personal, non-commercial project. It has no accounts, no cookies and no ads.

## What is collected

If analytics is enabled, the site uses [GoatCounter](https://www.goatcounter.com), a cookieless, privacy-friendly service, to count aggregate page views and a few anonymous events. No consent banner is needed because nothing identifies you. Your browser sends:

- a page view for the path `/` only (never the URL query or hash), plus the origin of the site that linked to you, if any;
- these events, each at most once per visit, with nothing attached to them:
  - `filter_used:<id>`, the first time you use a given filter (the filter's id only, never its value)
  - `play_pressed`
  - `history_mode_opened`
  - `myclimate_clicked`
  - `share_opened`

GoatCounter itself derives coarse, aggregate information (such as browser and country) from the request, as described in its [documentation](https://www.goatcounter.com/help/pixel).

## What is not collected

- No cookies, and nothing is written to your browser for analytics.
- No personal data, coordinates, cities, search text or free text, ever.
- Your home city is kept in your browser's `localStorage` only, so the app can remember it. It is never sent anywhere.
- "Use my location" is snapped to the nearest city on your device; the coordinates are never sent or stored.
- Your home city is not put in URLs, unless you tick "Include my city in the link" when sharing, and then only the city name.

## Do Not Track and Global Privacy Control

If your browser sends Do Not Track or Global Privacy Control, analytics is switched off entirely.

## Other services your browser contacts

- [OpenFreeMap](https://openfreemap.org) for map tiles (data from OpenStreetMap contributors).
- GoatCounter, only when analytics is enabled.

Conference data and the list of cities are served from this site itself.

## Contact

Questions or requests: open an issue at [github.com/vict0rsch/confmaps](https://github.com/vict0rsch/confmaps/issues).
