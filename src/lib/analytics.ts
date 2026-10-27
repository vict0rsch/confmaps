// Privacy-respecting analytics (DESIGN §6, PRIVACY.md): GoatCounter's documented count endpoint
// (https://www.goatcounter.com/help/pixel) called directly, no third-party script, no cookies, no
// storage. Entirely a no-op unless VITE_GOATCOUNTER_CODE is set at build time, on localhost, or
// when the browser sends Do Not Track / Global Privacy Control.
// Sent: page view (`p=/`, referrer origin only) and anonymous events (`e=true`, `p=<event name>`).
// Never sent: coordinates, cities, search text, URL query strings or hashes.
// Events: `filter_used:<filterId>`, `play_pressed`, `history_mode_opened`, `myclimate_clicked`,
// `share_opened`. Each at most once per page load.

export interface AnalyticsEnv {
  code: string | undefined;
  hostname: string;
  origin: string;
  referrer: string;
  doNotTrack: string | null | undefined;
  globalPrivacyControl: boolean | undefined;
  send: (url: string) => void;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '']);

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function createAnalytics(env: AnalyticsEnv) {
  const code = env.code?.trim();
  const enabled =
    !!code &&
    /^[a-z0-9-]+$/i.test(code) &&
    !LOCAL_HOSTS.has(env.hostname) &&
    env.doNotTrack !== '1' &&
    env.globalPrivacyControl !== true;
  const seen = new Set<string>();

  function count(path: string, event: boolean) {
    if (!enabled || seen.has(path)) return;
    seen.add(path);
    const params = new URLSearchParams({ p: path });
    if (event) params.set('e', 'true');
    else {
      const ref = originOf(env.referrer);
      if (ref && ref !== env.origin) params.set('r', ref);
    }
    env.send(`https://${code}.goatcounter.com/count?${params}`);
  }

  return {
    track: (name: string) => count(name, true),
    pageView: () => count('/', false),
  };
}

function browserEnv(): AnalyticsEnv {
  return {
    code: import.meta.env.VITE_GOATCOUNTER_CODE as string | undefined,
    hostname: location.hostname,
    origin: location.origin,
    referrer: document.referrer,
    doNotTrack: navigator.doNotTrack,
    globalPrivacyControl: (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl,
    send(url) {
      try {
        void fetch(url, {
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
