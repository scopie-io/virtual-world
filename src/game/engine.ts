import * as THREE from 'three';
import { effect } from '@preact/signals';
import type { Booth, Hologram, LevelData, Lift } from '../../shared/types';
import { ROLE_INFO, STAMP_RADIUS_M, type Pose } from '../../shared/rules';
import { defaultAvatar } from '../../shared/avatar';
import { THEME } from '../theme';
import { World, toWorld, type Label, type Quality } from './world';
import { NavGrid, pathLength, pointAlong, type P2 } from './nav';
import { Astronaut } from './astronaut';
import { Input } from './input';
import { placeAt, taken, type Seat } from './places';
import { RemoteTrack } from './remote';
import { BoothPicker } from './pick';
import { newMover, stepMover, RUN_SPEED } from './mover';
import { hallCards, hallLine } from './facts';
import { api, ApiError } from '../net/api';
import { sfx } from '../sfx';
import { atLaunchPad, currentDeck, distToGoal, goalVia, guideOn, guideTarget, herePlace, markSeen, me, modal, moveHint, nearLift, nearStation, online, panelStation, photoShot, seated, seen, stampedSet, stationMap, stations, toast } from '../state';

const JUMP_S = 0.52, JUMP_M = 1.0;
const PING_MS = 2000;
const TRAIL_STEP = 1.5, TRAIL_MAX = 220;
const BOOTH_LABELS = 6, BOOTH_LABEL_RANGE = 12;
/** A scan at a real booth is still "where you are" for this long after you come back to the game. */
const ARRIVAL_FRESH_MS = 10 * 60_000;

interface Holo { a: Astronaut; cls: Hologram['cls']; track: RemoteTrack; tx: number; ty: number; label: HTMLDivElement; seen: number; sitting: boolean }

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
  private mv = newMover(); // where the astronaut is and where it is going: mover.ts
  private get pos(): P2 { return this.mv.pos; } private set pos(p: P2) { this.mv.pos = p; }
  private get heading() { return this.mv.heading; } private set heading(h: number) { this.mv.heading = h; }
  private get speed01() { return this.mv.speed01; }
  private get route(): P2[] { return this.mv.route; } private set route(r: P2[]) { this.mv.route = r; this.mv.stall = 0; this.mv.replans = 0; }
  private get vel(): P2 { return this.mv.vel; }
  private cam = { yaw: 0, pitch: 1.0, dist: 170, want: 26, goalYaw: 0, goalPitch: 1.0 };
  private camTarget = new THREE.Vector3();
  private trail: THREE.InstancedMesh;
  private trailPath: P2[] = [];
  private trailAt = 0;
  private ping: { mesh: THREE.Mesh; t: number };
  private holos = new Map<string, Holo>();
  private labelEls: { el: HTMLDivElement; l: Label }[] = [];
  private labelCache = new WeakMap<HTMLDivElement, { o: string; t: string }>();
  private boothEls: { el: HTMLDivElement; booth: Booth | null; pos: THREE.Vector3 }[] = [];
  private buckets = new Map<string, Booth[]>();
  private running = false; private last = 0; private pingAt = 0; private proxAt = 0; private firstPing = true; private arrivalSeen = 0;
  private fps = { acc: 0, n: 0, dpr: 1, at: 0 };
  private perf: { el: HTMLDivElement; t0: number; frames: number; cpu: number; parts: Record<string, number> } | null = null;
  private ui = 1; // the interface scale from ui.css (--ui): label boxes grow with the type
  private pose: Pose = ''; private poseUntil = 0; private jumpT = 1; private seat: Seat | null = null; private wantBeforeSit = 30;
  private liftT = 1; private hallNow: number | null = null;
  /** the opening: one unbroken move from the X, where the first screen was looking, to the player at the door */
  private intro: { t: number; from: THREE.Vector3; dist: number; yaw: number; toYaw: number } | null = null;
  private walked = 0;
  private seatGoal: Seat | null = null;
  private picker: BoothPicker;
  private mouse: { x: number; y: number } | null = null; private hoverAt = 0;
  private hover: { booth: Booth; el: HTMLDivElement; pos: THREE.Vector3 } | null = null; private hoverEl: HTMLDivElement;
  /** the booth the player pressed: walked to, framed until they get there, and preferred over its neighbours once they do */
  private picked: Booth | null = null;
  private halls: ReturnType<typeof hallCards>;
  private stops: (() => void)[] = [];

  constructor(private host: HTMLElement, private level: LevelData, private quality: Quality) {
    // Antialiasing and the phone's real pixel density, always: this scene is a few thousand flat boxes, and edges are what people see.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); // throws without WebGL
    this.fps.dpr = Math.min(devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.fps.dpr);
    this.renderer.toneMapping = THREE.NoToneMapping; // colours on screen are the colours in theme.ts
    host.prepend(this.renderer.domElement);

    this.world = new World(level);
    this.halls = hallCards(level);
    this.nav = new NavGrid(level);
    this.picker = new BoothPicker(level);
    for (const b of level.booths) { const k = `${Math.floor(b.x / 6)},${Math.floor(b.y / 6)}`; (this.buckets.get(k) ?? this.buckets.set(k, []).get(k)!).push(b); }

    const onFloor = { depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 } as const;
    this.trail = new THREE.InstancedMesh(new THREE.CircleGeometry(0.26, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: THEME.blue, ...onFloor }), TRAIL_MAX);
    this.trail.count = 0; this.trail.frustumCulled = false; this.trail.renderOrder = 3; this.world.scene.add(this.trail);
    this.ping = { mesh: new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: THEME.blue, transparent: true, ...onFloor })), t: 1 };
    this.ping.mesh.visible = false; this.ping.mesh.renderOrder = 3; this.world.scene.add(this.ping.mesh);

    this.input = new Input(this.renderer.domElement, {
      onTap: (x, y) => this.tapMove(x, y),
      onHover: (at) => { this.mouse = at; this.hoverAt = 0; },
      onOrbit: (dYaw, dPitch) => { this.intro = null; this.cam.goalYaw += dYaw; this.cam.goalPitch = THREE.MathUtils.clamp(this.cam.goalPitch + dPitch, 0.62, 1.32); }, // from a low three-quarter view to almost straight down
      onZoom: (f) => { this.cam.want = THREE.MathUtils.clamp(this.cam.want * f, 12, 95); },
      enabled: () => !modal.value,
    });
    this.stops.push(effect(() => { if (modal.value) this.input.release(); })); // a sheet opened: stop walking, forget held keys

    for (const l of this.world.labels) {
      const el = Object.assign(document.createElement('div'), { className: `lbl ${l.kind}`, textContent: l.text });
      host.appendChild(el); this.labelEls.push({ el, l });
    }
    this.hoverEl = Object.assign(document.createElement('div'), { className: 'lbl booth tip' }); host.appendChild(this.hoverEl);
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

    const key = (e: KeyboardEvent) => { // desk shortcuts: space jumps, E does the thing in front of you, 1-3 express
      if (!this.player || e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || modal.value) return;
      if (e.code === 'Space') { e.preventDefault(); this.jump(); } else if (e.code === 'KeyE') void this.interact();
      else if (e.code === 'Digit1') this.emote('wave'); else if (e.code === 'Digit2') this.emote('cheer'); else if (e.code === 'Digit3') this.emote('dance');
      else if (e.code === 'KeyM') modal.value = 'map';
    };
    window.addEventListener('keydown', key); this.stops.push(() => window.removeEventListener('keydown', key));

    if (new URLSearchParams(location.search).has('perf')) {
      this.perf = { el: Object.assign(document.createElement('div'), { className: 'perf' }), t0: performance.now(), frames: 0, cpu: 0, parts: {} }; host.appendChild(this.perf.el);
      (window as unknown as { __mx?: unknown }).__mx = { scene: this.world.scene, mover: () => ({ x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), route: this.route.length, next: this.route[0] ?? null, speed: +this.speed01.toFixed(2), stall: +this.mv.stall.toFixed(2), replans: this.mv.replans, seat: !!this.seat, stick: { ...this.input.move } }), info: () => ({ ...this.renderer.info.render, dpr: this.fps.dpr, holos: this.holos.size }) };
    }

    // a slow turn around the X behind the first screen
    this.camTarget.copy(this.world.heroPos); this.cam.yaw = this.cam.goalYaw = 0.6; this.loop(true);
  }

  private resize() {
    const w = this.host.clientWidth || innerWidth, h = this.host.clientHeight || innerHeight;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.fov = w < h ? 50 : 42;
    this.ui = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui')) || 1;
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
    this.world.scene.add(this.player.group);
    // No cut: the camera leaves the X, rises, crosses the hall and settles behind the player. 2.4 s, and the player can walk at once.
    const toYaw = spawn === 'short' ? 0 : Math.PI / 2, yaw = toYaw + Math.atan2(Math.sin(this.cam.yaw - toYaw), Math.cos(this.cam.yaw - toYaw)); // the short way round
    this.intro = { t: 0, from: this.camTarget.clone(), dist: this.cam.dist, yaw, toYaw }; this.cam.yaw = this.cam.goalYaw = yaw; this.cam.want = 26; this.resize();
    this.walked = 0; if (!seen.value.has('hint:move')) moveHint.value = true;
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
    const t = now / 1000, pf = this.perf, c0 = pf ? performance.now() : 0;
    let mark = c0; const lap = (k: string) => { if (!pf) return; const n = performance.now(); pf.parts[k] = (pf.parts[k] ?? 0) + n - mark; mark = n; };
    this.world.update(t, dt);
    if (this.player) { this.movePlayer(dt); this.proximity(now); lap('move'); this.updateTrail(now, t); lap('trail'); this.sync(now); this.updateHolos(now, dt); lap('people'); }
    else { this.cam.goalYaw += dt * 0.1; this.cam.dist += (64 - this.cam.dist) * Math.min(1, dt * 1.5); }
    this.updatePing(dt); this.updateCamera(dt); this.pointAt(now); lap('camera'); this.updateLabels(); lap('labels');
    this.world.troupe.end();
    this.renderer.render(this.world.scene, this.camera); lap('render');
    this.adaptQuality(now);
    if (pf) {
      pf.frames++; pf.cpu += performance.now() - c0;
      if (now - pf.t0 >= 1000) {
        const i = this.renderer.info.render, n = pf.frames, parts = Object.entries(pf.parts).map(([k, v]) => `${k} ${(v / n).toFixed(1)}`).join(' · ');
        pf.el.textContent = `${Math.round((n * 1000) / (now - pf.t0))} fps · ${(pf.cpu / n).toFixed(1)} ms · ${i.calls} calls · ${Math.round(i.triangles / 1000)}k tris · dpr ${this.fps.dpr}\n${parts}`;
        pf.t0 = now; pf.frames = 0; pf.cpu = 0; pf.parts = {};
      }
    }
  }

  /* ---------------- movement ---------------- */

  private movePlayer(dt: number) {
    const p = this.player!, inp = this.input.move; let stick: P2 | null = null;
    if (this.seat) { // sitting: any push on the stick, or a tap on the floor, stands you up
      if (inp.x || inp.y || this.route.length) this.stand();
      else { toWorld(this.pos.x, this.pos.y, 0, p.group.position); p.group.rotation.y = this.heading; p.animate(dt, 0); return; }
    }
    if (inp.x || inp.y) {
      this.seatGoal = null;
      const s = Math.sin(this.cam.yaw), c = Math.cos(this.cam.yaw);
      const wx = c * inp.x - s * inp.y, wz = -s * inp.x - c * inp.y;   // screen → world
      stick = { x: wx, y: -wz };
    } else if (!this.route.length && this.seatGoal) this.takeSeat(this.seatGoal); // walked up to the chair: sit
    const moved = stepMover(this.mv, this.nav, dt, stick);
    if (moveHint.value && (this.walked += moved) > 4) { moveHint.value = false; markSeen('hint:move'); }

    const now = performance.now();
    if (this.pose && this.pose !== 'sit' && now > this.poseUntil) this.setPose('');
    let lift = 0; if (this.jumpT < 1) { this.jumpT = Math.min(1, this.jumpT + dt / JUMP_S); lift = 4 * JUMP_M * this.jumpT * (1 - this.jumpT); }
    toWorld(this.pos.x, this.pos.y, lift, p.group.position); p.group.rotation.y = this.heading;
    p.animate(dt, this.speed01);
  }

  /* ---------------- things to do: expression, sitting, photos. None of it scores; all of it is seen by others. ---------------- */

  private setPose(pose: Pose, seatZ?: number) {
    if (pose === this.pose) return;
    this.pose = pose; this.player?.setPose(pose, seatZ); this.pingAt = Math.min(this.pingAt, performance.now() - PING_MS + 120); // tell the others soon
  }
  emote(pose: 'wave' | 'cheer' | 'dance', ms = pose === 'dance' ? 5200 : 2600) { if (!this.player) return; if (this.seat) this.stand(); this.setPose(pose); this.poseUntil = performance.now() + ms; }
  jump() { if (!this.player || this.jumpT < 1) return; if (this.seat) this.stand(); this.jumpT = 0; sfx('jump'); this.setPose('jump'); this.poseUntil = performance.now() + JUMP_S * 1000; }

  /** A seat is free if the quiet crowd is not in it and no player we can see is sitting there. */
  private freeSeats(pl: NonNullable<typeof herePlace.value>): Seat[] {
    const sitters = [...this.holos.values()].filter((o) => o.sitting);
    return pl.seats.filter((s, i) => !taken(pl, i) && !sitters.some((o) => Math.hypot(o.tx - s.x, o.ty - s.y) < 0.7));
  }

  /** Walk to the nearest free seat of the place you are in, and sit down when you get there. */
  sit() {
    const pl = herePlace.value; if (!this.player || !pl || this.seat) return;
    const d = (s: Seat) => Math.hypot(s.x - this.pos.x, s.y - this.pos.y), s = this.freeSeats(pl).reduce<Seat | null>((best, x) => (!best || d(x) < d(best) ? x : best), null);
    if (!s) { toast('Every seat is taken', 'Try again in a moment'); return; }
    if (d(s) < 1.6) return this.takeSeat(s);
    const path = this.nav.path(this.pos, s); if (!path) return this.takeSeat(s);
    this.route = path.slice(1); this.seatGoal = s;
  }
  private takeSeat(s: Seat) {
    this.seatGoal = null;
    const pl = herePlace.value; if (pl && !this.freeSeats(pl).includes(s)) { this.sit(); return; } // someone got there first: the next one
    this.seat = s; this.pos = { x: s.x, y: s.y }; this.heading = s.h; this.route = []; this.vel.x = this.vel.y = 0;
    this.setPose('sit', s.z); sfx('sit'); seated.value = true; this.wantBeforeSit = this.cam.want; this.cam.want = Math.min(this.cam.want, 15);
  }
  stand() {
    if (!this.seat) return;
    this.pos = this.nav.nearestWalkable(this.seat.x, this.seat.y, 4) ?? this.pos; this.seat = null; seated.value = false; this.setPose(''); this.cam.want = this.wantBeforeSit;
  }

  /** The one contextual action, for the E key: what the big button would do. */
  async interact() {
    if (this.seat) return this.stand();
    const pl = herePlace.value, st = nearStation.value;
    if (pl?.verb === 'photo') return void (await this.photo());
    if (pl?.verb) return this.sit();
    if (st && !stampedSet.value.has(st.id)) await this.stamp(st);
  }

  /**
   * A portrait of your astronaut, waving, with whatever is behind them — on the photo mark that is the MIHAS wall.
   * Rendered off to the side of the live view at a fixed size, framed, and handed to the photo sheet to share or save.
   */
  async photo(): Promise<void> {
    const p = this.player; if (!p) return;
    if (this.seat) this.stand();
    const spot = herePlace.value?.spot; if (spot) { this.pos = { x: spot.x, y: spot.y }; this.heading = spot.h; this.route = []; this.vel.x = this.vel.y = 0; }
    // The photographer needs room. Look for open floor in front of the astronaut; failing that, turn them to where there is some.
    const room = (h: number) => { let d = 0; while (d < 6.8 && this.nav.walkable(this.pos.x + Math.sin(h) * (d + 0.5), this.pos.y - Math.cos(h) * (d + 0.5))) d += 0.5; return d; };
    if (!spot && room(this.heading) < 6) this.heading = [0.5, -0.5, 1, 0.25, -0.25, 0.75, -0.75].map((k) => this.heading + k * Math.PI).reduce((best, h) => (room(h) > room(best) ? h : best), this.heading);
    const dist = spot ? 6.6 : Math.max(3, Math.min(6.6, room(this.heading) - 0.2));
    const W = 1080, H = 1350, cam = new THREE.PerspectiveCamera(Math.min(58, 31 * (6.6 / dist)), W / H, 0.5, 700), r = this.renderer;
    const fwd = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)), at = toWorld(this.pos.x, this.pos.y, 1.5);
    cam.position.copy(at).addScaledVector(fwd, dist).setY(1.9); cam.lookAt(at.x, 0.92, at.z); // head to toe, with room for the caption band
    toWorld(this.pos.x, this.pos.y, 0, p.group.position); p.group.rotation.y = this.heading; p.setPose('wave'); p.animate(0.2, 0);
    const size = r.getSize(new THREE.Vector2()), pr = r.getPixelRatio(), trail = this.trail.visible;
    this.trail.visible = false; this.ping.mesh.visible = false;
    sfx('shutter'); r.setPixelRatio(1); r.setSize(W, H, false); r.render(this.world.scene, cam);
    const shot = await createImageBitmap(r.domElement).catch(() => null);
    r.setPixelRatio(pr); r.setSize(size.x, size.y, false); this.trail.visible = trail; p.setPose(this.pose);
    if (!shot) { toast('Could not take the photo on this device', undefined, 'warn'); return; }

    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d')!;
    g.drawImage(shot, 0, 0, W, H); g.fillStyle = '#fff'; g.fillRect(0, H - 170, W, 170);
    g.fillStyle = '#1b2130'; g.textBaseline = 'alphabetic'; g.font = '800 46px Urbanist, Arial'; g.fillText(me.value?.callsign ?? 'Mission X', 56, H - 96);
    g.fillStyle = '#5a6172'; g.font = '600 30px Urbanist, Arial'; g.fillText('at MIHAS 2026 · MITEC Kuala Lumpur', 56, H - 50);
    g.textAlign = 'right'; g.fillStyle = '#1b2130'; g.font = '800 40px Urbanist, Arial'; g.fillText('MISSION X', W - 56, H - 96); g.fillStyle = '#2457f5'; g.font = '700 30px Urbanist, Arial'; g.fillText('Find the X · Booth 8H18B', W - 56, H - 50);
    photoShot.value = c.toDataURL('image/jpeg', 0.9); modal.value = 'photo'; api.track('photo', { place: herePlace.value?.id ?? null });
  }

  private rayAt(cx: number, cy: number): THREE.Ray {
    const r = this.renderer.domElement.getBoundingClientRect(), ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera); return ray.ray;
  }
  /** The booth under a point of the screen (pick.ts works in plan space: x east, y north, z up). */
  private boothAt(cx: number, cy: number): Booth | null {
    const { origin: o, direction: d } = this.rayAt(cx, cy);
    return this.picker.pick({ ox: o.x + 95, oy: 72 - o.z, oz: o.y, dx: d.x, dy: -d.z, dz: d.y });
  }

  private tapMove(cx: number, cy: number) {
    if (!this.player) return;
    const booth = this.boothAt(cx, cy); if (booth) return this.goToBooth(booth);
    const hit = this.rayAt(cx, cy).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); if (!hit) return;
    this.pick(null); this.walkTo({ x: hit.x + 95, y: 72 - hit.z });
  }
  private walkTo(to: P2): boolean {
    if (this.seat) this.stand();
    this.seatGoal = null;
    const path = this.nav.path(this.pos, to); if (!path) return false;
    this.route = path.slice(1);
    const end = path[path.length - 1]!; toWorld(end.x, end.y, 0.04, this.ping.mesh.position); this.ping.t = 0; sfx('go'); // "understood: going there"
    return true;
  }
  private pick(b: Booth | null) { this.picked = b; this.world.mark('goal', b); }

  /**
   * A press on a booth: walk up to it. On arrival the Stamp button is for that booth, not whichever neighbour is a
   * hand closer. Pressing the booth you are already standing at opens it; pressing the X walks to its counter.
   */
  private goToBooth(b: Booth) {
    if (b.id === this.level.hero.id) { this.pick(null); this.walkTo(this.level.hero.dock); return; }
    if (nearStation.value?.id === b.id && !this.route.length) { panelStation.value = b; modal.value = 'booth'; return; }
    const { w, d } = this.level.booth, off = (k: number) => k / 2 + 1.1, dist = (p: P2) => Math.hypot(p.x - this.pos.x, p.y - this.pos.y);
    const fronts = [{ x: b.x, y: b.y - off(d) }, { x: b.x, y: b.y + off(d) }, { x: b.x - off(w), y: b.y }, { x: b.x + off(w), y: b.y }].filter((p) => this.nav.walkable(p.x, p.y)).sort((p, q) => dist(p) - dist(q));
    const to = fronts[0] ?? this.nav.nearestWalkable(b.x, b.y, 10); if (!to) return;
    if (this.walkTo(to)) this.pick(b);
  }

  /** Desktop: what the mouse is resting on. Looked up a few times a second — the view moves under a still mouse too. */
  private pointAt(now: number) {
    if (now - this.hoverAt < 90) return; this.hoverAt = now;
    const b = this.mouse && this.player && !modal.value ? this.boothAt(this.mouse.x, this.mouse.y) : null;
    if (b?.id === this.hover?.booth.id) return;
    this.input.setCursor(b ? 'pointer' : 'grab');
    const hero = b?.id === this.level.hero.id; // the X has its own sign; the cursor is enough
    this.world.mark('hover', b && !hero ? b : null);
    if (!b || hero) { this.hover = b ? { booth: b, el: this.hoverEl, pos: new THREE.Vector3() } : null; return; }
    const st = stationMap.value.get(b.id), name = st?.company || b.name;
    this.hoverEl.textContent = name ? `${b.id} · ${name}` : `Booth ${b.id}`; this.hoverEl.classList.toggle('online', !!st);
    this.hover = { booth: b, el: this.hoverEl, pos: toWorld(b.x, b.y, this.level.booth.h + (st ? 2.7 : 1.5)) };
  }

  private updatePing(dt: number) {
    const p = this.ping; if (p.t >= 1) { p.mesh.visible = false; return; }
    p.t = Math.min(1, p.t + dt * 2.2); const s = 0.6 + p.t * 1.6;
    p.mesh.visible = true; p.mesh.scale.set(s, 1, s); (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p.t;
  }

  get position(): P2 { return this.pos; }
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
    if (this.seat) this.stand();
    sfx(to.deck > this.levelOf(this.pos) ? 'liftUp' : 'liftDown');
    this.pos = this.nav.nearestWalkable(to.x, to.y + 1.5) ?? { x: to.x, y: to.y }; this.route = []; this.heading = Math.PI; this.vel.x = this.vel.y = 0;
    this.firstPing = true; this.pingAt = 0; this.trailAt = 0; this.liftT = 0; // the camera rises, crosses to the other level and comes back down
    toast(`Level ${to.deck}`, this.level.decks.find((d) => d.level === to.deck)?.label.split(' · ')[1] ?? '', 'info', 2600);
  }

  /** Walk to the current goal on its own — the "take me there" button. */
  autopilot() { if (this.seat) this.stand(); this.seatGoal = null; const p = this.nav.path(this.pos, this.goal); if (p) this.route = p.slice(1); }

  /* ---------------- camera ---------------- */

  private updateCamera(dt: number) {
    const c = this.cam, riding = this.liftT < 1; if (riding) this.liftT = Math.min(1, this.liftT + dt / 1.5);
    const it = this.intro;
    if (it) {
      it.t = Math.min(1, it.t + dt / 2.4); const k = it.t, e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // ease in and out
      const to = toWorld(this.pos.x, this.pos.y, 1.2);
      this.camTarget.lerpVectors(it.from, to, e); c.dist = it.dist + (c.want - it.dist) * e + Math.sin(Math.PI * e) * 22; c.yaw = c.goalYaw = it.yaw + (it.toYaw - it.yaw) * e;
      if (k >= 1) this.intro = null;
      const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
      this.camera.position.set(this.camTarget.x + Math.sin(c.yaw) * cp * c.dist, this.camTarget.y + sp * c.dist, this.camTarget.z + Math.cos(c.yaw) * cp * c.dist);
      this.camera.lookAt(this.camTarget); return;
    }
    const want = riding ? c.want + 95 * Math.sin(Math.PI * this.liftT) : c.want;
    c.dist += (want - c.dist) * Math.min(1, dt * (this.player ? (riding ? 5 : 2.2) : 1));
    c.yaw += (c.goalYaw - c.yaw) * Math.min(1, dt * 14); c.pitch += (c.goalPitch - c.pitch) * Math.min(1, dt * 14);
    if (this.player) this.camTarget.lerp(toWorld(this.pos.x + this.vel.x * 0.22, this.pos.y + this.vel.y * 0.22, 1.2), Math.min(1, dt * (riding ? 2.6 : 5)));
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
    let best = around[0] && around[0].d < STAMP_RADIUS_M - 0.6 ? around[0].b : null;
    const pk = this.picked;
    if (pk) {
      const d = Math.hypot(pk.x - this.pos.x, pk.y - this.pos.y);
      if (d < STAMP_RADIUS_M - 0.6) best = pk;
      if (!this.route.length) { this.world.mark('goal', null); if (d > STAMP_RADIUS_M + 2) this.picked = null; } // arrived, or walked off on the stick
    }
    if (nearStation.value?.id !== best?.id) nearStation.value = best;

    // Every stand has its name on its roof. A floating label marks the ones whose exhibitor is in the game right now.
    const sm = stationMap.value, named = around.filter((x) => sm.has(x.b.id)).slice(0, BOOTH_LABELS);
    this.boothEls.forEach((slot, i) => {
      const b = named[i]?.b ?? null; if (slot.booth === b) return;
      slot.booth = b;
      if (b) { slot.el.textContent = sm.get(b.id)?.company || b.name; slot.el.classList.toggle('online', sm.has(b.id)); toWorld(b.x, b.y, this.level.booth.h + 2.7, slot.pos); } // above the green marker, clear of the name on the roof
    });

    // Walking into a hall or a place for the first time says what it is — counted from the floor plan, never made up.
    const hall = this.level.halls.find((h) => this.pos.x >= h.x0 && this.pos.x <= h.x1 && this.pos.y >= h.y0 && this.pos.y <= h.y1)?.id ?? null;
    if (hall !== this.hallNow) { this.hallNow = hall; const c = this.halls.find((h) => h.hall === hall); if (c && markSeen(`hall:${c.hall}`)) toast(`Hall ${c.hall} · Level ${c.level}`, hallLine(c), 'info', 5200); }
    const place = placeAt(this.world.places, this.pos.x, this.pos.y);
    if (herePlace.value !== place) { herePlace.value = place; if (place && markSeen(`place:${place.id}`)) toast(place.name, place.blurb, 'info', 4800); }

    const dock = this.level.hero.dock, near = Math.hypot(dock.x - this.pos.x, dock.y - this.pos.y) < 4.2;
    if (atLaunchPad.value !== near) atLaunchPad.value = near;
    const lift = this.level.lifts.find((l) => Math.hypot(l.x - this.pos.x, l.y - this.pos.y) < 3.4) ?? null;
    if ((nearLift.value?.here ?? null) !== lift) nearLift.value = lift ? { here: lift, others: this.level.lifts.filter((l) => l.id === lift.id && l.deck !== lift.deck).sort((a, b) => a.deck - b.deck) } : null;
    const lv = this.levelOf(this.pos); if (currentDeck.value !== lv) currentDeck.value = lv;
  }

  /** Server checks distance against the position IT last saw, so report position first. */
  async stamp(b: Booth) {
    try { await api.presence({ x: this.pos.x, y: this.pos.y, h: this.heading }); await api.stamp({ stationId: b.id, proof: 'virtual' }); this.emote('cheer', 1300); }
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
    api.presence({ x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), h: +this.heading.toFixed(2), spawn, pose: this.pose || undefined })
      .then((r) => { online.value = r.online; this.applyHolos(r.holograms, now); }).catch(() => {});
  }

  private applyHolos(list: Hologram[], now: number) {
    for (const h of list.slice(0, this.quality === 'high' ? 40 : 24)) {
      let o = this.holos.get(h.id);
      if (o && o.cls !== h.cls) { o.a.dispose(); o.label.remove(); this.holos.delete(h.id); o = undefined; } // changed door: new jacket
      if (!o) {
        const a = new Astronaut({ spec: defaultAvatar(h.cls), jacket: h.cls ? ROLE_INFO[h.cls].color : undefined, detail: 'lo' }); a.group.visible = false; this.world.scene.add(a.group); // posed here, drawn by the troupe
        const label = Object.assign(document.createElement('div'), { className: 'lbl person', textContent: h.callsign }); this.host.appendChild(label);
        o = { a, cls: h.cls, track: new RemoteTrack({ t: now, x: h.x, y: h.y, h: h.h }), tx: h.x, ty: h.y, label, seen: now, sitting: false }; this.holos.set(h.id, o);
      }
      if (o.label.textContent !== h.callsign) o.label.textContent = h.callsign;
      const sitting = h.pose === 'sit', chair = sitting ? this.world.places.flatMap((p) => p.seats).find((s) => Math.hypot(s.x - h.x, s.y - h.y) < 0.8) : undefined;
      o.a.setPose(h.pose ?? '', chair?.z); o.sitting = sitting;
      const snap = { t: now, x: h.x, y: h.y, h: h.h }; if (sitting) o.track.place(snap); else o.track.push(snap);
      o.tx = h.x; o.ty = h.y; o.seen = now;
    }
    for (const [id, o] of this.holos) if (now - o.seen > PING_MS * 3) { o.a.dispose(); o.label.remove(); this.holos.delete(id); }
  }

  /** Other people glide at constant speed between the positions we hear about (remote.ts), and walk at the pace they move. */
  private updateHolos(now: number, dt: number) {
    const far = this.cam.dist * 2.4 + 60, cx = this.camTarget.x + 95, cy = 72 - this.camTarget.z; // well beyond the edge of the screen: not posed, not drawn
    for (const o of this.holos.values()) {
      const r = o.track; r.step(now, dt);
      if (Math.abs(r.x - cx) > far || Math.abs(r.y - cy) > far) continue;
      toWorld(r.x, r.y, 0, o.a.group.position); o.a.group.rotation.y = r.h; o.a.animate(dt, Math.min(1, r.speed / RUN_SPEED));
      this.world.troupe.add(o.a.group);
    }
  }

  /* ---------------- labels: HTML, snapped to whole pixels so type stays sharp ---------------- */

  private updateLabels() {
    const v = new THREE.Vector3(), w = this.host.clientWidth, h = this.host.clientHeight, taken: [number, number, number, number][] = [];
    // Placed in order of importance; a label that would sit on one already placed stays hidden this frame.
    // A label's style is only touched when it changes: most of the ~60 labels are out of range on any frame, and the rest sit still when you do.
    const write = (el: HTMLDivElement, opacity: string, transform?: string) => {
      let c = this.labelCache.get(el); if (!c) this.labelCache.set(el, c = { o: '', t: '' });
      if (c.o !== opacity) el.style.opacity = c.o = opacity;
      if (transform && c.t !== transform) el.style.transform = c.t = transform;
    };
    const place = (el: HTMLDivElement, pos: THREE.Vector3, maxD: number, always = false) => {
      const d = this.camera.position.distanceTo(pos); if (!always && d >= maxD) return write(el, '0');
      v.copy(pos).project(this.camera);
      let vis = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      const x = Math.round((v.x * 0.5 + 0.5) * w), y = Math.round((-v.y * 0.5 + 0.5) * h);
      if (vis) {
        const hw = ((el.textContent?.length ?? 8) * 3.6 + 14) * this.ui, hh = 11 * this.ui, box: [number, number, number, number] = [x - hw, y - hh, x + hw, y + hh];
        if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) vis = false; else taken.push(box);
      }
      if (vis) write(el, always ? '1' : THREE.MathUtils.clamp((maxD - d) / (maxD * 0.25), 0, 1).toFixed(2), `translate(-50%,-50%) translate(${x}px,${y}px)`); else write(el, '0');
    };
    const hero = this.labelEls.find((x) => x.l.kind === 'hero'); if (hero) place(hero.el, hero.l.pos, 0, true);
    if (this.hover && this.hover.booth.id !== this.level.hero.id) place(this.hover.el, this.hover.pos, 0, true); else write(this.hoverEl, '0');
    for (const s of this.boothEls) { if (s.booth && s.booth !== this.hover?.booth) place(s.el, s.pos, 52); else write(s.el, '0'); }
    const p = new THREE.Vector3();
    for (const o of this.holos.values()) place(o.label, toWorld(o.track.x, o.track.y, 2.9, p), 40);
    for (const { el, l } of this.labelEls) if (l.kind !== 'hero') place(el, l.pos, l.kind === 'gate' ? 110 : 80);
  }

  /* ---------------- resolution: start sharp, give a little only if the phone cannot keep up ---------------- */

  private adaptQuality(now: number) {
    const f = this.fps, gap = now - (f.at || now); f.at = now;
    if (gap > 250 || document.hidden) { f.acc = 0; f.n = 0; return; } // the tab was away, or something outside the game stalled: not evidence
    f.acc += gap / 1000; f.n++;
    if (f.acc < 3) return;
    const fps = f.n / f.acc; f.acc = 0; f.n = 0;
    const capped30 = fps > 27 && fps < 33; // battery saver and some in-app browsers hold the page to 30: fewer pixels would not change that
    if (fps < 42 && !capped30 && f.dpr > 1.25) { f.dpr = Math.max(1.25, f.dpr - 0.25); this.renderer.setPixelRatio(f.dpr); }
  }

  dispose() { this.running = false; this.input.dispose(); this.stops.forEach((s) => s()); this.renderer.dispose(); this.renderer.domElement.remove(); }
}
