import { render } from 'preact';
import './styles.css';
import './m2.css';
import { App } from './ui/App';
import { Engine, pickQuality } from './game/engine';
import { api, ApiError } from './net/api';
import { handleScan } from './scan';
import { bootError, gcView, guideTarget, level, me, missions, phase, sectors, stations, toast } from './state';
import type { LevelData } from '../shared/types';

let engine: Engine | null = null;
render(<App engine={() => engine} />, document.getElementById('ui')!);

/** Shared world state every client needs: which stations are online, who holds which sector. */
function poll() {
  const pull = () => {
    if (document.hidden) return;
    api.stations().then((s) => (stations.value = s), () => {});
    api.sectors().then((s) => (sectors.value = s), () => {});
    api.missions().then((m) => {
      const was = missions.value; missions.value = m;
      if (m.storm && m.storm.zone !== was?.storm?.zone) toast('⚡ Signal Storm', `${m.storm.label} pays double for 15 minutes`, 'xp', 6000);
      if (was?.active && !m.active) guideTarget.value = null; // finished or timed out: stop leading there
    }, () => {});
  };
  // Ground Control needs a faster heartbeat, but only while a run is queued or live.
  setInterval(() => {
    const st = gcView.value?.state;
    if (!document.hidden && (st === 'queued' || st === 'active')) api.gc().then((v) => { if (v.state === 'done' && st === 'active') toast('Ground Control', 'Target reached — +150 XP each', 'xp', 5000); gcView.value = v; }, () => {});
  }, 3000);
  api.gc().then((v) => (gcView.value = v), () => {});
  pull();
  setInterval(pull, 20_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
}

async function boot() {
  try {
    const [lv] = await Promise.all([
      fetch('/data/floor.json').then((r) => { if (!r.ok) throw new Error('level'); return r.json() as Promise<LevelData>; }),
      api.me(),
      document.fonts.load('800 32px Urbanist').catch(() => {}), // roof signs are drawn to a canvas — the font must be ready first
    ]);
    level.value = lv;
    try { engine = new Engine(document.getElementById('stage')!, lv, pickQuality()); }
    catch { bootError.value = 'This browser cannot open the 3D station. Try opening the link in Chrome or Safari.'; phase.value = 'error'; return; }
    poll();

    // Arrived by scanning a Mission X code with the phone's own camera: ?b= beacon, ?h= host code, ?l= Link code.
    const query = location.search;
    if (/[?&](b|h|l)=/.test(query)) {
      history.replaceState(null, '', location.pathname);
      const returning = !!me.value?.cls;
      if (returning) { engine.start('short'); phase.value = 'play'; } // straight back into the game, then handle the code
      await handleScan(query);
      if (returning) { api.track('boot', { via: 'scan' }); return; }
    }

    phase.value = 'suitup';
    api.track('boot', { q: pickQuality(), ref: document.referrer.slice(0, 80), returning: (me.value?.xp ?? 0) > 0 });
  } catch (e) {
    bootError.value = e instanceof ApiError ? e.message : 'Could not reach the station. Check your connection.';
    phase.value = 'error';
  }
}
void boot();
