// Analytics hook point (DESIGN §7). A no-op until the analytics phase implements it (GoatCounter,
// anonymous events only: never coordinates, cities or free text).
// Events emitted so far: `filter_used:<filterId>` (first activation of each filter per page load).

export function track(name: string): void {
  void name;
}
