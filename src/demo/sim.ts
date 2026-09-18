// The demo world. With no backend configured the real game server runs inside the browser (see sw.ts); this file
// fills it with life so every M1–M4 system has something to show: exhibitors hosting stations, visitors walking the
// decks and stamping, links, company teams, sector control, a Daily Drop, a Signal Storm, one account worth reviewing —
// plus partners for the things one person cannot do alone (Link-up, Ground Control, visitors to the station you host).
//
// Everything goes through the same services real players use, so XP, the ledger, boards and trust stay consistent.
import type { Services } from '../../server/wire';
import { dayStart } from '../../server/game';
import type { Booth, Hologram, LevelData } from '../../shared/types';
import { CLASSES, HOST_WINDOW_MS, STORM_GAP_MS, VENUE_DEFAULT, type PlayerClass, type ShareField } from '../../shared/rules';
import { CATALOG, SLOTS, defaultAvatar, isUnlocked, type AvatarSpec, type Option } from '../../shared/avatar';
import { NavGrid, type P2 } from '../game/nav';

export const DEMO_CREW_PIN = '2026';
type Kind = 'host' | 'onsite' | 'remote' | 'gcAstro' | 'gcGround' | 'suspect';
interface RosterEntry { id: string; kind: Kind; deck: number; station?: string; hosting?: boolean; passport: boolean }
interface Bot extends RosterEntry {
  pos: P2; h: number; path: P2[]; speed: number; wait: number; target: Booth | null;
  base: Omit<Hologram, 'x' | 'y' | 'h' | 'deck' | 'sigma'> | null; baseAt: number;
  /** a job that overrides wandering: visit a player's station, or fly a Ground Control run */
  job: { type: 'visit'; station: string } | { type: 'gc'; goalKey: string } | null;
}
export interface DemoState { version: number; crewPin: string; teams: { name: string; code: string }[]; pendingStation: string | null; hostedNear: { id: string; name: string }[]; drop: string | null; bots: number }

const PEOPLE = ['Aisyah Rahman', 'Daniel Lim', 'Nurul Huda', 'Arif Hakimi', 'Mei Ling Tan', 'Farid Ismail', 'Siti Khadijah', 'Kumar Raj', 'Hannah Yusof', 'Amirul Zaki', 'Wei Jie Ong', 'Zara Malik', 'Irfan Shah', 'Priya Nair', 'Hafiz Rosli', 'Sofia Azman',
  'Jason Wong', 'Liyana Karim', 'Omar Siddiq', 'Yasmin Idris', 'Adam Fikri', 'Chloe Teo', 'Rashid Noor', 'Amina Yusuf', 'Bilal Ahmed', 'Dina Salleh', 'Ethan Chua', 'Fatin Nabila', 'Ghazali Musa', 'Imran Latif', 'Jamilah Osman', 'Khairul Anwar',
  'Laila Hamid', 'Marcus Lee', 'Nadia Zain', 'Putri Ayu', 'Qistina Rafi', 'Ridzuan Said', 'Salma Haris', 'Tariq Aziz', 'Umar Faruq', 'Vivian Goh'];
const COMPANIES = ['Kencana Foods', 'Seri Bumi Trading', 'Halal Harvest Co', 'Nusantara Spice', 'Baraka Organics', 'Citra Logistics', 'Madani Packaging', 'Teratai Beauty', 'Warisan Kitchen', 'Zamrud Pharma', 'Al-Noor Imports', 'Pelangi Retail'];
const ROLES = ['Founder', 'Export Manager', 'Buyer', 'Marketing Lead', 'Business Development', 'Procurement', 'Sales Director', 'Brand Manager', 'Operations', 'Product Lead'];
// The cast hosts booths under the names printed on the floor plan; the offer line says plainly that the host is simulated.
const OFFERS = ['Demo host (simulated) — walk up and scan the code on their screen', 'Demo host (simulated) — share your Passport to see the lead flow', 'Demo host (simulated) — this is what an exhibitor profile looks like'];
const COLORS = [0x17b6d6, 0x3aa8ff, 0x4d7cff, 0xb69cff, 0xff7a66, 0xffc629, 0x9be564, 0x2fd0a0];
const SHARE: ShareField[] = ['name', 'company', 'role', 'email'];
const MITEC = { lat: VENUE_DEFAULT.lat, lon: VENUE_DEFAULT.lon, acc: 12 };

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const quiet = async <T,>(f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch { return null; } };

export class DemoSim {
  private nav: NavGrid;
  private bots: Bot[] = [];
  private botIds = new Set<string>();
  private rand = rng(0x5eed);
  private lastTick = 0; private busy = false;
  private every = { hosts: 0, players: 0, venue: 0 };
  private visits = new Map<string, { n: number; at: number }>();
  private byDeck = new Map<number, Booth[]>();

  constructor(private s: Services, private level: LevelData, private version: number) {
    this.nav = new NavGrid(level);
    for (const b of level.booths) { if (b.id === level.hero.id) continue; const l = this.byDeck.get(b.deck) ?? []; l.push(b); this.byDeck.set(b.deck, l); }
  }

  /* ------------------------------------------------------------------ seeding */

  static async isSeeded(s: Services, version: number): Promise<boolean> {
    const row = await s.game.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'demo:version'");
    return Number(row?.value) === version;
  }

  /** Builds a few hours of history. `clock.offset` lets the services believe it is earlier; the caller resets it to 0 afterwards. */
  async seed(clock: { offset: number }): Promise<void> {
    const { game, stations, social, crews, venue, ops } = this.s, r = this.rand, real = Date.now();
    const span = 4.5 * 3600_000; let t = real - span; const at = (ms: number) => { t = ms; clock.offset = t - Date.now(); };
    const pickOf = <T,>(a: T[]) => a[Math.floor(r() * a.length)]!;
    at(t);

    // --- who: exhibitors hosting stations, visitors on the floor, visitors at home, two co-op partners, one account to review
    const hero = this.level.hero, d2 = (this.byDeck.get(2) ?? []).filter((b) => b.name).sort((a, b) => Math.hypot(a.x - hero.x, a.y - hero.y) - Math.hypot(b.x - hero.x, b.y - hero.y));
    const uniqueName = <T extends { name: string }>(list: T[]) => [...new Map(list.map((b) => [b.name.toLowerCase(), b])).values()]; // some exhibitors have two booths
    const named = (deck: number) => (this.byDeck.get(deck) ?? []).filter((b) => b.name).sort((a, b) => a.id.localeCompare(b.id));
    const near2 = uniqueName([1, 3, 7, 12, 18, 28, 40, 55, 75, 95, 115, 140, 160].map((i) => d2[Math.min(i, d2.length - 1)]!)).slice(0, 8); // three by the Launch Pad, the rest across Level 2
    const hostBooths = uniqueName([...near2, ...[6, 45, 80].map((i) => named(1)[i]!).filter(Boolean).slice(0, 2), ...[6, 45, 80].map((i) => named(3)[i]!).filter(Boolean).slice(0, 2)]);
    const plan: { kind: Kind; deck: number; booth?: Booth }[] = [
      ...hostBooths.map((b) => ({ kind: 'host' as const, deck: b.deck, booth: b })),
      ...[2, 2, 2, 2, 2, 2, 2, 1, 1, 3].map((deck) => ({ kind: 'onsite' as const, deck })),
      ...[2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 3, 3].map((deck) => ({ kind: 'remote' as const, deck })),
      { kind: 'gcAstro', deck: 2 }, { kind: 'gcGround', deck: 2 }, { kind: 'suspect', deck: 2 },
    ];
    const roster: RosterEntry[] = [];
    for (const [i, p] of plan.entries()) {
      const id = await game.createGuest(), cls = CLASSES[i % CLASSES.length]!, passport = p.kind !== 'remote' || r() < 0.75;
      await game.suitUp(id, cls); await game.setAvatar(id, this.look(cls));
      const company = p.booth ? p.booth.name : `${COMPANIES[i % COMPANIES.length]} (demo)`;
      if (passport) await game.issuePassport(id, { name: PEOPLE[i % PEOPLE.length]!, company, role: pickOf(ROLES), phone: `+60110000${String(1000 + i)}`, email: `visitor${i + 1}@example.com`, showContact: true, consentMarketing: r() < 0.6, consentNotice: true });
      roster.push({ id, kind: p.kind, deck: p.deck, station: p.booth?.id, hosting: p.booth ? i % 3 !== 2 : undefined, passport });
      at(t + 20_000);
    }
    this.botIds = new Set(roster.map((b) => b.id));

    // --- stations come online; the crew has approved all but one (left pending for the crew console)
    const hosts = roster.filter((b) => b.kind === 'host'), pendingAt = Math.min(7, hosts.length - 1); // the far end of Level 2
    for (const [i, h] of hosts.entries()) {
      const b = game.stations.get(h.station!)!;
      await stations.claim(h.id, { stationId: b.id, company: b.name, offer: OFFERS[i % OFFERS.length]!, link: '', color: COLORS[i % COLORS.length]! });
      if (i !== pendingAt) await stations.crewSetStatus(b.id, 'approved');
      at(t + 30_000);
    }
    const pending = hosts[pendingAt]?.station ?? null;

    // --- three company teams
    const teams: { name: string; code: string }[] = [];
    for (const [i, owner] of hosts.slice(0, 3).entries()) {
      const tv = await ops.createTeam(owner.id, game.stations.get(owner.station!)!.name);
      if (tv.code) teams.push({ name: tv.name, code: tv.code });
      for (const m of roster.filter((b) => b.passport && b.kind !== 'host').slice(i * 4, i * 4 + 3)) await quiet(() => ops.joinTeam(m.id, tv.code));
    }

    // --- a few hours on the floor: stamps (virtual / beacon / host code), card shares, links, sector ticks
    const walkers = roster.filter((b) => b.kind === 'onsite' || b.kind === 'remote' || b.kind === 'suspect'), live = new Map(hosts.map((h) => [h.station!, h]));
    // "Today" boards count from midnight (MYT). Opened in the small hours, most of the history belongs to yesterday —
    // so the last part of it is squeezed into today, however short today is, and the boards are never empty.
    const N = 330, end = real - 60_000, day0 = dayStart(real), spread = (a: number, b: number, k: number) => Array.from({ length: k }, (_, i) => a + ((b - a) * (i + 1)) / k);
    const times = day0 <= t ? spread(t, end, N) : [...spread(t, day0 - 1000, Math.round(N * 0.55)), ...spread(Math.min(day0 + 2000, end), end, N - Math.round(N * 0.55))];
    let lastTickAt = t, n = 0;
    for (const when of times) {
      at(Math.max(when, t + 50)); n++;
      const suspect = walkers.find((w) => w.kind === 'suspect')!; // plays suspiciously often, and sometimes from impossible places
      const bot = n % 7 === 0 ? suspect : walkers[n % walkers.length]!, onsite = bot.kind === 'onsite';
      const b = this.pickBooth(bot.deck, r() < 0.45 ? [...live.keys()] : null), owner = live.get(b.id);
      const holo = await game.hologramOf(bot.id, { x: b.x, y: b.y, h: 0, deck: onsite, sigma: onsite ? 2 : 0 });
      await game.presence.update(holo, t, true);
      if (onsite) await venue.checkIn(bot.id, MITEC);
      const hostHere = owner?.hosting && onsite;
      if (hostHere) await quiet(() => stations.hostCode(owner!.id, b.id));
      await this.rested(bot.id, t);
      const ok = await quiet(async () => game.stamp(bot.id, hostHere ? { stationId: b.id, proof: 'host', code: (await game.hostCode(b.id, Math.floor(t / HOST_WINDOW_MS))).digits } : onsite ? { stationId: b.id, proof: 'beacon', beacon: await game.beaconToken(b.id) } : { stationId: b.id, proof: 'virtual' }));
      if (ok && owner && bot.passport && r() < 0.7) await quiet(() => stations.share(bot.id, b.id, SHARE));
      if (n % 12 === 0) { // two people meet
        const a = pickOf(roster.filter((x) => x.passport)), c = pickOf(roster.filter((x) => x.passport && x.id !== a.id));
        const code = await quiet(() => social.linkCode(a.id)); if (code) await quiet(() => social.link(c.id, code.code, SHARE));
      }
      if (bot.kind === 'suspect' && n % 21 === 0) await ops.speedFlag(bot.id, 'to 188,61 (demo: jumped across the hall)');
      if (t - lastTickAt > 30 * 60_000) { lastTickAt = t; await crews.view(); }
    }

    // --- some visitors already made it real at 8H18B
    for (const b of roster.filter((x) => (x.kind === 'onsite' || x.kind === 'gcAstro') && x.passport).slice(0, 7)) { const me = await game.me(b.id); if (me.ticket) await quiet(() => game.crewDock(me.ticket!.code)); }

    // --- now: today's drop at a hosted station near the Launch Pad, and a fresh Signal Storm
    at(real); clock.offset = 0;
    const dropAt = hosts.find((h) => h.hosting)!.station!;
    await ops.setDrop(dropAt, 'Say hello at the counter', 150);
    await game.db.run('DELETE FROM storms WHERE ends_at > ?', [real - STORM_GAP_MS]);
    const state: DemoState = { version: this.version, crewPin: DEMO_CREW_PIN, teams, pendingStation: pending, hostedNear: hosts.filter((h) => h.hosting).slice(0, 3).map((h) => ({ id: h.station!, name: game.stations.get(h.station!)!.name })), drop: dropAt, bots: roster.length };
    await game.db.batch([
      ['INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['demo:roster', JSON.stringify(roster)]],
      ['INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['demo:state', JSON.stringify(state)]],
      ['INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['demo:version', String(this.version)]],
    ]);
  }

  private look(cls: PlayerClass): AvatarSpec {
    const a = { ...defaultAvatar(cls) };
    for (const s of SLOTS) { if (s === 'carry' && this.rand() < 0.5) continue; const opts = (CATALOG[s] as Option[]).map((o, i) => ({ o, i })).filter((x) => isUnlocked(x.o, 0)); a[s] = opts[Math.floor(this.rand() * opts.length)]!.i; }
    return a;
  }

  private pickBooth(deck: number, prefer: string[] | null): Booth {
    const all = this.byDeck.get(deck) ?? this.byDeck.get(2)!;
    if (prefer) { const here = prefer.map((id) => this.s.game.stations.get(id)!).filter((b) => b && b.deck === deck); if (here.length) return here[Math.floor(this.rand() * here.length)]!; }
    return all[Math.floor(this.rand() * all.length)]!;
  }

  /* ------------------------------------------------------------------ live */

  /** Call after every (re)start of the backend: puts the cast back on the floor. */
  async start(): Promise<void> {
    const row = await this.s.game.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'demo:roster'");
    const roster = row ? (JSON.parse(row.value) as RosterEntry[]) : [];
    this.botIds = new Set(roster.map((b) => b.id));
    this.bots = roster.filter((b) => b.kind !== 'gcGround').map((b) => {
      const home = b.station ? this.s.game.stations.get(b.station)! : this.pickBooth(b.deck, null);
      const pos = this.nav.nearestWalkable(home.x, home.y) ?? { x: home.x, y: home.y };
      return { ...b, pos, h: this.rand() * 6.28, path: [], speed: b.kind === 'remote' || b.kind === 'suspect' ? 3.2 + this.rand() * 1.8 : 1.1 + this.rand() * 0.5, wait: this.rand() * 12, target: null, base: null, baseAt: 0, job: null };
    });
    this.groundBot = roster.find((b) => b.kind === 'gcGround')?.id ?? null;
    this.lastTick = 0;
  }
  private groundBot: string | null = null;

  isBot(id: string) { return this.botIds.has(id); }

  async state(): Promise<DemoState | null> {
    const row = await this.s.game.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'demo:state'");
    return row ? (JSON.parse(row.value) as DemoState) : null;
  }

  /** Advances the world. Safe to call as often as you like; it paces itself and never overlaps. */
  async tick(): Promise<void> {
    const t = this.s.game.now();
    if (this.busy || t - this.lastTick < 900) return;
    const dt = Math.min(5, this.lastTick ? (t - this.lastTick) / 1000 : 1); this.lastTick = t; this.busy = true;
    try {
      if (t - this.every.venue > 15 * 60_000) { this.every.venue = t; for (const b of this.bots) if (this.onsite(b)) await this.s.venue.checkIn(b.id, MITEC); }
      if (t - this.every.hosts > 20_000) { this.every.hosts = t; for (const b of this.bots) if (b.kind === 'host' && b.hosting) await quiet(() => this.s.stations.hostCode(b.id, b.station!)); }
      if (t - this.every.players > 3000) { this.every.players = t; await this.groundControl(t); await this.sendVisitors(t); }
      for (const b of this.bots) await this.step(b, t, dt);
    } catch (e) { console.warn('[demo] tick', e); } finally { this.busy = false; }
  }

  private onsite(b: RosterEntry) { return b.kind === 'host' || b.kind === 'onsite' || b.kind === 'gcAstro'; }

  private async step(b: Bot, t: number, dt: number): Promise<void> {
    if (b.kind !== 'host') {
      if (b.wait > 0) b.wait -= dt;
      else if (!b.path.length) await this.arrive(b, t);
      else this.walk(b, dt);
    } else if (this.rand() < 0.04) b.h += (this.rand() - 0.5) * 1.2;

    if (!b.base || t - b.baseAt > 60_000) { const h = await this.s.game.hologramOf(b.id, { x: 0, y: 0, h: 0, deck: false, sigma: 0 }); b.base = { id: h.id, callsign: h.callsign, cls: h.cls, rank: h.rank, av: h.av }; b.baseAt = t; }
    const deck = this.onsite(b);
    let moved = await this.s.game.presence.update({ ...b.base, x: +b.pos.x.toFixed(2), y: +b.pos.y.toFixed(2), h: +b.h.toFixed(2), deck, sigma: deck ? 2 : 0 }, t, false);
    if (moved == null) { // the server refused an implausible jump: exactly what a teleporting client looks like
      await this.s.ops.speedFlag(b.id, `to ${b.pos.x.toFixed(0)},${b.pos.y.toFixed(0)} (demo: jumped across the hall)`);
      moved = await this.s.game.presence.update({ ...b.base, x: b.pos.x, y: b.pos.y, h: b.h, deck, sigma: 0 }, t, true);
    }
  }

  private walk(b: Bot, dt: number) {
    let left = b.speed * dt;
    while (left > 0 && b.path.length) {
      const n = b.path[0]!, dx = n.x - b.pos.x, dy = n.y - b.pos.y, l = Math.hypot(dx, dy);
      if (l > 0.01) b.h = Math.atan2(dx, -dy);
      if (l <= left) { b.pos = { x: n.x, y: n.y }; b.path.shift(); left -= l; } else { b.pos = { x: b.pos.x + (dx / l) * left, y: b.pos.y + (dy / l) * left }; left = 0; }
    }
  }

  private route(b: Bot, to: P2, teleportIfBlocked = true): boolean {
    const p = this.nav.path(b.pos, to);
    if (p && p.length > 1) { b.path = p.slice(1); return true; }
    if (teleportIfBlocked) { // another deck: take the lift
      b.pos = this.nav.nearestWalkable(to.x, to.y) ?? to; b.path = [];
      if (b.base) void this.s.game.presence.update({ ...b.base, x: b.pos.x, y: b.pos.y, h: b.h, deck: this.onsite(b), sigma: 0 }, this.s.game.now(), true);
    }
    return false;
  }

  /** Reached the end of a path (or has none yet): do what the bot came for, then choose where to go next. */
  private async arrive(b: Bot, t: number): Promise<void> {
    const { game, stations } = this.s;
    if (b.job?.type === 'gc') return; // Ground Control runs are steered from groundControl()
    if (b.target && Math.hypot(b.target.x - b.pos.x, b.target.y - b.pos.y) < 5) {
      const booth = b.target, visit = b.job?.type === 'visit' && b.job.station === booth.id;
      const st = (await stations.list()).find((s) => s.id === booth.id);
      if (visit) await this.rested(b.id, t);
      if (visit || (b.kind !== 'gcAstro' && this.rand() < 0.65)) {
        const host = st?.hosted && this.onsite(b);
        const ok = await quiet(async () => game.stamp(b.id, host ? { stationId: booth.id, proof: 'host', code: (await game.hostCode(booth.id, Math.floor(t / HOST_WINDOW_MS))).digits } : this.onsite(b) ? { stationId: booth.id, proof: 'beacon', beacon: await game.beaconToken(booth.id) } : { stationId: booth.id, proof: 'virtual' }));
        if (ok && st && b.passport && (visit || this.rand() < 0.5)) await quiet(() => stations.share(b.id, booth.id, SHARE));
      }
      if (visit) b.job = null;
      b.target = null; b.wait = 4 + this.rand() * 10;
      return;
    }
    if (b.kind === 'suspect' && this.rand() < 0.25) { const far = this.pickBooth(b.deck, null); b.pos = this.nav.nearestWalkable(far.x, far.y) ?? b.pos; b.wait = 3; return; } // "teleports": refused by the server and flagged
    const live = (await stations.list()).map((s) => s.id);
    b.target = b.job?.type === 'visit' ? game.stations.get(b.job.station)! : this.pickBooth(b.deck, this.rand() < 0.5 ? live : null);
    if (!this.route(b, b.target, b.job != null)) { if (!b.job) { b.target = null; b.wait = 2; } }
  }

  /* ---- things a single visitor cannot do alone ---- */

  private async humans(): Promise<string[]> {
    return (await this.s.game.db.all<{ id: string }>('SELECT id FROM players WHERE cls IS NOT NULL ORDER BY last_seen DESC LIMIT 200')).map((p) => p.id).filter((id) => !this.botIds.has(id));
  }

  /** A station hosted by a real person gets real-looking footfall: someone walks up, scans the host code and shares a card. */
  private async sendVisitors(t: number): Promise<void> {
    const humans = await this.humans(); if (!humans.length) return;
    const mine = await this.s.game.db.all<{ station_id: string; host_seen_at: number | null }>(`SELECT station_id, host_seen_at FROM stations WHERE status != 'revoked' AND owner_id IN (${humans.map(() => '?').join(',')})`, humans);
    for (const st of mine) {
      const v = this.visits.get(st.station_id) ?? { n: 0, at: 0 }, hosted = st.host_seen_at != null && t - st.host_seen_at < 60_000;
      if (v.n >= 10 || t - v.at < (hosted ? 25_000 : 70_000) || this.bots.some((b) => b.job?.type === 'visit' && b.job.station === st.station_id)) continue;
      const bot = await this.freshVisitor(st.station_id, hosted); if (!bot) continue;
      this.visits.set(st.station_id, { n: v.n + 1, at: t });
      bot.job = { type: 'visit', station: st.station_id }; bot.path = []; bot.target = null; bot.wait = 0;
    }
  }

  private async freshVisitor(stationId: string, preferOnsite: boolean): Promise<Bot | null> {
    const booth = this.s.game.stations.get(stationId); if (!booth) return null;
    const seen = new Set((await this.s.game.db.all<{ player_id: string }>('SELECT player_id FROM stamps WHERE station_id = ?', [stationId])).map((r) => r.player_id));
    const pool = this.bots.filter((b) => (b.kind === 'onsite' || b.kind === 'remote') && b.passport && !b.job && !seen.has(b.id));
    const d = (b: Bot) => (b.deck === booth.deck ? 0 : 1000) + Math.hypot(b.pos.x - booth.x, b.pos.y - booth.y) + (preferOnsite === (b.kind === 'onsite') ? 0 : 400);
    return pool.sort((a, b) => d(a) - d(b))[0] ?? null;
  }

  /** The 45 s scanner cooldown is for people; a cast member on an errand should not fail because of it. */
  private rested(botId: string, t: number) { return this.s.game.db.run('UPDATE stamps SET created_at = created_at - 60000 WHERE player_id = ? AND created_at > ?', [botId, t - 60_000]); }

  /** "Send a visitor now": no walking, the card arrives straight away. */
  async visitNow(playerId: string): Promise<{ station: string; name: string } | null> {
    const { game, stations } = this.s, t = game.now();
    const st = await game.db.get<{ station_id: string }>("SELECT station_id FROM stations WHERE owner_id = ? AND status != 'revoked' ORDER BY claimed_at DESC LIMIT 1", [playerId]); if (!st) return null;
    const bot = await this.freshVisitor(st.station_id, true); if (!bot) return null;
    const booth = game.stations.get(st.station_id)!; bot.pos = this.nav.nearestWalkable(booth.x, booth.y) ?? booth; bot.path = []; bot.wait = 8; bot.deck = booth.deck;
    if (bot.base) await game.presence.update({ ...bot.base, x: bot.pos.x, y: bot.pos.y, h: bot.h, deck: this.onsite(bot), sigma: 0 }, t, true);
    await this.rested(bot.id, t);
    await stations.hostCode(playerId, st.station_id);
    if (this.onsite(bot)) await this.s.venue.checkIn(bot.id, MITEC);
    await game.stamp(bot.id, this.onsite(bot) ? { stationId: booth.id, proof: 'host', code: (await game.hostCode(booth.id, Math.floor(t / HOST_WINDOW_MS))).digits } : { stationId: booth.id, proof: 'virtual' });
    await stations.share(bot.id, booth.id, SHARE);
    return { station: booth.id, name: (await game.passportOf(bot.id))?.name ?? 'A visitor' };
  }

  /** Ground Control needs two people. Whoever is waiting in the queue gets a partner from the cast, who then plays their part. */
  private async groundControl(t: number): Promise<void> {
    const { game, gc, venue } = this.s, astro = this.bots.find((b) => b.kind === 'gcAstro');
    for (const q of await game.db.all<{ player_id: string; role: string; queued_at: number }>('SELECT player_id, role, queued_at FROM gc_queue')) {
      if (this.botIds.has(q.player_id) || t - q.queued_at < 4000) continue;
      if (q.role === 'ground' && astro) { await venue.checkIn(astro.id, MITEC); await quiet(() => gc.join(astro.id)); }
      else if (q.role === 'astro' && this.groundBot) await quiet(() => gc.join(this.groundBot!));
    }
    const runs = await game.db.all<{ id: string; ground_id: string; astro_id: string; station_id: string; waypoints: string; expires_at: number }>("SELECT id, ground_id, astro_id, station_id, waypoints, expires_at FROM gc_sessions WHERE state = 'active' AND expires_at > ?", [t]);
    if (astro && astro.job?.type === 'gc' && !runs.some((r) => r.astro_id === astro.id)) { astro.job = null; astro.path = []; astro.wait = 5; }
    for (const run of runs) {
      const target = game.stations.get(run.station_id)!, marks = JSON.parse(run.waypoints) as P2[], last = marks.at(-1);
      if (astro && run.astro_id === astro.id) { // the cast flies; the person steers with markers
        const closeEnough = !!last && Math.hypot(last.x - target.x, last.y - target.y) < 14, goal = closeEnough ? target : last, key = goal ? `${goal.x},${goal.y}` : '';
        if (goal && (astro.job?.type !== 'gc' || astro.job.goalKey !== key)) { astro.job = { type: 'gc', goalKey: key }; astro.wait = 0; astro.speed = 2.4; this.route(astro, goal); }
        if (closeEnough && !astro.path.length && Math.hypot(astro.pos.x - target.x, astro.pos.y - target.y) < 6) {
          const owner = await game.db.get<{ owner_id: string }>('SELECT owner_id FROM stations WHERE station_id = ?', [target.id]);
          if (owner) await quiet(() => this.s.stations.hostCode(owner.owner_id, target.id));
          await this.rested(astro.id, t);
          await quiet(async () => game.stamp(astro.id, { stationId: target.id, proof: 'host', code: (await game.hostCode(target.id, Math.floor(t / HOST_WINDOW_MS))).digits }));
          // keep the demo repeatable: the cast member forgets this station, so it can be a target again
          await game.db.batch([['DELETE FROM stamps WHERE player_id = ? AND station_id = ?', [astro.id, target.id]], ['DELETE FROM verified_contacts WHERE player_id = ? AND station_id = ?', [astro.id, target.id]]]);
          astro.job = null; astro.speed = 1.3; astro.wait = 6;
        }
      } else if (run.ground_id === this.groundBot) { // the person flies; the cast drops markers a stretch ahead of them
        const at = await game.presence.position(run.astro_id, t); if (!at) continue;
        const path = this.nav.path(at, target); let mark: P2 = target;
        if (path) { let left = 32; for (let i = 1; i < path.length && left > 0; i++) { const a = path[i - 1]!, b = path[i]!, l = Math.hypot(b.x - a.x, b.y - a.y); mark = l <= left ? b : { x: a.x + ((b.x - a.x) * left) / l, y: a.y + ((b.y - a.y) * left) / l }; left -= l; } }
        if (!last || Math.hypot(last.x - mark.x, last.y - mark.y) > 9) await quiet(() => gc.waypoint(this.groundBot!, mark.x, mark.y));
      }
    }
  }

  /* ---- helpers the Demo tour calls for the player ---- */

  private async partner(playerId: string): Promise<string | null> {
    const linked = new Set((await this.s.game.db.all<{ a_id: string; b_id: string }>('SELECT a_id, b_id FROM links WHERE a_id = ? OR b_id = ?', [playerId, playerId])).flatMap((l) => [l.a_id, l.b_id]));
    return [...this.bots].sort((a, b) => Number(this.onsite(b)) - Number(this.onsite(a))).find((b) => b.passport && b.kind !== 'host' && !linked.has(b.id))?.id ?? null;
  }
  /** Someone shows you their Link code. */
  async partnerCode(playerId: string): Promise<{ code: string; callsign: string } | null> {
    const id = await this.partner(playerId); if (!id) return null;
    return { code: (await this.s.social.linkCode(id)).code, callsign: (await this.s.game.player(id)).callsign };
  }
  /** Someone scans the Link code you are showing. */
  async partnerScan(playerId: string): Promise<{ callsign: string } | null> {
    const t = this.s.game.now(), mine = await this.s.game.db.get<{ code: string }>('SELECT code FROM link_codes WHERE player_id = ? AND expires_at > ?', [playerId, t]), id = await this.partner(playerId);
    if (!mine || !id) return null;
    await this.s.social.link(id, mine.code, SHARE);
    return { callsign: (await this.s.game.player(id)).callsign };
  }
  /** What the host's screen shows right now at a station, and the link its printed beacon carries. */
  async hint(stationId: string): Promise<{ claimed: boolean; hosted: boolean; digits: string | null; expiresInMs: number; beacon: string } | null> {
    const { game, stations } = this.s, b = game.stations.get(stationId); if (!b) return null;
    const t = game.now(), st = (await stations.list()).find((s) => s.id === b.id), w = Math.floor(t / HOST_WINDOW_MS);
    return { claimed: !!st, hosted: !!st?.hosted, digits: st ? (await game.hostCode(b.id, w)).digits : null, expiresInMs: (w + 1) * HOST_WINDOW_MS - t, beacon: await game.beaconToken(b.id) };
  }
  async dock(playerId: string): Promise<boolean> { const me = await this.s.game.me(playerId); if (!me.ticket) return false; await this.s.game.crewDock(me.ticket.code); return true; }
  async boost(playerId: string, xp: number): Promise<void> { const g = this.s.game; await g.db.batch(g.award(playerId, 'demo_boost', Math.max(100, Math.min(5000, Math.round(xp))), null, { demo: true }, g.now())); }
}
