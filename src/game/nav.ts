import type { LevelData, Rect } from '../../shared/types';
import { buildPlaces } from './places';

export interface P2 { x: number; y: number }

/** Walkability grid in floor-plan metres. Used for collision, tap-to-move and the guide trail. */
export class NavGrid {
  readonly res = 0.5;
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  private cells: Uint8Array;
  // A* scratch space, allocated once: the grid spans three decks (~400 k cells) and the trail re-plans every second
  private gScore: Float32Array; private parent: Int32Array; private closed: Uint8Array; private touched: number[] = [];

  constructor(level: LevelData, radius = 0.45) {
    const rects = [...level.walkable, ...level.decks];
    this.x0 = Math.floor(Math.min(...rects.map((r) => r.x0))) - 2; this.y0 = Math.floor(Math.min(...rects.map((r) => r.y0))) - 2;
    this.w = Math.ceil((Math.max(...rects.map((r) => r.x1)) + 2 - this.x0) / this.res);
    this.h = Math.ceil((Math.max(...rects.map((r) => r.y1)) + 2 - this.y0) / this.res);
    this.cells = new Uint8Array(this.w * this.h);
    this.gScore = new Float32Array(this.w * this.h).fill(Infinity); this.parent = new Int32Array(this.w * this.h).fill(-1); this.closed = new Uint8Array(this.w * this.h);

    for (const r of level.walkable) this.fill(r, 1, -radius);
    const bw = level.booth.w / 2, depth = new Map(level.decks.map((d) => [d.level, d.boothD / 2]));
    for (const b of level.booths) { const bd = depth.get(b.deck) ?? level.booth.d / 2; this.fill({ x0: b.x - bw, y0: b.y - bd, x1: b.x + bw, y1: b.y + bd }, 0, radius); }
    for (const p of buildPlaces(level)) for (const r of p.blocked) this.fill(r, 0, radius * 0.6); // places are walked into; only their furniture is in the way
    for (const wl of level.walls) this.fill(wl, 0, radius);
  }

  /** grow > 0 inflates the rect (obstacles), grow < 0 shrinks it (keeps the avatar off the outer edge). */
  private fill(r: Rect, v: 0 | 1, grow: number) {
    const i0 = Math.max(0, Math.floor((r.x0 - grow - this.x0) / this.res)), i1 = Math.min(this.w - 1, Math.ceil((r.x1 + grow - this.x0) / this.res) - 1);
    const j0 = Math.max(0, Math.floor((r.y0 - grow - this.y0) / this.res)), j1 = Math.min(this.h - 1, Math.ceil((r.y1 + grow - this.y0) / this.res) - 1);
    for (let j = j0; j <= j1; j++) this.cells.fill(v, j * this.w + i0, j * this.w + i1 + 1);
  }

  private idx(x: number, y: number): number {
    const i = Math.floor((x - this.x0) / this.res), j = Math.floor((y - this.y0) / this.res);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i;
  }

  walkable(x: number, y: number): boolean {
    const k = this.idx(x, y);
    return k >= 0 && this.cells[k] === 1;
  }

  /** Move with wall-sliding: try the full step, then each axis on its own. */
  move(p: P2, dx: number, dy: number): P2 {
    if (this.walkable(p.x + dx, p.y + dy)) return { x: p.x + dx, y: p.y + dy };
    if (dx && this.walkable(p.x + dx, p.y)) return { x: p.x + dx, y: p.y };
    if (dy && this.walkable(p.x, p.y + dy)) return { x: p.x, y: p.y + dy };
    return p;
  }

  nearestWalkable(x: number, y: number, maxR = 8): P2 | null {
    if (this.walkable(x, y)) return { x, y };
    for (let r = this.res; r <= maxR; r += this.res) {
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r, py = y + Math.sin((a / 16) * Math.PI * 2) * r;
        if (this.walkable(px, py)) return { x: px, y: py };
      }
    }
    return null;
  }

  lineClear(a: P2, b: P2): boolean {
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / (this.res * 0.5)));
    for (let s = 0; s <= n; s++) if (!this.walkable(a.x + ((b.x - a.x) * s) / n, a.y + ((b.y - a.y) * s) / n)) return false;
    return true;
  }

  /** A* (8-connected, no corner cutting) + line-of-sight smoothing. Returns metres, start→goal, or null. */
  path(from: P2, to: P2): P2[] | null {
    const s = this.nearestWalkable(from.x, from.y), g = this.nearestWalkable(to.x, to.y);
    if (!s || !g) return null;
    const start = this.idx(s.x, s.y), goal = this.idx(g.x, g.y);
    if (start === goal) return [s, g];

    const W = this.w, { gScore, parent, closed, touched } = this;
    for (const k of touched) { gScore[k] = Infinity; parent[k] = -1; closed[k] = 0; } // undo only what the last search wrote
    touched.length = 0;
    const gi = goal % W, gj = (goal / W) | 0;
    const heur = (k: number) => { const dx = Math.abs((k % W) - gi), dy = Math.abs(((k / W) | 0) - gj); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };

    // binary heap of [f, index]
    const heapK: number[] = [], heapF: number[] = [];
    const push = (k: number, f: number) => {
      let i = heapK.length; heapK.push(k); heapF.push(f);
      while (i > 0) { const p = (i - 1) >> 1; if (heapF[p]! <= f) break; heapK[i] = heapK[p]!; heapF[i] = heapF[p]!; i = p; }
      heapK[i] = k; heapF[i] = f;
    };
    const pop = (): number => {
      const top = heapK[0]!, k = heapK.pop()!, f = heapF.pop()!;
      const n = heapK.length;
      if (n) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1; if (c >= n) break;
          if (c + 1 < n && heapF[c + 1]! < heapF[c]!) c++;
          if (heapF[c]! >= f) break;
          heapK[i] = heapK[c]!; heapF[i] = heapF[c]!; i = c;
        }
        heapK[i] = k; heapF[i] = f;
      }
      return top;
    };

    gScore[start] = 0; touched.push(start); push(start, heur(start));
    const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    let found = false;
    while (heapK.length) {
      const k = pop();
      if (k === goal) { found = true; break; }
      if (closed[k]) continue;
      closed[k] = 1;
      const i = k % W, j = (k / W) | 0;
      for (let d = 0; d < 8; d++) {
        const ni = i + DI[d]!, nj = j + DJ[d]!;
        if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
        const nk = nj * W + ni;
        if (!this.cells[nk] || closed[nk]) continue;
        if (d >= 4 && (!this.cells[j * W + ni] || !this.cells[nj * W + i])) continue;
        const ng = gScore[k]! + (d >= 4 ? 1.4142 : 1);
        if (ng < gScore[nk]!) { if (gScore[nk] === Infinity) touched.push(nk); gScore[nk] = ng; parent[nk] = k; push(nk, ng + heur(nk)); }
      }
    }
    if (!found) return null;

    const raw: P2[] = [];
    for (let k = goal; k !== -1; k = parent[k]!) raw.push({ x: this.x0 + ((k % W) + 0.5) * this.res, y: this.y0 + (((k / W) | 0) + 0.5) * this.res });
    raw.reverse(); raw[0] = s; raw[raw.length - 1] = g;

    const out: P2[] = [raw[0]!];
    let anchor = 0;
    for (let i = 2; i < raw.length; i++) {
      if (!this.lineClear(raw[anchor]!, raw[i]!)) { out.push(raw[i - 1]!); anchor = i - 1; }
    }
    out.push(raw[raw.length - 1]!);
    return out;
  }
}

export function pathLength(p: P2[]): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i]!.x - p[i - 1]!.x, p[i]!.y - p[i - 1]!.y);
  return L;
}

/** Point at distance d along a polyline. */
export function pointAlong(p: P2[], d: number): P2 {
  for (let i = 1; i < p.length; i++) {
    const l = Math.hypot(p[i]!.x - p[i - 1]!.x, p[i]!.y - p[i - 1]!.y);
    if (d <= l || i === p.length - 1) { const t = l ? Math.min(1, d / l) : 0; return { x: p[i - 1]!.x + (p[i]!.x - p[i - 1]!.x) * t, y: p[i - 1]!.y + (p[i]!.y - p[i - 1]!.y) * t }; }
    d -= l;
  }
  return p[p.length - 1]!;
}
