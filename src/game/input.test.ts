// Input rules that were bugs once: a tap under the thumb must still be a tap; typing must never walk the astronaut.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// the smallest DOM the Input class touches
class FakeEl { h = new Map<string, (e: unknown) => void>(); style: Record<string, string> = {}; addEventListener(k: string, f: (e: unknown) => void) { this.h.set(k, f); } removeEventListener() {} appendChild() {} remove() {} setPointerCapture() {} getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 800 }; } fire(k: string, e: object) { this.h.get(k)?.(e); } }
class HTMLElement {} class HTMLInputElement extends HTMLElement {} class HTMLTextAreaElement extends HTMLElement {} class HTMLSelectElement extends HTMLElement {}
const win = new FakeEl(), doc = Object.assign(new FakeEl(), { createElement: () => new FakeEl(), body: new FakeEl(), hidden: false });
Object.assign(globalThis, { window: win, document: doc, HTMLElement, HTMLInputElement, HTMLTextAreaElement, HTMLSelectElement });

const { Input } = await import('./input');

function rig(enabled = true) {
  const el = new FakeEl(), log: string[] = [];
  const input = new Input(el as never, { onTap: (x, y) => log.push(`tap ${x},${y}`), onOrbit: () => log.push('orbit'), onZoom: () => log.push('zoom'), enabled: () => enabled });
  const p = (k: string, x: number, y: number, id = 1) => el.fire(k, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y });
  return { el, input, log, p };
}

test('a tap in the joystick zone (lower-left of a phone) walks there; a drag there is the joystick', () => {
  const a = rig();
  a.p('pointerdown', 80, 700); a.p('pointerup', 82, 701);
  assert.deepEqual(a.log, ['tap 82,701']);
  assert.deepEqual([a.input.move.x, a.input.move.y], [0, 0]);

  const b = rig();
  b.p('pointerdown', 80, 700); b.p('pointermove', 80, 650); // thumb pushes up
  assert.ok(b.input.move.y > 0.7 && Math.abs(b.input.move.x) < 0.01, JSON.stringify(b.input.move));
  b.p('pointermove', 80, 500); assert.ok(b.input.move.y <= 1.0001, 'never more than full tilt, however far the thumb goes');
  b.p('pointerup', 80, 500);
  assert.deepEqual(b.log, [], 'a joystick push is not a tap'); assert.equal(b.input.move.y, 0);
});

test('outside the zone: tap walks, drag looks around, two fingers zoom', () => {
  const a = rig();
  a.p('pointerdown', 300, 200); a.p('pointerup', 300, 200);
  a.p('pointerdown', 300, 200); a.p('pointermove', 340, 200); a.p('pointerup', 340, 200);
  a.p('pointerdown', 250, 200, 1); a.p('pointerdown', 350, 200, 2); a.p('pointermove', 380, 200, 2); a.p('pointerup', 380, 200, 2); a.p('pointerup', 250, 200, 1);
  assert.deepEqual(a.log, ['tap 300,200', 'orbit', 'zoom']);
});

test('the keyboard moves the astronaut only when the world is listening', () => {
  const a = rig();
  win.fire('keydown', { code: 'KeyW', target: new HTMLElement() }); assert.equal(a.input.move.y, 1);
  a.input.release(); assert.equal(a.input.move.y, 0, 'a sheet opened: held keys are forgotten');
  win.fire('keydown', { code: 'KeyW', target: new HTMLTextAreaElement() }); assert.equal(a.input.move.y, 0, 'typing a note');
  win.fire('keydown', { code: 'KeyD', target: new HTMLInputElement() }); assert.equal(a.input.move.x, 0, 'typing in a field');

  const b = rig(false);
  win.fire('keydown', { code: 'KeyW', target: new HTMLElement() }); assert.equal(b.input.move.y, 0, 'a sheet is open');
});
