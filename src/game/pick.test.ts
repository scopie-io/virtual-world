// Pointing at a booth must pick that booth: straight down, at an angle, and never through the one in front of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { LevelData } from '../../shared/types';
import { BoothPicker, type Ray } from './pick';

const level = JSON.parse(readFileSync('public/data/floor.json', 'utf8')) as LevelData;
const picker = new BoothPicker(level), H = level.booth.h;
/** A ray from an eye at `from` (plan x, y, height) through the point `to`. */
const ray = (from: [number, number, number], to: [number, number, number]): Ray => {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]], l = Math.hypot(d[0]!, d[1]!, d[2]!);
  return { ox: from[0], oy: from[1], oz: from[2], dx: d[0]! / l, dy: d[1]! / l, dz: d[2]! / l };
};

test('looking straight down at any booth picks it, on every level', () => {
  for (const b of level.booths) assert.equal(picker.pick(ray([b.x, b.y, 40], [b.x, b.y, 0]))?.id, b.id, b.id);
});

test('from the game camera angle, aiming at the middle of a roof picks that booth', () => {
  let n = 0;
  for (const b of level.booths.filter((_, i) => i % 7 === 0)) for (const yaw of [0, 1.3, 2.9, 4.4]) {
    const eye: [number, number, number] = [b.x + Math.sin(yaw) * 14, b.y - Math.cos(yaw) * 14, 22]; // ~57° down, like the default view
    assert.equal(picker.pick(ray(eye, [b.x, b.y, H]))?.id, b.id, `${b.id} from yaw ${yaw}`); n++;
  }
  assert.ok(n > 500);
});

test('a booth is never picked through the one in front of it, and open floor picks nothing', () => {
  // two neighbours in the same row: aim at the far one's wall, low down, from beyond the near one
  const row = level.booths.filter((b) => b.deck === 2), a = row.find((b) => row.some((c) => Math.abs(c.y - b.y) < 0.1 && Math.abs(c.x - b.x - level.booth.w) < 0.1))!;
  const next = row.find((c) => Math.abs(c.y - a.y) < 0.1 && Math.abs(c.x - a.x - level.booth.w) < 0.1)!;
  const hit = picker.pick(ray([a.x - 12, a.y, 6], [next.x, next.y, 0.2]));
  assert.equal(hit?.id, a.id, 'the near booth is in the way');
  const s = level.spawns.short; assert.equal(picker.pick(ray([s.x, s.y - 10, 20], [s.x, s.y, 0])), null, 'the entrance floor is not a booth');
  assert.equal(picker.pick({ ox: 0, oy: 0, oz: 20, dx: 1, dy: 0, dz: 0 }), null, 'a level ray hits nothing');
});
