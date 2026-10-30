// Privacy-respecting analytics (DESIGN §6, PRIVACY.md): Umami Cloud's documented send endpoint
// (https://docs.umami.is/docs/api/sending-stats) called directly, no third-party script, no cookies,
// no storage. Entirely a no-op unless VITE_UMAMI_WEBSITE_ID is set at build time, on localhost, or
// when the browser sends Do Not Track / Global Privacy Control.
// Sent: page view (`url: /`, referrer origin only) and anonymous events (`url: /`, `name`).
// Never sent: coordinates, cities, search text, URL query strings or hashes.
// Events: `filter_used:<filterId>`, `play_pressed`, `history_mode_opened`, `myclimate_clicked`,
// `share_opened`. Each at most once per page load.

export interface AnalyticsEnv {
  websiteId: string | undefined;
  hostname: string;
  origin: string;
  referrer: string;
  doNotTrack: string | null | undefined;
  globalPrivacyControl: boolean | undefined;
  send: (body: string) => void;
}

const ENDPOINT = 'https://gateway.umami.is/api/send';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '']);

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function createAnalytics(env: AnalyticsEnv) {
  const websiteId = env.websiteId?.trim();
  const enabled =
    !!websiteId &&
    UUID.test(websiteId) &&
    !LOCAL_HOSTS.has(env.hostname) &&
    env.doNotTrack !== '1' &&
    env.globalPrivacyControl !== true;
  const seen = new Set<string>();

  function send(key: string, extra: { name?: string; referrer?: string }) {
    if (!enabled || seen.has(key)) return;
    seen.add(key);
    const payload = { website: websiteId, hostname: env.hostname, url: '/', ...extra };
    env.send(JSON.stringify({ type: 'event', payload }));
  }

  return {
    track: (name: string) => send(name, { name }),
    pageView: () => {
      const ref = originOf(env.referrer);
      send('/', ref && ref !== env.origin ? { referrer: ref } : {});
    },
  };
}

function browserEnv(): AnalyticsEnv {
  return {
    websiteId: import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined,
    hostname: location.hostname,
    origin: location.origin,
    referrer: document.referrer,
    doNotTrack: navigator.doNotTrack,
    globalPrivacyControl: (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl,
    send(body) {
      try {
        // A text/plain body keeps this a simple request (no CORS preflight); Umami parses it as JSON.
        void fetch(ENDPOINT, {
          method: 'POST',
          body,
          mode: 'no-cors',
          keepalive: true,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        }).catch(() => {});
      } catch {
        // Analytics must never break the app.
      }
    },
  };
}

let instance: ReturnType<typeof createAnalytics> | undefined;
function get() {
  return (instance ??= createAnalytics(browserEnv()));
}

export function track(name: string): void {
  get().track(name);
}

export function trackPageView(): void {
  get().pageView();
}
