import * as THREE from 'three';
import { CATALOG, type AvatarSpec, type CarryKind, type SmileKind, type TopOption } from '../../shared/avatar';
import type { Pose } from '../../shared/rules';

// The brand mascot from primitives: helmet, black visor, LED smile, ear ring — dressed from an AvatarSpec.
// In the game everyone wears the same suit; the jacket colour says who they are (blue visitor, green exhibitor).
// Placeholder for a rigged glTF character: the class API is what the rest of the game depends on.

const geo = {
  helmet: new THREE.SphereGeometry(0.56, 24, 18),
  visor: new THREE.SphereGeometry(0.47, 24, 18),
  face: new THREE.PlaneGeometry(0.6, 0.34),
  ear: new THREE.CylinderGeometry(0.16, 0.16, 0.1, 14),
  body: new THREE.CapsuleGeometry(0.36, 0.45, 5, 12),
  skirt: new THREE.CylinderGeometry(0.35, 0.47, 0.62, 14, 1, true),
  band: new THREE.CylinderGeometry(0.375, 0.375, 0.07, 14, 1, true),
  sash: new THREE.CylinderGeometry(0.39, 0.42, 0.26, 14, 1, true),
  collar: new THREE.TorusGeometry(0.2, 0.05, 6, 14),
  button: new THREE.SphereGeometry(0.035, 6, 5),
  leg: new THREE.CapsuleGeometry(0.14, 0.34, 4, 8),
  arm: new THREE.CapsuleGeometry(0.11, 0.34, 4, 8),
  shoe: new THREE.BoxGeometry(0.24, 0.14, 0.4),
  shadow: new THREE.CircleGeometry(0.62, 28),
  marker: new THREE.RingGeometry(0.78, 0.98, 40),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
};

const mats = new Map<string, THREE.Material>();
function mat(color: number, ghost: boolean, o: { rough?: number; metal?: number; map?: THREE.Texture; side?: THREE.Side } = {}): THREE.Material {
  const key = `${color}|${ghost}|${o.rough ?? 0.8}|${o.metal ?? 0}|${o.map?.uuid ?? ''}|${o.side ?? 0}`;
  let m = mats.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0, map: o.map ?? null, side: o.side ?? THREE.FrontSide, transparent: ghost, opacity: ghost ? 0.58 : 1, depthWrite: !ghost }); mats.set(key, m); }
  return m;
}
// Grounding: a soft contact shadow under everyone, and a coloured ring under the player so they can always find themselves.
const onFloor = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 } as const;
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x1b2130, opacity: 0.16, ...onFloor });

/** LED glyphs drawn once per kind: crisp strokes with a soft glow, like the visor in the brand art. */
const faces = new Map<SmileKind, THREE.Material>();
function faceMat(kind: SmileKind): THREE.Material {
  let m = faces.get(kind);
  if (m) return m;
  const c = document.createElement('canvas'); c.width = 192; c.height = 108;
  const g = c.getContext('2d')!; g.strokeStyle = g.fillStyle = '#5cc4ff'; g.shadowColor = '#2f9bff'; g.shadowBlur = 12; g.lineWidth = 9; g.lineCap = g.lineJoin = 'round';
  const arc = (x: number, y: number, r: number, a0: number, a1: number) => { g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke(); };
  const dot = (x: number, y: number, r = 7) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
  switch (kind) {
    case 'smile': arc(96, 30, 46, 0.2 * Math.PI, 0.8 * Math.PI); break;
    case 'grin': g.beginPath(); g.arc(96, 38, 44, 0.08 * Math.PI, 0.92 * Math.PI); g.closePath(); g.stroke(); break;
    case 'wink': arc(96, 34, 42, 0.2 * Math.PI, 0.8 * Math.PI); dot(62, 26); g.beginPath(); g.moveTo(118, 26); g.lineTo(140, 26); g.stroke(); break;
    case 'dots': dot(60, 54, 9); dot(96, 54, 9); dot(132, 54, 9); break;
    case 'heart': g.beginPath(); g.moveTo(96, 86); g.bezierCurveTo(30, 44, 62, 8, 96, 36); g.bezierCurveTo(130, 8, 162, 44, 96, 86); g.fill(); break;
    case 'zigzag': g.beginPath(); [[40, 62], [62, 44], [84, 62], [108, 44], [130, 62], [152, 44]].forEach(([x, y], i) => (i ? g.lineTo(x!, y!) : g.moveTo(x!, y!))); g.stroke(); break;
    case 'x': g.strokeStyle = '#ffc629'; g.shadowColor = '#ffb21e'; g.beginPath(); g.moveTo(66, 24); g.lineTo(126, 84); g.moveTo(126, 24); g.lineTo(66, 84); g.stroke(); break;
    case 'star': g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 17 : 40, a = -Math.PI / 2 + (i * Math.PI) / 5; g[i ? 'lineTo' : 'moveTo'](96 + Math.cos(a) * r, 54 + Math.sin(a) * r); } g.closePath(); g.fill(); break;
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false });
  faces.set(kind, m); return m;
}

let batik: THREE.Texture | null = null;
function batikTex(base: number, accent: number): THREE.Texture {
  if (batik) return batik;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
  g.fillStyle = '#' + base.toString(16).padStart(6, '0'); g.fillRect(0, 0, 64, 64); g.fillStyle = g.strokeStyle = '#' + accent.toString(16).padStart(6, '0'); g.lineWidth = 2;
  for (const [x, y] of [[16, 16], [48, 48]]) { g.beginPath(); g.moveTo(x!, y! - 11); g.lineTo(x! + 11, y!); g.lineTo(x!, y! + 11); g.lineTo(x! - 11, y!); g.closePath(); g.stroke(); g.beginPath(); g.arc(x!, y!, 3, 0, 7); g.fill(); }
  for (const [x, y] of [[48, 16], [16, 48]]) { g.beginPath(); g.arc(x!, y!, 5, 0, 7); g.stroke(); }
  batik = new THREE.CanvasTexture(c); batik.colorSpace = THREE.SRGBColorSpace; batik.wrapS = batik.wrapT = THREE.RepeatWrapping; batik.repeat.set(4, 2);
  return batik;
}

function carryMesh(kind: CarryKind, ghost: boolean): THREE.Object3D | null {
  const part = (g: THREE.BufferGeometry, color: number, s: [number, number, number], p: [number, number, number] = [0, 0, 0], o = {}) => { const m = new THREE.Mesh(g, mat(color, ghost, o)); m.scale.set(...s); m.position.set(...p); return m; };
  const grp = new THREE.Group();
  switch (kind) {
    case 'none': return null;
    case 'laptop': grp.add(part(geo.box, 0xb9c0c8, [0.5, 0.035, 0.36], [0, 0, 0], { rough: 0.35, metal: 0.6 })); grp.rotation.set(0.2, 0, 1.35); grp.position.set(0.62, 0.95, 0.06); break;
    case 'tablet': grp.add(part(geo.box, 0x15181d, [0.36, 0.03, 0.27], [0, 0, 0], { rough: 0.3 }), part(geo.box, 0x6fe3ff, [0.31, 0.032, 0.22])); grp.rotation.set(0.2, 0, 1.35); grp.position.set(0.61, 0.95, 0.06); break;
    case 'clipboard': grp.add(part(geo.box, 0x8a6a45, [0.34, 0.03, 0.46]), part(geo.box, 0xf5f7fa, [0.29, 0.034, 0.38], [0, 0, 0.02])); grp.rotation.set(0.2, 0, 1.35); grp.position.set(0.61, 0.95, 0.06); break;
    case 'camera': grp.add(part(geo.box, 0x16181c, [0.3, 0.2, 0.16]), part(geo.cyl, 0x2a2d33, [0.15, 0.16, 0.15], [0, 0, 0.14], { rough: 0.3 })); grp.children[1]!.rotation.x = Math.PI / 2; grp.position.set(0.2, 1.02, 0.42); break;
    case 'coffee': grp.add(part(geo.cyl, 0x3b2a20, [0.13, 0.2, 0.13]), part(geo.cyl, 0xf5f7fa, [0.14, 0.04, 0.14], [0, 0.11, 0])); grp.position.set(0.5, 0.86, 0.3); break;
    case 'mic': grp.add(part(geo.cyl, 0x2a2d33, [0.06, 0.26, 0.06]), part(geo.helmet, 0x6b7480, [0.13, 0.13, 0.13], [0, 0.17, 0], { metal: 0.5, rough: 0.4 })); grp.position.set(0.48, 0.96, 0.3); break;
    case 'box': grp.add(part(geo.box, 0xc9a27a, [0.4, 0.3, 0.32]), part(geo.box, 0xa88258, [0.41, 0.05, 0.08], [0, 0.13, 0])); grp.position.set(0, 0.9, 0.46); break;
    case 'briefcase': grp.add(part(geo.box, 0x4a3323, [0.42, 0.3, 0.1]), part(geo.box, 0x2a1d14, [0.16, 0.05, 0.05], [0, 0.17, 0])); grp.position.set(0.56, 0.52, 0.04); break;
    case 'bag': grp.add(part(geo.box, 0x17b6d6, [0.32, 0.36, 0.14]), part(geo.box, 0xf5f7fa, [0.14, 0.06, 0.03], [0, 0.2, 0])); grp.position.set(0.56, 0.5, 0.04); break;
    case 'toolkit': grp.add(part(geo.box, 0xe24a3b, [0.4, 0.2, 0.18]), part(geo.box, 0x2a2d33, [0.18, 0.05, 0.05], [0, 0.125, 0])); grp.position.set(0.56, 0.48, 0.04); break;
  }
  return grp;
}

export interface AstronautOpts { spec: AvatarSpec; /** overrides the top's colour: the role colour */ jacket?: number; /** a ring on the floor in this colour: "this one is you" */ marker?: number }

export class Astronaut {
  readonly group = new THREE.Group();
  private rig = new THREE.Group();
  private legs: THREE.Group[] = [];
  private arms: THREE.Mesh[] = [];
  private phase = Math.random() * 10;
  private ghost = false;
  private jacket: number | undefined;
  private pose: Pose = '';
  private seatZ = 0.46;
  private poseT = 0;

  constructor({ spec, jacket, marker }: AstronautOpts) {
    this.jacket = jacket;
    this.group.add(this.rig);
    const s = new THREE.Mesh(geo.shadow, shadowMat); s.rotation.x = -Math.PI / 2; s.position.y = 0.02; s.renderOrder = 4; this.group.add(s);
    if (marker != null) { const r = new THREE.Mesh(geo.marker, new THREE.MeshBasicMaterial({ color: marker, ...onFloor })); r.rotation.x = -Math.PI / 2; r.position.y = 0.03; r.renderOrder = 5; this.group.add(r); }
    this.dress(spec);
  }

  setJacket(color: number | undefined) { this.jacket = color; }
  /** What the astronaut is doing besides walking. seatZ: how high the seat is, for 'sit'. */
  setPose(pose: Pose, seatZ = 0.46) { if (pose !== this.pose) this.poseT = 0; this.pose = pose; this.seatZ = seatZ; }

  /** Rebuild the look in place. Cheap: shared geometry, cached materials. */
  dress(spec: AvatarSpec) {
    this.rig.clear(); this.legs = []; this.arms = [];
    const g = this.ghost, C = CATALOG;
    const top = (C.top[spec.top] ?? C.top[0]!) as TopOption, carry = C.carry[spec.carry]?.kind ?? 'none';
    const topColor = this.jacket ?? top.color;
    const topM = mat(topColor, g, this.jacket == null && top.pattern === 'batik' ? { map: batikTex(top.color, top.accent ?? 0xffffff) } : {}), sleeveM = mat(topColor, g);
    const accentM = mat(top.accent ?? 0xf5f7fa, g, { rough: 0.5, side: THREE.DoubleSide });
    const add = <T extends THREE.Object3D>(o: T, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); this.rig.add(o); return o; };

    add(new THREE.Mesh(geo.helmet, mat(C.helmet[spec.helmet]?.color ?? 0xf5f7fa, g, { rough: 0.35 })), 0, 1.72, 0);
    const visor = add(new THREE.Mesh(geo.visor, mat(C.visor[spec.visor]?.color ?? 0x05070c, g, { rough: 0.08, metal: 0.6 })), 0, 1.7, 0.17); visor.scale.set(1, 0.86, 0.9);
    add(new THREE.Mesh(geo.face, faceMat(C.smile[spec.smile]?.kind ?? 'smile')), 0, 1.68, 0.61);
    add(new THREE.Mesh(geo.body, topM), 0, 0.92, 0);
    if (top.long) add(new THREE.Mesh(geo.skirt, mat(topColor, g, { side: THREE.DoubleSide })), 0, 0.5, 0);
    if (top.pattern === 'collar') add(new THREE.Mesh(geo.collar, accentM), 0, 1.24, 0.03).rotation.x = Math.PI / 2;
    if (top.pattern === 'sampin') add(new THREE.Mesh(geo.sash, accentM), 0, 0.66, 0);
    if (top.pattern === 'hivis') for (const y of [0.82, 1.04]) add(new THREE.Mesh(geo.band, accentM), 0, y, 0);
    if (top.pattern === 'buttons') for (const y of [0.78, 0.94, 1.1]) add(new THREE.Mesh(geo.button, mat(top.accent ?? 0xe9edf1, g, { rough: 0.4 })), 0, y, 0.36);

    const earM = mat(C.ear[spec.ear]?.color ?? 0xffb21e, g, { rough: 0.4 }), pantsM = mat(C.bottom[spec.bottom]?.color ?? 0x1f3558, g, { rough: 0.85 }), shoeM = mat(C.shoes[spec.shoes]?.color ?? 0xf5f7fa, g, { rough: 0.5 });
    for (const s of [-1, 1]) {
      add(new THREE.Mesh(geo.ear, earM), 0.56 * s, 1.7, 0).rotation.z = Math.PI / 2;
      const leg = new THREE.Group(), l = new THREE.Mesh(geo.leg, pantsM), shoe = new THREE.Mesh(geo.shoe, shoeM);
      l.position.y = -0.26; shoe.position.set(0, -0.53, 0.07); leg.add(l, shoe); add(leg, 0.17 * s, 0.6, 0); this.legs.push(leg);
      const arm = add(new THREE.Mesh(geo.arm, sleeveM), 0.47 * s, 0.98, 0); arm.rotation.z = 0.25 * s; this.arms.push(arm);
    }
    const prop = carryMesh(carry, g); if (prop) this.rig.add(prop);
  }

  /** speed01: 0 idle … 1 full run. */
  animate(dt: number, speed01: number) {
    this.phase += dt * (2 + speed01 * 9); this.poseT += dt;
    const [l, r] = this.arms as [THREE.Mesh, THREE.Mesh], legs = this.legs, rig = this.rig, t = this.poseT;
    // arms pivot at their middle, so a raised arm is moved up as well as turned
    const arm = (a: THREE.Mesh, s: number, up: number, wobble = 0) => { a.position.set(s * (0.47 + up * 0.13), 0.98 + up * 0.34, 0); a.rotation.set(0, 0, s * (0.25 + up * 2.3) + wobble); };
    arm(l, -1, 0); arm(r, 1, 0); rig.rotation.set(0, 0, 0);
    const pose = speed01 > 0.15 && this.pose !== 'jump' ? '' : this.pose; // walking wins over waving
    if (pose === 'sit') {
      legs[0]!.rotation.x = legs[1]!.rotation.x = -1.45; rig.position.y = this.seatZ - 0.52 + Math.sin(this.phase * 0.5) * 0.01; return;
    }
    const swing = Math.sin(this.phase) * 0.75 * speed01;
    legs[0]!.rotation.x = swing; legs[1]!.rotation.x = -swing;
    l.rotation.x = -swing * 0.8; r.rotation.x = swing * 0.8;
    rig.position.y = speed01 > 0.05 ? Math.abs(Math.sin(this.phase)) * 0.12 : Math.sin(this.phase * 0.5) * 0.03 + 0.03;
    if (pose === 'wave') arm(r, 1, 1, Math.sin(t * 11) * 0.35);
    else if (pose === 'cheer') { arm(l, -1, 1, Math.sin(t * 9) * 0.12); arm(r, 1, 1, -Math.sin(t * 9) * 0.12); rig.position.y = Math.abs(Math.sin(t * 7)) * 0.22; }
    else if (pose === 'dance') { const k = Math.sin(t * 6); arm(l, -1, 0.5 + k * 0.5); arm(r, 1, 0.5 - k * 0.5); rig.rotation.z = k * 0.16; rig.rotation.y = Math.sin(t * 3) * 0.5; rig.position.y = Math.abs(Math.sin(t * 6)) * 0.14; legs[0]!.rotation.x = k * 0.35; legs[1]!.rotation.x = -k * 0.35; }
    else if (pose === 'jump') { arm(l, -1, 0.6); arm(r, 1, 0.6); legs[0]!.rotation.x = 0.4; legs[1]!.rotation.x = -0.25; }
  }

  dispose() { this.group.removeFromParent(); }
}
