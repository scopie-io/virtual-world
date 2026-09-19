// One-thumb controls: a floating joystick in the lower-left, tap-to-walk anywhere, drag to look around, pinch / wheel to zoom.
// Desktop: WASD / arrows, click to walk, drag to look around, wheel to zoom. A mouse that is only pointing is reported
// too (onHover), and the cursor says what a press would do: grab the view, or pick the thing under it.
//
// A touch in the joystick zone is not a joystick until the thumb actually moves: lifted in place, it is a tap like any
// other — so "tap where you want to go" works on the whole screen, including under the thumb.

export interface InputSink {
  onTap(x: number, y: number): void; onOrbit(dYaw: number, dPitch: number): void; onZoom(factor: number): void;
  /** a mouse resting or moving over the world without a button down; null when it leaves */
  onHover?(at: { x: number; y: number } | null): void;
  /** false while a sheet is open: the world does not listen to the keyboard then */
  enabled(): boolean;
}

const STICK_R = 52, STICK_DEAD = 9, TAP_SLOP = 9, TAP_MS = 450;
const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);

export class Input {
  /** Desired move in screen space: x right, y up, length ≤ 1. */
  readonly move = { x: 0, y: 0 };
  private keys = new Set<string>();
  private stick: { id: number; x: number; y: number; t: number; live: boolean } | null = null;
  private drags = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; moved: boolean }>();
  private pinch = 0;
  private cursor = 'grab'; private grabbing = false;
  private base: HTMLDivElement; private knob: HTMLDivElement;
  private off: (() => void)[] = [];

  constructor(private el: HTMLElement, private sink: InputSink) {
    this.base = Object.assign(document.createElement('div'), { className: 'stick' });
    this.knob = Object.assign(document.createElement('div'), { className: 'stick-knob' });
    this.base.appendChild(this.knob); document.body.appendChild(this.base);

    const on = <K extends keyof HTMLElementEventMap>(t: EventTarget, k: K | string, f: (e: never) => void, o?: AddEventListenerOptions) => { t.addEventListener(k, f as EventListener, o); this.off.push(() => t.removeEventListener(k, f as EventListener, o)); };
    on(el, 'pointerdown', (e: PointerEvent) => this.down(e));
    on(el, 'pointermove', (e: PointerEvent) => this.moveEv(e));
    on(el, 'pointerup', (e: PointerEvent) => this.up(e));
    on(el, 'pointercancel', (e: PointerEvent) => this.up(e, true));
    on(el, 'pointerleave', (e: PointerEvent) => { if (e.pointerType === 'mouse') sink.onHover?.(null); });
    on(el, 'wheel', (e: WheelEvent) => { e.preventDefault(); sink.onZoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    on(el, 'contextmenu', (e: Event) => e.preventDefault());
    on(window, 'keydown', (e: KeyboardEvent) => { if (typing(e.target) || !sink.enabled()) return; this.keys.add(e.code); this.fromKeys(); });
    on(window, 'keyup', (e: KeyboardEvent) => { this.keys.delete(e.code); this.fromKeys(); });
    on(window, 'blur', () => this.release());
    on(document, 'visibilitychange', () => { if (document.hidden) this.release(); });
  }

  /** What the mouse cursor looks like over the world when nothing is being dragged: 'grab', or 'pointer' over something that can be picked. */
  setCursor(c: 'grab' | 'pointer') { this.cursor = c; this.paintCursor(); }
  private paintCursor() { const c = this.grabbing ? 'grabbing' : this.cursor; if (this.el.style.cursor !== c) this.el.style.cursor = c; }

  /** Let go of everything: a sheet opened, the tab went away. Nobody keeps walking because a key-up was never heard. */
  release() {
    this.keys.clear(); this.drags.clear(); this.pinch = 0; this.grabbing = false; this.paintCursor();
    if (this.stick) { this.stick = null; this.base.style.display = 'none'; }
    this.move.x = this.move.y = 0;
  }

  private fromKeys() {
    if (this.stick?.live) return;
    const k = this.keys, x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0), y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const l = Math.hypot(x, y) || 1; this.move.x = x / l; this.move.y = y / l;
  }

  private down(e: PointerEvent) {
    try { this.el.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone (a very fast tap): nothing to hold on to */ }
    const r = this.el.getBoundingClientRect(), inStickZone = e.pointerType === 'touch' && e.clientX - r.left < r.width * 0.5 && e.clientY - r.top > r.height * 0.45;
    if (inStickZone && !this.stick && this.drags.size === 0) { this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), live: false }; return; }
    this.drags.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false });
    if (this.drags.size === 2) { this.pinch = this.pinchDist(); for (const d of this.drags.values()) d.moved = true; } // a pinch is never a tap, whichever finger lifts last
  }

  private pinchDist() { const [a, b] = [...this.drags.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; }

  private moveEv(e: PointerEvent) {
    const s = this.stick;
    if (s?.id === e.pointerId) {
      let dx = e.clientX - s.x, dy = e.clientY - s.y, l = Math.hypot(dx, dy);
      if (!s.live) { if (l < TAP_SLOP) return; s.live = true; this.base.style.cssText = `display:block;left:${s.x}px;top:${s.y}px`; }
      if (l > STICK_R) { // the base follows a thumb that wanders, so the stick never runs out of travel
        s.x += (dx / l) * (l - STICK_R); s.y += (dy / l) * (l - STICK_R); this.base.style.left = s.x + 'px'; this.base.style.top = s.y + 'px';
        dx = e.clientX - s.x; dy = e.clientY - s.y; l = STICK_R;
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const mag = l <= STICK_DEAD ? 0 : (l - STICK_DEAD) / (STICK_R - STICK_DEAD); // ramps from the edge of the dead zone: no jump from still to a jog
      this.move.x = l ? (dx / l) * mag : 0; this.move.y = l ? (-dy / l) * mag : 0;
      return;
    }
    const d = this.drags.get(e.pointerId); if (!d) { if (e.pointerType === 'mouse' && !e.buttons) this.sink.onHover?.({ x: e.clientX, y: e.clientY }); return; }
    const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY;
    if (Math.hypot(d.x - d.sx, d.y - d.sy) > TAP_SLOP) { d.moved = true; if (e.pointerType === 'mouse' && !this.grabbing) { this.grabbing = true; this.paintCursor(); this.sink.onHover?.(null); } }
    if (this.drags.size === 2) { const p = this.pinchDist(); if (this.pinch && p) this.sink.onZoom(this.pinch / p); this.pinch = p; }
    else if (d.moved) this.sink.onOrbit(-dx * 0.006, dy * 0.004);
  }

  private up(e: PointerEvent, cancelled = false) {
    const s = this.stick;
    if (s?.id === e.pointerId) {
      this.stick = null; this.base.style.display = 'none'; this.move.x = this.move.y = 0; this.fromKeys();
      if (!s.live && !cancelled && performance.now() - s.t < TAP_MS) this.sink.onTap(e.clientX, e.clientY); // never became a joystick: it was a tap
      return;
    }
    const d = this.drags.get(e.pointerId); this.drags.delete(e.pointerId); this.pinch = 0;
    if (this.grabbing && this.drags.size === 0) { this.grabbing = false; this.paintCursor(); if (!cancelled) this.sink.onHover?.({ x: e.clientX, y: e.clientY }); }
    if (d && !cancelled && !d.moved && performance.now() - d.t < TAP_MS && this.drags.size === 0) this.sink.onTap(e.clientX, e.clientY);
  }

  dispose() { this.off.forEach((f) => f()); this.base.remove(); }
}
