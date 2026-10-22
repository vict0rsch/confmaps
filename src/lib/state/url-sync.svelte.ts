// URL state (DESIGN §6.6), live part: hydrate from `location.search` once, then mirror filters,
// selection and travel settings back with `history.replaceState` (debounced). `home` is read once
// (shared link) and never written back.
import { home } from '../home/store.svelte';
import { app } from './app.svelte';
import { filterState } from './filters.svelte';
import { historyMode } from './timeline.svelte';
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
  const h = parseHistory(query, (s) => historyMode.isSeries(s));
  if (h) historyMode.enter(h, { fromURL: true });
  // Opt-in shared city: this visit only (not saved); the sync below then drops `home` from the URL.
  if (parsed.home) void home.applyShared(parsed.home);
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
        history: historyMode.series,
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
