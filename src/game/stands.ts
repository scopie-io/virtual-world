// An exhibitor's stand is often several booths side by side (the biggest at MIHAS 2026 is 26). The floor plan lists
// them as separate cells; on the floor they are one stand with one name. This groups neighbouring booths of the same
// exhibitor, and says where that name should be written: along the longest straight run of the stand.
// Game rules stay per booth (each cell is still stamped on its own); this is only how the world is drawn.
import type { LevelData } from '../../shared/types';

export interface Stand {
  name: string; deck: number;
  /** indices into level.booths */
  booths: number[];
  /** where the name goes: centre, and the width / depth available, in metres on the plan */
  x: number; y: number; w: number; d: number;
}

export function buildStands(level: LevelData): Stand[] {
  const BW = level.booth.w, depthOf = new Map(level.decks.map((k) => [k.level, k.boothD])), byKey = new Map<string, number[]>();
  level.booths.forEach((b, i) => { if (!b.name || b.id === level.hero.id) return; const k = `${b.deck}|${b.name}`; (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(i); });
  const out: Stand[] = [];
  for (const [key, all] of byKey) {
    const deck = Number(key.split('|')[0]), BD = depthOf.get(deck) ?? level.booth.d, B = (i: number) => level.booths[i]!;
    const touching = (a: number, b: number) => { const dx = Math.abs(B(a).x - B(b).x), dy = Math.abs(B(a).y - B(b).y); return (dx <= BW + 0.4 && dy <= 0.4) || (dy <= BD + 0.4 && dx <= 0.4); };
    const left = new Set(all);
    while (left.size) { // flood-fill one connected stand at a time
      const first = left.values().next().value as number, group = [first], queue = [first]; left.delete(first);
      while (queue.length) { const a = queue.pop()!; for (const b of [...left]) if (touching(a, b)) { left.delete(b); group.push(b); queue.push(b); } }
      // the longest run of cells in one row: that is where a fascia board would hang
      const rows = new Map<number, number[]>(); for (const i of group) { const k = Math.round(B(i).y * 2); (rows.get(k) ?? rows.set(k, []).get(k)!).push(i); }
      let best: number[] = [];
      for (const row of rows.values()) {
        row.sort((p, q) => B(p).x - B(q).x); let run = [row[0]!];
        for (let n = 1; n <= row.length; n++) {
          if (n < row.length && B(row[n]!).x - B(row[n - 1]!).x <= BW + 0.4) { run.push(row[n]!); continue; }
          if (run.length > best.length) best = run; run = n < row.length ? [row[n]!] : [];
        }
      }
      const x = best.reduce((s, i) => s + B(i).x, 0) / best.length;
      out.push({ name: B(first).name, deck, booths: group, x, y: B(best[0]!).y, w: best.length * BW - 0.5, d: BD - 0.7 });
    }
  }
  return out;
}
