// Page side of demo mode. Every page calls ensureBackend() before its first API request:
//   a real backend answers /api/healthz            → "live", nothing else happens;
//   anything else (no database configured, static hosting) → the in-browser backend (sw.ts) is started: "demo".
// Overrides: ?demo=1 / ?demo=0 in the URL (remembered), or VITE_DEMO=1 / 0 at build time.
import { signal } from '@preact/signals';
import type { DemoState } from './sim';
import { DEMO_VERSION } from './version';

export const demo = signal(false);
export const demoState = signal<DemoState | null>(null);

const RELOADS = 'mx_demo_reloads';
const reloadOnce = (): void => { const n = Number(sessionStorage.getItem(RELOADS) ?? 0); if (n < 2) { sessionStorage.setItem(RELOADS, String(n + 1)); location.reload(); } };

async function probe(): Promise<'live' | 'demo'> {
  try {
    const r = await fetch('/api/healthz', { cache: 'no-store' }), j = (await r.json()) as { ok?: boolean; data?: string };
    return r.ok && j.ok === true && j.data === 'live' ? 'live' : 'demo';
  } catch { return 'demo'; }
}

export async function ensureBackend(status?: (text: string) => void): Promise<'live' | 'demo'> {
  const asked = new URLSearchParams(location.search).get('demo'), built = import.meta.env.VITE_DEMO as string | undefined;
  try { if (asked === '1') localStorage.setItem('mx_demo', '1'); else if (asked === '0') localStorage.removeItem('mx_demo'); } catch { /* private mode */ }
  const pinned = (() => { try { return localStorage.getItem('mx_demo') === '1'; } catch { return false; } })();
  const mode = built === '1' || pinned ? 'demo' : built === '0' || asked === '0' ? 'live' : import.meta.env.DEV ? 'live' : await probe();

  if (mode === 'live') {
    if ('serviceWorker' in navigator) { // a backend was configured since the last visit: retire the demo
      const regs = (await navigator.serviceWorker.getRegistrations()).filter((r) => (r.active ?? r.waiting ?? r.installing)?.scriptURL.endsWith('/demo-sw.js'));
      if (regs.length) { await Promise.all(regs.map((r) => r.unregister())); if (navigator.serviceWorker.controller) reloadOnce(); }
    }
    return 'live';
  }

  if (!('serviceWorker' in navigator)) throw new Error('This demo runs its server inside your browser, which this window does not allow. Open it in a normal (not private) Chrome, Edge, Safari or Firefox window.');
  status?.('Starting the demo station…');
  const reg = await navigator.serviceWorker.register('/demo-sw.js');
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) { // first visit, or a hard reload: wait for the worker to take this page
    await new Promise<void>((ok) => { navigator.serviceWorker.addEventListener('controllerchange', () => ok(), { once: true }); setTimeout(ok, 2500); });
    if (!navigator.serviceWorker.controller) { reloadOnce(); await new Promise(() => {}); }
  }
  // A newer worker (after a redeploy) takes over mid-visit and may have rebuilt the world: start this page again on top of it.
  navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
  status?.('Building the demo world — exhibitors, visitors, a few hours of history…');
  const r = await fetch('/api/demo/state'), j = (await r.json().catch(() => null)) as { ok: boolean; data: DemoState | null; error?: string } | null;
  if (!j?.ok) throw new Error(j?.error ?? 'The demo backend did not start. Reload the page to try again.');
  if (j.data?.version !== DEMO_VERSION) { // this page is newer than the worker that answered: fetch the new one, which reloads us when it takes over
    await reg.update().catch(() => {});
    await new Promise((ok) => setTimeout(ok, 4000));
  }
  sessionStorage.removeItem(RELOADS);
  demoState.value = j.data; demo.value = true;
  return 'demo';
}

async function post<T>(path: string): Promise<T> {
  const r = await fetch(path, { method: 'POST' }), j = (await r.json()) as { ok: boolean; data: T; error?: string };
  if (!j.ok) throw new Error(j.error ?? 'Demo helper failed');
  return j.data;
}
export interface StationHint { claimed: boolean; hosted: boolean; digits: string | null; expiresInMs: number; beacon: string }
export const demoApi = {
  hint: async (stationId: string) => ((await (await fetch(`/api/demo/hint?station=${encodeURIComponent(stationId)}`)).json()) as { data: StationHint | null }).data,
  partnerCode: () => post<{ code: string; callsign: string } | null>('/api/demo/partner-code'),
  partnerScan: () => post<{ callsign: string } | null>('/api/demo/partner-scan'),
  visitor: () => post<{ station: string; name: string } | null>('/api/demo/visitor'),
  dock: () => post<boolean>('/api/demo/dock'),
  boost: () => post<null>('/api/demo/boost'),
  reset: async () => { await post<null>('/api/demo/reset'); try { localStorage.removeItem('mx_axis'); } catch { /* ignore */ } location.href = location.pathname; },
};
