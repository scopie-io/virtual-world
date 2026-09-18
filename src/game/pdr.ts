// Pedestrian dead reckoning for the browser (Systems doc §3.4): count steps from the accelerometer, take direction
// from the compass, and let the floor plan do the rest — MITEC's aisles are a grid, so headings snap to four directions
// and the nav grid refuses to walk through booths. Everything here is BETA and needs a field test in the halls.

/** Step detector: gravity-removed acceleration magnitude, low-passed, with an adaptive threshold and a refractory period. */
export class StepDetector {
  private g = 9.81; private s = 0; private last = 0; private lastStep = -1e9; private peakAvg = 2.2; private peak = 0; private armed = false;

  /** Feed one accelerometer sample (m/s², gravity included, as `accelerationIncludingGravity` gives it). Returns true on a step. */
  push(tMs: number, ax: number, ay: number, az: number): boolean {
    const dt = this.last ? Math.min(0.1, (tMs - this.last) / 1000) : 1 / 60; this.last = tMs;
    const mag = Math.hypot(ax, ay, az);
    this.g += (mag - this.g) * (1 - Math.exp(-dt / 1.0));             // slow: tracks gravity
    this.s += (mag - this.g - this.s) * (1 - Math.exp(-dt / 0.06));   // fast: ~3 Hz, walking band
    const th = Math.max(0.8, this.peakAvg * 0.45);
    if (!this.armed) { if (this.s > th) { this.armed = true; this.peak = this.s; } return false; }
    this.peak = Math.max(this.peak, this.s);
    if (this.s > th * 0.35) return false;                              // still inside the bump
    this.armed = false;
    const since = tMs - this.lastStep;
    if (since < 300) return false;                                     // nobody walks at 3+ steps a second
    this.peakAvg += (Math.min(this.peak, 8) - this.peakAvg) * 0.2;
    this.lastStep = tMs;
    return true;
  }
}

export type Dir = 0 | 1 | 2 | 3; // plan +y (north on the drawing), +x, −y, −x
export const DIR_VEC: Record<Dir, { x: number; y: number }> = { 0: { x: 0, y: 1 }, 1: { x: 1, y: 0 }, 2: { x: 0, y: -1 }, 3: { x: -1, y: 0 } };

/**
 * Snap a compass heading to an aisle direction. `axisBearingDeg` is the compass bearing of the drawing's +y axis —
 * one constant for the whole building, measured on site (or set with the in-game calibration).
 */
export function quantiseHeading(headingDeg: number, axisBearingDeg: number): Dir {
  const rel = (((headingDeg - axisBearingDeg) % 360) + 360) % 360;
  return (Math.round(rel / 90) % 4) as Dir;
}

/** Smooths the compass on the unit circle; indoor magnetometers jump around near steel. */
export class HeadingFilter {
  private x = 0; private y = 0; private has = false;
  push(deg: number) { const r = (deg * Math.PI) / 180, k = this.has ? 0.15 : 1; this.x += (Math.cos(r) - this.x) * k; this.y += (Math.sin(r) - this.y) * k; this.has = true; }
  get deg(): number | null { return this.has ? ((Math.atan2(this.y, this.x) * 180) / Math.PI + 360) % 360 : null; }
}

/** Personal step length from two scans: the map knows how far apart they are. */
export function calibrateStepLength(pathMetres: number, steps: number, previous: number): number {
  if (steps < 20 || pathMetres < 10) return previous;
  return Math.min(0.95, Math.max(0.45, pathMetres / steps));
}

type PermissionCtor = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Browser glue. Works only while the page is visible — a web page cannot track in the background, by design. */
export class StepTracker {
  private det = new StepDetector(); private head = new HeadingFilter(); private off: (() => void)[] = [];
  constructor(private onStep: (headingDeg: number | null) => void) {}

  /** Must be called from a tap: iOS only grants motion access on a user gesture. */
  async start(): Promise<'ok' | 'denied' | 'unsupported'> {
    if (typeof DeviceMotionEvent === 'undefined') return 'unsupported';
    try {
      for (const C of [DeviceMotionEvent, DeviceOrientationEvent] as unknown as PermissionCtor[]) if (C?.requestPermission && (await C.requestPermission()) !== 'granted') return 'denied';
    } catch { return 'denied'; }
    const motion = (e: DeviceMotionEvent) => { const a = e.accelerationIncludingGravity; if (a?.x != null && a.y != null && a.z != null && this.det.push(e.timeStamp, a.x, a.y, a.z)) this.onStep(this.head.deg); };
    const orient = (e: DeviceOrientationEvent) => {
      const ios = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
      if (typeof ios === 'number') this.head.push(ios); else if (e.absolute && e.alpha != null) this.head.push(360 - e.alpha);
    };
    addEventListener('devicemotion', motion); addEventListener('deviceorientationabsolute', orient as EventListener); addEventListener('deviceorientation', orient);
    this.off = [() => removeEventListener('devicemotion', motion), () => removeEventListener('deviceorientationabsolute', orient as EventListener), () => removeEventListener('deviceorientation', orient)];
    return 'ok';
  }
  stop() { this.off.forEach((f) => f()); this.off = []; }
  get heading(): number | null { return this.head.deg; }
}
