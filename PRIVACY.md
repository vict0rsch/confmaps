# Privacy

confmaps is a personal, non-commercial project. It has no accounts, no cookies and no ads.

## What is collected

If analytics is enabled, the site uses [Umami Cloud](https://umami.is), a cookieless, privacy-friendly service, to count aggregate page views and a few anonymous events. There is no consent banner: the site sets no cookies and the app sends nothing that identifies you. Your browser sends:

- a page view for the path `/` only (never the URL query or hash), plus the origin of the site that linked to you, if any;
- these events, each at most once per visit, with nothing attached to them:
  - `filter_used:<id>`, the first time you use a given filter (the filter's id only, never its value)
  - `play_pressed`
  - `history_mode_opened`
  - `myclimate_clicked`
  - `share_opened`

Each request also carries the site's hostname (`confmaps.org`) and the site's Umami id. The app does not send your screen size, language or page title.

Umami itself derives information from the request: browser, operating system, device type and an approximate location (country, region and possibly city) from your IP address. To count unique visitors, it combines your IP address and browser with a value that changes every month, so your visits within the same month can be linked. It does not store the IP address in its analytics records, but the address may appear in Umami's operational and security logs, as described in its [privacy policy](https://umami.is/privacy).

## What is not collected

- No cookies, and nothing is written to your browser for analytics.
- The app never sends personal data, coordinates, cities, search text or free text.
- Your home city is kept in your browser's `localStorage` only, so the app can remember it. It is never sent anywhere.
- "Use my location" is snapped to the nearest city on your device; the coordinates are never sent or stored.
- Your home city is not put in URLs, unless you tick "Include my city in the link" when sharing, and then only the city's GeoNames id (a number) — never coordinates.

## Do Not Track and Global Privacy Control

If your browser sends Do Not Track or Global Privacy Control, analytics is switched off entirely.

## Other services your browser contacts

- [OpenFreeMap](https://openfreemap.org) for map tiles (data from OpenStreetMap contributors).
- Umami Cloud (`gateway.umami.is`), only when analytics is enabled.

Conference data and the list of cities are served from this site itself.

## Contact

Questions or requests: open an issue at [github.com/vict0rsch/confmaps](https://github.com/vict0rsch/confmaps/issues).
