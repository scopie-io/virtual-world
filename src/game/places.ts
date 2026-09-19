// The named areas of the real floor plan — cafés, lounges, stages, kitchens, the photo booth, the press rooms — turned
// from footprints into places: furniture, seats, one thing to do. Pure geometry from floor.json, no rendering:
// the world draws it, the nav grid walks around it, the engine sits people in it, and the demo cast uses it too.
//
// Everything is axis-aligned boxes and cylinders in floor-plan metres. One layout rule per kind of place, sized to
// whatever rectangle the organiser drew — nothing is placed by hand.
import type { Area, LevelData, Rect } from '../../shared/types';

export type PlaceKind = 'cafe' | 'lounge' | 'stage' | 'kitchen' | 'press' | 'photo' | 'shop' | 'staff';
export type Verb = 'sit' | 'watch' | 'photo' | null;
export type Tone = 'white' | 'soft' | 'mid' | 'ink' | 'area';
/** x, y = centre on the plan; z = height of the underside; w along x, d along y, h up. */
export interface Solid { x: number; y: number; z: number; w: number; d: number; h: number; tone: Tone; round?: boolean }
/** h = the rotation.y an astronaut has when sitting here; z = seat height. */
export interface Seat { x: number; y: number; z: number; h: number }
export interface Place {
  id: string; name: string; deck: number; kind: PlaceKind; rect: Rect; verb: Verb; blurb: string;
  /** false for back-of-house rooms: drawn, labelled, not somewhere to go */
  open: boolean;
  solids: Solid[]; blocked: Rect[]; seats: Seat[];
  /** photo places: where to stand, which way to face, and what the wall behind says */
  spot?: { x: number; y: number; h: number; wall: { x: number; y: number; w: number; d: number; text: string; face: 'N' | 'S' | 'E' | 'W' } };
  /** stages: where the presenter stands */
  presenter?: Seat;
}

const FACE = { N: Math.PI, S: 0, E: Math.PI / 2, W: -Math.PI / 2 } as const; // rotation.y that looks north / south / east / west
type Side = keyof typeof FACE;
const OPP: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };

function kindOf(a: Area): PlaceKind {
  const k = (a.id + ' ' + a.name).toLowerCase();
  if (/cafe|café/.test(k)) return 'cafe';
  if (/wellness|vip|speaker/.test(k)) return 'lounge';
  if (/kitchen/.test(k)) return 'kitchen';
  if (/stage|corner|livebox|live box/.test(k)) return Math.min(a.x1 - a.x0, a.y1 - a.y0) >= 8 ? 'stage' : 'press';
  if (/media|bernama|studio/.test(k)) return 'press';
  if (/photo|2027/.test(k)) return 'photo';
  if (/merch/.test(k)) return 'shop';
  return 'staff';
}

const BLURB: Record<PlaceKind, string> = {
  cafe: 'Take a seat. Everyone needs a break from the aisles.',
  lounge: 'A quiet corner to sit down.',
  stage: 'Talks and demos happen here. Sit and watch.',
  kitchen: 'Live cooking. Pull up a stool.',
  press: 'Where the show is reported from.',
  photo: 'Stand on the mark and take a photo of your astronaut.',
  shop: 'Official MIHAS merchandise.',
  staff: '',
};

/** The long side of the rectangle that is closest to the edge of its level: where a stage or a backdrop wall goes. */
function backSide(r: Rect, deck: Rect): Side {
  const wide = r.x1 - r.x0 >= r.y1 - r.y0;
  return wide ? (deck.y1 - r.y1 <= r.y0 - deck.y0 ? 'N' : 'S') : (deck.x1 - r.x1 <= r.x0 - deck.x0 ? 'E' : 'W');
}

/** Work in a local frame where "back" is +v: u runs along the back wall, v from the front edge (0) to the back edge (depth). */
function frame(r: Rect, back: Side) {
  const ns = back === 'N' || back === 'S', len = ns ? r.x1 - r.x0 : r.y1 - r.y0, depth = ns ? r.y1 - r.y0 : r.x1 - r.x0;
  const at = (u: number, v: number) => (back === 'N' ? { x: r.x0 + u, y: r.y0 + v } : back === 'S' ? { x: r.x0 + u, y: r.y1 - v } : back === 'E' ? { x: r.x0 + v, y: r.y0 + u } : { x: r.x1 - v, y: r.y0 + u });
  /** a box `lu` long (along the wall) and `lv` deep, centred at (u, v) */
  const box = (u: number, v: number, lu: number, lv: number, z: number, h: number, tone: Tone, round = false): Solid => ({ ...at(u, v), z, h, tone, round, w: ns ? lu : lv, d: ns ? lv : lu });
  return { len, depth, at, box, ns };
}

const footprint = (s: Solid): Rect => ({ x0: s.x - s.w / 2, y0: s.y - s.d / 2, x1: s.x + s.w / 2, y1: s.y + s.d / 2 });

/**
 * One scale for everything people use. The astronaut is a mascot, about 1.25× a person (2.3 m with the helmet), so
 * chairs, tables, counters and the gaps between them are 1.25× life size too: a seated astronaut fits their chair,
 * and sits level with the quiet crowd next to them. Booths and halls stay true to the floor plan.
 */
export const K = 1.25;
const SEAT_Z = 0.46 * K, CHAIR = 0.46 * K;

/** A chair: seat and back. `facing` is where the sitter looks. */
function chair(x: number, y: number, facing: Side, out: Place) {
  const b = CHAIR / 2 + 0.02, dx = facing === 'E' ? -b : facing === 'W' ? b : 0, dy = facing === 'N' ? -b : facing === 'S' ? b : 0, ns = facing === 'N' || facing === 'S';
  out.solids.push({ x, y, z: SEAT_Z - 0.07, w: CHAIR, d: CHAIR, h: 0.07, tone: 'mid' }, { x: x + dx, y: y + dy, z: SEAT_Z - 0.07, w: ns ? CHAIR : 0.07, d: ns ? 0.07 : CHAIR, h: 0.62, tone: 'mid' });
  out.seats.push({ x, y, z: SEAT_Z, h: FACE[facing] });
}

function layout(p: Place, deck: Rect) {
  const r = p.rect, W = r.x1 - r.x0, D = r.y1 - r.y0, block = (s: Solid) => { p.solids.push(s); p.blocked.push(footprint(s)); };

  if (p.kind === 'cafe') { // round tables on a grid, four chairs each
    const sx = 7.5, sy = 6, nx = Math.max(1, Math.floor((W - 6) / sx) + 1), ny = Math.max(1, Math.floor((D - 6) / sy) + 1), ox = r.x0 + (W - (nx - 1) * sx) / 2, oy = r.y0 + (D - (ny - 1) * sy) / 2, tr = 0.75, off = 1.32;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const x = ox + i * sx, y = oy + j * sy;
      p.solids.push({ x, y, z: 0, w: 0.2, d: 0.2, h: 0.9, tone: 'mid', round: true }, { x, y, z: 0.9, w: tr * 2, d: tr * 2, h: 0.07, tone: 'white', round: true });
      p.blocked.push({ x0: x - tr, y0: y - tr, x1: x + tr, y1: y + tr });
      chair(x - off, y, 'E', p); chair(x + off, y, 'W', p); chair(x, y - off, 'N', p); chair(x, y + off, 'S', p);
    }
  } else if (p.kind === 'lounge') { // pairs of sofas facing each other over a low table, along the long axis
    const f = frame(r, W >= D ? 'N' : 'E'), n = Math.max(1, Math.floor((f.len - 3) / 8)), step = f.len / n, mid = f.depth / 2, sl = Math.min(2.5, f.len - 1.2), gap = Math.min(1.85, f.depth / 2 - 0.85);
    for (let i = 0; i < n; i++) {
      const u = step * (i + 0.5);
      for (const s of [-1, 1]) {
        const v = mid + s * gap, facing: Side = f.ns ? (s < 0 ? 'N' : 'S') : s < 0 ? 'E' : 'W';
        block(f.box(u, v, sl, 1.0, 0, SEAT_Z, 'area')); block(f.box(u, v + s * 0.6, sl, 0.22, SEAT_Z, 0.55, 'area'));
        for (const k of [-0.6, 0.6]) p.seats.push({ ...f.at(u + k * Math.min(1, sl / 2.5), v - s * 0.1), z: SEAT_Z, h: FACE[facing] });
      }
      if (gap > 1.3) block(f.box(u, mid, 1.2, 0.7, 0, 0.45, 'white'));
    }
  } else if (p.kind === 'stage') { // a platform against the back, a screen behind it, rows of chairs facing it
    const back = backSide(r, deck), f = frame(r, back), pd = Math.min(8, Math.max(3, f.depth * 0.35)), v0 = f.depth - pd, pitch = 1.15, row = 1.65;
    block(f.box(f.len / 2, v0 + pd / 2, f.len - 1, pd, 0, 0.8, 'white'));
    p.solids.push(f.box(f.len / 2, f.depth - 0.25, f.len - 3, 0.3, 0.8, 4.2, 'soft'), f.box(f.len / 2, f.depth - 0.45, Math.min(f.len - 6, 10), 0.1, 1.7, 2.8, 'ink'));
    p.presenter = { ...f.at(f.len / 2 + 2.6, v0 + pd / 2 - 0.4), z: 0.8, h: FACE[OPP[back]] };
    const rows = Math.min(6, Math.floor((v0 - 3) / row)), per = Math.min(14, Math.floor((f.len - 4) / pitch));
    for (let j = 0; j < rows; j++) for (let i = 0; i < per; i++) {
      const u = f.len / 2 + (i - (per - 1) / 2) * pitch; if (Math.abs(u - f.len / 2) < 1) continue; // centre aisle
      const q = f.at(u, v0 - 2.2 - j * row); chair(q.x, q.y, back, p);
    }
  } else if (p.kind === 'kitchen') { // a back counter, an island, stools along the island's front
    const back = backSide(r, deck), f = frame(r, back), il = Math.max(3, f.len * 0.55), top = 1.15, stool = 0.9;
    block(f.box(f.len / 2, f.depth - 1, f.len - 2, 1.1, 0, top, 'white')); block(f.box(f.len / 2, f.depth - 0.75, f.len - 2.4, 0.5, top, 0.6, 'soft'));
    block(f.box(f.len / 2, f.depth / 2, il, 1.3, 0, top, 'white')); p.solids.push(f.box(f.len / 2, f.depth / 2, il + 0.2, 1.5, top, 0.07, 'mid'));
    for (let i = 0, n = Math.floor(il / 1.2); i < n; i++) {
      const q = f.at(f.len / 2 + (i - (n - 1) / 2) * 1.2, f.depth / 2 - 1.3);
      p.solids.push({ ...q, z: 0, w: 0.12, d: 0.12, h: stool - 0.07, tone: 'mid', round: true }, { ...q, z: stool - 0.07, w: 0.52, d: 0.52, h: 0.07, tone: 'mid', round: true });
      p.seats.push({ ...q, z: stool, h: FACE[back] });
    }
  } else if (p.kind === 'press') {
    const back = backSide(r, deck), f = frame(r, back);
    if (W * D > 120) { // a press room: rows of work desks, a chair on each side
      const cols = Math.max(1, Math.floor((f.depth - 2) / 4.6)), n = Math.max(1, Math.floor((f.len - 3) / 4.4));
      for (let c = 0; c < cols; c++) for (let i = 0; i < n; i++) {
        const u = f.len / 2 + (i - (n - 1) / 2) * 4.4, v = f.depth / 2 + (c - (cols - 1) / 2) * 4.6;
        block(f.box(u, v, 3, 1, 0, 0.92, 'white'));
        for (const s of [-1, 1]) { const q = f.at(u, v + s * 1.1); chair(q.x, q.y, s < 0 ? back : OPP[back], p); }
      }
    } else { // a small studio: a screen wall, a desk, chairs behind it facing out
      p.solids.push(f.box(f.len / 2, f.depth - 0.2, f.len - 0.6, 0.25, 0, 3.4, 'soft'), f.box(f.len / 2, f.depth - 0.4, Math.max(1.2, f.len - 1.8), 0.08, 1.3, 1.7, 'ink'));
      p.blocked.push(footprint(f.box(f.len / 2, f.depth - 0.2, f.len - 0.6, 0.4, 0, 3, 'soft')));
      const dv = Math.max(1.1, f.depth / 2 - 0.5);
      block(f.box(f.len / 2, dv - 0.9, Math.min(3, f.len - 0.8), 0.8, 0, 0.92, 'white'));
      const two = f.len > 3.2; for (const k of two ? [-0.75, 0.75] : [0]) { const q = f.at(f.len / 2 + k, dv + 0.2); chair(q.x, q.y, OPP[back], p); }
    }
  } else if (p.kind === 'photo') { // a backdrop wall, and a mark on the floor in front of it
    const back = backSide(r, deck), f = frame(r, back), wl = Math.min(f.len - 1.5, 8), wall = f.box(f.len / 2, f.depth - 0.35, wl, 0.3, 0, 3.6, 'white');
    block(wall);
    p.spot = { ...f.at(f.len / 2, f.depth - 2.4), h: FACE[OPP[back]], wall: { x: wall.x, y: wall.y, w: wall.w, d: wall.d, text: /2027/.test(p.name) ? 'MIHAS 2027' : 'MIHAS 2026', face: OPP[back] } };
  } else if (p.kind === 'shop') { // shelving against the back, a counter in front
    const back = backSide(r, deck), f = frame(r, back), n = Math.max(1, Math.floor((f.len - 1) / 2.6));
    for (let i = 0; i < n; i++) block(f.box(f.len / 2 + (i - (n - 1) / 2) * 2.6, f.depth - 0.45, 2.2, 0.6, 0, 2.2, 'white'));
    block(f.box(f.len / 2, Math.max(0.5, f.depth - 2), Math.min(3.4, f.len * 0.4), 0.7, 0, 1.15, 'soft'));
  } else { // back of house: a closed room
    block({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2, z: 0, w: W, d: D, h: 1.6, tone: 'area' });
  }
}

let cache: { level: LevelData; places: Place[] } | null = null;
export function buildPlaces(level: LevelData): Place[] {
  if (cache?.level === level) return cache.places;
  const places = level.areas.map((a): Place => {
    const kind = kindOf(a), deck = level.decks.find((d) => d.level === a.deck) ?? level.decks[0]!;
    const p: Place = { id: a.id, name: a.name, deck: a.deck, kind, rect: { x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1 }, verb: null, open: kind !== 'staff', blurb: BLURB[kind], solids: [], blocked: [], seats: [] };
    if (/bernama/i.test(a.name)) p.blurb = "The national news agency's studio on the show floor.";
    if (/2027/.test(a.name)) p.blurb = "Next year's show. Take a photo with it.";
    layout(p, deck);
    p.verb = p.kind === 'photo' ? 'photo' : p.seats.length ? (p.kind === 'stage' ? 'watch' : 'sit') : null;
    return p;
  });
  cache = { level, places };
  return places;
}

/** A quiet crowd: which seats already have someone in them. The same everywhere, every time — it is scenery, not people. */
export function taken(place: Place, i: number): boolean {
  let h = 2166136261; for (const c of place.id + ':' + i) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) % 100 < (place.kind === 'stage' ? 34 : place.kind === 'cafe' ? 20 : 14);
}

export const placeAt = (places: Place[], x: number, y: number, pad = 0.8): Place | null =>
  places.find((p) => p.open && x >= p.rect.x0 - pad && x <= p.rect.x1 + pad && y >= p.rect.y0 - pad && y <= p.rect.y1 + pad) ?? null;
