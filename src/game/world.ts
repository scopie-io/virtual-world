import * as THREE from 'three';
import type { LevelData, StationView } from '../../shared/types';
import { Astronaut } from './astronaut';
import { defaultAvatar } from '../../shared/avatar';
import { THEME, css } from '../theme';

// Floor-plan metres → world. +x east, +y north ⇒ world +x east, −z north.
export const CX = 95, CY = 72;
export const toWorld = (x: number, y: number, h = 0, out = new THREE.Vector3()) => out.set(x - CX, h, -(y - CY));
export const toPlan = (v: THREE.Vector3) => ({ x: v.x + CX, y: CY - v.z });

export type Quality = 'high' | 'low';
export interface Label { text: string; pos: THREE.Vector3; kind: 'area' | 'gate' | 'hero' | 'lift' }

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

  constructor(private level: LevelData) {
    this.heroPos = toWorld(level.hero.x, level.hero.y);
    this.scene.background = new THREE.Color(THEME.paper);
    this.scene.fog = new THREE.Fog(THEME.paper, 220, 640); // the other levels fade into the paper instead of ending in an edge
    // Tuned so an upward face receives exactly 1.0: colours on the floor and on roofs come out as written in theme.ts.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb4ae9f, 1.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(-80, 140, 60); this.scene.add(sun);
    this.levels(); this.areas(); this.gates(); this.lifts(); this.booths(); this.theX();
  }

  private flat(color: number) { return new THREE.MeshLambertMaterial({ color }); }
  /** Painted on the floor: drawn after it, never fighting it for depth. */
  private decal(o: THREE.MeshBasicMaterialParameters) { return new THREE.MeshBasicMaterial({ ...o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); }

  private levels() {
    const slab = this.flat(THEME.floor), carpet = this.decal({ color: THEME.hall }), curb = this.flat(THEME.line);
    for (const d of this.level.decks) {
      const w = d.x1 - d.x0, dp = d.y1 - d.y0, c = toWorld((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w + 6, 0.8, dp + 6), slab); m.position.set(c.x, -0.4, c.z); this.scene.add(m);
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

  /** Lounges, stages, kitchens: one quiet colour, low, so the booths stay the subject. */
  private areas() {
    const m = this.flat(THEME.area);
    for (const a of this.level.areas) {
      const h = Math.min(a.h, 1.6), box = new THREE.Mesh(new THREE.BoxGeometry(a.x1 - a.x0, h, a.y1 - a.y0), m);
      toWorld((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2, h / 2, box.position); this.scene.add(box);
      this.labels.push({ text: a.name, pos: toWorld((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2, h + 1.2), kind: 'area' });
    }
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
    list.forEach((b, i) => {
      this.boothIndex.set(b.id, i);
      const s = b.id === this.level.hero.id ? 1e-4 : 1; // ours is built by hand in theX()
      toWorld(b.x, b.y, BH / 2, p); M.makeScale(s, s, s * (depth.get(b.deck) ?? 1)).setPosition(p); body.setMatrixAt(i, M); body.setColorAt(i, C);
    });
    body.name = 'booths'; this.body = body; this.scene.add(body);

    // Stamped: a gold roof panel. Exhibitor at the counter: a green marker above the booth. Both are drawn only where needed.
    this.roofs = new THREE.InstancedMesh(new THREE.BoxGeometry(BW - 0.5, 0.12, BD - 0.5), this.flat(THEME.gold), n);
    this.pins = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.55), this.flat(THEME.green), 256);
    for (const m of [this.roofs, this.pins]) { m.count = 0; m.frustumCulled = false; this.scene.add(m); }
  }

  /** The live list of booths that exhibitors have brought online. */
  setStations(list: StationView[]) {
    const next = new Set(list.map((s) => s.id)), C = new THREE.Color();
    for (const id of this.online) if (!next.has(id)) { const i = this.boothIndex.get(id); if (i != null) this.body.setColorAt(i, C.set(THEME.booth)); }
    this.pinned = [];
    for (const s of list) {
      const i = this.boothIndex.get(s.id); if (i == null) continue;
      if (!this.online.has(s.id)) this.body.setColorAt(i, C.set(THEME.greenSoft));
      if (s.hosted && this.pinned.length < 256) this.pinned.push(i);
    }
    this.online = next; this.pins.count = this.pinned.length;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }

  setStamped(ids: Iterable<string>) {
    const M = new THREE.Matrix4(), p = new THREE.Vector3(); let n = 0;
    for (const id of ids) {
      const i = this.boothIndex.get(id); if (i == null) continue;
      const b = this.level.booths[i]!; toWorld(b.x, b.y, this.boothH + 0.06, p); M.makeTranslation(p.x, p.y, p.z); this.roofs.setMatrixAt(n++, M);
    }
    this.roofs.count = n; this.roofs.instanceMatrix.needsUpdate = true;
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

    const X = new THREE.Group(), bar = (color: number, rz: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 5.4, 0.7), this.flat(color)); m.rotation.z = rz; return m; };
    X.add(bar(THEME.xBlue, Math.PI / 5), bar(THEME.xYellow, -Math.PI / 5)); X.position.y = 8.5;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2), this.decal({ color: THEME.gold, transparent: true })); ring.position.y = 0.04; ring.renderOrder = 3;
    const crew = [-0.85, 0.2, 0.95].map((z, i) => { // our booth crew
      const a = new Astronaut({ spec: defaultAvatar(null), jacket: THEME.ink }); a.group.position.set([-0.2, 0.55, -0.4][i]!, 0.1, z); a.group.rotation.y = -Math.PI / 2 + (i - 1) * 0.35; a.group.scale.setScalar(0.95); return a;
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
    if (this.pinned.length) {
      const M = new THREE.Matrix4(), p = new THREE.Vector3(), y = this.boothH + 1.5 + Math.sin(t * 2) * 0.18;
      this.pinned.forEach((bi, n) => { const b = this.level.booths[bi]!; toWorld(b.x, b.y, y, p); M.makeRotationY(t * 0.9).setPosition(p); this.pins.setMatrixAt(n, M); });
      this.pins.instanceMatrix.needsUpdate = true;
    }
  }
}
