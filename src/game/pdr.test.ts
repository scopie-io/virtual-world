import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadingFilter, StepDetector, calibrateStepLength, quantiseHeading } from './pdr';

/** Synthetic walk: gravity + a bump per step + sensor noise, sampled at `hz`. */
function walk(det: StepDetector, seconds: number, stepsPerSec: number, amp: number, hz = 60, t0 = 0): number {
  let steps = 0, seed = 7;
  const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed / 2147483648 - 0.5) * 0.5; };
  for (let i = 0; i < seconds * hz; i++) {
    const t = i / hz, bump = stepsPerSec ? amp * Math.max(0, Math.sin(2 * Math.PI * stepsPerSec * t)) ** 3 : 0;
    // phone tilted in a hand: gravity split across y and z
    if (det.push(t0 + t * 1000, noise(), 9.81 * 0.5 + noise(), 9.81 * 0.866 + bump + noise())) steps++;
  }
  return steps;
}

test('step detector counts a normal walk within ±10 %, at phone-typical sample rates', () => {
  for (const hz of [30, 60, 100]) {
    const n = walk(new StepDetector(), 30, 1.8, 3.2, hz); // 54 real steps
    assert.ok(Math.abs(n - 54) <= 5, `${hz} Hz: counted ${n}`);
  }
});

test('step detector ignores a phone that is held still or just fidgeted with', () => {
  assert.equal(walk(new StepDetector(), 20, 0, 0), 0);
  assert.ok(walk(new StepDetector(), 20, 1.8, 0.5) <= 1, 'tiny wobbles are not steps');
});

test('a slow shuffle and a brisk walk are both followed', () => {
  assert.ok(Math.abs(walk(new StepDetector(), 30, 1.2, 2.4) - 36) <= 4);
  assert.ok(Math.abs(walk(new StepDetector(), 30, 2.3, 4.0) - 69) <= 7);
});

test('headings snap to the four aisle directions around the building axis', () => {
  assert.equal(quantiseHeading(0, 0), 0);
  assert.equal(quantiseHeading(44, 0), 0);
  assert.equal(quantiseHeading(46, 0), 1);
  assert.equal(quantiseHeading(359, 0), 0);
  assert.equal(quantiseHeading(200, 20), 2, 'the axis offset rotates the whole grid');
  assert.equal(quantiseHeading(10, 100), 3);
});

test('compass smoothing survives the 359° → 0° wrap and single wild readings', () => {
  const f = new HeadingFilter();
  for (const d of [358, 2, 359, 1, 140, 0, 357, 3, 1, 359, 2, 0]) f.push(d); // one steel-beam spike
  const h = f.deg!;
  assert.ok(h > 345 || h < 25, `settled at ${h.toFixed(1)}`);
});

test('step length is calibrated from two scans, within human limits, and only with enough evidence', () => {
  assert.equal(calibrateStepLength(42, 60, 0.7), 0.7);
  assert.equal(calibrateStepLength(8, 12, 0.7), 0.7, 'too little walking: keep the old value');
  assert.equal(calibrateStepLength(100, 60, 0.7), 0.95, 'clamped — more likely a missed-step problem than a giant');
  assert.equal(calibrateStepLength(20, 60, 0.7), 0.45);
});
