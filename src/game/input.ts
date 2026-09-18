// One-thumb controls: a floating joystick in the lower-left, tap-to-move anywhere else, drag to orbit, pinch/wheel to zoom.
// Desktop: WASD / arrows, click to move, drag to orbit, wheel to zoom.

export interface InputSink { onTap(x: number, y: number): void; onOrbit(dYaw: number): void; onZoom(factor: number): void }

export class Input {
  /** Desired move in screen space: x right, y up, length ≤ 1. */
  readonly move = { x: 0, y: 0 };
  private keys = new Set<string>();
  private stick: { id: number; x: number; y: number } | null = null;
  private drags = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; moved: boolean }>();
  private pinch = 0;
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
    on(el, 'wheel', (e: WheelEvent) => { e.preventDefault(); sink.onZoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    on(el, 'contextmenu', (e: Event) => e.preventDefault());
    on(window, 'keydown', (e: KeyboardEvent) => { if (!(e.target instanceof HTMLInputElement)) { this.keys.add(e.code); this.fromKeys(); } });
    on(window, 'keyup', (e: KeyboardEvent) => { this.keys.delete(e.code); this.fromKeys(); });
    on(window, 'blur', () => { this.keys.clear(); this.fromKeys(); });
  }

  private fromKeys() {
    if (this.stick) return;
    const k = this.keys, x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0), y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const l = Math.hypot(x, y) || 1; this.move.x = x / l; this.move.y = y / l;
  }

  private down(e: PointerEvent) {
    this.el.setPointerCapture(e.pointerId);
    const r = this.el.getBoundingClientRect(), inStickZone = e.pointerType === 'touch' && e.clientX - r.left < r.width * 0.5 && e.clientY - r.top > r.height * 0.45;
    if (inStickZone && !this.stick) {
      this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.base.style.cssText = `display:block;left:${e.clientX}px;top:${e.clientY}px`; this.knob.style.transform = 'translate(-50%,-50%)';
      return;
    }
    this.drags.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false });
    if (this.drags.size === 2) this.pinch = this.pinchDist();
  }

  private pinchDist() { const [a, b] = [...this.drags.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; }

  private moveEv(e: PointerEvent) {
    if (this.stick?.id === e.pointerId) {
      const R = 52; let dx = e.clientX - this.stick.x, dy = e.clientY - this.stick.y; const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const dead = l < 8 ? 0 : 1; this.move.x = (dx / R) * dead; this.move.y = (-dy / R) * dead;
      return;
    }
    const d = this.drags.get(e.pointerId); if (!d) return;
    const dx = e.clientX - d.x; d.x = e.clientX; d.y = e.clientY;
    if (Math.hypot(d.x - d.sx, d.y - d.sy) > 8) d.moved = true;
    if (this.drags.size === 2) { const p = this.pinchDist(); if (this.pinch && p) this.sink.onZoom(this.pinch / p); this.pinch = p; }
    else if (d.moved) this.sink.onOrbit(-dx * 0.006);
  }

  private up(e: PointerEvent, cancelled = false) {
    if (this.stick?.id === e.pointerId) { this.stick = null; this.base.style.display = 'none'; this.move.x = this.move.y = 0; this.fromKeys(); return; }
    const d = this.drags.get(e.pointerId); this.drags.delete(e.pointerId); this.pinch = 0;
    if (d && !cancelled && !d.moved && performance.now() - d.t < 450 && this.drags.size === 0) this.sink.onTap(e.clientX, e.clientY);
  }

  dispose() { this.off.forEach((f) => f()); this.base.remove(); }
}
