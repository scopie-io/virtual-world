// Mission Control: the booth's big screen. A slow fly-over of the live station — every player a dot in their crew colour,
// solid if they are really on the floor — with today's board, sector control and a QR to join. Crew sign-in required.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import * as THREE from 'three';
import './styles.css';
import './m2.css';
import './screen.css';
import './demo/demo.css';
import { demo, demoState, ensureBackend } from './demo/client';
import { World, toWorld } from './game/world';
import { Qr, hex } from './ui/common';
import { CLASSES, CREW_INFO } from '../shared/rules';
import type { LevelData, ScreenView, StationView } from '../shared/types';

const DECK_SECONDS = 28, MAX_DOTS = 2000;

async function getJson<T>(path: string): Promise<T | null> {
  try { const r = await fetch(path, { credentials: 'same-origin' }); const j = await r.json(); return j.ok ? (j.data as T) : null; } catch { return null; }
}

function startScene(host: HTMLElement, level: LevelData) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  host.prepend(renderer.domElement);
  const world = new World(level, 'high'), camera = new THREE.PerspectiveCamera(38, 1, 0.5, 3000);
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 12, 10), new THREE.MeshBasicMaterial(), MAX_DOTS), halos = new THREE.InstancedMesh(new THREE.RingGeometry(1.3, 1.8, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }), MAX_DOTS);
  dots.count = halos.count = 0; dots.frustumCulled = halos.frustumCulled = false; world.scene.add(dots, halos);

  const resize = () => { renderer.setSize(host.clientWidth, host.clientHeight); camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(host); resize();

  const decks = [...level.decks].sort((a, b) => a.level - b.level), target = new THREE.Vector3(), want = new THREE.Vector3();
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000), t = now / 1000; last = now;
    const d = decks[Math.floor(t / DECK_SECONDS) % decks.length]!, phase = (t % DECK_SECONDS) / DECK_SECONDS;
    toWorld((d.x0 + d.x1) / 2 + (phase - 0.5) * 60, (d.y0 + d.y1) / 2, 0, want);
    target.lerp(want, Math.min(1, dt * 0.9));
    const yaw = 0.35 * Math.sin(t * 0.07), dist = 150;
    camera.position.set(target.x + Math.sin(yaw) * dist * 0.62, 105, target.z + Math.cos(yaw) * dist * 0.62); camera.lookAt(target);
    world.update(t, dt); renderer.render(world.scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  const M = new THREE.Matrix4(), C = new THREE.Color(), p = new THREE.Vector3();
  return {
    world,
    deckLabel: () => decks[Math.floor(performance.now() / 1000 / DECK_SECONDS) % decks.length]!.label,
    setDots(list: ScreenView['dots']) {
      let n = 0, h = 0;
      for (const d of list.slice(0, MAX_DOTS)) {
        C.set(d.cls ? CREW_INFO[d.cls].color : 0xffffff);
        toWorld(d.x, d.y, 1.4, p); M.makeScale(1, 1, 1).setPosition(p); dots.setMatrixAt(n, M); dots.setColorAt(n, C); n++;
        if (d.deck) { toWorld(d.x, d.y, 0.15, p); M.setPosition(p); halos.setMatrixAt(h, M); halos.setColorAt(h, C.set(0x3ddc84)); h++; } // really on the floor
      }
      dots.count = n; halos.count = h; dots.instanceMatrix.needsUpdate = halos.instanceMatrix.needsUpdate = true;
      for (const m of [dots, halos]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    },
  };
}

function Screen() {
  const [view, setView] = useState<ScreenView | null>(null), [auth, setAuth] = useState(true), [deck, setDeck] = useState('');
  useEffect(() => {
    let scene: ReturnType<typeof startScene> | null = null, stop = false;
    (async () => {
      const level = await fetch('/data/floor.json').then((r) => r.json() as Promise<LevelData>);
      await document.fonts.load('800 32px Urbanist').catch(() => {});
      scene = startScene(document.getElementById('stage')!, level);
      const pull = async () => {
        if (stop) return;
        const v = await getJson<ScreenView>('/api/crew/screen');
        if (!v) { setAuth(false); return; }
        setAuth(true); setView(v); scene!.setDots(v.dots); scene!.world.setSectors(v.sectors.sectors); scene!.world.setStorm(v.storm);
        const st = await getJson<StationView[]>('/api/stations'); if (st) scene!.world.setStations(st);
      };
      void pull(); setInterval(pull, 4000); setInterval(() => setDeck(scene!.deckLabel()), 1000);
    })();
    return () => { stop = true; };
  }, []);

  if (!auth) return <div class="splash"><div class="x err">✕</div><p>Sign in on the crew console in this browser first, then reload this page.{demo.value ? ` Demo PIN: ${demoState.value?.crewPin}.` : ''}</p><a class="btn" href="/crew.html">Open the crew console</a></div>;
  const v = view, holders = v ? CLASSES.map((c) => ({ c, n: v.sectors.sectors.filter((s) => s.holder === c).length })).sort((a, b) => b.n - a.n) : [];
  return (
    <div class="mc">
      <header>
        <div class="mc-brand"><span>lean<b>.x</b>digital</span><i /><span>ne<b>x</b>ova</span></div>
        <div class="mc-title"><strong>MISSION <b>X</b></strong><span>Live from the MIHAS floor · {deck}</span></div>
        <div class="mc-live"><span class="live-dot" />{v?.online ?? 0} flying now · {v?.onsite ?? 0} on the floor</div>
      </header>

      <aside class="mc-left">
        <h3>Today's board</h3>
        <ol>{(v?.board ?? []).slice(0, 8).map((r, i) => <li key={r.title}><span>{i + 1}</span><strong style={r.cls ? { color: hex(CREW_INFO[r.cls].color) } : {}}>{r.title}{r.trusted ? ' ✓' : ''}</strong><em>{r.value.toLocaleString()}</em></li>)}</ol>
        {v && v.board.length === 0 && <p>Nobody on the board yet — be the first.</p>}
        <h3>Sector control</h3>
        <div class="mc-crews">{holders.map(({ c, n }) => <div key={c}><i style={{ background: hex(CREW_INFO[c].color) }} /><strong>{CREW_INFO[c].crew}</strong><em>{n} hall{n === 1 ? '' : 's'}</em></div>)}</div>
      </aside>

      <aside class="mc-right">
        <div class="mc-join"><Qr text={v?.joinUrl ?? location.origin} label="Join Mission X" /><strong>Play the floor.</strong><span>Scan · no app · find the <b>X</b> at 8H18B</span></div>
        <div class="mc-stats">
          <div><strong>{v?.totals.players ?? 0}</strong><span>astronauts</span></div><div><strong>{v?.totals.stations ?? 0}</strong><span>stations online</span></div>
          <div><strong>{v?.totals.stamps ?? 0}</strong><span>stamps</span></div><div><strong>{v?.totals.links ?? 0}</strong><span>handshakes</span></div>
        </div>
      </aside>

      <footer>
        {v?.storm && <span class="tick gold">⚡ Signal Storm · {v.storm.label} · stamps ×{v.storm.mult}</span>}
        {v?.drop && <span class="tick">★ Daily Drop · {v.drop.title} at {v.drop.label} · +{v.drop.bonus} XP</span>}
        <span class="tick">✕ Find the X · Booth 8H18B · Hall 8 · opposite Bernama Studio</span>
      </footer>
    </div>
  );
}

void ensureBackend().catch(() => 'live').then(() => render(<Screen />, document.getElementById('ui')!));
