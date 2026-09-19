import { render } from 'preact';
import './styles.css';
import './m2.css';
import { App } from './ui/App';
import { Engine, pickQuality } from './game/engine';
import { api, ApiError } from './net/api';
import { handleScan } from './scan';
import { ensureBackend } from './demo/client';
import { bootError, bootNote, drop, level, me, myBooths, phase, stations } from './state';
import type { LevelData } from '../shared/types';

let engine: Engine | null = null;
render(<App engine={() => engine} />, document.getElementById('ui')!);

/** What every client keeps fresh: which booths are online, today's special booth, and — for exhibitors — their own numbers. */
function poll() {
  const pull = () => {
    if (document.hidden) return;
    api.stations().then((s) => (stations.value = s), () => {});
    api.today().then((t) => (drop.value = t.drop), () => {});
    if (me.value?.cls === 'exhibitor' || me.value?.hosting.length) api.myBooths().then((b) => (myBooths.value = b), () => {});
  };
  pull();
  setInterval(pull, 20_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
}

async function boot() {
  try {
    await ensureBackend((text) => (bootNote.value = text)); // real backend, or the in-browser demo when none is configured
    const [lv] = await Promise.all([
      fetch('/data/floor.json').then((r) => { if (!r.ok) throw new Error('level'); return r.json() as Promise<LevelData>; }),
      api.me(),
      document.fonts.load('800 32px Urbanist').catch(() => {}), // roof signs are drawn to a canvas — the font must be ready first
    ]);
    level.value = lv;
    try { engine = new Engine(document.getElementById('stage')!, lv, pickQuality()); }
    catch { bootError.value = 'This browser cannot open the 3D station. Try opening the link in Chrome or Safari.'; phase.value = 'error'; return; }
    poll();

    // Arrived by scanning a Mission X code with the phone's own camera: ?b= printed booth QR, ?h= live booth QR, ?l= card-swap code.
    const query = location.search;
    if (/[?&](b|h|l)=/.test(query)) {
      history.replaceState(null, '', location.pathname);
      const returning = !!me.value?.cls;
      if (returning) { engine.start('short'); phase.value = 'play'; } // straight back into the game, then handle the code
      await handleScan(query);
      if (returning) { api.track('boot', { via: 'scan' }); return; }
    }

    phase.value = 'start';
    api.track('boot', { q: pickQuality(), ref: document.referrer.slice(0, 80), returning: (me.value?.xp ?? 0) > 0 });
  } catch (e) {
    bootError.value = e instanceof ApiError || (e instanceof Error && /demo/i.test(e.message)) ? e.message : 'Could not reach the station. Check your connection.';
    phase.value = 'error';
  }
}
void boot();
