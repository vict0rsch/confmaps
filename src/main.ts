import './styles/index.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { startURLSync } from './lib/state/url-sync.svelte';

// Before mounting, so the first render already reflects a shared link.
startURLSync();

const app = mount(App, { target: document.getElementById('app')! });

export default app;
