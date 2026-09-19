import * as THREE from 'three';
import type { LevelData, StationView } from '../../shared/types';
import { Astronaut } from './astronaut';
import { defaultAvatar } from '../../shared/avatar';
import { THEME, css } from '../theme';
import { buildPlaces, taken, type Place, type Tone } from './places';
import { buildStands, type Stand } from './stands';

// Floor-plan metres → world. +x east, +y north ⇒ world +x east, −z north.
export const CX = 95, CY = 72;
export const toWorld = (x: number, y: number, h = 0, out = new THREE.Vector3()) => out.set(x - CX, h, -(y - CY));
export const toPlan = (v: THREE.Vector3) => ({ x: v.x + CX, y: CY - v.z });

export type Quality = 'high' | 'low';
export interface Label { text: string; pos: THREE.Vector3; kind: 'area' | 'gate' | 'hero' | 'lift' }
const TONE: Record<Tone, number> = { white: 0xffffff, soft: 0xe9e6df, mid: THEME.inkSoft, ink: THEME.ink, area: THEME.area };

/**
 * A daylight model of the expo. Everything is matte, flat-coloured and lit by one sun, so edges stay clean on a phone:
 * no glow, no transparency tricks, no textures except the floor lettering. Colour carries meaning and nothing else —
 * white booths, green when an exhibitor has brought one online, a gold roof once you have stamped it (see theme.ts).
 */
export class World {
  readonly scene = new THREE.Scene();
  readonly labels: Label[] = [];
  readonly heroPos: THREE.Vector3;
  private boothIndex = new Map<string, number>();
  private body!: THREE.InstancedMesh;
  private roofs!: THREE.InstancedMesh;
  private pins!: THREE.InstancedMesh;
  private pinned: number[] = [];
  private online = new Set<string>();
  private boothH = 3;
  private hero = new THREE.Group();
  private heroBits!: { X: THREE.Group; ring: THREE.Mesh; crew: Astronaut[] };
  readonly places: Place[];
  private pop: { i: number; t: number } | null = null;
  private standOf = new Map<number, Stand>();
  private stampedIds: string[] = [];

  constructor(private level: LevelData) {
    this.heroPos = toWorld(level.hero.x, level.hero.y);
    this.places = buildPlaces(level);
    this.scene.background = new THREE.Color(THEME.paper);
    this.scene.fog = new THREE.Fog(THEME.paper, 220, 640); // the other levels fade into the paper instead of ending in an edge
    // Tuned so an upward face receives exactly 1.0: colours on the floor and on roofs come out as written in theme.ts.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb4ae9f, 1.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(-80, 140, 60); this.scene.add(sun);
    this.levels(); this.furnish(); this.gates(); this.lifts(); this.booths(); this.theX();
  }

  private flat(color: number) { return new THREE.MeshLambertMaterial({ color }); }
  /** Painted on the floor: drawn after it, never fighting it for depth. */
  private decal(o: THREE.MeshBasicMaterialParameters) { return new THREE.MeshBasicMaterial({ ...o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); }

  private levels() {
    const slab = this.flat(THEME.floor), carpet = this.decal({ color: THEME.hall }), curb = this.flat(THEME.line);
    // The building stands on something: a ground that fades into the sky, and a soft shadow under each level.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: THEME.ground })); ground.position.y = -0.82; this.scene.add(ground);
    const shade = new THREE.MeshBasicMaterial({ color: THEME.ink, transparent: true, opacity: 0.05, depthWrite: false });
    for (const d of this.level.decks) {
      const w = d.x1 - d.x0, dp = d.y1 - d.y0, c = toWorld((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w + 6, 0.8, dp + 6), slab); m.position.set(c.x, -0.4, c.z); this.scene.add(m);
      for (const [grow, y] of [[5, -0.815], [2.5, -0.81], [1, -0.805]] as const) { // three stacked quads ≈ a blurred edge, no texture
        const s = new THREE.Mesh(new THREE.PlaneGeometry(w + 6 + grow * 2, dp + 6 + grow * 2).rotateX(-Math.PI / 2), shade); s.position.set(c.x + 1.5, y, c.z + 1.5); s.renderOrder = 1; this.scene.add(s);
      }
    }
    for (const h of this.level.halls) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(h.x1 - h.x0, h.y1 - h.y0).rotateX(-Math.PI / 2), carpet);
      toWorld((h.x0 + h.x1) / 2, (h.y0 + h.y1) / 2, 0.02, m.position); m.renderOrder = 1; this.scene.add(m);
      this.floorText(`HALL ${h.id}`, h.x0 + (h.x1 - h.x0) * 0.82, h.y0 - 4.5, 5);
    }
    this.floorText('HALL 5 · REGISTRATION', 196, 64, 4, -Math.PI / 2);
    const hl = this.level.hall, walls = [...this.level.walls, { x0: hl.x0 - 0.4, y0: hl.y0, x1: hl.x0, y1: hl.y1 }, { x0: hl.x0, y0: hl.y1, x1: hl.x1, y1: hl.y1 + 0.4 }];
    for (const r of walls) { // low, like the base of a model: they say "wall" without hiding the floor behind them
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.4, r.x1 - r.x0), 0.8, Math.max(0.4, r.y1 - r.y0)), curb);
      toWorld((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 0.4, m.position); this.scene.add(m);
    }
  }

  private floorText(txt: string, x: number, y: number, size: number, rot = 0) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
    const g = c.getContext('2d')!; g.font = '800 150px Urbanist, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = css(THEME.ink); g.fillText(txt, 512, 136);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 4, size), this.decal({ map: t, transparent: true, opacity: 0.16 }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = rot; toWorld(x, y, 0.03, m.position); m.renderOrder = 2; this.scene.add(m);
  }

  /**
   * Cafés, lounges, stages, kitchens, the photo booth, the press rooms: a floor of their own and furniture from places.ts.
   * All of it is two instanced meshes (boxes, cylinders) — a few thousand pieces, two draw calls — plus a seated crowd in three.
   */
  private furnish() {
    const floor = this.decal({ color: THEME.area }), all = this.places.flatMap((p) => p.solids);
    const boxes = all.filter((s) => !s.round), rounds = all.filter((s) => s.round), M = new THREE.Matrix4(), C = new THREE.Color(), p = new THREE.Vector3();
    const build = (list: typeof all, geo: THREE.BufferGeometry) => {
      const m = new THREE.InstancedMesh(geo, this.flat(0xffffff), Math.max(1, list.length));
      list.forEach((s, i) => { toWorld(s.x, s.y, s.z + s.h / 2, p); M.makeScale(s.w, s.h, s.d).setPosition(p); m.setMatrixAt(i, M); m.setColorAt(i, C.set(TONE[s.tone])); });
      m.count = list.length; m.frustumCulled = false; this.scene.add(m);
    };
    build(boxes, new THREE.BoxGeometry(1, 1, 1)); build(rounds, new THREE.CylinderGeometry(0.5, 0.5, 1, 20));

    for (const pl of this.places) {
      const r = pl.rect, cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
      if (pl.open) { const f = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.y1 - r.y0).rotateX(-Math.PI / 2), floor); toWorld(cx, cy, 0.025, f.position); f.renderOrder = 2; this.scene.add(f); }
      this.labels.push({ text: pl.name, pos: toWorld(cx, cy, pl.open ? 4.4 : 2.8), kind: 'area' });
      if (pl.spot) this.backdrop(pl);
    }

    // The seated crowd: scenery, in grey — never blue or green, which are real people.
    const crowd = this.places.flatMap((pl) => [...pl.seats.filter((_, i) => taken(pl, i)).map((s) => ({ s, sit: true })), ...(pl.presenter ? [{ s: pl.presenter, sit: false }] : [])]);
    // Same proportions as the player's astronaut (astronaut.ts), in four instanced meshes instead of eighteen each.
    const N = Math.max(1, crowd.length);
    const body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.36, 0.45, 4, 10), this.flat(THEME.inkSoft), N);
    const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.56, 20, 14), this.flat(0xffffff), N);
    const visor = new THREE.InstancedMesh(new THREE.SphereGeometry(0.47, 18, 12), this.flat(THEME.ink), N);
    const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.26, 1), this.flat(THEME.ink), N);
    const R = new THREE.Matrix4(), S = new THREE.Matrix4(), off = new THREE.Vector3();
    crowd.forEach(({ s, sit }, i) => {
      const lift = sit ? s.z - 0.52 : s.z; R.makeRotationY(s.h);
      toWorld(s.x, s.y, lift + 0.92, p); body.setMatrixAt(i, M.copy(R).setPosition(p));
      toWorld(s.x, s.y, lift + 1.72, p); head.setMatrixAt(i, M.copy(R).setPosition(p));
      off.set(0, 0, 0.17).applyMatrix4(R); visor.setMatrixAt(i, M.copy(R).multiply(S.makeScale(1, 0.86, 0.9)).setPosition(p.x + off.x, p.y - 0.02, p.z + off.z));
      // sitting: thighs forward along the seat; standing: legs straight down
      if (sit) { off.set(0, 0, 0.3).applyMatrix4(R); toWorld(s.x, s.y, s.z + 0.1, p); legs.setMatrixAt(i, M.copy(R).multiply(S.makeScale(1, 1, 0.6)).setPosition(p.x + off.x, p.y, p.z + off.z)); }
      else { toWorld(s.x, s.y, s.z + 0.3, p); legs.setMatrixAt(i, M.copy(R).multiply(S.makeScale(0.9, 2.3, 0.3)).setPosition(p)); }
    });
    for (const m of [body, head, visor, legs]) { m.count = crowd.length; m.frustumCulled = false; this.scene.add(m); }
  }

  /** The photo wall: big quiet lettering to stand in front of, and a blue mark on the floor — blue, because it is something you can do. */
  private backdrop(pl: Place) {
    const { wall, x, y } = pl.spot!, c = document.createElement('canvas'); c.width = 1024; c.height = 420;
    const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, 1024, 420); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = css(THEME.ink); g.font = '800 150px Urbanist, Arial'; g.fillText(wall.text, 512, 190); g.fillStyle = css(THEME.inkSoft); g.font = '600 44px Urbanist, Arial'; g.fillText('MITEC · KUALA LUMPUR', 512, 320);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const len = Math.max(wall.w, wall.d), art = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.4, (len - 0.4) * 0.41), new THREE.MeshBasicMaterial({ map: t }));
    const n = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] }[wall.face] as [number, number];
    toWorld(wall.x + n[0] * 0.17, wall.y + n[1] * 0.17, 1.8, art.position); art.rotation.y = { N: Math.PI, S: 0, E: Math.PI / 2, W: -Math.PI / 2 }[wall.face]; this.scene.add(art);
    const mark = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 40).rotateX(-Math.PI / 2), this.decal({ color: THEME.blue })); toWorld(x, y, 0.035, mark.position); mark.renderOrder = 3; this.scene.add(mark);
  }

  private gates() {
    const m = this.flat(THEME.inkSoft), post = new THREE.BoxGeometry(0.35, 5, 0.35), top = new THREE.BoxGeometry(9.35, 0.35, 0.35);
    for (const g of this.level.gates) {
      const grp = new THREE.Group(), a = new THREE.Mesh(post, m), b = new THREE.Mesh(post, m), t = new THREE.Mesh(top, m);
      a.position.set(-4.5, 2.5, 0); b.position.set(4.5, 2.5, 0); t.position.set(0, 5.17, 0); grp.add(a, b, t);
      if (g.axis === 'y') grp.rotation.y = Math.PI / 2;
      toWorld(g.x, g.y, 0, grp.position); this.scene.add(grp);
      this.labels.push({ text: g.name, pos: toWorld(g.x, g.y, 6.6), kind: 'gate' });
    }
  }

  /** Lifts are something you can do, so they are blue: a disc to step on, the same on every level. */
  private lifts() {
    const disc = new THREE.CylinderGeometry(2.2, 2.2, 0.12, 40), inner = new THREE.CylinderGeometry(1.5, 1.5, 0.14, 40), m = this.flat(THEME.blue), mi = this.flat(0xffffff);
    for (const l of this.level.lifts) {
      const a = new THREE.Mesh(disc, m), b = new THREE.Mesh(inner, mi);
      toWorld(l.x, l.y, 0.06, a.position); toWorld(l.x, l.y, 0.08, b.position); this.scene.add(a, b);
      this.labels.push({ text: l.label, pos: toWorld(l.x, l.y, 2.4), kind: 'lift' });
    }
  }

  private booths() {
    const { w: BW, d: BD, h: BH } = this.level.booth, list = this.level.booths, n = list.length; this.boothH = BH;
    const depth = new Map(this.level.decks.map((d) => [d.level, d.boothD / BD])); // rows are 3.27 m apart on Level 2, 3.00 m on Levels 1 and 3
    // A hair under full width, so neighbours in a row read as separate booths rather than one slab.
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(BW - 0.16, BH, BD - 0.16), this.flat(0xffffff), n);
    const M = new THREE.Matrix4(), C = new THREE.Color(THEME.booth), p = new THREE.Vector3();
    const stands = buildStands(this.level); for (const st of stands) for (const i of st.booths) this.standOf.set(i, st);
    list.forEach((b, i) => {
      this.boothIndex.set(b.id, i);
      const s = b.id === this.level.hero.id ? 1e-4 : 1; // ours is built by hand in theX()
      const joined = (this.standOf.get(i)?.booths.length ?? 1) > 1, fx = joined ? BW / (BW - 0.16) : 1, fz = joined ? BD / (BD - 0.16) : 1; // cells of one stand close up
      toWorld(b.x, b.y, BH / 2, p); M.makeScale(s * fx, s, s * fz * (depth.get(b.deck) ?? 1)).setPosition(p); body.setMatrixAt(i, M); body.setColorAt(i, C);
    });
    body.name = 'booths'; this.body = body; this.scene.add(body);
    this.names(stands);

    // Stamped: a gold roof panel. Exhibitor at the counter: a green marker above the booth. Both are drawn only where needed.
    this.roofs = new THREE.InstancedMesh(new THREE.BoxGeometry(BW - 0.5, 0.12, BD - 0.5), this.flat(THEME.gold), n);
    this.pins = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.55), this.flat(THEME.green), 256);
    for (const m of [this.roofs, this.pins]) { m.count = 0; m.frustumCulled = false; this.scene.add(m); }
  }

  /**
   * The exhibitor's name, written on the roof of their stand — once per stand, as wide as the stand allows.
   * One texture, one draw call: every name is drawn into a packed atlas and shown on an instanced quad that fades out
   * with distance in proportion to its size, so far-away lettering never turns into shimmer.
   */
  private names(stands: Stand[]) {
    const CW = 176, SIZE = 2048, cells = stands.map((s) => { const aspect = Math.min(7, Math.max(3, s.w / s.d)); return { s, aspect, h: Math.round(CW / aspect), x: 0, y: 0 }; }).sort((a, b) => b.h - a.h);
    let x = 0, y = 0, shelf = 0; const fit: typeof cells = [];
    for (const c of cells) { if (x + CW > SIZE) { x = 0; y += shelf + 2; shelf = 0; } if (y + c.h > SIZE) break; c.x = x; c.y = y; x += CW + 2; shelf = Math.max(shelf, c.h); fit.push(c); }
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = SIZE; const g = canvas.getContext('2d')!; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = css(THEME.ink);
    for (const c of fit) { // one line if it fits at a readable size, otherwise two
      const words = c.s.name.split(/\s+/), size = (lines: string[]) => { let f = Math.min(c.h / lines.length * 0.62, 34); g.font = `800 ${f}px Urbanist, Arial`; const w = Math.max(...lines.map((l) => g.measureText(l).width)); if (w > CW - 12) f *= (CW - 12) / w; return f; };
      let lines = [c.s.name]; if (words.length > 1 && c.h >= 44) { const half = Math.ceil(words.length / 2), two = [words.slice(0, half).join(' '), words.slice(half).join(' ')]; if (size(two) * 0.9 > size(lines)) lines = two; }
      const f = size(lines); g.font = `800 ${f}px Urbanist, Arial`;
      lines.forEach((l, i) => g.fillText(l, c.x + CW / 2, c.y + c.h / 2 + (i - (lines.length - 1) / 2) * f * 1.08, CW - 8));
    }
    const tex = new THREE.CanvasTexture(canvas); tex.flipY = false; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), uv = new Float32Array(fit.length * 4), fade = new Float32Array(fit.length);
    const mesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { map: { value: tex } },
      vertexShader: 'attribute vec4 aUv; attribute float aFade; varying vec2 vUv; varying float vA; void main(){ vUv = aUv.xy + vec2(uv.x, 1.0 - uv.y) * aUv.zw; vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0); vA = 1.0 - smoothstep(aFade * 0.7, aFade, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec2 vUv; varying float vA; void main(){ float a = texture2D(map, vUv).a * vA * 0.62; if (a < 0.02) discard; gl_FragColor = vec4(0.106, 0.129, 0.188, a); }',
    }), Math.max(1, fit.length));
    const M = new THREE.Matrix4(), p = new THREE.Vector3();
    fit.forEach((c, i) => {
      const d = Math.min(c.s.d, c.s.w / c.aspect), w = d * c.aspect; // keep the cell's proportions: lettering is never stretched
      toWorld(c.s.x, c.s.y, this.boothH + 0.14, p); M.makeScale(w, 1, d).setPosition(p); mesh.setMatrixAt(i, M);
      uv.set([c.x / SIZE, c.y / SIZE, CW / SIZE, c.h / SIZE], i * 4); fade[i] = 34 + w * 9; // big stands can be read from further away
    });
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 4)); geo.setAttribute('aFade', new THREE.InstancedBufferAttribute(fade, 1));
    mesh.count = fit.length; mesh.frustumCulled = false; mesh.renderOrder = 6; this.scene.add(mesh);
  }

  /** The live list of booths that exhibitors have brought online. */
  setStations(list: StationView[]) {
    const next = new Set(list.map((s) => s.id)), C = new THREE.Color();
    const cells = (i: number) => this.standOf.get(i)?.booths ?? [i];
    for (const id of this.online) if (!next.has(id)) { const i = this.boothIndex.get(id); if (i != null) for (const k of cells(i)) this.body.setColorAt(k, C.set(THEME.booth)); }
    this.pinned = [];
    for (const s of list) {
      const i = this.boothIndex.get(s.id); if (i == null) continue;
      for (const k of cells(i)) this.body.setColorAt(k, C.set(THEME.greenSoft));
      if (s.hosted && this.pinned.length < 256) this.pinned.push(i);
    }
    this.online = next; this.pins.count = this.pinned.length;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }

  setStamped(ids: Iterable<string>) {
    const next = [...ids].filter((id) => this.boothIndex.has(id)), was = new Set(this.stampedIds), fresh = next.findIndex((id) => !was.has(id));
    if (this.stampedIds.length && fresh >= 0 && next.length === this.stampedIds.length + 1) this.pop = { i: fresh, t: 0 }; // one new stamp: let it land
    this.stampedIds = next; this.roofs.count = next.length;
    next.forEach((_, n) => this.placeRoof(n, 1));
    this.roofs.instanceMatrix.needsUpdate = true;
  }
  private placeRoof(n: number, s: number) {
    const b = this.level.booths[this.boothIndex.get(this.stampedIds[n]!)!]!, p = toWorld(b.x, b.y, this.boothH + 0.06 + (1 - s) * 1.2);
    this.roofs.setMatrixAt(n, new THREE.Matrix4().makeScale(s, 1, s).setPosition(p));
  }

  /** Booth 8H18B, built by hand: open to the west aisle, our crew inside, and the X turning above it. */
  private theX() {
    const { w: BW, d: BD } = this.level.booth, hero = this.hero; hero.position.copy(this.heroPos); this.scene.add(hero);
    const white = this.flat(0xffffff), ink = this.flat(THEME.ink);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(BW, 0.1, BD), this.flat(THEME.gold)); pad.position.y = 0.05;
    const art = document.createElement('canvas'); art.width = 1024; art.height = 820;
    const g = art.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, 1024, 820); g.textAlign = 'center'; g.fillStyle = css(THEME.ink);
    g.font = '800 96px Urbanist, Arial'; g.fillText('lean.x digital', 512, 330); g.font = '600 60px Urbanist, Arial'; g.fillStyle = css(THEME.inkSoft); g.fillText('nexova', 512, 430);
    const tex = new THREE.CanvasTexture(art); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    // 8H18B is mid-row: walls N, E (back) and S; the open side faces the west aisle.
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.5, BD - 0.1), [white, new THREE.MeshBasicMaterial({ map: tex }), white, white, white, white]); back.position.set(BW / 2 - 0.06, 1.35, 0);
    hero.add(pad, back);
    for (const s of [-1, 1]) { const side = new THREE.Mesh(new THREE.BoxGeometry(BW, 2.5, 0.1), white); side.position.set(0, 1.35, s * (BD / 2 - 0.05)); hero.add(side); }
    const counter = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 1.5), ink); counter.position.set(-0.75, 0.6, 0.45); hero.add(counter);

    // The two bars cross without sharing a face (one is a touch slimmer), so the middle never flickers.
    const X = new THREE.Group(), bar = (color: number, rz: number, depth: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 5.4, depth), this.flat(color)); m.rotation.z = rz; return m; };
    X.add(bar(THEME.xBlue, Math.PI / 5, 0.7), bar(THEME.xYellow, -Math.PI / 5, 0.56)); X.position.y = 8.5;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2), this.decal({ color: THEME.gold, transparent: true })); ring.position.y = 0.04; ring.renderOrder = 3;
    const crew = [-0.85, 0.2, 0.95].map((z, i) => { // our booth crew
      const a = new Astronaut({ spec: defaultAvatar(null), jacket: THEME.ink }); a.group.position.set([-0.2, 0.55, -0.4][i]!, 0.1, z); a.group.rotation.y = -Math.PI / 2 + (i - 1) * 0.35; a.group.scale.setScalar(0.82); return a;
    });
    hero.add(X, ring, ...crew.map((c) => c.group));
    this.heroBits = { X, ring, crew };
    this.labels.push({ text: 'The X · Booth ' + this.level.hero.id, pos: this.heroPos.clone().setY(12.6), kind: 'hero' });
  }

  update(t: number, dt: number) {
    const { X, ring, crew } = this.heroBits;
    X.rotation.y = t * 0.6; X.position.y = 8.5 + Math.sin(t * 1.2) * 0.25;
    const k = (t * 0.35) % 1, s = 3 + k * 9; ring.scale.set(s, 1, s); (ring.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.55;
    for (const c of crew) c.animate(dt, 0);
    if (this.pop) { // ease-out-back: overshoots a little, settles
      const k = Math.min(1, (this.pop.t += dt * 3.2)), e = 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2);
      if (this.pop.i < this.stampedIds.length) { this.placeRoof(this.pop.i, e); this.roofs.instanceMatrix.needsUpdate = true; }
      if (k >= 1) this.pop = null;
    }
    if (this.pinned.length) {
      const M = new THREE.Matrix4(), p = new THREE.Vector3(), y = this.boothH + 1.5 + Math.sin(t * 2) * 0.18;
      this.pinned.forEach((bi, n) => { const b = this.level.booths[bi]!; toWorld(b.x, b.y, y, p); M.makeRotationY(t * 0.9).setPosition(p); this.pins.setMatrixAt(n, M); });
      this.pins.instanceMatrix.needsUpdate = true;
    }
  }
}
