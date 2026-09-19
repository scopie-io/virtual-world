// Tap anywhere, from anywhere: four hundred random walks across the three levels, with frame times that jump about the
// way a busy phone's do. Every one must arrive, in about the time the distance deserves — no circling a waypoint, no
// leaning on a wall. Seeded, so a failure can be replayed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { LevelData } from '../../shared/types';
import { NavGrid, pathLength, type P2 } from './nav';
import { newMover, stepMover, RUN_SPEED } from './mover';

const level = JSON.parse(readFileSync('public/data/floor.json', 'utf8')) as LevelData, nav = new NavGrid(level);
let seed = 20260919; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function spot(deck: LevelData['decks'][number]): P2 {
  for (;;) { const p = { x: deck.x0 + rnd() * (deck.x1 - deck.x0), y: deck.y0 + rnd() * (deck.y1 - deck.y0) }; if (nav.walkable(p.x, p.y)) return p; }
}

test('400 random walks with irregular frame times all arrive, and none dawdles', () => {
  const late: string[] = []; let n = 0, replans = 0, worst = 0;
  while (n < 400) {
    const deck = level.decks[n % level.decks.length]!, from = spot(deck), to = spot(deck), path = nav.path(from, to); if (!path || path.length < 2) continue;
    n++;
    const m = newMover(); m.pos = { ...from }; m.route = path.slice(1);
    const goal = path[path.length - 1]!, fair = pathLength(path) / RUN_SPEED, budget = fair * 1.35 + 3; let t = 0;
    while (m.route.length && t < budget) { const dt = rnd() < 0.15 ? 0.05 : 0.008 + rnd() * 0.03; stepMover(m, nav, dt, null); t += dt; }
    const off = Math.hypot(m.pos.x - goal.x, m.pos.y - goal.y); replans += m.replans; worst = Math.max(worst, t - fair);
    if (off > 0.6) late.push(`#${n} L${deck.level} (${from.x.toFixed(1)},${from.y.toFixed(1)}) → (${to.x.toFixed(1)},${to.y.toFixed(1)}): ${off.toFixed(1)} m short after ${t.toFixed(1)} s, fair ${fair.toFixed(1)} s, ${m.replans} re-plans`);
  }
  console.log(`    ${n} walks, ${replans} re-plans, slowest arrival ${worst.toFixed(1)} s over a straight run`);
  assert.deepEqual(late, []);
});
