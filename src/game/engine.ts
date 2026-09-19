import * as THREE from 'three';
import type { Booth, Hologram, LevelData, Lift } from '../../shared/types';
import { STAMP_RADIUS_M } from '../../shared/rules';
import { decodeAvatar, defaultAvatar, type AvatarSpec } from '../../shared/avatar';
import { World, toWorld, type Label, type Quality } from './world';
import { NavGrid, pathLength, pointAlong, type P2 } from './nav';
import { Astronaut } from './astronaut';
import { Input } from './input';
import { api, ApiError } from '../net/api';
import { atLaunchPad, currentDeck, deck, distToGoal, goalVia, nearLift, gcMarkerMode, gcView, guideOn, guideTarget, me, missions, nearStation, online, sectors, stampedSet, stations, toast } from '../state';
import { DECK_STALE_MS, DECK_STALE_SIGMA_M } from '../../shared/rules';
import { DIR_VEC, StepTracker, calibrateStepLength, quantiseHeading } from './pdr';
import { effect } from '@preact/signals';

const RUN_SPEED = 6.5;          // m/s — brisk on purpose: the Epic route is 228 m
const PING_MS = 2000;
const TRAIL_STEP = 1.6, TRAIL_MAX = 220;

interface Holo { a: Astronaut; av: string; deck: boolean; x: number; y: number; tx: number; ty: number; h: number; label: HTMLDivElement; seen: number }

/** Switched off with the rest of the presence engine: a real-booth scan places the astronaut, it does not lock it. */
const FOLLOW_REAL_STEPS = false;

export function pickQuality(): Quality {
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || mem <= 4 ? 'low' : 'high';
}

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(42, 1, 0.5, 2600);
  private world: World;
  private nav: NavGrid;
  private input: Input;
  private player: Astronaut | null = null;
  private pos: P2 = { x: 0, y: 0 };
  private heading = 0;
  private speed01 = 0;
  private route: P2[] = [];
  private cam = { yaw: 0, pitch: 0.92, dist: 170, want: 30 };
  private camTarget = new THREE.Vector3();
  private trail: THREE.InstancedMesh;
  private trailPath: P2[] = [];
  private trailAt = 0;
  private holos = new Map<string, Holo>();
  private labelEls: { el: HTMLDivElement; l: Label }[] = [];
  private buckets = new Map<string, Booth[]>();
  private running = false; private last = 0; private pingAt = 0; private proxAt = 0; private firstPing = true;
  private fps = { acc: 0, n: 0, dpr: 1 };
  private dust: { mesh: THREE.InstancedMesh; p: Float32Array; life: Float32Array; next: number; acc: number };
  private stops: (() => void)[] = [];
  private tracker: StepTracker | null = null;
  private stepsSincePing = 0;
  private walk = { steps: 0, stepLen: 0.7, lastAnchor: null as P2 | null, anchorSeen: 0, warned: 0 };
  /** Compass bearing of the drawing's +y axis. 0 until measured at MITEC or set by the in-game calibration. */
  private axisBearing = Number(localStorage.getItem('mx_axis') ?? 0) || 0;

  constructor(private host: HTMLElement, private level: LevelData, private quality: Quality) {
    this.renderer = new THREE.WebGLRenderer({ antialias: quality === 'high', powerPreference: 'high-performance' }); // throws without WebGL
    this.fps.dpr = Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.5);
    this.renderer.setPixelRatio(this.fps.dpr);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.15;
    host.prepend(this.renderer.domElement);

    this.world = new World(level, quality);
    this.nav = new NavGrid(level);
    for (const b of level.booths) { const k = `${Math.floor(b.x / 6)},${Math.floor(b.y / 6)}`; (this.buckets.get(k) ?? this.buckets.set(k, []).get(k)!).push(b); }

    this.trail = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd65c }), TRAIL_MAX);
    this.trail.count = 0; this.trail.frustumCulled = false; this.world.scene.add(this.trail);
    const DUST = 36; // rank-unlocked trail effect behind the player
    this.dust = { mesh: new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 6, 5), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), DUST), p: new Float32Array(DUST * 3), life: new Float32Array(DUST), next: 0, acc: 0 };
    this.dust.mesh.frustumCulled = false; this.dust.mesh.count = DUST; this.world.scene.add(this.dust.mesh);

    this.input = new Input(this.renderer.domElement, {
      onTap: (x, y) => this.tapMove(x, y),
      onOrbit: (d) => { this.cam.yaw += d; },
      onZoom: (f) => { this.cam.want = THREE.MathUtils.clamp(this.cam.want * f, 12, 95); },
    });

    for (const l of this.world.labels) {
      const el = Object.assign(document.createElement('div'), { className: `lbl ${l.kind}`, textContent: l.text });
      host.appendChild(el); this.labelEls.push({ el, l });
    }

    const ro = new ResizeObserver(() => this.resize()); ro.observe(host); this.stops.push(() => ro.disconnect()); this.resize();
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.running = false; toast('Graphics paused', 'Reloading…', 'warn', 6000); setTimeout(() => location.reload(), 1500); });
    this.stops.push(effect(() => this.world.setStamped(stampedSet.value)));
    this.stops.push(effect(() => this.world.setStations(stations.value)));
    this.stops.push(effect(() => { if (sectors.value) this.world.setSectors(sectors.value.sectors); }));
    this.stops.push(effect(() => { void guideTarget.value; this.trailAt = 0; }));
    this.stops.push(effect(() => this.world.setStorm(missions.value?.storm ?? null)));
    this.stops.push(effect(() => this.world.setGc(gcView.value)));
    // an on-site scan is the server saying "this person really stood here": put the avatar on deck at that station
    this.stops.push(effect(() => { const a = me.value?.anchor; if (a && this.player && a.at > this.walk.anchorSeen) this.arriveAt(a.stationId, a.at); }));

    // idle orbit behind the suit-up screen
    this.camTarget.copy(this.world.heroPos); this.cam.yaw = 0.6; this.loop(true);
  }

  private resize() {
    const w = this.host.clientWidth || innerWidth, h = this.host.clientHeight || innerHeight;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.fov = w < h ? 50 : 42; this.camera.updateProjectionMatrix();
  }

  /** Drop the player in and hand over control. */
  start(spawn: 'short' | 'epic') {
    const s = this.level.spawns[spawn];
    this.pos = { x: s.x, y: s.y }; this.heading = spawn === 'short' ? Math.PI : -Math.PI / 2; // rotation.y that faces north / west
    this.player?.group.removeFromParent();
    this.player = new Astronaut({ spec: me.value?.avatar ?? defaultAvatar(me.value?.cls ?? null) }); this.player.group.scale.setScalar(1.25); this.world.scene.add(this.player.group);
    this.cam.yaw = spawn === 'short' ? 0 : Math.PI / 2; this.cam.dist = 150; this.cam.want = 30;
    this.firstPing = true; this.pingAt = 0; this.trailAt = 0;
    const a = me.value?.anchor; // came back to the game shortly after a scan at a real booth: stand there
    if (a && Date.now() - a.at < DECK_STALE_MS) this.arriveAt(a.stationId, a.at); else if (a) this.walk.anchorSeen = a.at;
  }

  /* ---------------- on deck: the avatar is where the person is ---------------- */

  /** A scan at a real booth: the astronaut appears where the person stands, and stays free to walk on.
   *  ("On deck" — the avatar locked to the person's real steps — belongs to the switched-off systems.) */
  private arriveAt(stationId: string, at: number) {
    if (FOLLOW_REAL_STEPS) { this.enterDeck(stationId, at); return; }
    const b = this.level.booths.find((x) => x.id === stationId); this.walk.anchorSeen = at; if (!b) return;
    this.pos = this.nav.nearestWalkable(b.x, b.y) ?? { x: b.x, y: b.y }; this.route = []; this.firstPing = true; this.pingAt = 0; this.trailAt = 0;
    this.camTarget.copy(toWorld(this.pos.x, this.pos.y, 1.2));
  }

  private enterDeck(stationId: string, at: number) {
    const b = this.level.booths.find((x) => x.id === stationId); if (!b) return;
    const spot = this.nav.nearestWalkable(b.x, b.y) ?? { x: b.x, y: b.y };
    if (this.walk.lastAnchor && deck.value.on) this.walk.stepLen = calibrateStepLength(pathLength(this.nav.path(this.walk.lastAnchor, spot) ?? []), this.walk.steps, this.walk.stepLen);
    this.walk = { ...this.walk, steps: 0, lastAnchor: spot, anchorSeen: at, warned: 0 };
    this.pos = spot; this.route = []; this.pingAt = 0;
    deck.value = { on: true, label: stations.value.find((s) => s.id === b.id)?.company || b.name || 'Station ' + b.id, sigma: 1, since: at, tracking: !!this.tracker };
  }

  leaveDeck(reason?: string) {
    if (!deck.value.on) return;
    deck.value = { ...deck.value, on: false }; this.pingAt = 0;
    if (reason) toast('Free roam', reason);
  }

  /** Beta. Must be called from a tap (iOS motion permission). */
  async setStepTracking(on: boolean): Promise<boolean> {
    this.tracker?.stop(); this.tracker = null;
    if (on) {
      const t = new StepTracker((h) => this.onStep(h)), r = await t.start();
      if (r !== 'ok') { toast(r === 'denied' ? 'Motion access was refused' : 'This device has no motion sensors', 'Your astronaut will hop from scan to scan instead', 'warn', 5000); deck.value = { ...deck.value, tracking: false }; return false; }
      this.tracker = t;
    }
    deck.value = { ...deck.value, tracking: on };
    return on;
  }

  /** "I am facing INTO the Launch Pad": the booth opens west, so looking into it is due east (+x) on the drawing — that fixes the building axis. */
  calibrateAxis(): boolean {
    const h = this.tracker?.heading; if (h == null) return false;
    this.axisBearing = (((h - 90) % 360) + 360) % 360; localStorage.setItem('mx_axis', String(Math.round(this.axisBearing)));
    return true;
  }

  private onStep(headingDeg: number | null) {
    if (!deck.value.on || !this.player || document.hidden) return;
    const w = this.walk; w.steps++; this.stepsSincePing++;
    const dir = headingDeg == null ? null : DIR_VEC[quantiseHeading(headingDeg, this.axisBearing)];
    if (dir) {
      const next = this.nav.move(this.pos, dir.x * w.stepLen, dir.y * w.stepLen); // the nav grid is the map-matcher: no walking through booths
      if (next !== this.pos) { this.pos = next; this.heading = Math.atan2(dir.x, -dir.y); this.speed01 = 0.6; }
    }
    deck.value = { ...deck.value, sigma: +(deck.value.sigma + 0.08 * w.stepLen * (dir ? 1 : 3)).toFixed(1) };
  }

  private deckHealth(now: number) {
    const d = deck.value; if (!d.on) return;
    const stale = d.sigma > DECK_STALE_SIGMA_M || (!d.tracking && Date.now() - d.since > DECK_STALE_MS);
    if (stale) this.leaveDeck('Scan any station to put your astronaut back where you are');
    else if (d.sigma > DECK_STALE_SIGMA_M * 0.7 && now - this.walk.warned > 60_000) { this.walk.warned = now; toast('Position getting fuzzy', 'Scan a booth QR to place yourself again', 'info', 4000); }
  }

  private loop(first = false) {
    if (first) { this.running = true; this.last = performance.now(); }
    const frame = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      this.tick(now, dt); requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private tick(now: number, dt: number) {
    const t = now / 1000;
    this.world.update(t, dt);
    if (this.player) { this.movePlayer(dt); this.deckHealth(now); this.updateDust(dt); this.proximity(now); this.updateTrail(now, t); this.sync(now); this.updateHolos(dt); }
    else { this.cam.yaw += dt * 0.12; this.cam.dist += (70 - this.cam.dist) * Math.min(1, dt * 1.5); }
    this.updateCamera(dt); this.updateLabels();
    this.renderer.render(this.world.scene, this.camera);
    this.adaptQuality(dt);
  }

  /* ---------------- movement ---------------- */

  private movePlayer(dt: number) {
    const p = this.player!, inp = this.input.move; let dx = 0, dy = 0;
    if (deck.value.on) {
      if ((inp.x || inp.y) && performance.now() - this.walk.warned > 4000) { this.walk.warned = performance.now(); toast('You are on deck', 'Your astronaut follows the real you — tap Free roam to explore', 'info', 3500); }
      this.speed01 += (0 - this.speed01) * Math.min(1, dt * 4);
    } else if (inp.x || inp.y) {
      this.route = [];
      const s = Math.sin(this.cam.yaw), c = Math.cos(this.cam.yaw);
      const wx = c * inp.x - s * inp.y, wz = -s * inp.x - c * inp.y;   // screen → world
      dx = wx; dy = -wz;
    } else if (this.route.length) {
      const n = this.route[0]!, ddx = n.x - this.pos.x, ddy = n.y - this.pos.y, l = Math.hypot(ddx, ddy);
      if (l < 0.35) this.route.shift(); else { dx = ddx / l; dy = ddy / l; }
    }
    const mag = Math.min(1, Math.hypot(dx, dy));
    if (mag > 0.01) {
      const step = RUN_SPEED * dt, next = this.nav.move(this.pos, dx * step, dy * step);
      const moved = Math.hypot(next.x - this.pos.x, next.y - this.pos.y);
      this.pos = next; this.speed01 += ((moved > step * 0.2 ? mag : 0) - this.speed01) * Math.min(1, dt * 10);
      const want = Math.atan2(dx, -dy); // rotation.y that points the model (+z) along travel; world z = −plan y
      let d = want - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d)); this.heading += d * Math.min(1, dt * 12);
    } else this.speed01 += (0 - this.speed01) * Math.min(1, dt * 10);
    toWorld(this.pos.x, this.pos.y, 0.1, p.group.position); p.group.rotation.y = this.heading;
    p.animate(dt, this.speed01);
  }

  private tapMove(cx: number, cy: number) {
    if (!this.player) return;
    const marker = gcMarkerMode.value && gcView.value?.state === 'active' && gcView.value.role === 'ground';
    if (deck.value.on && !marker) return;
    const r = this.renderer.domElement.getBoundingClientRect(), ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); if (!hit) return;
    const at = { x: hit.x + 95, y: 72 - hit.z };
    if (marker) { api.gcWaypoint(at.x, at.y).then((v) => (gcView.value = v), (e) => toast(e instanceof ApiError ? e.message : 'Marker not sent', undefined, 'warn')); return; }
    const path = this.nav.path(this.pos, at);
    if (path) this.route = path.slice(1);
  }

  deckOf(p: P2): number { const d = this.level.decks; return (d.find((k) => p.y >= k.y0 - 15 && p.y <= k.y1 + 15) ?? d[0]!).level; }

  /** Where the trail leads. A goal on another deck is reached through the nearest lift on this one. */
  private get goal(): P2 {
    const target = guideTarget.value ?? this.level.hero.dock, here = this.deckOf(this.pos), there = this.deckOf(target);
    if (here === there) { if (goalVia.value) goalVia.value = null; return target; }
    const lifts = this.level.lifts.filter((l) => l.deck === here), lift = lifts.reduce((a, b) => (Math.hypot(b.x - this.pos.x, b.y - this.pos.y) < Math.hypot(a.x - this.pos.x, a.y - this.pos.y) ? b : a), lifts[0]!);
    const via = `Take the ${lift.label.toLowerCase()} to Level ${there}`; if (goalVia.value !== via) goalVia.value = via;
    return lift;
  }

  /** Ride a lift: the same shaft on another deck. A lift ride is the one jump the server accepts away from a spawn point. */
  useLift(to: Lift) {
    if (deck.value.on) { toast('You are on deck', 'Your astronaut follows the real you — scan a booth QR on the other level', 'info', 4000); return; }
    this.pos = this.nav.nearestWalkable(to.x, to.y + 1.5) ?? { x: to.x, y: to.y }; this.route = []; this.heading = Math.PI;
    this.firstPing = true; this.pingAt = 0; this.trailAt = 0; this.cam.dist = 120;
    this.camTarget.copy(toWorld(this.pos.x, this.pos.y, 1.2));
    toast(`Level ${to.deck}`, this.level.decks.find((d) => d.level === to.deck)?.label.split(' · ')[1] ?? '', 'info', 2600);
  }

  /** Walk to the current goal on its own — the "take me there" button. */
  autopilot() { if (deck.value.on) { toast('You are on deck', 'Follow the trail on foot — or tap Free roam'); return; } const p = this.nav.path(this.pos, this.goal); if (p) this.route = p.slice(1); }

  /** Live preview while editing, and the final look once saved. */
  setAvatar(spec: AvatarSpec) { this.player?.dress(spec); }
  get position(): P2 { return this.pos; }

  /* ---------------- camera ---------------- */

  private updateCamera(dt: number) {
    const c = this.cam; c.dist += (c.want - c.dist) * Math.min(1, dt * (this.player ? 2.2 : 1));
    if (this.player) this.camTarget.lerp(toWorld(this.pos.x, this.pos.y, 1.2), Math.min(1, dt * 6));
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    this.camera.position.set(this.camTarget.x + Math.sin(c.yaw) * cp * c.dist, this.camTarget.y + sp * c.dist, this.camTarget.z + Math.cos(c.yaw) * cp * c.dist);
    this.camera.lookAt(this.camTarget);
  }

  /* ---------------- proximity: stations + Launch Pad ---------------- */

  private proximity(now: number) {
    if (now - this.proxAt < 180) return; this.proxAt = now;
    const gx = Math.floor(this.pos.x / 6), gy = Math.floor(this.pos.y / 6); let best: Booth | null = null, bd = STAMP_RADIUS_M - 0.6;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const b of this.buckets.get(`${gx + i},${gy + j}`) ?? []) {
      if (b.id === this.level.hero.id) continue;
      const d = Math.hypot(b.x - this.pos.x, b.y - this.pos.y); if (d < bd) { bd = d; best = b; }
    }
    if (nearStation.value?.id !== best?.id) nearStation.value = best;
    const dock = this.level.hero.dock, near = Math.hypot(dock.x - this.pos.x, dock.y - this.pos.y) < 4.2;
    if (atLaunchPad.value !== near) atLaunchPad.value = near;
    const lift = this.level.lifts.find((l) => Math.hypot(l.x - this.pos.x, l.y - this.pos.y) < 3.4) ?? null;
    if ((nearLift.value?.here ?? null) !== lift) nearLift.value = lift ? { here: lift, others: this.level.lifts.filter((l) => l.id === lift.id && l.deck !== lift.deck).sort((a, b) => a.deck - b.deck) } : null;
    const dk = this.deckOf(this.pos); if (currentDeck.value !== dk) currentDeck.value = dk;
  }

  /** Server checks distance against the position IT last saw, so report position first. */
  async stamp(b: Booth) {
    try { await api.presence({ x: this.pos.x, y: this.pos.y, h: this.heading }); await api.stamp({ stationId: b.id, proof: 'virtual' }); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not stamp', undefined, 'warn'); }
  }

  /* ---------------- guide trail ---------------- */

  private updateTrail(now: number, t: number) {
    // The trail leads to the X until the player has their card; after that only to a place they picked.
    const wanted = guideOn.value && (guideTarget.value != null || (!me.value?.passport && me.value?.cls !== 'exhibitor'));
    if (!wanted) { if (this.trail.count) { this.trail.count = 0; distToGoal.value = null; } return; }
    if (now - this.trailAt > 1200) {
      this.trailAt = now; this.trailPath = this.nav.path(this.pos, this.goal) ?? [];
      const d = this.trailPath.length ? Math.round(pathLength(this.trailPath)) : null;
      distToGoal.value = d;
      if (guideTarget.value && !goalVia.value && d != null && d < 6) { toast('You have arrived', guideTarget.value.label); guideTarget.value = null; }
    }
    const L = pathLength(this.trailPath), n = Math.min(TRAIL_MAX, Math.floor(L / TRAIL_STEP)), M = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const d = (i + 1) * TRAIL_STEP, q = pointAlong(this.trailPath, d), s = 1 + 0.55 * Math.max(0, Math.sin(d * 0.35 - t * 5));
      M.makeScale(s, s, s).setPosition(q.x - 95, 0.45, 72 - q.y); this.trail.setMatrixAt(i, M);
    }
    this.trail.count = n; this.trail.instanceMatrix.needsUpdate = true;
  }

  /* ---------------- presence + holograms ---------------- */

  private sync(now: number) {
    if (now - this.pingAt < PING_MS || document.hidden) return; this.pingAt = now;
    const spawn = this.firstPing; this.firstPing = false;
    const d = deck.value, steps = this.stepsSincePing; this.stepsSincePing = 0;
    api.presence({ x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), h: +this.heading.toFixed(2), spawn, deck: d.on, sigma: d.on ? d.sigma : undefined, steps: d.on ? steps : undefined })
      .then((r) => { online.value = r.online; this.applyHolos(r.holograms, now); if (d.on && !r.deck) this.leaveDeck('Your venue check has lapsed — check in again from the menu'); }).catch(() => {});
  }

  private applyHolos(list: Hologram[], now: number) {
    for (const h of list.slice(0, this.quality === 'high' ? 40 : 20)) {
      let o = this.holos.get(h.id);
      if (!o) {
        const a = new Astronaut({ spec: decodeAvatar(h.av) ?? defaultAvatar(h.cls), ghost: !h.deck }); a.group.scale.setScalar(1.25); this.world.scene.add(a.group);
        const label = Object.assign(document.createElement('div'), { className: 'lbl holo', textContent: h.callsign }); this.host.appendChild(label);
        o = { a, av: h.av, deck: h.deck, x: h.x, y: h.y, tx: h.x, ty: h.y, h: h.h, label, seen: now }; this.holos.set(h.id, o);
      }
      if (o.av !== h.av) { o.av = h.av; o.a.dress(decodeAvatar(h.av) ?? defaultAvatar(h.cls)); }
      if (o.deck !== h.deck) { o.a.dispose(); o.label.remove(); this.holos.delete(h.id); continue; } // walked in / went remote: rebuild next ping with the right body
      o.tx = h.x; o.ty = h.y; o.h = h.h; o.seen = now;
    }
    for (const [id, o] of this.holos) if (now - o.seen > PING_MS * 3) { o.a.dispose(); o.label.remove(); this.holos.delete(id); }
  }

  private updateHolos(dt: number) {
    for (const o of this.holos.values()) {
      const dx = o.tx - o.x, dy = o.ty - o.y, k = Math.min(1, dt * 2.5); o.x += dx * k; o.y += dy * k;
      toWorld(o.x, o.y, 0.1, o.a.group.position); o.a.group.rotation.y = o.h; o.a.animate(dt, Math.min(1, Math.hypot(dx, dy) / 3));
    }
  }

  /* ---------------- trail effect (cosmetic, rank-unlocked) ---------------- */

  private updateDust(dt: number) {
    const d = this.dust, kind = me.value?.avatar.trail ?? 0, n = d.life.length, M = new THREE.Matrix4();
    if (kind && this.speed01 > 0.3) {
      d.acc += dt;
      while (d.acc > 0.045) {
        d.acc -= 0.045; const i = d.next; d.next = (i + 1) % n; d.life[i] = 1;
        d.p[i * 3] = this.pos.x - 95 + (Math.random() - 0.5) * 0.5; d.p[i * 3 + 1] = 0.25 + Math.random() * 0.5; d.p[i * 3 + 2] = 72 - this.pos.y + (Math.random() - 0.5) * 0.5;
        d.mesh.setColorAt(i, new THREE.Color(kind === 1 ? 0xffd65c : kind === 2 ? 0x6fe3ff : i % 2 ? 0xffc629 : 0x3aa8ff));
      }
      if (d.mesh.instanceColor) d.mesh.instanceColor.needsUpdate = true;
    }
    for (let i = 0; i < n; i++) {
      d.life[i] = Math.max(0, d.life[i]! - dt * 1.4); const s = d.life[i]!;
      M.makeScale(s, s, s).setPosition(d.p[i * 3]!, d.p[i * 3 + 1]! + (1 - s) * 0.8, d.p[i * 3 + 2]!); d.mesh.setMatrixAt(i, M);
    }
    d.mesh.instanceMatrix.needsUpdate = true;
  }

  /* ---------------- labels ---------------- */

  private updateLabels() {
    const v = new THREE.Vector3(), w = this.host.clientWidth, h = this.host.clientHeight;
    const place = (el: HTMLDivElement, pos: THREE.Vector3, maxD: number, always = false) => {
      v.copy(pos).project(this.camera); const d = this.camera.position.distanceTo(pos);
      const vis = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && (always || d < maxD);
      el.style.opacity = vis ? String(always ? 1 : THREE.MathUtils.clamp((maxD - d) / (maxD * 0.3), 0, 1)) : '0';
      if (vis) el.style.transform = `translate(-50%,-50%) translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px,${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
    };
    for (const { el, l } of this.labelEls) place(el, l.pos, l.kind === 'gate' ? 150 : 110, l.kind === 'hero');
    const p = new THREE.Vector3();
    for (const o of this.holos.values()) place(o.label, toWorld(o.x, o.y, 3.6, p), 60);
  }

  /* ---------------- adaptive resolution ---------------- */

  private adaptQuality(dt: number) {
    const f = this.fps; f.acc += dt; f.n++;
    if (f.acc < 3) return;
    const fps = f.n / f.acc; f.acc = 0; f.n = 0;
    if (fps < 28 && f.dpr > 1) { f.dpr = Math.max(1, f.dpr - 0.25); this.renderer.setPixelRatio(f.dpr); }
  }

  dispose() { this.tracker?.stop(); this.running = false; this.input.dispose(); this.stops.forEach((s) => s()); this.renderer.dispose(); this.renderer.domElement.remove(); }
  get callsign() { return me.value?.callsign ?? ''; }
}
