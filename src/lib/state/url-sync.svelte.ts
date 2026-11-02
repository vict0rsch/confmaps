// URL state (DESIGN §5.6), live part: hydrate from `location.search` once, then mirror filters,
// selection and travel settings back with `history.replaceState` (debounced). `home` (shared link)
// and `h` (history link) are read once and never written back.
import { isSeries, seriesWindow } from '../filters/series';
import { home } from '../home/store.svelte';
import { app } from './app.svelte';
import { filterState } from './filters.svelte';
import { tour } from './timeline.svelte';
import { travel } from './travel.svelte';
import { buildQuery, parseHistory, parseQuery, type URLInputs } from './url';

export const URL_DEBOUNCE_MS = 250;

/** Read the current URL into app state. Invalid params are ignored. */
export function hydrateFromURL(query: string = location.search): void {
  const parsed = parseQuery(query, filterState.filters, (id) => app.data.conferenceById.has(id));
  filterState.hydrate(parsed.filters);
  // Travel settings in a link (always present with a CO₂ filter) win for this visit, unsaved.
  travel.applyShared(parsed.travel);
  if (parsed.selection) app.select(parsed.selection);
  // A history link (`h=<series>`): the series' editions, over any dates in the link; no autoplay.
  const h = parseHistory(query, (s) => isSeries(app.data.conferences, s));
  if (h) filterState.hydrate({ series: h, dates: seriesWindow(app.data.locations, h) });
  // The tour starts once the shared city (if any) is in place, since the city can change what is
  // visible; not if the viewer changed a filter meanwhile.
  const states = filterState.states;
  const startTour = () => {
    if (h && filterState.states === states) tour.enter({ fromURL: true });
  };
  // Opt-in shared city: this visit only (not saved); the sync below then drops `home` from the URL.
  if (parsed.home) void home.applyShared(parsed.home).then(startTour);
  else startTour();
}

function write(inputs: URLInputs): void {
  try {
    const q = buildQuery(location.search, inputs);
    const search = q ? `?${q}` : '';
    if (search === location.search) return;
    history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
  } catch {
    // Never break the app over the address bar (e.g. sandboxed iframes).
  }
}

/** Hydrate, then keep the URL in sync. Returns a stop function. */
export function startURLSync(debounceMs = URL_DEBOUNCE_MS): () => void {
  hydrateFromURL();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = $effect.root(() => {
    $effect(() => {
      const inputs: URLInputs = {
        filters: filterState.filters,
        states: filterState.states,
        selection: app.selectedConferenceId,
        travel: travel.values,
      };
      clearTimeout(timer);
      timer = setTimeout(() => write(inputs), debounceMs);
    });
  });
  return () => {
    clearTimeout(timer);
    stop();
  };
}
