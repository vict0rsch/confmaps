// URL state (DESIGN §6.6), live part: hydrate from `location.search` once, then mirror filters,
// selection and travel settings back with `history.replaceState` (debounced).
import { app } from './app.svelte';
import { filterState } from './filters.svelte';
import { travel } from './travel.svelte';
import { buildQuery, parseQuery, type URLInputs } from './url';

export const URL_DEBOUNCE_MS = 250;

/** Read the current URL into app state. Invalid params are ignored. */
export function hydrateFromURL(query: string = location.search): void {
  const parsed = parseQuery(query, filterState.filters, (id) => app.data.conferenceById.has(id));
  filterState.hydrate(parsed.filters);
  travel.apply(parsed.travel);
  if (parsed.selection) app.select(parsed.selection);
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
