// Every walk the game offers must arrive: "take me there" from both entrances, and a press on any booth — at a smooth
// 60 frames a second and at the 20 a struggling phone manages. Run on the real floor plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { LevelData } from '../../shared/types';
import { NavGrid, pathLength, type P2 } from './nav';
import { follow, newMover, stepMover, RUN_SPEED } from './mover';

const level = JSON.parse(readFileSync('public/data/floor.json', 'utf8')) as LevelData, nav = new NavGrid(level);

/** Walk a route to its end; returns how far from the goal the mover stopped, and how long it took. */
function walk(from: P2, to: P2, dt: number) {
  const path = nav.path(from, to); assert.ok(path, 'a path exists');
  const m = newMover(); m.pos = { ...from }; follow(m, path);
  const goal = path[path.length - 1]!, budget = pathLength(path) / RUN_SPEED * 1.5 + 6; let t = 0;
  while (m.route.length && t < budget) { stepMover(m, nav, dt, null); t += dt; }
  return { off: Math.hypot(m.pos.x - goal.x, m.pos.y - goal.y), t, budget, replans: m.replans };
}

test('"take me there" arrives at the X from both entrances, smooth or choppy', () => {
  for (const spawn of [level.spawns.short, level.spawns.epic]) for (const dt of [1 / 60, 1 / 30, 0.05]) {
    const r = walk(spawn, level.hero.dock, dt);
    assert.ok(r.off < 0.6, `from ${spawn.label} at dt ${dt.toFixed(3)}: stopped ${r.off.toFixed(1)} m short after ${r.t.toFixed(0)} s (${r.replans} re-plans)`);
  }
});

test('a press on a booth walks to its front: 150 booths across the three levels, from their level entrance', () => {
  const { w, d } = level.booth; let walked = 0, replanned = 0;
  for (const b of level.booths.filter((_, i) => i % 11 === 0)) {
    const fronts = [{ x: b.x, y: b.y - d / 2 - 1.1 }, { x: b.x, y: b.y + d / 2 + 1.1 }, { x: b.x - w / 2 - 1.1, y: b.y }, { x: b.x + w / 2 + 1.1, y: b.y }].filter((p) => nav.walkable(p.x, p.y));
    const to = fronts[0] ?? nav.nearestWalkable(b.x, b.y, 10); if (!to) continue;
    const lift = level.lifts.find((l) => l.deck === b.deck), from = b.deck === 2 ? level.spawns.short : nav.nearestWalkable(lift!.x, lift!.y + 1.5)!;
    if (!nav.path(from, to)) continue; // not every cell of a big island stand has a way in
    for (const dt of [1 / 60, 0.05]) { const r = walk(from, to, dt); assert.ok(r.off < 0.6, `${b.id} at dt ${dt.toFixed(3)}: ${r.off.toFixed(1)} m short, ${r.replans} re-plans`); replanned += r.replans; }
    walked++;
  }
  assert.ok(walked > 100, `${walked} booths walked to`);
  console.log(`    ${walked} booths, ${replanned} re-plans needed`);
});

test('the stick always wins over a route, and letting go stops with a little weight, not a slide', () => {
  const m = newMover(); m.pos = { ...level.spawns.short }; follow(m, nav.path(m.pos, level.hero.dock)!);
  stepMover(m, nav, 1 / 60, { x: 1, y: 0 }); assert.equal(m.route.length, 0);
  for (let i = 0; i < 60; i++) stepMover(m, nav, 1 / 60, { x: 1, y: 0 });
  const at = m.pos.x; let t = 0; while (m.speed01 > 0 && t < 2) { stepMover(m, nav, 1 / 60, null); t += 1 / 60; }
  assert.ok(t < 0.8 && m.pos.x - at < 1.2, `stopped in ${t.toFixed(2)} s over ${(m.pos.x - at).toFixed(2)} m`);
});
