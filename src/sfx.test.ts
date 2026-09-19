// Sound must never be a surprise: silent until the player touches the page, silent when switched off, and one sound per moment.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let started = 0;
const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
class FakeAudio {
  state = 'running'; currentTime = 0; sampleRate = 8000; destination = {};
  createGain() { return { gain: param(), connect: (x: unknown) => x }; }
  createOscillator() { return { type: 'sine', frequency: param(), connect: (x: unknown) => x, start: () => { started++; }, stop() {} }; }
  createBiquadFilter() { return { type: '', frequency: param(), Q: param(), connect: (x: unknown) => x }; }
  createBuffer(_c: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { return { buffer: null, connect: (x: unknown) => x, start: () => { started++; } }; }
  resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); }
}
const store = new Map<string, string>();
Object.assign(globalThis, { window: { AudioContext: FakeAudio }, localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });

const { sfx, unlock, setSound, soundOn } = await import('./sfx');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('nothing sounds before the first touch; after it, a stamp is two notes and the same moment never sounds twice', async () => {
  sfx('stamp'); assert.equal(started, 0, 'silent until unlocked');
  unlock(); sfx('stamp'); assert.equal(started, 2);
  sfx('stamp'); assert.equal(started, 2, 'two causes within a blink: one sound');
  await wait(80); sfx('shutter'); assert.equal(started, 4, 'the shutter is two clicks');
});

test('the switch in the menu silences everything and is remembered', async () => {
  await wait(80); setSound(false); const before = started;
  sfx('big'); sfx('tap'); assert.equal(started, before); assert.equal(store.get('mx_sound'), 'off'); assert.equal(soundOn.value, false);
  await wait(80); setSound(true); assert.ok(started > before, 'turning it back on answers with a tick'); assert.equal(store.get('mx_sound'), 'on');
});
