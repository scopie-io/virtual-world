// Presence engine, server side (Systems doc §3): the venue gate, on-site anchors, deck walking, invisibility.
// GPS is only ever a gate ("is this person at MITEC?"). It never places anyone on the floor — scans do that.
import { Game, GameError, dayOf } from './game.js';
import type { XpEvent } from '../shared/types.js';
import { ONSITE_TTL_MS, VENUE_DEFAULT, VENUE_MAX_ACCURACY_M, WALK_XP_DAILY_CAP, WALK_XP_PER_M } from '../shared/rules.js';

export interface VenueConfig { lat: number; lon: number; radiusM: number }

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000, r = Math.PI / 180, dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export class Venue {
  readonly hidden = new Set<string>();
  /** Metres accepted on this instance and not yet written down. The database row holds the total and what was paid. */
  private unpaid = new Map<string, number>();

  constructor(private g: Game, readonly cfg: VenueConfig = VENUE_DEFAULT) {}

  /** The client sends one fix; we keep only the verdict and how far off it was. */
  async checkIn(id: string, fix: { lat: number; lon: number; acc: number }): Promise<{ onsite: boolean; distanceM: number; reason?: string }> {
    const { lat, lon, acc } = fix;
    if (![lat, lon, acc].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || acc < 0) throw new GameError('bad_fix', 'That location fix is not usable');
    const dist = Math.round(haversineM(lat, lon, this.cfg.lat, this.cfg.lon));
    const usable = acc <= VENUE_MAX_ACCURACY_M, ok = usable && dist <= this.cfg.radiusM + Math.min(acc, 100);
    await this.g.db.run('INSERT INTO venue_checks (player_id, ok, dist_m, acc_m, checked_at) VALUES (?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET ok = excluded.ok, dist_m = excluded.dist_m, acc_m = excluded.acc_m, checked_at = excluded.checked_at',
      [id, ok ? 1 : 0, dist, Math.round(acc), this.g.now()]);
    return { onsite: ok, distanceM: dist, reason: ok ? undefined : usable ? 'outside' : 'inaccurate' };
  }

  async venueOk(id: string, t: number): Promise<boolean> {
    const v = await this.g.db.get<{ ok: number; checked_at: number }>('SELECT ok, checked_at FROM venue_checks WHERE player_id = ?', [id]);
    return !!v && v.ok === 1 && t - v.checked_at <= ONSITE_TTL_MS;
  }

  async anchorOf(id: string): Promise<{ stationId: string; at: number } | null> {
    const a = await this.g.db.get<{ station_id: string; anchored_at: number }>('SELECT station_id, anchored_at FROM anchors WHERE player_id = ?', [id]);
    return a ? { stationId: a.station_id, at: a.anchored_at } : null;
  }

  /** On site = a good venue check, or an on-site scan, within the last half hour. */
  async isOnsite(id: string, t: number): Promise<boolean> {
    if (await this.venueOk(id, t)) return true;
    const a = await this.anchorOf(id);
    return !!a && t - a.at <= ONSITE_TTL_MS;
  }

  /** An on-site proof at a station: remember it and place the player there for everyone else. */
  async anchor(id: string, stationId: string, t: number): Promise<void> {
    const s = this.g.stations.get(stationId); if (!s) return;
    await this.g.db.run('INSERT INTO anchors (player_id, station_id, anchored_at) VALUES (?,?,?) ON CONFLICT(player_id) DO UPDATE SET station_id = excluded.station_id, anchored_at = excluded.anchored_at', [id, stationId, t]);
    await this.g.presence.anchor(await this.g.hologramOf(id, { x: s.x, y: s.y, h: 0, deck: true, sigma: 1 }), t);
  }

  async isHidden(id: string): Promise<boolean> {
    const f = await this.g.db.get<{ hidden: number }>('SELECT hidden FROM player_flags WHERE player_id = ?', [id]);
    if (f?.hidden) this.hidden.add(id); else this.hidden.delete(id);
    return !!f?.hidden;
  }

  async setHidden(id: string, hidden: boolean): Promise<void> {
    await this.g.db.run('INSERT INTO player_flags (player_id, hidden) VALUES (?,?) ON CONFLICT(player_id) DO UPDATE SET hidden = excluded.hidden', [id, hidden ? 1 : 0]);
    if (hidden) this.hidden.add(id); else this.hidden.delete(id);
  }

  /** Real walking on deck earns 1 XP per 10 m, capped daily. Metres come from server-accepted deck movement only. */
  async walk(id: string, metres: number, t: number): Promise<XpEvent[]> {
    if (!this.g.features.explore || metres <= 0) return [];
    const pending = (this.unpaid.get(id) ?? 0) + metres;
    if (pending < 25) { this.unpaid.set(id, pending); return []; } // touch the database every 25 m, not every ping
    this.unpaid.delete(id);
    const day = dayOf(t), row = await this.g.db.get<{ metres: number; xp: number }>('SELECT metres, xp FROM walks WHERE player_id = ? AND day = ?', [id, day]);
    const total = (row?.metres ?? 0) + pending, paid = row?.xp ?? 0;
    const due = Math.min(WALK_XP_DAILY_CAP, Math.floor(total * WALK_XP_PER_M)) - paid, pay = due >= 5 || paid + due >= WALK_XP_DAILY_CAP ? Math.max(0, due) : 0; // pay in batches of 5+
    await this.g.db.batch([
      ['INSERT INTO walks (player_id, day, metres, xp) VALUES (?,?,?,?) ON CONFLICT(player_id, day) DO UPDATE SET metres = excluded.metres, xp = excluded.xp', [id, day, total, paid + pay]],
      ...(pay ? this.g.award(id, 'walk', pay, null, { metres: Math.round(total) }, t) : []),
    ]);
    return pay ? [{ action: 'walk', xp: pay, target: `${Math.round(total)} m on deck today` }] : [];
  }
}
