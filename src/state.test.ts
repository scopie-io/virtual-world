// Notifications: one at a time, in order, problems first, one action = one message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { showEvents, toast, toasts } from './state';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shown = () => toasts.value.map((t) => t.title);

test('toasts queue instead of piling up; a warning jumps the queue; repeats are dropped', async () => {
  toast('Hall 7 · Level 2', '150 booths', 'info', 60); toast('MIHAS Kitchen', 'Live cooking', 'info', 60); toast('MIHAS Kitchen', 'Live cooking', 'info', 60);
  assert.deepEqual(shown(), ['Hall 7 · Level 2'], 'only one on screen');
  await sleep(90); assert.deepEqual(shown(), ['MIHAS Kitchen']);
  toast('Walk up to the booth first', undefined, 'warn', 60);
  assert.deepEqual(shown(), ['Walk up to the booth first'], 'something went wrong: said immediately');
  await sleep(160); assert.deepEqual(shown(), [], 'and the screen is clear again');
});

test('one action that pays three ways is one message with one total', async () => {
  showEvents([{ action: 'scan', xp: 50, target: 'UOB' }, { action: 'verified_contact', xp: 0, target: 'UOB' }, { action: 'daily_drop', xp: 150, target: 'Say hello at the counter' }]);
  assert.equal(toasts.value.length, 1);
  assert.equal(toasts.value[0]!.title, '+200 points');
  assert.equal(toasts.value[0]!.sub, 'Scanned at the real booth · Met in person · Booth of the day · UOB');
});
