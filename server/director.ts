// Switched off in the simple game (FEATURES.director).
// The Mission Director (Systems doc §10): reads the live floor and hands each player something worth doing now.
// Offers are a choice of three, never a draw. Signal Storms pull traffic into the quietest zone.
import { Game, GameError, type StampOutcome } from './game.js';
import type { Stations } from './stations.js';
import type { Venue } from './venue.js';
import type { Booth, HallRect, MissionView, MissionsView, StormView, XpEvent } from '../shared/types.js';
import {
  DIRECTOR_W, INFLUENCE_PRESENCE, MISSION_INFLUENCE, MISSION_INFO, MISSION_OFFER_TTL_MS, REMOTE_SHARE, STAMP_RADIUS_M, STORM_GAP_MS, STORM_MS, STORM_MULT,
  type MissionTemplate,
} from '../shared/rules.js';
import type { Stmt } from './db/types.js';

interface Row { id: string; player_id: string; template: MissionTemplate; params: string; progress: string; state: MissionView['state']; xp: number; created_at: number; expires_at: number }
interface Params { hall?: number; a?: string; b?: string; station?: string }
interface Progress { n?: number; need?: number; stage?: number; seen?: string[]; onsite: boolean }
interface Candidate { template: MissionTemplate; params: Params; progress: Progress; point: { x: number; y: number }; targets: string[]; score: number }


export class Director {
  private active = new Map<string, { row: Row | null; at: number }>(); // per-player, a few seconds: keeps pings cheap without trusting one instance's memory
  private stormCache: { at: number; storm: (StormView & { endsAt: number }) | null } = { at: -1e9, storm: null };

  constructor(private g: Game, private stationsSvc: Stations, private venue: Venue) {}

  /* ---------------- helpers ---------------- */

  private booth(id: string | undefined): Booth | undefined { return id ? this.g.stations.get(id) : undefined; }
  private hall(id: number | undefined): HallRect { return this.g.level.halls.find((h) => h.id === id) ?? this.g.level.halls[0]!; }
  /** Where the trail should lead for "go to Hall N": the middle of its front aisle. */
  private hallPoint(id: number | undefined) { const h = this.hall(id); return { x: (h.x0 + h.x1) / 2, y: h.y0 + (h.y1 - h.y0) * 0.28 }; }
  private deckAt(p: { x: number; y: number }): number { const d = this.g.level.decks; return (d.find((k) => p.y >= k.y0 - 20 && p.y <= k.y1 + 20) ?? d[0]!).level; }
  private label(b: Booth, company?: string) { return company || b.name || `Station ${b.id}`; }

  private async activeOf(id: string, t: number): Promise<Row | null> {
    let hit = this.active.get(id);
    if (!hit || t - hit.at > 3000 || t < hit.at) {
      hit = { row: (await this.g.db.get<Row>("SELECT * FROM missions WHERE player_id = ? AND state = 'active' ORDER BY created_at DESC LIMIT 1", [id])) ?? null, at: t };
      this.active.set(id, hit);
    }
    if (hit.row && hit.row.expires_at <= t) {
      await this.g.db.run("UPDATE missions SET state = 'expired' WHERE id = ?", [hit.row.id]);
      this.active.delete(id); return null;
    }
    return hit.row;
  }

  private toView(r: Row, t: number, claimed: Map<string, string>): MissionView {
    const p = JSON.parse(r.params) as Params, pr = JSON.parse(r.progress) as Progress, info = MISSION_INFO[r.template];
    const name = (sid?: string) => { const b = this.booth(sid); return b ? `${this.label(b, claimed.get(b.id))} (${b.id})` : '?'; };
    const at = (sid?: string) => { const b = this.booth(sid); return b ? { x: b.x, y: b.y, label: this.label(b, claimed.get(b.id)), stationId: b.id } : null; };
    let brief = '', progress = '', target: MissionView['target'] = null;
    switch (r.template) {
      case 'survey': brief = `Stamp ${pr.need} stations in Hall ${p.hall} you have not stamped before.`; progress = `${pr.n} / ${pr.need}`; target = { ...this.hallPoint(p.hall), label: `Hall ${p.hall}` }; break;
      case 'supply': brief = `Pick up a crate at ${name(p.a)} and deliver it to ${name(p.b)}.`; progress = pr.stage === 0 ? 'Go to pickup' : 'Crate on board — deliver it'; target = at(pr.stage === 0 ? p.a : p.b); break;
      case 'first_contact': brief = `Have a real conversation in Hall ${p.hall}: scan a host's live code at any online station there.`; progress = 'Needs a host code'; target = { ...this.hallPoint(p.hall), label: `Hall ${p.hall}` }; break;
      case 'cartographer': brief = `Stamp ${name(p.station)} — the far side of the map from where you stood.`; progress = 'One stamp'; target = at(p.station); break;
      case 'dark_sector': brief = `Walk up to ${pr.need} dark stations. Each exhibitor is told someone came looking for them.`; progress = `${pr.seen?.length ?? 0} / ${pr.need}`; break;
    }
    return { id: r.id, template: r.template, title: info.title, brief, xp: r.xp, state: r.state, progress, target, expiresInMs: Math.max(0, r.expires_at - t) };
  }

  /* ---------------- offers ---------------- */

  private async generate(id: string, t: number): Promise<Candidate[]> {
    const [stampedRows, live, recent, onsite] = await Promise.all([
      this.g.db.all<{ station_id: string; hall: number }>('SELECT station_id, hall FROM stamps WHERE player_id = ?', [id]),
      this.stationsSvc.list(),
      this.g.db.all<{ template: string; params: string }>('SELECT template, params FROM missions WHERE player_id = ? AND created_at > ?', [id, t - 30 * 60_000]),
      this.venue.isOnsite(id, t),
    ]);
    const stamped = new Set(stampedRows.map((s) => s.station_id)), hallsDone = new Set(stampedRows.map((s) => s.hall));
    const liveMap = new Map(live.map((s) => [s.id, s])), pos = (await this.g.presence.position(id, t)) ?? this.g.level.spawns.short;
    const deck = this.deckAt(pos);
    const booths = this.g.level.booths.filter((b) => b.deck === deck && b.id !== this.g.level.hero.id), fresh = booths.filter((b) => !stamped.has(b.id));
    const dist = (b: { x: number; y: number }) => Math.hypot(b.x - pos.x, b.y - pos.y);
    const recentKeys = new Set(recent.map((r) => r.template + r.params));
    const heat = await this.zoneHeat(t), maxHeat = Math.max(1, ...heat.values());
    const out: Candidate[] = [];

    const push = (template: MissionTemplate, params: Params, progress: Progress, point: { x: number; y: number }, targets: string[]) => {
      const d = dist(point) * 1.3; // aisles are not straight lines
      const proximity = d < 60 ? d / 60 : d <= 250 ? 1 : Math.max(0, 1 - (d - 250) / 250);
      const novelty = targets.length ? targets.filter((s) => !stamped.has(s)).length / targets.length : 1;
      const quiet = 1 - (heat.get(this.zoneOf(point)) ?? 0) / maxHeat;
      const partner = targets.length ? Math.max(...targets.map((s) => { const v = liveMap.get(s); return v ? (v.hosted ? 1 : 0.7) : 0.3; })) : 0.3;
      const repeat = recentKeys.has(template + JSON.stringify(params)) ? 1 : 0;
      const score = DIRECTOR_W.proximity * proximity + DIRECTOR_W.novelty * novelty + DIRECTOR_W.quiet * quiet + DIRECTOR_W.interest * 0.5 + DIRECTOR_W.partner * partner - DIRECTOR_W.repeat * repeat;
      out.push({ template, params, progress, point, targets, score });
    };

    for (const hall of this.g.level.halls.filter((h) => h.deck === deck).map((h) => h.id)) {
      const inHall = fresh.filter((b) => b.hall === hall);
      if (inHall.length >= 3) push('survey', { hall }, { n: 0, need: 3, onsite: true }, this.hallPoint(hall), []);
      if (onsite && !hallsDone.has(hall) && live.some((s) => this.booth(s.id)?.hall === hall)) push('first_contact', { hall }, { onsite: true }, this.hallPoint(hall), live.filter((s) => this.booth(s.id)?.hall === hall).map((s) => s.id));
    }
    // Supply runs prefer online stations at both ends: two exhibitors get a visitor.
    const liveHere = live.map((s) => this.booth(s.id)!).filter((b) => b && b.deck === deck);
    const pool = (liveHere.length >= 2 ? liveHere : booths.filter((b) => b.name)).filter((b) => b.id !== this.g.level.hero.id);
    const byNear = [...pool].sort((a, b) => dist(a) - dist(b));
    for (const a of byNear.slice(0, 3)) {
      const b = [...pool].filter((x) => x.hall !== a.hall).sort((x, y) => Math.hypot(y.x - a.x, y.y - a.y) - Math.hypot(x.x - a.x, x.y - a.y))[0];
      if (b) push('supply', { a: a.id, b: b.id }, { stage: 0, onsite: true }, a, [a.id, b.id]);
    }
    const far = [...fresh].sort((a, b) => dist(b) - dist(a))[0];
    if (far) push('cartographer', { station: far.id }, { onsite: true }, far, [far.id]);
    if (booths.filter((b) => !liveMap.has(b.id)).length >= 3) push('dark_sector', {}, { seen: [], need: 3, onsite: true }, pos, []);

    // Best three, one per template: a real choice, not three flavours of the same errand.
    const best = new Map<MissionTemplate, Candidate>();
    for (const c of out.sort((a, b) => b.score - a.score)) if (!best.has(c.template)) best.set(c.template, c);
    return [...best.values()].slice(0, 3);
  }

  async view(id: string): Promise<MissionsView> {
    if (!this.g.features.director) return { active: null, offers: [], storm: null, darkVisitors: {} };
    const t = this.g.now(), active = await this.activeOf(id, t);
    const claimed = new Map((await this.stationsSvc.list()).map((s) => [s.id, s.company]));
    let offers: Row[] = [];
    if (!active) {
      offers = await this.g.db.all<Row>("SELECT * FROM missions WHERE player_id = ? AND state = 'offered' AND expires_at > ? ORDER BY xp DESC", [id, t]);
      if (offers.length === 0) {
        const stmts: Stmt[] = [["UPDATE missions SET state = 'expired' WHERE player_id = ? AND state = 'offered'", [id]]];
        for (const c of await this.generate(id, t)) {
          stmts.push(['INSERT INTO missions (id, player_id, template, params, progress, state, xp, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)',
            [crypto.randomUUID(), id, c.template, JSON.stringify(c.params), JSON.stringify(c.progress), 'offered', MISSION_INFO[c.template].xp, t, t + MISSION_OFFER_TTL_MS]]);
        }
        await this.g.db.batch(stmts);
        offers = await this.g.db.all<Row>("SELECT * FROM missions WHERE player_id = ? AND state = 'offered' AND expires_at > ? ORDER BY xp DESC", [id, t]);
      }
    }
    const mine = await this.g.db.all<{ station_id: string }>("SELECT station_id FROM stations WHERE owner_id = ? AND status != 'revoked'", [id]);
    const darkVisitors: Record<string, number> = {};
    for (const m of mine) darkVisitors[m.station_id] = (await this.g.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM dark_visits WHERE station_id = ?', [m.station_id]))?.n ?? 0;
    const storm = await this.storm(t);
    return { active: active ? this.toView(active, t, claimed) : null, offers: offers.map((o) => this.toView(o, t, claimed)), storm: storm ? { ...storm, endsInMs: storm.endsAt - t } : null, darkVisitors };
  }

  async accept(id: string, missionId: string): Promise<void> {
    if (!this.g.features.director) throw new GameError('off', 'Not part of this game', 404);
    const t = this.g.now();
    if (await this.activeOf(id, t)) throw new GameError('busy', 'Finish or abandon your current mission first');
    const r = await this.g.db.get<Row>("SELECT * FROM missions WHERE id = ? AND player_id = ? AND state = 'offered'", [String(missionId), id]);
    if (!r || r.expires_at <= t) throw new GameError('gone', 'That offer has expired — here are fresh ones', 404);
    const until = t + MISSION_INFO[r.template].minutes * 60_000;
    await this.g.db.batch([
      ["UPDATE missions SET state = 'active', created_at = ?, expires_at = ? WHERE id = ?", [t, until, r.id]],
      ["UPDATE missions SET state = 'expired' WHERE player_id = ? AND state = 'offered'", [id]],
    ]);
    this.active.set(id, { row: { ...r, state: 'active', created_at: t, expires_at: until }, at: t });
  }

  async abandon(id: string): Promise<void> {
    const r = await this.activeOf(id, this.g.now()); if (!r) return;
    await this.g.db.run("UPDATE missions SET state = 'abandoned' WHERE id = ?", [r.id]);
    this.active.delete(id);
  }

  /* ---------------- progress ---------------- */

  private async advance(r: Row, pr: Progress, done: boolean, cls: string | null, hall: number, t: number): Promise<XpEvent[]> {
    if (!done) {
      await this.g.db.run('UPDATE missions SET progress = ? WHERE id = ?', [JSON.stringify(pr), r.id]);
      r.progress = JSON.stringify(pr);
      return [];
    }
    const presence = pr.onsite ? 'onsite' : 'remote', xp = Math.max(5, Math.round(r.xp * (pr.onsite ? 1 : REMOTE_SHARE)));
    await this.g.db.batch([
      ["UPDATE missions SET state = 'done', progress = ?, done_at = ? WHERE id = ?", [JSON.stringify(pr), t, r.id]],
      ...this.g.award(r.player_id, 'mission', xp, r.template, { presence }, t),
      ...this.g.influence(r.player_id, cls, hall, MISSION_INFLUENCE * INFLUENCE_PRESENCE[presence], t),
    ]);
    this.active.delete(r.player_id);
    return [{ action: 'mission', xp, target: MISSION_INFO[r.template].title, note: presence === 'remote' ? 'Walk it on site for the full reward' : undefined }];
  }

  async afterStamp(o: StampOutcome): Promise<XpEvent[]> {
    if (!this.g.features.director) return [];
    const r = await this.activeOf(o.id, o.t); if (!r) return [];
    const p = JSON.parse(r.params) as Params, pr = JSON.parse(r.progress) as Progress, onsite = o.presence === 'onsite';
    if (r.template === 'survey' && o.newStamp && o.station.hall === p.hall) { pr.n = (pr.n ?? 0) + 1; pr.onsite &&= onsite; return this.advance(r, pr, pr.n >= (pr.need ?? 3), o.cls, o.station.hall, o.t); }
    if (r.template === 'cartographer' && o.newStamp && o.station.id === p.station) { pr.onsite &&= onsite; return this.advance(r, pr, true, o.cls, o.station.hall, o.t); }
    if (r.template === 'first_contact' && o.newVerified && o.station.hall === p.hall) return this.advance(r, pr, true, o.cls, o.station.hall, o.t);
    return [];
  }

  /** Walk-up progress: crate pickups and deliveries, and visits to dark stations. */
  async afterPing(o: { id: string; x: number; y: number; deck: boolean; t: number }): Promise<XpEvent[]> {
    if (!this.g.features.director) return [];
    const r = await this.activeOf(o.id, o.t); if (!r || (r.template !== 'supply' && r.template !== 'dark_sector')) return [];
    const p = JSON.parse(r.params) as Params, pr = JSON.parse(r.progress) as Progress, near = (b?: Booth) => !!b && Math.hypot(b.x - o.x, b.y - o.y) <= STAMP_RADIUS_M;
    const cls = (await this.g.player(o.id)).cls;
    if (r.template === 'supply') {
      const target = this.booth(pr.stage === 0 ? p.a : p.b);
      if (!near(target)) return [];
      pr.onsite &&= o.deck; pr.stage = (pr.stage ?? 0) + 1;
      const ev = await this.advance(r, pr, pr.stage >= 2, cls, target!.hall, o.t);
      return ev.length ? ev : [{ action: 'mission_step', xp: 0, target: 'Crate on board — deliver it' }];
    }
    const live = new Set((await this.stationsSvc.list()).map((s) => s.id)), seen = new Set(pr.seen ?? []);
    const hit = this.g.level.booths.find((b) => !live.has(b.id) && !seen.has(b.id) && b.id !== this.g.level.hero.id && Math.hypot(b.x - o.x, b.y - o.y) <= 4);
    if (!hit) return [];
    pr.seen = [...seen, hit.id]; pr.onsite &&= o.deck;
    await this.g.db.run('INSERT OR IGNORE INTO dark_visits (station_id, player_id, created_at) VALUES (?,?,?)', [hit.id, o.id, o.t]);
    const ev = await this.advance(r, pr, pr.seen.length >= (pr.need ?? 3), cls, hit.hall, o.t);
    return ev.length ? ev : [{ action: 'mission_step', xp: 0, target: `Dark station ${hit.id} logged · ${pr.seen.length} / ${pr.need}` }];
  }

  /* ---------------- Signal Storms ---------------- */

  /** A zone is half a hall: "7N", "3S". Points outside every hall belong to the nearest one. */
  private zoneOf(p: { x: number; y: number }): string {
    const halls = this.g.level.halls, d = (h: HallRect) => Math.hypot(Math.max(h.x0 - p.x, 0, p.x - h.x1), Math.max(h.y0 - p.y, 0, p.y - h.y1));
    const h = halls.reduce((best, k) => (d(k) < d(best) ? k : best), halls[0]!);
    return `${h.id}${p.y >= (h.y0 + h.y1) / 2 ? 'N' : 'S'}`;
  }

  /** Decayed stamp activity per zone (hall × north/south half) over the last hour. */
  private async zoneHeat(t: number): Promise<Map<string, number>> {
    const rows = await this.g.db.all<{ station_id: string; created_at: number }>('SELECT station_id, created_at FROM stamps WHERE created_at > ?', [t - 60 * 60_000]);
    const heat = new Map<string, number>();
    for (const r of rows) { const b = this.booth(r.station_id); if (b) { const z = this.zoneOf(b); heat.set(z, (heat.get(z) ?? 0) + Math.exp(-(t - r.created_at) / (20 * 60_000))); } }
    return heat;
  }

  /** Lazy and deterministic: when no storm is running and the gap has passed, the quietest zone gets one. */
  private async storm(t: number): Promise<(StormView & { endsAt: number }) | null> {
    if (!this.g.features.director) return null;
    if (t - this.stormCache.at < 15_000 && (!this.stormCache.storm || this.stormCache.storm.endsAt > t)) return this.stormCache.storm;
    const last = await this.g.db.get<{ zone: string; x0: number; y0: number; x1: number; y1: number; starts_at: number; ends_at: number }>('SELECT * FROM storms ORDER BY ends_at DESC LIMIT 1');
    let row = last && last.ends_at > t ? last : null;
    if (!row && (!last || t - last.ends_at >= STORM_GAP_MS)) {
      const heat = await this.zoneHeat(t);
      // a storm over a lounge or a stage would send people to a zone with nothing to stamp
      const stocked = new Map<string, number>();
      for (const b of this.g.level.booths) { const z = this.zoneOf(b); stocked.set(z, (stocked.get(z) ?? 0) + 1); }
      const zones = this.g.level.halls.flatMap((hall) => (['S', 'N'] as const).map((half) => ({ zone: `${hall.id}${half}`, hall, half }))).filter((z) => (stocked.get(z.zone) ?? 0) >= 12);
      const turn = Math.floor(t / (STORM_MS + STORM_GAP_MS));
      const pick = zones.map((z, i) => ({ z, heat: heat.get(z.zone) ?? 0, order: (i + zones.length - (turn % zones.length)) % zones.length })).sort((a, b) => a.heat - b.heat || a.order - b.order)[0]!.z;
      const h = pick.hall, mid = (h.y0 + h.y1) / 2;
      row = { zone: pick.zone, x0: h.x0, x1: h.x1, y0: pick.half === 'S' ? h.y0 : mid, y1: pick.half === 'S' ? mid : h.y1, starts_at: t, ends_at: t + STORM_MS };
      await this.g.db.run('INSERT INTO storms (zone, x0, y0, x1, y1, starts_at, ends_at) VALUES (?,?,?,?,?,?,?)', [row.zone, row.x0, row.y0, row.x1, row.y1, row.starts_at, row.ends_at]);
    }
    const storm = row ? { zone: row.zone, label: `Hall ${row.zone.slice(0, -1)} · ${row.zone.endsWith('N') ? 'north' : 'south'} side`, x0: row.x0, y0: row.y0, x1: row.x1, y1: row.y1, endsInMs: row.ends_at - t, endsAt: row.ends_at, mult: STORM_MULT } : null;
    this.stormCache = { at: t, storm };
    return storm;
  }

  /** The running storm, if any — for the booth screen, which has no player behind it. */
  async stormView(): Promise<StormView | null> { const t = this.g.now(), s = await this.storm(t); return s ? { ...s, endsInMs: s.endsAt - t } : null; }

  async stampMult(stationId: string, t: number): Promise<number> {
    const s = await this.storm(t), b = this.booth(stationId);
    return s && b && b.x >= s.x0 && b.x < s.x1 && b.y >= s.y0 && b.y < s.y1 ? s.mult : 1;
  }
}
