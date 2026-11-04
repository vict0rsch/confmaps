import './styles/index.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { trackPageView } from './lib/analytics';
import { app as appState } from './lib/state/app.svelte';
import { startURLSync } from './lib/state/url-sync.svelte';

// Before mounting, so the first render already reflects a shared link.
startURLSync();
appState.startClock();

// index.html holds a static summary for crawlers (vite.config.ts); the app replaces it.
const target = document.getElementById('app')!;
target.replaceChildren();
const app = mount(App, { target });

trackPageView();

export default app;
