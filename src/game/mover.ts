// How the player's astronaut moves: by the stick, or along a route (a tap, "take me there", walking to a seat).
// Pure — no rendering, no browser — so that "does every walk actually arrive?" is a test on the real floor plan.
//
// Velocity eases toward what is asked, which gives starts and stops a little weight. The price of easing is that a
// figure following a route swings wide at corners and can end up pressed against a wall with its next waypoint on the
// other side. So a route is watched: no real progress for half a second means plan again from where we actually are.
// Three failed plans and the route is dropped — standing still is better than walking into a wall for ever.

import type { NavGrid, P2 } from './nav';

export const RUN_SPEED = 6.5;   // m/s — brisk on purpose: halls are long
const ACCEL = 9;                // how quickly the astronaut reaches that speed, and stops: a little weight
const ROUTE_ACCEL = 14;         // on a route, turn in tighter: less swing at corners
const ARRIVE_M = 0.35, STALL_S = 0.5, MAX_REPLANS = 3;

export interface Mover { pos: P2; vel: P2; route: P2[]; heading: number; speed01: number; stall: number; replans: number }
export const newMover = (): Mover => ({ pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, route: [], heading: 0, speed01: 0, stall: 0, replans: 0 });

/** Give the mover a path to follow (as returned by NavGrid.path: the first point is where it stands). */
export function follow(m: Mover, path: P2[]) { m.route = path.slice(1); m.stall = 0; m.replans = 0; }

/** One frame. `stick` is the direction asked for in plan space (length ≤ 1), or null. Returns the metres moved. */
export function stepMover(m: Mover, nav: NavGrid, dt: number, stick: P2 | null): number {
  let dx = 0, dy = 0;
  if (stick) { m.route = []; dx = stick.x; dy = stick.y; }
  else if (m.route.length) {
    const n = m.route[0]!, ddx = n.x - m.pos.x, ddy = n.y - m.pos.y, l = Math.hypot(ddx, ddy);
    if (l < ARRIVE_M) m.route.shift(); else { dx = ddx / l; dy = ddy / l; }
  }
  const v = m.vel, k = Math.min(1, dt * (m.route.length ? ROUTE_ACCEL : ACCEL));
  v.x += (dx * RUN_SPEED - v.x) * k; v.y += (dy * RUN_SPEED - v.y) * k;
  const sp = Math.hypot(v.x, v.y); let moved = 0;
  if (sp > 0.05) {
    const next = nav.move(m.pos, v.x * dt, v.y * dt); moved = Math.hypot(next.x - m.pos.x, next.y - m.pos.y);
    if (moved < sp * dt * 0.2) { v.x *= 0.5; v.y *= 0.5; } // walked into something
    m.pos = next; m.speed01 = Math.min(1, moved / Math.max(1e-4, dt) / RUN_SPEED);
    if (dx || dy) { const want = Math.atan2(dx, -dy); let d = want - m.heading; d = Math.atan2(Math.sin(d), Math.cos(d)); m.heading += d * Math.min(1, dt * 12); } // rotation.y that points the model (+z) along travel; world z = −plan y
  } else { v.x = v.y = 0; m.speed01 = 0; }

  if (m.route.length && (dx || dy)) {
    m.stall = moved < RUN_SPEED * dt * 0.25 ? m.stall + dt : 0;
    if (m.stall > STALL_S) {
      const goal = m.route[m.route.length - 1]!, path = ++m.replans <= MAX_REPLANS ? nav.path(m.pos, goal) : null;
      m.stall = 0; v.x = v.y = 0; m.route = path && path.length > 1 ? path.slice(1) : [];
    }
  } else m.stall = 0;
  return moved;
}
