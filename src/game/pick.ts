// Which booth is under the pointer. Worked out from the floor plan, not by asking the GPU: a ray from the eye is tested
// against the boxes of the few booths it passes over, and the first one it enters wins — so a booth hidden behind
// another is never picked through it. Plan space throughout: x east, y north, z up (the same numbers as floor.json).

import type { Booth, LevelData } from '../../shared/types';

export interface Ray { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }
const CELL = 6;

export class BoothPicker {
  private buckets = new Map<string, Booth[]>();
  private w: number; private h: number; private depth = new Map<number, number>();

  constructor(level: LevelData) {
    this.w = level.booth.w; this.h = level.booth.h;
    for (const d of level.decks) this.depth.set(d.level, d.boothD);
    for (const b of level.booths) { const k = `${Math.floor(b.x / CELL)},${Math.floor(b.y / CELL)}`; (this.buckets.get(k) ?? this.buckets.set(k, []).get(k)!).push(b); }
  }

  /** The front-most booth the ray enters, or null: it reached the floor first, or it never comes down. */
  pick(r: Ray): Booth | null {
    if (r.dz >= -1e-6 || r.oz <= this.h) return null; // looking up, or from inside the furniture: nothing sensible to say
    // A booth can only be entered between the height of its roof and the floor: that stretch of the ray is a short line on the plan.
    const tTop = (this.h - r.oz) / r.dz, tFloor = -r.oz / r.dz;
    const ax = r.ox + r.dx * tTop, ay = r.oy + r.dy * tTop, bx = r.ox + r.dx * tFloor, by = r.oy + r.dy * tFloor;
    if (Math.hypot(bx - ax, by - ay) > 60) return null; // a grazing ray near the horizon: not a click on anything
    const x0 = Math.floor((Math.min(ax, bx) - this.w) / CELL), x1 = Math.floor((Math.max(ax, bx) + this.w) / CELL);
    const y0 = Math.floor((Math.min(ay, by) - 4) / CELL), y1 = Math.floor((Math.max(ay, by) + 4) / CELL);
    let best: Booth | null = null, bestT = Infinity;
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) for (const b of this.buckets.get(`${i},${j}`) ?? []) {
      const t = this.enter(r, b); if (t < bestT) { bestT = t; best = b; }
    }
    return best;
  }

  /** Distance along the ray at which it enters the booth's box (slab test); Infinity if it misses. */
  private enter(r: Ray, b: Booth): number {
    const hw = this.w / 2, hd = (this.depth.get(b.deck) ?? 3) / 2;
    let t0 = 0, t1 = Infinity;
    for (const [o, d, lo, hi] of [[r.ox, r.dx, b.x - hw, b.x + hw], [r.oy, r.dy, b.y - hd, b.y + hd], [r.oz, r.dz, 0, this.h]] as const) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; continue; }
      const a = (lo - o) / d, c = (hi - o) / d; t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
      if (t0 > t1) return Infinity;
    }
    return t0;
  }
}
