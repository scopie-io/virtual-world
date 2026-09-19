// Switched off in the simple game (FEATURES.groundControl).
// Ground Control (Systems doc §10.3): a remote player sees a target only visible "from orbit"; an on-site player
// must physically reach it and scan. Waypoints only — no free text between strangers.
import { Game, GameError, type StampOutcome } from './game.js';
import type { Stations } from './stations.js';
import type { Venue } from './venue.js';
import type { GcRole, GcView, XpEvent } from '../shared/types.js';
import { GC_MAX_WAYPOINTS, GC_QUEUE_TTL_MS, GC_SESSION_MS, GC_XP, INFLUENCE_PRESENCE, MISSION_INFLUENCE } from '../shared/rules.js';

interface Session { id: string; ground_id: string; astro_id: string; station_id: string; state: 'active' | 'done' | 'expired'; waypoints: string; created_at: number; expires_at: number; done_at: number | null }

export class GroundControl {
  constructor(private g: Game, private stationsSvc: Stations, private venue: Venue) {}

  private async session(id: string, t: number): Promise<Session | null> {
    const s = await this.g.db.get<Session>("SELECT * FROM gc_sessions WHERE (ground_id = ? OR astro_id = ?) ORDER BY created_at DESC LIMIT 1", [id, id]);
    if (!s) return null;
    if (s.state === 'active' && s.expires_at <= t) { await this.g.db.run("UPDATE gc_sessions SET state = 'expired' WHERE id = ?", [s.id]); s.state = 'expired'; }
    return s;
  }

  /** Your role is not a choice: being verifiably on site makes you the astronaut. */
  async join(id: string): Promise<GcView> {
    if (!this.g.features.groundControl) throw new GameError('off', 'Not part of this game', 404);
    const t = this.g.now(), cur = await this.session(id, t);
    if (cur?.state === 'active') return this.view(id);
    const role: GcRole = (await this.venue.isOnsite(id, t)) ? 'astro' : 'ground', want: GcRole = role === 'astro' ? 'ground' : 'astro';
    await this.g.db.run('DELETE FROM gc_queue WHERE queued_at < ?', [t - GC_QUEUE_TTL_MS]);
    const other = await this.g.db.get<{ player_id: string }>('SELECT player_id FROM gc_queue WHERE role = ? AND player_id != ? ORDER BY queued_at LIMIT 1', [want, id]);
    if (!other) {
      await this.g.db.run('INSERT INTO gc_queue (player_id, role, queued_at) VALUES (?,?,?) ON CONFLICT(player_id) DO UPDATE SET role = excluded.role, queued_at = excluded.queued_at', [id, role, t]);
      return this.view(id);
    }
    const ground = role === 'ground' ? id : other.player_id, astro = role === 'astro' ? id : other.player_id;
    const target = await this.pickTarget(astro, t);
    if (!target) throw new GameError('no_target', 'No station is online yet for a Ground Control run — try again once exhibitors are hosting');
    await this.g.db.batch([
      ['DELETE FROM gc_queue WHERE player_id IN (?, ?)', [id, other.player_id]],
      ['INSERT INTO gc_sessions (id, ground_id, astro_id, station_id, state, created_at, expires_at) VALUES (?,?,?,?,?,?,?)', [crypto.randomUUID(), ground, astro, target, 'active', t, t + GC_SESSION_MS]],
    ]);
    return this.view(id);
  }

  /** An online station the astronaut has not stamped, 40–160 m from where they last stood — a walk, not a marathon. */
  private async pickTarget(astro: string, t: number): Promise<string | null> {
    const live = await this.stationsSvc.list(), stamped = new Set((await this.g.db.all<{ station_id: string }>('SELECT station_id FROM stamps WHERE player_id = ?', [astro])).map((s) => s.station_id));
    const mine = new Set((await this.g.db.all<{ station_id: string }>('SELECT station_id FROM stations WHERE owner_id = ?', [astro])).map((s) => s.station_id));
    const anchor = await this.venue.anchorOf(astro), from = (await this.g.presence.position(astro, t)) ?? this.g.stations.get(anchor?.stationId ?? '') ?? this.g.level.spawns.short;
    const scored = live.filter((s) => !stamped.has(s.id) && !mine.has(s.id)).map((s) => { const b = this.g.stations.get(s.id)!; const d = Math.hypot(b.x - from.x, b.y - from.y); return { id: s.id, fit: d >= 40 && d <= 160 ? 0 : Math.min(Math.abs(d - 40), Math.abs(d - 160)), hosted: s.hosted ? 0 : 1 }; });
    scored.sort((a, b) => a.hosted - b.hosted || a.fit - b.fit);
    return scored[0]?.id ?? null;
  }

  async leave(id: string): Promise<void> {
    const t = this.g.now();
    await this.g.db.run('DELETE FROM gc_queue WHERE player_id = ?', [id]);
    const s = await this.session(id, t);
    if (s?.state === 'active') await this.g.db.run("UPDATE gc_sessions SET state = 'expired' WHERE id = ?", [s.id]);
  }

  /** Ground Control's only voice: a marker on the floor. Rate-limited by the API layer; only the last few are kept. */
  async waypoint(id: string, x: number, y: number): Promise<void> {
    const s = await this.session(id, this.g.now());
    if (!s || s.state !== 'active' || s.ground_id !== id) throw new GameError('not_ground', 'Only Ground Control can drop markers', 403);
    if (![x, y].every(Number.isFinite) || !this.g.level.decks.some((d) => x >= d.x0 && x <= d.x1 && y >= d.y0 && y <= d.y1)) throw new GameError('bad_pos', 'That marker is off the deck');
    const list = [...(JSON.parse(s.waypoints) as { x: number; y: number }[]), { x: +x.toFixed(1), y: +y.toFixed(1) }].slice(-GC_MAX_WAYPOINTS);
    await this.g.db.run('UPDATE gc_sessions SET waypoints = ? WHERE id = ?', [JSON.stringify(list), s.id]);
  }

  async view(id: string): Promise<GcView> {
    const t = this.g.now(), s = await this.session(id, t);
    const idle: GcView = { state: 'idle', role: null, partner: null, target: null, partnerPos: null, waypoints: [], expiresInMs: 0, xp: GC_XP };
    if (!s || (s.state !== 'active' && t - (s.done_at ?? s.expires_at) > 60_000)) {
      const q = await this.g.db.get<{ role: GcRole; queued_at: number }>('SELECT role, queued_at FROM gc_queue WHERE player_id = ?', [id]);
      return q && t - q.queued_at <= GC_QUEUE_TTL_MS ? { ...idle, state: 'queued', role: q.role, expiresInMs: q.queued_at + GC_QUEUE_TTL_MS - t } : idle;
    }
    const role: GcRole = s.ground_id === id ? 'ground' : 'astro', partnerId = role === 'ground' ? s.astro_id : s.ground_id;
    const b = this.g.stations.get(s.station_id)!, company = (await this.stationsSvc.list()).find((x) => x.id === b.id)?.company;
    const hidden = await this.venue.isHidden(partnerId);
    return {
      state: s.state, role, partner: (await this.g.player(partnerId)).callsign, xp: GC_XP,
      target: role === 'ground' || s.state === 'done' ? { x: b.x, y: b.y, label: company || b.name || `Station ${b.id}`, stationId: b.id } : null,
      partnerPos: role === 'ground' && !hidden ? await this.g.presence.position(partnerId, t) : null, // an invisible astronaut stays invisible, even to their controller
      waypoints: JSON.parse(s.waypoints), expiresInMs: Math.max(0, s.expires_at - t),
    };
  }

  /** The run completes when the astronaut proves they are at the target. Both are paid in full — this is how remote players earn well. */
  async afterStamp(o: StampOutcome): Promise<XpEvent[]> {
    if (!this.g.features.groundControl || o.presence !== 'onsite') return [];
    const s = await this.g.db.get<Session>("SELECT * FROM gc_sessions WHERE astro_id = ? AND state = 'active' AND station_id = ? AND expires_at > ?", [o.id, o.station.id, o.t]);
    if (!s) return [];
    const ground = await this.g.player(s.ground_id);
    await this.g.db.batch([
      ["UPDATE gc_sessions SET state = 'done', done_at = ? WHERE id = ?", [o.t, s.id]],
      ...this.g.award(s.astro_id, 'ground_control', GC_XP, s.station_id, { role: 'astro' }, o.t),
      ...this.g.award(s.ground_id, 'ground_control', GC_XP, s.station_id, { role: 'ground' }, o.t),
      ...this.g.influence(s.astro_id, o.cls, o.station.hall, MISSION_INFLUENCE * INFLUENCE_PRESENCE.onsite, o.t),
      ...this.g.influence(s.ground_id, ground.cls, o.station.hall, MISSION_INFLUENCE * INFLUENCE_PRESENCE.onsite, o.t),
    ]);
    return [{ action: 'ground_control', xp: GC_XP, target: `with ${ground.callsign}` }];
  }
}
