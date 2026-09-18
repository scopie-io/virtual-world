import * as THREE from 'three';
import type { Booth, GcView, LevelData, SectorState, StationView, StormView } from '../../shared/types';
import { Astronaut } from './astronaut';
import { CREW_INFO } from '../../shared/rules';
import { defaultAvatar } from '../../shared/avatar';

// Floor-plan metres → world. +x east, +y north ⇒ world +x east, −z north.
export const CX = 95, CY = 72;
export const toWorld = (x: number, y: number, h = 0, out = new THREE.Vector3()) => out.set(x - CX, h, -(y - CY));
export const toPlan = (v: THREE.Vector3) => ({ x: v.x + CX, y: CY - v.z });

export type Quality = 'high' | 'low';
export interface Label { text: string; pos: THREE.Vector3; kind: 'area' | 'gate' | 'hero' | 'lift' }

const HALL_PALETTE = [0x5b7de0, 0x2f8fd6, 0x22b8d4]; // neighbouring halls read as different blocks on every deck
const STAMPED = new THREE.Color(0xffc629), WHITE = new THREE.Color(0xffffff);

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class World {
  readonly scene = new THREE.Scene();
  readonly labels: Label[] = [];
  readonly heroPos: THREE.Vector3;
  private caps!: THREE.InstancedMesh;
  private boothIndex = new Map<string, number>();
  private capHeights: number[] = [];
  private body!: THREE.InstancedMesh;
  private baseColor: THREE.Color[] = [];
  private sign!: { g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; cellW: number; cellH: number; cols: number };
  private beams!: THREE.InstancedMesh;
  private hostRings!: THREE.InstancedMesh;
  private hostedIdx: number[] = [];
  private online = new Map<string, StationView>();
  private sectorPlanes = new Map<number, THREE.Mesh>();
  private stormPlane: THREE.Mesh | null = null;
  private gcGroup = new THREE.Group();
  private hero = new THREE.Group();
  private heroBits!: { X: THREE.Group; guide: Astronaut; rings: THREE.Mesh[]; crew: Astronaut[] };

  constructor(private level: LevelData, private quality: Quality) {
    this.heroPos = toWorld(level.hero.x, level.hero.y);
    this.scene.background = new THREE.Color(0x03121f);
    this.scene.fog = new THREE.FogExp2(0x041c30, 0.0021);
    this.lights(); this.space(); this.platforms(); this.landmarks(); this.gates(); this.lifts(); this.booths(); this.launchPad();
  }

  private lights() {
    this.scene.add(new THREE.HemisphereLight(0x9fe8ff, 0x04263d, 1.25));
    const sun = new THREE.DirectionalLight(0xfff2d6, 2.1); sun.position.set(-120, 160, 60);
    const rim = new THREE.DirectionalLight(0x38c8ff, 1.0); rim.position.set(140, 60, -120);
    this.scene.add(sun, rim);
  }

  private space() {
    const n = this.quality === 'high' ? 2200 : 900, p = new Float32Array(n * 3), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) { v.randomDirection().multiplyScalar(900 + Math.random() * 300); p.set([v.x, Math.abs(v.y) * 0.9 - 80, v.z], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcdf3ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.85, fog: false })));
    const planet = new THREE.Mesh(new THREE.SphereGeometry(850, 72, 48), new THREE.MeshStandardMaterial({ color: 0x06263b, roughness: 1, emissive: 0x03141f, fog: false }));
    planet.position.set(0, -905, -420); this.scene.add(planet);
    if (this.quality === 'high') {
      const halo = new THREE.Mesh(new THREE.SphereGeometry(868, 72, 48), new THREE.MeshBasicMaterial({ color: 0x5fe0ff, transparent: true, opacity: 0.22, side: THREE.BackSide, fog: false, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.position.copy(planet.position); this.scene.add(halo);
    }
  }

  /** Each exhibition level is a platform of the station. They share one plan space, far enough apart to feel like separate decks. */
  private platforms() {
    const grid = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#0b3a57'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(111,227,255,.13)'; g.lineWidth = 2;
      g.strokeRect(0, 0, w / 2, h / 2); g.strokeRect(w / 2, h / 2, w / 2, h / 2); g.strokeRect(w / 2, 0, w / 2, h / 2); g.strokeRect(0, h / 2, w / 2, h / 2);
    });
    grid.wrapS = grid.wrapT = THREE.RepeatWrapping;
    const edgeM = new THREE.MeshBasicMaterial({ color: 0x3fd8ff }), hullM = new THREE.MeshStandardMaterial({ color: 0x051f33, roughness: 0.6, metalness: 0.5 });
    for (const d of this.level.decks) {
      const fw = d.x1 - d.x0, fd = d.y1 - d.y0, c = toWorld((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2);
      const map = grid.clone(); map.needsUpdate = true; map.repeat.set(fw / 6, fd / 6);
      const floor = new THREE.Mesh(new THREE.BoxGeometry(fw, 1, fd), new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0.1 })); floor.position.set(c.x, -0.5, c.z);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(fw + 2.4, 0.5, fd + 2.4), edgeM); edge.position.set(c.x, -1.05, c.z);
      const hull = new THREE.Mesh(new THREE.BoxGeometry(fw - 6, 7, fd - 6), hullM); hull.position.set(c.x, -4.8, c.z);
      this.scene.add(floor, edge, hull);
      this.labels.push({ text: d.label, pos: toWorld((d.x0 + d.x1) / 2, d.y0 + 1.5, 9), kind: 'gate' });
    }

    const wallM = new THREE.MeshStandardMaterial({ color: 0x0f5576, roughness: 0.7, transparent: true, opacity: 0.5 });
    const h = this.level.hall, walls = [...this.level.walls, { x0: h.x0 - 0.4, y0: h.y0, x1: h.x0, y1: h.y1 }, { x0: h.x0, y0: h.y1, x1: h.x1, y1: h.y1 + 0.4 }];
    for (const r of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.4, r.x1 - r.x0), 4.5, Math.max(0.4, r.y1 - r.y0)), wallM);
      toWorld((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 2.25, m.position); this.scene.add(m);
    }

    const floorText = (txt: string, x: number, y: number, size: number, color: string, rot = 0) => {
      const t = canvasTex(1024, 256, (g, w, hh) => { g.font = '800 150px Urbanist, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color; g.fillText(txt, w / 2, hh / 2 + 8); });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 4, size), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.85, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = rot; toWorld(x, y, 0.06, m.position); this.scene.add(m);
    };
    for (const hl of this.level.halls) floorText(`HALL ${hl.id}`, hl.x0 + (hl.x1 - hl.x0) * 0.82, hl.y0 - 4.5, 5, '#6fe3ff');
    floorText('HALL 5 · REGISTRATION', 196, 64, 4, '#ffc629', -Math.PI / 2);
  }

  private landmarks() {
    const color: Record<string, number> = { zone: 0x0f6f80, pad: 0x39506b };
    for (const a of this.level.areas) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(a.x1 - a.x0, a.h, a.y1 - a.y0), new THREE.MeshStandardMaterial({ color: a.id === 'corner' || a.id === 'speaker' || a.id === 'bernama' ? 0x2a4fa3 : color[a.kind]!, roughness: 0.8 }));
      toWorld((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2, a.h / 2, m.position);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.5 })); e.position.copy(m.position);
      this.scene.add(m, e);
      this.labels.push({ text: a.name, pos: toWorld((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2, a.h + 1.5), kind: 'area' });
    }
  }

  private gates() {
    const m = new THREE.MeshBasicMaterial({ color: 0xffc629 });
    for (const g of this.level.gates) {
      const grp = new THREE.Group(), a = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), m), b = a.clone(), t = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.5, 0.5), m);
      a.position.set(-4.5, 3, 0); b.position.set(4.5, 3, 0); t.position.set(0, 6, 0); grp.add(a, b, t);
      if (g.axis === 'y') grp.rotation.y = Math.PI / 2;
      toWorld(g.x, g.y, 0, grp.position); this.scene.add(grp);
      this.labels.push({ text: g.name, pos: toWorld(g.x, g.y, 8), kind: 'gate' });
    }
  }

  /** The lifts that stand between the halls on every level: step on one to ride to another deck. */
  private lifts() {
    const pad = new THREE.CylinderGeometry(2.2, 2.2, 0.16, 28), beam = new THREE.CylinderGeometry(1.5, 1.5, 9, 20, 1, true);
    const padM = new THREE.MeshBasicMaterial({ color: 0x3ddc84 }), beamM = new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const l of this.level.lifts) {
      const p = new THREE.Mesh(pad, padM), b = new THREE.Mesh(beam, beamM);
      toWorld(l.x, l.y, 0.08, p.position); toWorld(l.x, l.y, 4.5, b.position); this.scene.add(p, b);
      this.labels.push({ text: `⇅ ${l.label}`, pos: toWorld(l.x, l.y, 10.5), kind: 'lift' });
    }
  }

  private booths() {
    const { w: BW, d: BD, h: BH } = this.level.booth, list = this.level.booths, n = list.length;
    const depth = new Map(this.level.decks.map((d) => [d.level, d.boothD / BD])); // rows are 3.27 m apart on Level 2, 3.00 m on Levels 1 and 3
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(BW, BH, BD), new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }), n);
    this.caps = new THREE.InstancedMesh(new THREE.BoxGeometry(BW - 0.3, 0.14, BD - 0.3), new THREE.MeshBasicMaterial(), n);
    const M = new THREE.Matrix4(), C = new THREE.Color(), p = new THREE.Vector3();

    list.forEach((b, i) => {
      this.boothIndex.set(b.id, i);
      const hero = b.id === this.level.hero.id, s = hero ? 1e-4 : 1, hs = 0.85 + ((i * 37) % 10) / 28, sz = s * (depth.get(b.deck) ?? 1);
      toWorld(b.x, b.y, (BH * hs) / 2, p);
      M.makeScale(s, hs * s, sz).setPosition(p); body.setMatrixAt(i, M);
      C.set(HALL_PALETTE[b.hall % 3]!).offsetHSL(0, 0, (((i * 53) % 9) - 4) / 90 + (b.name ? 0.06 : 0)); body.setColorAt(i, C);
      this.baseColor[i] = C.clone();
      this.capHeights[i] = BH * hs + 0.05;
      M.makeScale(s, 1, sz).setPosition(p.x, this.capHeights[i]!, p.z); this.caps.setMatrixAt(i, M);
      this.caps.setColorAt(i, C.multiplyScalar(0.62)); // unlit roof: a deeper tint so white sign text reads; turns yellow when stamped
    });
    body.name = 'booths'; this.body = body; this.scene.add(body, this.caps);
    this.signs(list);

    // Online stations: a light column each (taller and wider while a host is present), plus a pulse ring under hosted ones.
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false } as const;
    this.beams = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.4, 1, 10, 1, true), new THREE.MeshBasicMaterial({ opacity: 0.3, side: THREE.DoubleSide, ...additive }), n);
    this.hostRings = new THREE.InstancedMesh(new THREE.RingGeometry(0.9, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ opacity: 0.7, side: THREE.DoubleSide, ...additive }), n);
    this.beams.count = this.hostRings.count = 0; this.beams.frustumCulled = this.hostRings.frustumCulled = false;
    this.scene.add(this.beams, this.hostRings);
  }

  /** One draw call for every roof sign: instanced quads sampling a text atlas we can redraw cell by cell. */
  private signs(list: Booth[]) {
    const cellW = this.quality === 'high' ? 192 : 128, cellH = cellW / 4, cols = Math.floor(4096 / cellW), rows = Math.ceil(list.length / cols); // 1,600 cells inside a 4096² texture
    const canvas = document.createElement('canvas'); canvas.width = cellW * cols; canvas.height = cellH * rows;
    const tex = new THREE.CanvasTexture(canvas); tex.flipY = false; tex.anisotropy = 4; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.sign = { g: canvas.getContext('2d')!, tex, cellW, cellH, cols };
    list.forEach((b, i) => this.drawSign(i, b.name, b.id));

    const geo = new THREE.PlaneGeometry(2.6, 0.65); geo.rotateX(-Math.PI / 2);
    const uv = new Float32Array(list.length * 2);
    const mesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { map: { value: tex }, cell: { value: new THREE.Vector2(1 / cols, 1 / rows) } },
      vertexShader: `attribute vec2 aCell; uniform vec2 cell; varying vec2 vUv; varying float vDist;
        void main(){ vUv = (aCell + vec2(uv.x, 1.0 - uv.y)) * cell; vec4 mv = modelViewMatrix * instanceMatrix * vec4(position,1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying float vDist;
        void main(){ float a = texture2D(map, vUv).a * (1.0 - smoothstep(55.0, 95.0, vDist)); if (a < 0.02) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, a); }`,
    }), list.length);
    const M = new THREE.Matrix4();
    list.forEach((b, i) => {
      const hide = b.id === this.level.hero.id ? 1e-4 : 1, p = toWorld(b.x, b.y, this.capHeights[i]! + 0.09);
      M.makeScale(hide, 1, hide).setPosition(p); mesh.setMatrixAt(i, M);
      uv[i * 2] = i % cols; uv[i * 2 + 1] = Math.floor(i / cols);
    });
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(uv, 2));
    mesh.frustumCulled = false; this.scene.add(mesh);
  }

  private drawSign(i: number, name: string, id: string) {
    const { g, tex, cellW, cellH, cols } = this.sign, x0 = (i % cols) * cellW, y0 = Math.floor(i / cols) * cellH, x = x0 + cellW / 2, y = y0 + cellH / 2;
    g.clearRect(x0, y0, cellW, cellH); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    if (name) {
      g.font = `800 ${cellH * 0.34}px Urbanist, Arial`; let shown = name;
      while (g.measureText(shown).width > cellW * 0.94 && shown.length > 4) shown = shown.slice(0, -2);
      g.fillText(shown === name ? shown : shown + '…', x, y - cellH * 0.16);
      g.font = `600 ${cellH * 0.28}px Urbanist, Arial`; g.globalAlpha = 0.75; g.fillText(id, x, y + cellH * 0.26); g.globalAlpha = 1;
    } else { g.font = `700 ${cellH * 0.46}px Urbanist, Arial`; g.globalAlpha = 0.8; g.fillText(id, x, y); g.globalAlpha = 1; }
    tex.needsUpdate = true;
  }

  /** Apply the live list of claimed stations: brand colour, company name on the roof, light column, host pulse. */
  setStations(list: StationView[]) {
    const next = new Map(list.map((s) => [s.id, s])), C = new THREE.Color(), M = new THREE.Matrix4(), p = new THREE.Vector3();
    for (const [id, was] of this.online) {                       // went dark, or renamed
      const now = next.get(id), i = this.boothIndex.get(id);
      if (i == null || (now && now.company === was.company && now.color === was.color)) continue;
      if (!now) { this.body.setColorAt(i, this.baseColor[i]!); this.drawSign(i, this.level.booths[i]!.name, id); }
    }
    let nb = 0, nr = 0; this.hostedIdx = [];
    for (const s of list) {
      const i = this.boothIndex.get(s.id); if (i == null) continue;
      const was = this.online.get(s.id);
      if (!was || was.color !== s.color) this.body.setColorAt(i, C.set(s.color));
      if (!was || was.company !== s.company) this.drawSign(i, s.company, s.id);
      const b = this.level.booths[i]!, h = s.hosted ? 26 : 14, w = s.hosted ? 2.1 : 1;
      toWorld(b.x, b.y, this.capHeights[i]! + h / 2, p);
      M.makeScale(w, h, w).setPosition(p); this.beams.setMatrixAt(nb, M); this.beams.setColorAt(nb, C.set(s.color).lerp(WHITE, 0.35)); nb++;
      if (s.hosted) { this.hostedIdx.push(i); this.hostRings.setColorAt(nr, C.set(s.color).lerp(WHITE, 0.2)); nr++; }
    }
    this.beams.count = nb; this.hostRings.count = nr; this.online = next;
    this.beams.instanceMatrix.needsUpdate = true;
    for (const m of [this.body, this.beams, this.hostRings]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  /** Signal Storm: the quiet zone that pays double pulses on the floor so people can see where to run. */
  setStorm(st: StormView | null) {
    if (!st) { if (this.stormPlane) this.stormPlane.visible = false; return; }
    if (!this.stormPlane) {
      this.stormPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc629, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.scene.add(this.stormPlane);
    }
    this.stormPlane.visible = true; this.stormPlane.scale.set(st.x1 - st.x0, 1, st.y1 - st.y0);
    toWorld((st.x0 + st.x1) / 2, (st.y0 + st.y1) / 2, 0.05, this.stormPlane.position);
  }

  /** Ground Control: the target (Ground only), the astronaut (Ground only), and the markers both can see. */
  setGc(v: GcView | null) {
    this.gcGroup.clear(); if (!this.gcGroup.parent) this.scene.add(this.gcGroup);
    if (!v || v.state !== 'active') return;
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false } as const;
    if (v.target) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 40, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xff5fd2, opacity: 0.35, side: THREE.DoubleSide, ...additive }));
      toWorld(v.target.x, v.target.y, 20, beam.position); this.gcGroup.add(beam);
    }
    if (v.partnerPos) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.9, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3ddc84, opacity: 0.9, side: THREE.DoubleSide, ...additive }));
      toWorld(v.partnerPos.x, v.partnerPos.y, 0.12, ring.position); this.gcGroup.add(ring);
    }
    v.waypoints.forEach((w, i) => {
      const newest = i === v.waypoints.length - 1;
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.8, 12).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xff5fd2, transparent: true, opacity: newest ? 1 : 0.35 }));
      toWorld(w.x, w.y, 2.2, m.position); m.userData.bob = newest; this.gcGroup.add(m);
    });
  }

  /** Sector control: the hall floor glows in the holding crew's colour. */
  setSectors(sectors: SectorState[]) {
    for (const s of sectors) {
      const e = this.level.halls.find((k) => k.id === s.hall); if (!e) continue;
      let plane = this.sectorPlanes.get(s.hall);
      if (!plane) {
        plane = new THREE.Mesh(new THREE.PlaneGeometry(e.x1 - e.x0, e.y1 - e.y0).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        toWorld((e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2, 0.03, plane.position); this.scene.add(plane); this.sectorPlanes.set(s.hall, plane);
      }
      const m = plane.material as THREE.MeshBasicMaterial;
      if (s.holder) { m.color.set(CREW_INFO[s.holder].color); m.opacity = 0.11; } else m.opacity = 0;
    }
  }

  setStamped(ids: Iterable<string>) {
    const C = new THREE.Color();
    for (const id of ids) { const i = this.boothIndex.get(id); if (i != null) this.caps.setColorAt(i, C.copy(STAMPED)); }
    if (this.caps.instanceColor) this.caps.instanceColor.needsUpdate = true;
  }

  private launchPad() {
    const { w: BW, d: BD } = this.level.booth, hero = this.hero; hero.position.copy(this.heroPos); this.scene.add(hero);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.1, 0.16, BD + 0.1), new THREE.MeshBasicMaterial({ color: 0xffc629 })); pad.position.y = 0.08;
    const carpet = new THREE.Mesh(new THREE.BoxGeometry(BW - 0.25, 0.18, BD - 0.25), new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 1 })); carpet.position.y = 0.1;
    const wallW = new THREE.MeshStandardMaterial({ color: 0xf2f6f9, roughness: 0.7 });
    const art = canvasTex(1024, 820, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0b5f86'); gr.addColorStop(0.55, '#1aa9c9'); gr.addColorStop(1, '#2fd0e0'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(190,245,255,.35)'; g.beginPath(); g.arc(w / 2, h * 1.18, w * 0.52, 0, 7); g.fill();
      g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = '700 54px Urbanist, Arial'; g.fillText('lean.x digital  |  nexova', w / 2, 130);
      g.font = '800 92px Urbanist, Arial'; g.fillText('Building', w / 2 - 250, 300); g.fillStyle = '#ffc629'; g.fillText('Brands', w / 2 + 110, 300);
      g.fillStyle = '#fff'; g.fillText('Driving', w / 2 - 230, 410); g.fillStyle = '#ffc629'; g.fillText('Growth', w / 2 + 120, 410);
    });
    // 8H18B is mid-row: walls N, E (back) and S; the open side faces the west aisle.
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.5, BD - 0.1), [wallW, new THREE.MeshBasicMaterial({ map: art }), wallW, wallW, wallW, wallW]); back.position.set(BW / 2 - 0.06, 1.4, 0);
    hero.add(pad, carpet, back);
    for (const s of [-1, 1]) { const side = new THREE.Mesh(new THREE.BoxGeometry(BW, 2.5, 0.1), wallW); side.position.set(0, 1.4, s * (BD / 2 - 0.05)); hero.add(side); }
    const counter = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 1.5), new THREE.MeshStandardMaterial({ color: 0x1396bd, roughness: 0.5 })); counter.position.set(-0.75, 0.65, 0.45);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 1.3), new THREE.MeshBasicMaterial({ color: 0x9ff1ff })); screen.position.set(BW / 2 - 0.2, 1.6, -0.75);
    hero.add(counter, screen);

    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false } as const;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 120, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc629, opacity: 0.13, side: THREE.DoubleSide, ...additive })); beam.position.y = 60;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 120, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1b8, opacity: 0.5, ...additive })); core.position.y = 60;
    const X = new THREE.Group();
    const bar = (color: number, emissive: number, rz: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 5.4, 0.7), new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.9, roughness: 0.3 })); m.rotation.z = rz; return m; };
    X.add(bar(0x3aa8ff, 0x1d7be0, Math.PI / 5), bar(0xffc629, 0xd99a00, -Math.PI / 5)); X.position.y = 10.5;
    const guide = new Astronaut({ spec: { ...defaultAvatar(null), top: 5, bottom: 4 } }); guide.group.scale.setScalar(1.5); guide.group.position.set(0, 9.2, 1.2); guide.group.rotation.set(0.2, -Math.PI / 2, 0.35);
    const rings = [0, 1, 2].map(() => { const r = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffc629, transparent: true, side: THREE.DoubleSide, depthWrite: false })); r.rotation.x = -Math.PI / 2; r.position.y = 0.22; return r; });
    const crew = (['closer', 'strategist', 'creator'] as const).map((k, i) => {
      const a = new Astronaut({ spec: defaultAvatar(k) }); a.group.position.set([-0.2, 0.55, -0.4][i]!, 0.18, [-0.85, 0.2, 0.95][i]!); a.group.rotation.y = -Math.PI / 2 + (i - 1) * 0.35; a.group.scale.setScalar(0.95); return a;
    });
    hero.add(beam, core, X, guide.group, ...rings, ...crew.map((c) => c.group));
    this.heroBits = { X, guide, rings, crew };
    this.labels.push({ text: '✕  Launch Pad · ' + this.level.hero.id, pos: this.heroPos.clone().setY(15.5), kind: 'hero' });
  }

  update(t: number, dt: number) {
    const { X, guide, rings, crew } = this.heroBits;
    X.rotation.y = t * 0.8; X.position.y = 10.5 + Math.sin(t * 1.4) * 0.35;
    guide.group.position.y = 9 + Math.sin(t * 1.1) * 0.5; guide.group.rotation.z = 0.35 + Math.sin(t * 0.7) * 0.15;
    rings.forEach((r, i) => { const k = (t * 0.45 + i / 3) % 1, s = 2 + k * 11; r.scale.set(s, s, 1); (r.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.75; });
    for (const c of crew) c.animate(dt, 0);
    if (this.stormPlane?.visible) (this.stormPlane.material as THREE.MeshBasicMaterial).opacity = 0.09 + 0.07 * (0.5 + 0.5 * Math.sin(t * 2.4));
    for (const m of this.gcGroup.children) if (m.userData.bob) m.position.y = 2.2 + Math.sin(t * 4) * 0.35;
    if (this.hostedIdx.length) {
      const M = new THREE.Matrix4(), p = new THREE.Vector3(), k = (t * 0.6) % 1, s = 2.2 + k * 3.2;
      this.hostedIdx.forEach((bi, n) => { const b = this.level.booths[bi]!; toWorld(b.x, b.y, 0.08, p); M.makeScale(s, 1, s).setPosition(p); this.hostRings.setMatrixAt(n, M); });
      (this.hostRings.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.7; this.hostRings.instanceMatrix.needsUpdate = true;
    }
  }
}
