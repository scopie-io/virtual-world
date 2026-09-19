import type { Db, Stmt } from './db/types.js';
import type { Signer } from './crypto.js';
import { shortCode } from './crypto.js';
import type { Presence } from './presence.js';
import type { CrewTicketView, Hologram, LevelData, Me, PassportInput, PresencePing, StampRequest, XpEvent } from '../shared/types.js';
import {
  DEFAULT_SHARE, EXPLORE_XP, FEATURES, POSES, HOST_GRACE_WINDOWS, HOST_WINDOW_MS, INFLUENCE, INFLUENCE_PRESENCE, NAME_ON_BOARD, POINTS, PRIZE_CODE_TTL_MS, REMOTE_SHARE, ROLES, ROLE_INFO,
  SHARE_FIELDS, STAMP_MIN_INTERVAL_MS, STAMP_RADIUS_M, stampPoints, type Features, type Presence as Presence2, type Role, type ShareField,
} from '../shared/rules.js';
import { decodeAvatar, defaultAvatar, encodeAvatar, validateAvatar, type AvatarSpec } from '../shared/avatar.js';

export class GameError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export interface StampOutcome { id: string; cls: string | null; station: LevelData['booths'][number]; presence: Presence2; newStamp: boolean; newVerified: boolean; t: number }
/** Other systems plug in here so Game stays the single writer of stamps and XP. All optional. */
export interface GameHooks {
  isOnsite?(id: string, t: number): Promise<boolean>;
  isHidden?(id: string): Promise<boolean>;
  hiddenSet?(): ReadonlySet<string>;
  anchorOf?(id: string): Promise<{ stationId: string; at: number } | null>;
  onOnsiteProof?(id: string, stationId: string, t: number): Promise<void>;
  stampMult?(stationId: string, t: number): Promise<number>;
  afterStamp?(o: StampOutcome): Promise<XpEvent[]>;
  afterPing?(o: { id: string; x: number; y: number; deck: boolean; movedM: number; steps: number; t: number }): Promise<XpEvent[]>;
  onImplausible?(id: string, detail: string): Promise<void>;
}

export interface PlayerRow { id: string; callsign: string; cls: string | null; xp: number; docked_at: number | null }
export interface PassportRow { slug: string; name: string; company: string; role: string; phone: string; email: string; show_contact: number }

const digits = (n: number) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');

const MYT_OFFSET_MS = 8 * 3600 * 1000;
export const dayOf = (t: number) => Math.floor((t + MYT_OFFSET_MS) / 86_400_000);
export const dayStart = (t: number) => dayOf(t) * 86_400_000 - MYT_OFFSET_MS;
export const cleanText = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
export const cleanFields = (input: unknown): ShareField[] => {
  const set = new Set<ShareField>(['name']);
  if (Array.isArray(input)) for (const f of input) if ((SHARE_FIELDS as readonly string[]).includes(f)) set.add(f as ShareField);
  return SHARE_FIELDS.filter((f) => set.has(f));
};

export class Game {
  readonly stations: Map<string, LevelData['booths'][number]>;
  /** Per-player caches so presence pings do not hit the DB. */
  private seenHalls = new Map<string, Set<number>>();
  private seenLandmarks = new Map<string, Set<string>>();
  /** Short-lived: on serverless another instance may have saved a new look. */
  private avatarCode = new Map<string, { code: string; at: number }>();
  hooks: GameHooks = {};

  constructor(
    readonly db: Db,
    readonly signer: Signer,
    readonly presence: Presence,
    readonly level: LevelData,
    readonly publicOrigin: string,
    readonly now: () => number = Date.now,
    /** Which of the switched-off systems run. The simple game runs none of them. */
    readonly features: Features = FEATURES,
  ) {
    this.stations = new Map(level.booths.map((b) => [b.id, b]));
  }

  /* ---------------- players ---------------- */

  /** Until they have a card a player is "Visitor 4821"; with one, "Aisyah R." (NAME_ON_BOARD). Names are unique. */
  private async rename(id: string, base: string, numbered: boolean): Promise<void> {
    for (let i = 0; i < 12; i++) {
      const name = numbered ? `${base} ${digits(i < 8 ? 4 : 7)}` : i === 0 ? base : `${base} ${i + 1}`;
      try { await this.db.run('UPDATE players SET callsign = ? WHERE id = ?', [name, id]); return; } catch { /* taken — try the next */ }
    }
  }

  async createGuest(): Promise<string> {
    const id = crypto.randomUUID();
    const t = this.now();
    for (let i = 0; i < 8; i++) {
      try {
        await this.db.run('INSERT INTO players (id, callsign, created_at, last_seen) VALUES (?,?,?,?)', [id, `Guest ${digits(7)}`, t, t]);
        return id;
      } catch { /* name collision — try again */ }
    }
    throw new GameError('callsign', 'Could not start a new player', 500);
  }

  async exists(id: string): Promise<boolean> {
    return !!(await this.db.get('SELECT 1 AS x FROM players WHERE id = ?', [id]));
  }

  async player(id: string): Promise<PlayerRow> {
    const p = await this.db.get<PlayerRow>('SELECT id, callsign, cls, xp, docked_at FROM players WHERE id = ?', [id]);
    if (!p) throw new GameError('no_player', 'Unknown player', 401);
    return p;
  }

  passportOf(id: string) {
    return this.db.get<PassportRow>('SELECT slug, name, company, role, phone, email, show_contact FROM passports WHERE player_id = ?', [id]);
  }

  async requirePassport(id: string): Promise<PassportRow> {
    const p = await this.passportOf(id);
    if (!p) throw new GameError('need_passport', 'Get your digital business card first — it is free at the X, Booth 8H18B', 403);
    return p;
  }

  async avatarOf(id: string, cls: string | null): Promise<AvatarSpec> {
    const row = await this.db.get<{ spec: string }>('SELECT spec FROM avatars WHERE player_id = ?', [id]);
    return decodeAvatar(row?.spec) ?? defaultAvatar(cls as Role | null);
  }

  async sharePrefs(id: string): Promise<ShareField[]> {
    const row = await this.db.get<{ fields: string }>('SELECT fields FROM share_prefs WHERE player_id = ?', [id]);
    return row ? cleanFields(row.fields.split(',')) : DEFAULT_SHARE;
  }

  async me(id: string): Promise<Me> {
    const p = await this.player(id);
    const [stamps, pass, ticket, avatar, sharePrefs, links, shared, verified, hosting] = await Promise.all([
      this.db.all<{ station_id: string }>('SELECT station_id FROM stamps WHERE player_id = ?', [id]),
      this.passportOf(id),
      this.db.get<{ id: string; code: string; redeemed_at: number | null }>('SELECT id, code, redeemed_at FROM tickets WHERE player_id = ?', [id]),
      this.avatarOf(id, p.cls),
      this.sharePrefs(id),
      this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM links WHERE a_id = ? OR b_id = ?', [id, id]),
      this.db.all<{ to_station: string }>('SELECT to_station FROM card_shares WHERE from_player = ? AND to_station IS NOT NULL AND revoked_at IS NULL', [id]),
      this.db.all<{ station_id: string }>('SELECT station_id FROM verified_contacts WHERE player_id = ?', [id]),
      this.db.all<{ station_id: string }>("SELECT station_id FROM stations WHERE owner_id = ? AND status != 'revoked'", [id]),
    ]);
    const docked = p.docked_at != null;
    const t = this.now(), anchor = (await this.hooks.anchorOf?.(id)) ?? null;
    return {
      onsite: (await this.hooks.isOnsite?.(id, t)) ?? false,
      hidden: (await this.hooks.isHidden?.(id)) ?? false,
      anchor,
      id: p.id.slice(0, 8),
      callsign: p.callsign,
      cls: (p.cls as Role | null) ?? null,
      xp: p.xp,
      stamps: stamps.map((s) => s.station_id),
      passport: pass ? { slug: pass.slug, name: pass.name, company: pass.company, role: pass.role, url: `${this.publicOrigin}/p/${pass.slug}` } : null,
      docked,
      ticket: ticket && !ticket.redeemed_at ? { token: await this.signer.sign(`t:${ticket.id}`), code: ticket.code } : null,
      avatar,
      sharePrefs,
      links: links?.n ?? 0,
      shared: shared.map((s) => s.to_station),
      verified: verified.map((s) => s.station_id),
      hosting: hosting.map((s) => s.station_id),
    };
  }

  /** Ledger row + cache update, to be committed inside the caller's batch. */
  award(id: string, action: string, xp: number, target: string | null, detail: object | null, t: number): Stmt[] {
    return [
      ['INSERT INTO xp_ledger (player_id, action, target, xp, detail, created_at) VALUES (?,?,?,?,?,?)', [id, action, target, xp, detail ? JSON.stringify(detail) : null, t]],
      ['UPDATE players SET xp = xp + ?, last_seen = ? WHERE id = ?', [xp, t, id]],
    ];
  }

  /** Sector control (switched off in the simple game). hall 0 = not tied to a sector. */
  influence(id: string, cls: string | null, hall: number, weight: number, t: number): Stmt[] {
    return this.features.sectors && cls ? [['INSERT INTO influence_events (crew, hall, weight, player_id, created_at) VALUES (?,?,?,?,?)', [cls, hall, weight, id, t]]] : [];
  }

  /** "I'm visiting" / "I'm exhibiting". Free to change; it decides the colour you wear and which journey you are shown. */
  async start(id: string, role: string): Promise<void> {
    if (!ROLES.includes(role as Role)) throw new GameError('bad_role', 'Choose visitor or exhibitor');
    const p = await this.player(id);
    await this.db.run('UPDATE players SET cls = ?, last_seen = ? WHERE id = ?', [role, this.now(), id]);
    if (!(NAME_ON_BOARD && (await this.passportOf(id))) && !p.callsign.startsWith(ROLE_INFO[role as Role].label)) await this.rename(id, ROLE_INFO[role as Role].label, true);
    this.avatarCode.delete(id);
  }

  async setAvatar(id: string, input: unknown): Promise<void> {
    if (!this.features.avatars) throw new GameError('off', 'Everyone wears the same suit in this game', 404);
    const spec = validateAvatar(input);
    if (!spec) throw new GameError('bad_avatar', 'That look is not available yet');
    const code = encodeAvatar(spec);
    this.avatarCode.delete(id);
    await this.db.run('INSERT INTO avatars (player_id, spec, updated_at) VALUES (?,?,?) ON CONFLICT(player_id) DO UPDATE SET spec = excluded.spec, updated_at = excluded.updated_at', [id, code, this.now()]);
    this.avatarCode.set(id, { code, at: this.now() });
  }

  /* ---------------- presence ---------------- */

  hallAt(x: number, y: number): number | null {
    return this.level.halls.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1)?.id ?? null;
  }

  /** What other players are told about this one. */
  async hologramOf(id: string, at: { x: number; y: number; h: number; deck: boolean; sigma: number; pose?: Hologram['pose'] }): Promise<Hologram> {
    const p = await this.player(id);
    let av = this.avatarCode.get(id);
    if (!av || this.now() - av.at > 30_000) { av = { code: encodeAvatar(await this.avatarOf(id, p.cls)), at: this.now() }; this.avatarCode.set(id, av); }
    return { id, callsign: p.callsign, cls: p.cls as Role | null, av: av.code, ...at };
  }

  /** deck = "my avatar is following my real steps". Only honoured for players who are verifiably on site. */
  async ping(id: string, pos: PresencePing, isSpawn: boolean): Promise<{ holograms: Hologram[]; events: XpEvent[]; online: number; deck: boolean }> {
    if (![pos.x, pos.y, pos.h].every(Number.isFinite)) throw new GameError('bad_pos', 'Bad position');
    if (isSpawn && ![...Object.values(this.level.spawns), ...this.level.lifts].some((s) => Math.hypot(s.x - pos.x, s.y - pos.y) < 4)) isSpawn = false;
    const t = this.now();
    const deck = pos.deck === true && ((await this.hooks.isOnsite?.(id, t)) ?? false);
    const sigma = deck && Number.isFinite(pos.sigma) ? Math.min(50, Math.max(1, pos.sigma!)) : 0;
    const pose = (POSES as readonly string[]).includes(pos.pose ?? '') ? pos.pose : '';
    const moved = await this.presence.update(await this.hologramOf(id, { x: pos.x, y: pos.y, h: pos.h, deck, sigma, pose }), t, isSpawn);
    const events: XpEvent[] = [];
    if (moved != null) {
      events.push(...(await this.discover(id, pos.x, pos.y, t, deck ? 'onsite' : 'remote')));
      events.push(...((await this.hooks.afterPing?.({ id, x: pos.x, y: pos.y, deck, movedM: moved, steps: deck && Number.isFinite(pos.steps) ? pos.steps! : 0, t })) ?? []));
    } else await this.hooks.onImplausible?.(id, `to ${pos.x.toFixed(0)},${pos.y.toFixed(0)}${deck ? ' on deck' : ''}`);
    return { holograms: await this.presence.near(id, pos.x, pos.y, t, this.hooks.hiddenSet?.() ?? new Set()), events, online: await this.presence.online(t), deck };
  }

  /** Switched off in the simple game: first entry to a hall, and daily landmark check-ins, discovered from movement. */
  private async discover(id: string, x: number, y: number, t: number, presence: Presence2): Promise<XpEvent[]> {
    if (!this.features.explore) return [];
    const events: XpEvent[] = [];
    const stmts: Stmt[] = [];
    const mult = presence === 'onsite' ? 1 : REMOTE_SHARE;

    let halls = this.seenHalls.get(id);
    if (!halls) {
      halls = new Set((await this.db.all<{ hall: number }>('SELECT hall FROM halls_seen WHERE player_id = ?', [id])).map((h) => h.hall));
      this.seenHalls.set(id, halls);
    }
    const hall = this.hallAt(x, y);
    if (hall != null && !halls.has(hall)) {
      halls.add(hall);
      if (await this.db.get('SELECT 1 AS x FROM halls_seen WHERE player_id = ? AND hall = ?', [id, hall])) return this.discoverLandmarks(id, x, y, t, presence, events, stmts);
      const xp = Math.round(EXPLORE_XP.hall_first * mult);
      stmts.push(['INSERT OR IGNORE INTO halls_seen (player_id, hall, created_at) VALUES (?,?,?)', [id, hall, t]], ...this.award(id, 'hall_first', xp, String(hall), { presence }, t));
      events.push({ action: 'hall_first', xp, target: `Hall ${hall}` });
    }

    return this.discoverLandmarks(id, x, y, t, presence, events, stmts);
  }

  private async discoverLandmarks(id: string, x: number, y: number, t: number, presence: Presence2, events: XpEvent[], stmts: Stmt[]): Promise<XpEvent[]> {
    const mult = presence === 'onsite' ? 1 : REMOTE_SHARE;
    const day = dayOf(t);
    let marks = this.seenLandmarks.get(id);
    if (!marks) {
      marks = new Set((await this.db.all<{ area_id: string }>('SELECT area_id FROM landmarks_seen WHERE player_id = ? AND day = ?', [id, day])).map((m) => `${day}:${m.area_id}`));
      this.seenLandmarks.set(id, marks);
    }
    for (const a of this.level.areas) {
      const dx = Math.max(a.x0 - x, 0, x - a.x1), dy = Math.max(a.y0 - y, 0, y - a.y1);
      if (Math.hypot(dx, dy) > 2.5 || marks.has(`${day}:${a.id}`)) continue;
      marks.add(`${day}:${a.id}`);
      if (await this.db.get('SELECT 1 AS x FROM landmarks_seen WHERE player_id = ? AND area_id = ? AND day = ?', [id, a.id, day])) continue;
      const xp = Math.max(1, Math.round(EXPLORE_XP.landmark * mult));
      stmts.push(['INSERT OR IGNORE INTO landmarks_seen (player_id, area_id, day, created_at) VALUES (?,?,?,?)', [id, a.id, day, t]], ...this.award(id, 'landmark', xp, a.id, { presence }, t));
      events.push({ action: 'landmark', xp, target: a.name });
    }
    if (stmts.length) await this.db.batch(stmts);
    return events;
  }

  /* ---------------- stamps ---------------- */

  async beaconToken(stationId: string): Promise<string> {
    return `${stationId}.${await this.signer.mac(`b:${stationId}`, 12)}`;
  }

  /** The exhibitor's live booth QR for one time window: a URL token and six digits for typing. */
  async hostCode(stationId: string, window: number): Promise<{ token: string; digits: string }> {
    const mac = await this.signer.mac(`h:${stationId}:${window}`, 16);
    let n = 0;
    for (let i = 0; i < 6; i++) n = (n * 64 + mac.charCodeAt(i)) % 1_000_000;
    return { token: `${stationId}.${window}.${mac}`, digits: String(n).padStart(6, '0') };
  }

  private async hostCodeValid(stationId: string, code: string | undefined, t: number): Promise<boolean> {
    if (!code) return false;
    const w = Math.floor(t / HOST_WINDOW_MS);
    for (let i = 0; i <= HOST_GRACE_WINDOWS; i++) {
      const c = await this.hostCode(stationId, w - i);
      if (code === c.token || code === c.digits) return true;
    }
    return false;
  }

  async stamp(id: string, req: StampRequest): Promise<XpEvent[]> {
    const station = this.stations.get(req.stationId);
    if (!station) throw new GameError('no_station', 'Unknown booth');
    const t = this.now();
    const p = await this.player(id);

    let presence: Presence2;
    if (req.proof === 'beacon') {
      if (req.beacon !== (await this.beaconToken(station.id))) throw new GameError('bad_beacon', 'That is not a Mission X booth QR');
      // A printed code can be photographed and passed around, so it only counts as being there with a good venue check.
      presence = ((await this.hooks.isOnsite?.(id, t)) ?? false) ? 'onsite' : 'remote';
    } else if (req.proof === 'host') {
      const claim = await this.db.get<{ owner_id: string; status: string }>('SELECT owner_id, status FROM stations WHERE station_id = ?', [station.id]);
      if (!claim || claim.status === 'revoked') throw new GameError('not_hosted', 'This booth is not online yet');
      if (claim.owner_id === id) throw new GameError('own_station', 'This is your own booth — the QR is for your visitors');
      if (!(await this.hostCodeValid(station.id, req.code, t))) throw new GameError('bad_code', 'That code has expired — scan the booth QR again');
      presence = 'onsite';
    } else if (req.proof === 'virtual') {
      const pos = await this.presence.position(id, t);
      if (!pos || Math.hypot(pos.x - station.x, pos.y - station.y) > STAMP_RADIUS_M) throw new GameError('too_far', 'Walk up to the booth first');
      presence = 'remote';
    } else {
      throw new GameError('bad_proof', 'Unknown proof');
    }

    const events: XpEvent[] = [];
    const stmts: Stmt[] = [];
    const label = station.name || `Booth ${station.id}`;
    const geofence = presence === 'onsite' ? (((await this.hooks.isOnsite?.(id, t)) ?? false) ? 'ok' : 'unchecked') : undefined;
    let newVerified = false;
    const already = !!(await this.db.get('SELECT 1 AS x FROM stamps WHERE player_id = ? AND station_id = ?', [id, station.id]));

    if (already && req.proof !== 'host') throw new GameError('dup', 'You already have this stamp');
    if (!already) {
      const last = await this.db.get<{ t: number | null }>('SELECT MAX(created_at) AS t FROM stamps WHERE player_id = ?', [id]);
      const wait = (last?.t ?? 0) + STAMP_MIN_INTERVAL_MS - t;
      if (wait > 0) throw new GameError('cooldown', `One moment — ${Math.ceil(wait / 1000)} s`, 429);

      const storm = (await this.hooks.stampMult?.(station.id, t)) ?? 1;
      const xp = stampPoints(presence) * storm;
      const detail = { presence, proof: req.proof, geofence, storm: storm > 1 ? storm : undefined };
      stmts.push(
        ['INSERT INTO stamps (player_id, station_id, hall, proof, created_at) VALUES (?,?,?,?,?)', [id, station.id, station.hall, req.proof, t]],
        ...this.award(id, 'stamp', xp, station.id, detail, t),
        ...this.influence(id, p.cls, station.hall, INFLUENCE.stamp * INFLUENCE_PRESENCE[presence], t),
      );
      events.push({ action: presence === 'onsite' ? 'scan' : 'stamp', xp, target: label, note: storm > 1 ? 'Signal Storm ×' + storm : presence === 'remote' && req.proof === 'beacon' ? `Allow location while you are at MIHAS and a booth QR scores ${POINTS.scan}` : undefined });
    }

    // Scanning the exhibitor's live QR proves a real visit: "met in person", once per booth. It marks the lead for the exhibitor; the points are in the scan.
    if (req.proof === 'host') {
      const had = await this.db.get('SELECT 1 AS x FROM verified_contacts WHERE player_id = ? AND station_id = ?', [id, station.id]);
      if (had && already) throw new GameError('dup', 'You have already scanned this booth');
      if (!had) {
        stmts.push(
          ['INSERT INTO verified_contacts (player_id, station_id, created_at) VALUES (?,?,?)', [id, station.id, t]],
          ...this.influence(id, p.cls, station.hall, INFLUENCE.verified_contact, t),
        );
        events.push({ action: 'verified_contact', xp: 0, target: label });
        newVerified = true;
      }
    }
    await this.db.batch(stmts);
    if (presence === 'onsite') await this.hooks.onOnsiteProof?.(id, station.id, t);
    events.push(...((await this.hooks.afterStamp?.({ id, cls: p.cls, station, presence, newStamp: !already, newVerified, t })) ?? []));
    return events;
  }

  /* ---------------- passport + golden ticket ---------------- */

  async issuePassport(id: string, input: PassportInput): Promise<XpEvent[]> {
    const name = cleanText(input.name, 80), company = cleanText(input.company, 100), role = cleanText(input.role, 80);
    const email = cleanText(input.email, 120).toLowerCase(), phone = cleanText(input.phone, 24).replace(/[^\d+]/g, '');
    if (name.length < 2) throw new GameError('name', 'Please enter your name');
    if (company.length < 2) throw new GameError('company', 'Please enter your company');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new GameError('email', 'That email does not look right');
    if (!/^\+?\d{8,15}$/.test(phone)) throw new GameError('phone', 'Enter a phone number with 8–15 digits');
    if (input.consentNotice !== true) throw new GameError('consent', 'Please accept the privacy notice to continue');
    if (await this.passportOf(id)) throw new GameError('dup', 'You already have your card');

    const t = this.now();
    const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'crew';
    const slug = `${base}-${shortCode(4).toLowerCase()}`;
    await this.db.batch([
      ['INSERT INTO passports (player_id, slug, name, company, role, phone, email, show_contact, consent_notice, consent_marketing, consent_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, slug, name, company, role, phone, email, input.showContact ? 1 : 0, 1, input.consentMarketing ? 1 : 0, t, t]],
      ['INSERT INTO tickets (id, player_id, code, created_at) VALUES (?,?,?,?)', [crypto.randomUUID(), id, shortCode(6), t]],
      ...this.award(id, 'passport', POINTS.card, slug, null, t),
    ]);
    if (NAME_ON_BOARD) { // from now on they are a person, not a number: "Aisyah R."
      const parts = name.split(/\s+/).filter(Boolean), last = parts.length > 1 ? ` ${parts[parts.length - 1]![0]!.toUpperCase()}.` : '';
      await this.rename(id, `${parts[0]!.slice(0, 16)}${last}`, false);
      this.avatarCode.delete(id);
    }
    return [{ action: 'passport', xp: POINTS.card }];
  }

  async publicPassport(slug: string): Promise<(PassportRow & { callsign: string }) | null> {
    const row = await this.db.get<PassportRow & { callsign: string; xp: number; docked_at: number | null }>(
      'SELECT p.slug, p.name, p.company, p.role, p.phone, p.email, p.show_contact, pl.callsign, pl.xp, pl.docked_at FROM passports p JOIN players pl ON pl.id = p.player_id WHERE p.slug = ?', [slug]);
    if (!row) return null;
    const show = row.show_contact === 1;
    return { ...row, phone: show ? row.phone : '', email: show ? row.email : '' };
  }

  /* ---------------- crew (staff) ---------------- */

  private async resolveTicket(tokenOrCode: string) {
    let row: { id: string; player_id: string; created_at: number; redeemed_at: number | null } | undefined;
    const payload = await this.signer.verify(tokenOrCode);
    if (payload?.startsWith('t:')) {
      row = await this.db.get('SELECT id, player_id, created_at, redeemed_at FROM tickets WHERE id = ?', [payload.slice(2)]);
    } else if (/^[A-Z2-9]{6}$/.test(tokenOrCode.toUpperCase())) {
      row = await this.db.get('SELECT id, player_id, created_at, redeemed_at FROM tickets WHERE code = ?', [tokenOrCode.toUpperCase()]);
    }
    if (!row) throw new GameError('no_ticket', 'Prize code not recognised', 404);
    if (this.now() - row.created_at > PRIZE_CODE_TTL_MS) throw new GameError('expired', 'This prize code has expired');
    return row;
  }

  async crewTicket(tokenOrCode: string): Promise<CrewTicketView> {
    const tk = await this.resolveTicket(tokenOrCode);
    const v = await this.db.get<{ callsign: string; name: string; company: string; role: string }>(
      'SELECT pl.callsign, p.name, p.company, p.role FROM players pl JOIN passports p ON p.player_id = pl.id WHERE pl.id = ?', [tk.player_id]);
    if (!v) throw new GameError('no_passport', 'No card behind this prize code', 404);
    return { ...v, alreadyDocked: tk.redeemed_at != null };
  }

  async crewDock(tokenOrCode: string): Promise<CrewTicketView> {
    const tk = await this.resolveTicket(tokenOrCode);
    const view = await this.crewTicket(tokenOrCode);
    if (tk.redeemed_at != null) throw new GameError('used', 'This prize code was already used', 409);
    const t = this.now();
    await this.db.batch([
      ['UPDATE tickets SET redeemed_at = ? WHERE id = ? AND redeemed_at IS NULL', [t, tk.id]],
      ['UPDATE players SET docked_at = ? WHERE id = ?', [t, tk.player_id]],
      ...this.award(tk.player_id, 'dock', POINTS.booth, this.level.hero.id, { proof: 'staff_scan' }, t),
    ]);
    return { ...view, alreadyDocked: true };
  }

  async beacons(): Promise<{ id: string; name: string; url: string }[]> {
    return Promise.all(this.level.booths.map(async (b) => ({ id: b.id, name: b.name, url: `${this.publicOrigin}/?b=${encodeURIComponent(await this.beaconToken(b.id))}` })));
  }

  async leads() {
    return this.db.all<Record<string, string | number | null>>(
      `SELECT pl.callsign, pl.cls, pl.xp, pl.docked_at, p.name, p.company, p.role, p.phone, p.email, p.consent_marketing, p.created_at,
              (SELECT COUNT(*) FROM stamps s WHERE s.player_id = pl.id) AS stamps,
              (SELECT COUNT(*) FROM links l WHERE l.a_id = pl.id OR l.b_id = pl.id) AS links
       FROM passports p JOIN players pl ON pl.id = p.player_id ORDER BY p.created_at DESC LIMIT 5000`);
  }

  /* ---------------- analytics ---------------- */

  async track(id: string | null, name: string, props: unknown): Promise<void> {
    if (!/^[a-z0-9_]{2,40}$/.test(name)) return;
    await this.db.run('INSERT INTO events (player_id, name, props, created_at) VALUES (?,?,?,?)', [id, name, JSON.stringify(props ?? null).slice(0, 1000), this.now()]);
  }
}
