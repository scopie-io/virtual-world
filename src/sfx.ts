// Sound and touch feedback. Ten short sounds, made in the browser from sine and triangle waves on one five-note scale —
// no audio files to download, nothing to license, and everything is in tune with everything else. Quiet by design: this
// is played on an exhibition floor. The rules:
//   · nothing sounds until the player has touched the page (browsers insist, and so do we)
//   · one switch in the menu turns sound and vibration off, and the choice is remembered
//   · a phone on silent stays silent (Web Audio follows the ringer switch on iOS)
//   · a sound marks something that happened — never decoration, never a loop, never music
import { signal } from '@preact/signals';

export type Sfx = 'tap' | 'go' | 'stamp' | 'big' | 'warn' | 'jump' | 'sit' | 'shutter' | 'liftUp' | 'liftDown';

const KEY = 'mx_sound';
const stored = (): boolean => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export const soundOn = signal(stored());
export function setSound(on: boolean) { soundOn.value = on; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode: the choice lasts for this visit */ } if (on) { unlock(); sfx('tap'); } }

// C major pentatonic, fifth and sixth octave
const C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5;
interface Note { f: number; to?: number; at?: number; d: number; g: number; type?: OscillatorType }
const BANK: Record<Exclude<Sfx, 'shutter'>, Note[]> = {
  tap: [{ f: 1320, d: 0.035, g: 0.045, type: 'triangle' }],
  go: [{ f: G5, d: 0.07, g: 0.05 }],
  stamp: [{ f: E5, d: 0.22, g: 0.13, type: 'triangle' }, { f: A5, at: 0.085, d: 0.34, g: 0.13, type: 'triangle' }],
  big: [C5, E5, G5, C6].map((f, i) => ({ f, at: i * 0.095, d: i === 3 ? 0.7 : 0.3, g: 0.12, type: 'triangle' as const })),
  warn: [{ f: 330, d: 0.13, g: 0.09, type: 'triangle' }, { f: 262, at: 0.12, d: 0.2, g: 0.09, type: 'triangle' }],
  jump: [{ f: 330, to: 620, d: 0.14, g: 0.06 }],
  sit: [{ f: 196, to: 150, d: 0.12, g: 0.1 }],
  liftUp: [{ f: G5 / 2, to: G5, d: 0.55, g: 0.06 }, { f: D5, at: 0.5, d: 0.3, g: 0.07, type: 'triangle' }],
  liftDown: [{ f: G5, to: G5 / 2, d: 0.55, g: 0.06 }, { f: C5, at: 0.5, d: 0.3, g: 0.07, type: 'triangle' }],
};

let ctx: AudioContext | null = null, master: GainNode | null = null, lastAt = new Map<Sfx, number>();

/** Called from the first touch or key press: from then on sounds may play. Safe to call again. */
export function unlock() {
  if (typeof window === 'undefined' || !soundOn.value) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; if (!AC) return;
    if (!ctx) { ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination); }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { ctx = null; } // no audio on this device: the game is complete without it
}

export function sfx(name: Sfx) {
  if (!soundOn.value || !ctx || !master || ctx.state !== 'running') return;
  const wall = performance.now(); if (wall - (lastAt.get(name) ?? 0) < 60) return; lastAt.set(name, wall); // two causes, one moment: one sound
  try {
    const t0 = ctx.currentTime + 0.005;
    if (name === 'shutter') return shutter(ctx, master, t0);
    for (const n of BANK[name]) {
      const at = t0 + (n.at ?? 0), osc = ctx.createOscillator(), env = ctx.createGain();
      osc.type = n.type ?? 'sine'; osc.frequency.setValueAtTime(n.f, at); if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, at + n.d * 0.9);
      env.gain.setValueAtTime(0.0001, at); env.gain.exponentialRampToValueAtTime(n.g, at + 0.008); env.gain.exponentialRampToValueAtTime(0.0001, at + n.d);
      osc.connect(env).connect(master); osc.start(at); osc.stop(at + n.d + 0.02);
    }
  } catch { /* a sound that fails is not worth a word */ }
}

/** The camera: two short clicks of filtered noise. */
function shutter(c: AudioContext, out: GainNode, t0: number) {
  const len = Math.floor(c.sampleRate * 0.03), buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  for (const at of [0, 0.075]) {
    const src = c.createBufferSource(), band = c.createBiquadFilter(), env = c.createGain();
    src.buffer = buf; band.type = 'bandpass'; band.frequency.value = 3200; band.Q.value = 0.8; env.gain.value = 0.16;
    src.connect(band).connect(env).connect(out); src.start(t0 + at);
  }
}

/** A short buzz on phones that can (Android). Same switch as sound. */
export function buzz(pattern: number | number[]) {
  if (!soundOn.value || typeof navigator === 'undefined' || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch { /* not allowed here */ }
}

/** Wire the page: unlock on the first touch, tick on every control, rest while the tab is away. */
export function installSfx() {
  const first = () => unlock();
  window.addEventListener('pointerdown', first, { capture: true, passive: true }); window.addEventListener('keydown', first, { capture: true });
  document.addEventListener('click', (e) => { const t = e.target instanceof Element ? e.target.closest('button,a.btn,a.chip,.menu a') : null; if (t && !(t as HTMLButtonElement).disabled) sfx('tap'); }, { capture: true });
  document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) void ctx.suspend(); else if (soundOn.value) void ctx.resume(); });
}
