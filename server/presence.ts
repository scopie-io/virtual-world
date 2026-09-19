import type { Hologram } from '../shared/types.js';
import { DECK_MAX_SPEED_MPS, MAX_SPEED_MPS } from '../shared/rules.js';
import type { Db } from './db/types.js';

export const FRESH_MS = 15_000;
type Dot = { x: number; y: number; cls: Hologram['cls']; deck: boolean };

/** Who is where, right now. Two implementations: memory (one Node process) and database (serverless). */
export interface Presence {
  /** Returns the metres accepted, or null when the move is implausibly fast (the previous position is kept). */
  update(p: Hologram, now: number, isSpawn: boolean): Promise<number | null>;
  /** An on-site scan places the player with authority: no speed check, tight uncertainty. */
  anchor(p: Hologram, now: number): Promise<void>;
  position(id: string, now: number): Promise<{ x: number; y: number } | null>;
  /** Others never get a real person's exact spot: deck positions are snapped to a 1.5 m lattice. Hidden players are omitted. */
  near(id: string, x: number, y: number, now: number, hidden: ReadonlySet<string>, radius?: number, limit?: number): Promise<Hologram[]>;
  /** Every fresh position, for the booth's big screen: crew colour and whether the person is really there — nothing else. */
  all(now: number, hidden: ReadonlySet<string>): Promise<Dot[]>;
  online(now: number): Promise<number>;
}

/** On deck the avatar follows a walking person, so the ceiling is walking pace, not joystick pace.
 *  Switching between free roam and deck is a legitimate jump; only sustained deck movement is held to walking pace. */
function tooFast(prev: { x: number; y: number; deck: boolean; t: number }, p: Hologram, now: number): { moved: number; refuse: boolean } {
  const dt = Math.max(0.25, (now - prev.t) / 1000), moved = Math.hypot(p.x - prev.x, p.y - prev.y);
  return { moved, refuse: moved / dt > (p.deck && prev.deck ? DECK_MAX_SPEED_MPS : MAX_SPEED_MPS) };
}
function publicView(e: Hologram, d: number): Hologram & { d: number } {
  const q = e.deck ? 1.5 : 0;
  return { id: e.id.slice(0, 8), callsign: e.callsign, cls: e.cls, x: q ? Math.round(e.x / q) * q : e.x, y: q ? Math.round(e.y / q) * q : e.y, h: e.h, av: e.av, deck: e.deck, sigma: e.sigma, d };
}
const nearest = (list: (Hologram & { d: number })[], limit: number) => list.sort((a, b) => a.d - b.d).slice(0, limit).map(({ d: _d, ...h }) => h);

/** In-memory: correct and fast for a single Node process (local dev, a VM). */
export class PresenceStore implements Presence {
  private map = new Map<string, Hologram & { t: number }>();

  async update(p: Hologram, now: number, isSpawn: boolean) {
    const prev = this.map.get(p.id);
    let moved = 0;
    if (prev && !isSpawn && now - prev.t < 30_000) {
      const r = tooFast(prev, p, now); moved = r.moved;
      if (r.refuse) { prev.t = now; return null; }
    }
    this.map.set(p.id, { ...p, t: now });
    return moved;
  }
  async anchor(p: Hologram, now: number) { this.map.set(p.id, { ...p, deck: true, sigma: 1, t: now }); }
  async position(id: string, now: number) { const e = this.map.get(id); return e && now - e.t <= FRESH_MS ? { x: e.x, y: e.y } : null; }
  async near(id: string, x: number, y: number, now: number, hidden: ReadonlySet<string>, radius = 90, limit = 60) {
    const out: (Hologram & { d: number })[] = [];
    for (const [k, e] of this.map) {
      if (now - e.t > FRESH_MS) { this.map.delete(k); continue; }
      if (k === id || hidden.has(k)) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d <= radius) out.push(publicView(e, d));
    }
    return nearest(out, limit);
  }
  async all(now: number, hidden: ReadonlySet<string>) {
    const out: Dot[] = [];
    for (const [k, e] of this.map) if (now - e.t <= FRESH_MS && !hidden.has(k)) out.push({ x: +e.x.toFixed(1), y: +e.y.toFixed(1), cls: e.cls, deck: e.deck });
    return out;
  }
  async online(now: number) { let n = 0; for (const e of this.map.values()) if (now - e.t <= FRESH_MS) n++; return n; }
}

interface Row { player_id: string; callsign: string; cls: Hologram['cls']; av: string; x: number; y: number; h: number; deck: number; sigma: number; t: number }
const NOT_HIDDEN = 'player_id NOT IN (SELECT player_id FROM player_flags WHERE hidden = 1)';

/**
 * Database-backed: every request may land on a different serverless instance, so nothing can live in memory.
 * Costs a read and a write per ping — fine for a show-sized crowd; a Durable Object / Redis is the next step beyond that.
 * Invisibility is read from player_flags in SQL, so the in-memory `hidden` set is ignored here.
 */
export class DbPresence implements Presence {
  private count = { at: -1e9, n: 0 };
  constructor(private db: Db) {}

  private upsert(p: Hologram, now: number) {
    return this.db.run(
      `INSERT INTO presence (player_id, callsign, cls, rank, av, x, y, h, deck, sigma, t) VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(player_id) DO UPDATE SET callsign = excluded.callsign, cls = excluded.cls, rank = excluded.rank, av = excluded.av,
         x = excluded.x, y = excluded.y, h = excluded.h, deck = excluded.deck, sigma = excluded.sigma, t = excluded.t`,
      [p.id, p.callsign, p.cls, '', p.av, p.x, p.y, p.h, p.deck ? 1 : 0, p.sigma, now]);
  }
  async update(p: Hologram, now: number, isSpawn: boolean) {
    const prev = await this.db.get<Row>('SELECT x, y, deck, t FROM presence WHERE player_id = ?', [p.id]);
    let moved = 0;
    if (prev && !isSpawn && now - prev.t < 30_000) {
      const r = tooFast({ x: prev.x, y: prev.y, deck: prev.deck === 1, t: prev.t }, p, now); moved = r.moved;
      if (r.refuse) { await this.db.run('UPDATE presence SET t = ? WHERE player_id = ?', [now, p.id]); return null; }
    }
    await this.upsert(p, now);
    return moved;
  }
  async anchor(p: Hologram, now: number) { await this.upsert({ ...p, deck: true, sigma: 1 }, now); }
  async position(id: string, now: number) {
    const e = await this.db.get<Row>('SELECT x, y FROM presence WHERE player_id = ? AND t >= ?', [id, now - FRESH_MS]);
    return e ? { x: e.x, y: e.y } : null;
  }
  async near(id: string, x: number, y: number, now: number, _hidden: ReadonlySet<string>, radius = 90, limit = 60) {
    const rows = await this.db.all<Row>(`SELECT * FROM presence WHERE t >= ? AND player_id != ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ? AND ${NOT_HIDDEN} LIMIT 400`, [now - FRESH_MS, id, x - radius, x + radius, y - radius, y + radius]);
    const out = rows.map((e) => publicView({ id: e.player_id, callsign: e.callsign, cls: e.cls, av: e.av, x: e.x, y: e.y, h: e.h, deck: e.deck === 1, sigma: e.sigma }, Math.hypot(e.x - x, e.y - y))).filter((e) => e.d <= radius);
    return nearest(out, limit);
  }
  async all(now: number, _hidden: ReadonlySet<string>) {
    const rows = await this.db.all<Row>(`SELECT x, y, cls, deck FROM presence WHERE t >= ? AND ${NOT_HIDDEN} LIMIT 2000`, [now - FRESH_MS]);
    return rows.map((e) => ({ x: +e.x.toFixed(1), y: +e.y.toFixed(1), cls: e.cls, deck: e.deck === 1 }));
  }
  async online(now: number) {
    if (now - this.count.at > 8000) this.count = { at: now, n: (await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM presence WHERE t >= ?', [now - FRESH_MS]))?.n ?? 0 };
    return this.count.n;
  }
}
