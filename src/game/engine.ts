import * as THREE from 'three';
import { effect } from '@preact/signals';
import type { Booth, Hologram, LevelData, Lift } from '../../shared/types';
import { ROLE_INFO, STAMP_RADIUS_M } from '../../shared/rules';
import { defaultAvatar } from '../../shared/avatar';
import { THEME } from '../theme';
import { World, toWorld, type Label, type Quality } from './world';
import { NavGrid, pathLength, pointAlong, type P2 } from './nav';
import { Astronaut } from './astronaut';
import { Input } from './input';
import { api, ApiError } from '../net/api';
import { atLaunchPad, currentDeck, distToGoal, goalVia, guideOn, guideTarget, me, nearLift, nearStation, online, stampedSet, stationMap, stations, toast } from '../state';

const RUN_SPEED = 6.5;          // m/s — brisk on purpose: halls are long
const PING_MS = 2000;
const TRAIL_STEP = 1.5, TRAIL_MAX = 220;
const BOOTH_LABELS = 6, BOOTH_LABEL_RANGE = 12;
/** A scan at a real booth is still "where you are" for this long after you come back to the game. */
const ARRIVAL_FRESH_MS = 10 * 60_000;

interface Holo { a: Astronaut; cls: Hologram['cls']; x: number; y: number; tx: number; ty: number; h: number; label: HTMLDivElement; seen: number }

export function pickQuality(): Quality {
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || mem <= 4 ? 'low' : 'high';
}

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(42, 1, 1, 1400); // a tight depth range keeps surfaces from flickering on phone GPUs
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
  private ping: { mesh: THREE.Mesh; t: number };
  private holos = new Map<string, Holo>();
  private labelEls: { el: HTMLDivElement; l: Label }[] = [];
  private boothEls: { el: HTMLDivElement; booth: Booth | null; pos: THREE.Vector3 }[] = [];
  private buckets = new Map<string, Booth[]>();
  private running = false; private last = 0; private pingAt = 0; private proxAt = 0; private firstPing = true; private arrivalSeen = 0;
  private fps = { acc: 0, n: 0, dpr: 1 };
  private stops: (() => void)[] = [];

  constructor(private host: HTMLElement, private level: LevelData, private quality: Quality) {
    // Antialiasing and the phone's real pixel density, always: this scene is a few thousand flat boxes, and edges are what people see.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); // throws without WebGL
    this.fps.dpr = Math.min(devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.fps.dpr);
    this.renderer.toneMapping = THREE.NoToneMapping; // colours on screen are the colours in theme.ts
    host.prepend(this.renderer.domElement);

    this.world = new World(level);
    this.nav = new NavGrid(level);
    for (const b of level.booths) { const k = `${Math.floor(b.x / 6)},${Math.floor(b.y / 6)}`; (this.buckets.get(k) ?? this.buckets.set(k, []).get(k)!).push(b); }

    const onFloor = { depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 } as const;
    this.trail = new THREE.InstancedMesh(new THREE.CircleGeometry(0.26, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: THEME.blue, ...onFloor }), TRAIL_MAX);
    this.trail.count = 0; this.trail.frustumCulled = false; this.trail.renderOrder = 3; this.world.scene.add(this.trail);
    this.ping = { mesh: new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: THEME.blue, transparent: true, ...onFloor })), t: 1 };
    this.ping.mesh.visible = false; this.ping.mesh.renderOrder = 3; this.world.scene.add(this.ping.mesh);

    this.input = new Input(this.renderer.domElement, {
      onTap: (x, y) => this.tapMove(x, y),
      onOrbit: (d) => { this.cam.yaw += d; },
      onZoom: (f) => { this.cam.want = THREE.MathUtils.clamp(this.cam.want * f, 12, 95); },
    });

    for (const l of this.world.labels) {
      const el = Object.assign(document.createElement('div'), { className: `lbl ${l.kind}`, textContent: l.text });
      host.appendChild(el); this.labelEls.push({ el, l });
    }
    for (let i = 0; i < BOOTH_LABELS; i++) { const el = Object.assign(document.createElement('div'), { className: 'lbl booth' }); host.appendChild(el); this.boothEls.push({ el, booth: null, pos: new THREE.Vector3() }); }

    const ro = new ResizeObserver(() => this.resize()); ro.observe(host); this.stops.push(() => ro.disconnect()); this.resize();
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.running = false; toast('Graphics paused', 'Reloading…', 'warn', 6000); setTimeout(() => location.reload(), 1500); });
    this.stops.push(effect(() => this.world.setStamped(stampedSet.value)));
    this.stops.push(effect(() => this.world.setStations(stations.value)));
    this.stops.push(effect(() => { void guideTarget.value; this.trailAt = 0; }));
    // a scan at a real booth is the server saying "this person really stood here": stand there
    this.stops.push(effect(() => { const a = me.value?.anchor; if (a && this.player && a.at > this.arrivalSeen) this.arriveAt(a.stationId, a.at); }));
    let worn: string | null = null; // changed door from the menu: change jacket
    this.stops.push(effect(() => { const role = me.value?.cls ?? null; if (this.player && role && role !== worn) { worn = role; this.player.setJacket(ROLE_INFO[role].color); this.player.dress(defaultAvatar(role)); } }));

    // a slow turn around the X behind the first screen
    this.camTarget.copy(this.world.heroPos); this.cam.yaw = 0.6; this.loop(true);
  }

  private resize() {
    const w = this.host.clientWidth || innerWidth, h = this.host.clientHeight || innerHeight;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.fov = w < h ? 50 : 42;
    // Behind the first screen the sheet covers the lower part of a phone: shift the picture up so the X sits in what is left.
    if (!this.player && w < h) this.camera.setViewOffset(w, h, 0, Math.round(h * 0.17), w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** Drop the player in at the Hall 8 entrance and hand over control. The camera falls in from above: chapter 1. */
  start(spawn: 'short' | 'epic') {
    const s = this.level.spawns[spawn], role = me.value?.cls ?? null;
    this.pos = { x: s.x, y: s.y }; this.heading = spawn === 'short' ? Math.PI : -Math.PI / 2; // rotation.y that faces north / west
    this.player?.dispose();
    this.player = new Astronaut({ spec: defaultAvatar(role), jacket: role ? ROLE_INFO[role].color : undefined, marker: THEME.blue });
    this.player.group.scale.setScalar(1.25); this.world.scene.add(this.player.group);
    this.cam.yaw = spawn === 'short' ? 0 : Math.PI / 2; this.cam.dist = 150; this.cam.want = 30; this.resize();
    this.firstPing = true; this.pingAt = 0; this.trailAt = 0;
    const a = me.value?.anchor;
    if (a && Date.now() - a.at < ARRIVAL_FRESH_MS) this.arriveAt(a.stationId, a.at); else if (a) this.arrivalSeen = a.at;
  }

  /** A scan at a real booth: the astronaut appears where the person stands, and stays free to walk on. */
  private arriveAt(stationId: string, at: number) {
    const b = this.level.booths.find((x) => x.id === stationId); this.arrivalSeen = at; if (!b) return;
    this.pos = this.nav.nearestWalkable(b.x, b.y) ?? { x: b.x, y: b.y }; this.route = []; this.firstPing = true; this.pingAt = 0; this.trailAt = 0;
    this.camTarget.copy(toWorld(this.pos.x, this.pos.y, 1.2));
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
    if (this.player) { this.movePlayer(dt); this.proximity(now); this.updateTrail(now, t); this.sync(now); this.updateHolos(dt); }
    else { this.cam.yaw += dt * 0.1; this.cam.dist += (64 - this.cam.dist) * Math.min(1, dt * 1.5); }
    this.updatePing(dt); this.updateCamera(dt); this.updateLabels();
    this.renderer.render(this.world.scene, this.camera);
    this.adaptQuality(dt);
  }

  /* ---------------- movement ---------------- */

  private movePlayer(dt: number) {
    const p = this.player!, inp = this.input.move; let dx = 0, dy = 0;
    if (inp.x || inp.y) {
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
    toWorld(this.pos.x, this.pos.y, 0, p.group.position); p.group.rotation.y = this.heading;
    p.animate(dt, this.speed01);
  }

  private tapMove(cx: number, cy: number) {
    if (!this.player) return;
    const r = this.renderer.domElement.getBoundingClientRect(), ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); if (!hit) return;
    const path = this.nav.path(this.pos, { x: hit.x + 95, y: 72 - hit.z }); if (!path) return;
    this.route = path.slice(1);
    const end = path[path.length - 1]!; toWorld(end.x, end.y, 0.04, this.ping.mesh.position); this.ping.t = 0; // "understood: going there"
  }

  private updatePing(dt: number) {
    const p = this.ping; if (p.t >= 1) { p.mesh.visible = false; return; }
    p.t = Math.min(1, p.t + dt * 2.2); const s = 0.6 + p.t * 1.6;
    p.mesh.visible = true; p.mesh.scale.set(s, 1, s); (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p.t;
  }

  levelOf(p: P2): number { const d = this.level.decks; return (d.find((k) => p.y >= k.y0 - 15 && p.y <= k.y1 + 15) ?? d[0]!).level; }

  /** Where the trail leads. A goal on another level is reached through the nearest lift on this one. */
  private get goal(): P2 {
    const target = guideTarget.value ?? this.level.hero.dock, here = this.levelOf(this.pos), there = this.levelOf(target);
    if (here === there) { if (goalVia.value) goalVia.value = null; return target; }
    const lifts = this.level.lifts.filter((l) => l.deck === here), lift = lifts.reduce((a, b) => (Math.hypot(b.x - this.pos.x, b.y - this.pos.y) < Math.hypot(a.x - this.pos.x, a.y - this.pos.y) ? b : a), lifts[0]!);
    const via = `Take the ${lift.label.toLowerCase()} to Level ${there}`; if (goalVia.value !== via) goalVia.value = via;
    return lift;
  }

  /** Ride a lift: the same shaft on another level. A lift ride is the one jump the server accepts away from the entrance. */
  useLift(to: Lift) {
    this.pos = this.nav.nearestWalkable(to.x, to.y + 1.5) ?? { x: to.x, y: to.y }; this.route = []; this.heading = Math.PI;
    this.firstPing = true; this.pingAt = 0; this.trailAt = 0; this.cam.dist = 110;
    this.camTarget.copy(toWorld(this.pos.x, this.pos.y, 1.2));
    toast(`Level ${to.deck}`, this.level.decks.find((d) => d.level === to.deck)?.label.split(' · ')[1] ?? '', 'info', 2600);
  }

  /** Walk to the current goal on its own — the "take me there" button. */
  autopilot() { const p = this.nav.path(this.pos, this.goal); if (p) this.route = p.slice(1); }

  /* ---------------- camera ---------------- */

  private updateCamera(dt: number) {
    const c = this.cam; c.dist += (c.want - c.dist) * Math.min(1, dt * (this.player ? 2.2 : 1));
    if (this.player) this.camTarget.lerp(toWorld(this.pos.x, this.pos.y, 1.2), Math.min(1, dt * 6));
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    this.camera.position.set(this.camTarget.x + Math.sin(c.yaw) * cp * c.dist, this.camTarget.y + sp * c.dist, this.camTarget.z + Math.cos(c.yaw) * cp * c.dist);
    this.camera.lookAt(this.camTarget);
  }

  /* ---------------- what is next to the player: a booth, the X, a lift; and which booth names to show ---------------- */

  private proximity(now: number) {
    if (now - this.proxAt < 180) return; this.proxAt = now;
    const gx = Math.floor(this.pos.x / 6), gy = Math.floor(this.pos.y / 6), around: { b: Booth; d: number }[] = [];
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (const b of this.buckets.get(`${gx + i},${gy + j}`) ?? []) {
      if (b.id === this.level.hero.id) continue;
      const d = Math.hypot(b.x - this.pos.x, b.y - this.pos.y); if (d < BOOTH_LABEL_RANGE) around.push({ b, d });
    }
    around.sort((a, b) => a.d - b.d);
    const best = around[0] && around[0].d < STAMP_RADIUS_M - 0.6 ? around[0].b : null;
    if (nearStation.value?.id !== best?.id) nearStation.value = best;

    // Names appear for the few booths around you — crisp type instead of 1,599 tiny roof signs.
    const sm = stationMap.value, named = around.filter((x) => x.b.name || sm.has(x.b.id)).slice(0, BOOTH_LABELS);
    this.boothEls.forEach((slot, i) => {
      const b = named[i]?.b ?? null; if (slot.booth === b) return;
      slot.booth = b;
      if (b) { slot.el.textContent = sm.get(b.id)?.company || b.name; slot.el.classList.toggle('online', sm.has(b.id)); toWorld(b.x, b.y, this.level.booth.h + 0.9, slot.pos); }
    });

    const dock = this.level.hero.dock, near = Math.hypot(dock.x - this.pos.x, dock.y - this.pos.y) < 4.2;
    if (atLaunchPad.value !== near) atLaunchPad.value = near;
    const lift = this.level.lifts.find((l) => Math.hypot(l.x - this.pos.x, l.y - this.pos.y) < 3.4) ?? null;
    if ((nearLift.value?.here ?? null) !== lift) nearLift.value = lift ? { here: lift, others: this.level.lifts.filter((l) => l.id === lift.id && l.deck !== lift.deck).sort((a, b) => a.deck - b.deck) } : null;
    const lv = this.levelOf(this.pos); if (currentDeck.value !== lv) currentDeck.value = lv;
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
    for (let i = 0; i < n; i++) { // a slow wave runs along the dots, away from the player: it reads as "this way"
      const d = (i + 1) * TRAIL_STEP, q = pointAlong(this.trailPath, d), s = 1 + 0.45 * Math.max(0, Math.sin(d * 0.3 - t * 4));
      M.makeScale(s, 1, s).setPosition(q.x - 95, 0.04, 72 - q.y); this.trail.setMatrixAt(i, M);
    }
    this.trail.count = n; this.trail.instanceMatrix.needsUpdate = true;
  }

  /* ---------------- other people ---------------- */

  private sync(now: number) {
    if (now - this.pingAt < PING_MS || document.hidden) return; this.pingAt = now;
    const spawn = this.firstPing; this.firstPing = false;
    api.presence({ x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), h: +this.heading.toFixed(2), spawn })
      .then((r) => { online.value = r.online; this.applyHolos(r.holograms, now); }).catch(() => {});
  }

  private applyHolos(list: Hologram[], now: number) {
    for (const h of list.slice(0, this.quality === 'high' ? 40 : 24)) {
      let o = this.holos.get(h.id);
      if (o && o.cls !== h.cls) { o.a.dispose(); o.label.remove(); this.holos.delete(h.id); o = undefined; } // changed door: new jacket
      if (!o) {
        const a = new Astronaut({ spec: defaultAvatar(h.cls), jacket: h.cls ? ROLE_INFO[h.cls].color : undefined }); a.group.scale.setScalar(1.25); this.world.scene.add(a.group);
        const label = Object.assign(document.createElement('div'), { className: 'lbl person', textContent: h.callsign }); this.host.appendChild(label);
        o = { a, cls: h.cls, x: h.x, y: h.y, tx: h.x, ty: h.y, h: h.h, label, seen: now }; this.holos.set(h.id, o);
      }
      if (o.label.textContent !== h.callsign) o.label.textContent = h.callsign;
      o.tx = h.x; o.ty = h.y; o.h = h.h; o.seen = now;
    }
    for (const [id, o] of this.holos) if (now - o.seen > PING_MS * 3) { o.a.dispose(); o.label.remove(); this.holos.delete(id); }
  }

  private updateHolos(dt: number) {
    for (const o of this.holos.values()) {
      const dx = o.tx - o.x, dy = o.ty - o.y, k = Math.min(1, dt * 2.5); o.x += dx * k; o.y += dy * k;
      toWorld(o.x, o.y, 0, o.a.group.position); o.a.group.rotation.y = o.h; o.a.animate(dt, Math.min(1, Math.hypot(dx, dy) / 3));
    }
  }

  /* ---------------- labels: HTML, snapped to whole pixels so type stays sharp ---------------- */

  private updateLabels() {
    const v = new THREE.Vector3(), w = this.host.clientWidth, h = this.host.clientHeight, taken: [number, number, number, number][] = [];
    // Placed in order of importance; a label that would sit on one already placed stays hidden this frame.
    const place = (el: HTMLDivElement, pos: THREE.Vector3, maxD: number, always = false) => {
      v.copy(pos).project(this.camera); const d = this.camera.position.distanceTo(pos);
      let vis = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && (always || d < maxD);
      const x = Math.round((v.x * 0.5 + 0.5) * w), y = Math.round((-v.y * 0.5 + 0.5) * h);
      if (vis) {
        const hw = (el.textContent?.length ?? 8) * 3.6 + 14, box: [number, number, number, number] = [x - hw, y - 11, x + hw, y + 11];
        if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) vis = false; else taken.push(box);
      }
      el.style.opacity = vis ? String(always ? 1 : THREE.MathUtils.clamp((maxD - d) / (maxD * 0.25), 0, 1)) : '0';
      if (vis) el.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px)`;
    };
    const hero = this.labelEls.find((x) => x.l.kind === 'hero'); if (hero) place(hero.el, hero.l.pos, 0, true);
    for (const s of this.boothEls) { if (s.booth) place(s.el, s.pos, 52); else s.el.style.opacity = '0'; }
    const p = new THREE.Vector3();
    for (const o of this.holos.values()) place(o.label, toWorld(o.x, o.y, 3.5, p), 44);
    for (const { el, l } of this.labelEls) if (l.kind !== 'hero') place(el, l.pos, l.kind === 'gate' ? 110 : 80);
  }

  /* ---------------- resolution: start sharp, give a little only if the phone cannot keep up ---------------- */

  private adaptQuality(dt: number) {
    const f = this.fps; f.acc += dt; f.n++;
    if (f.acc < 4) return;
    const fps = f.n / f.acc; f.acc = 0; f.n = 0;
    if (fps < 24 && f.dpr > 1.25) { f.dpr = Math.max(1.25, f.dpr - 0.25); this.renderer.setPixelRatio(f.dpr); }
  }

  dispose() { this.running = false; this.input.dispose(); this.stops.forEach((s) => s()); this.renderer.dispose(); this.renderer.domElement.remove(); }
}
