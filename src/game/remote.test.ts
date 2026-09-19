// Other players must glide, not lurch: constant speed between updates, no sliding across the map, no spinning on the spot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteTrack } from './remote';

test('between two updates a remote player moves at constant speed and faces where they walk', () => {
  const r = new RemoteTrack({ t: 0, x: 0, y: 0, h: 0 });
  r.push({ t: 2000, x: 10, y: 0, h: 0 }); // 10 m east, heard about two seconds later
  const xs: number[] = [];
  for (let now = 2000; now <= 4000; now += 250) { r.step(now, 0.25); xs.push(+r.x.toFixed(3)); }
  const steps = xs.slice(1).map((x, i) => +(x - xs[i]!).toFixed(3));
  assert.ok(steps.every((s) => Math.abs(s - steps[0]!) < 1e-6), `equal steps, no ease-in / ease-out: ${steps.join(' ')}`);
  assert.equal(xs.at(-1), 10);
  assert.ok(Math.abs(r.speed) < 1e-9, 'arrived: standing');
  r.push({ t: 4000, x: 10, y: 8, h: 0 }); r.step(4500, 0.5); r.step(5000, 0.5);
  assert.ok(Math.abs(r.speed - 4) < 0.01, `walking north at 4 m/s, got ${r.speed}`);
  assert.ok(Math.abs(Math.abs(r.h) - Math.PI) < 0.2, 'turned to face north (rotation.y = ±π)');
});

test('a new update starts from where the figure is drawn, so late or early updates never make it jump', () => {
  const r = new RemoteTrack({ t: 0, x: 0, y: 0, h: 0 });
  r.push({ t: 2000, x: 8, y: 0, h: 0 }); r.step(3000, 0.016); // half way: x = 4
  const before = r.x; r.push({ t: 3000, x: 8, y: 6, h: 0 }); r.step(3000, 0.016);
  assert.ok(Math.abs(r.x - before) < 1e-6 && Math.abs(r.y) < 1e-6, 'no jump at the moment the update lands');
});

test('a lift ride or a fresh arrival is placed, not dragged across the hall', () => {
  const r = new RemoteTrack({ t: 0, x: 0, y: 0, h: 0 });
  r.push({ t: 2000, x: 0, y: 190, h: 1 }); r.step(2016, 0.016);
  assert.deepEqual([r.x, r.y], [0, 190]); assert.equal(r.speed, 0);
});
