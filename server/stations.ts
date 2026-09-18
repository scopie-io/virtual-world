// Station Command: exhibitors claim a booth, host it with a rotating code, and receive consented leads.
import type { Stmt } from './db/types.js';
import { Game, GameError, cleanFields, cleanText } from './game.js';
import type { CrewStationRow, HostCode, HostLead, HostStation, StationClaimInput, StationStatus, StationView, XpEvent } from '../shared/types.js';
import { BASE_XP, HOST_ONLINE_MS, HOST_WINDOW_MS, MAX_STATIONS_PER_OWNER, SXP, stationLevel, type ShareField } from '../shared/rules.js';

interface StationRow { station_id: string; owner_id: string; company: string; offer: string; link: string; color: number; status: StationStatus; claimed_at: number; host_seen_at: number | null; host_ms: number }
interface Counts { stamps: number; shares: number; verified: number }

function cleanLink(raw: unknown): string {
  const s = cleanText(raw, 200);
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
  } catch { return ''; }
}

export class Stations {
  private cache: { at: number; list: StationView[] } = { at: -1e9, list: [] };
  constructor(private g: Game) {}

  private sxp(r: StationRow, c: Counts): number {
    const profile = r.offer && r.link ? SXP.profile : 0;
    return SXP.claim + profile + c.stamps * SXP.stamp + c.shares * SXP.share + c.verified * SXP.verified + Math.floor(r.host_ms / 3_600_000) * SXP.hostHour;
  }

  private async counts(ids: string[]): Promise<Map<string, Counts>> {
    const out = new Map<string, Counts>(ids.map((id) => [id, { stamps: 0, shares: 0, verified: 0 }]));
    if (!ids.length) return out;
    const q = ids.map(() => '?').join(',');
    const [st, sh, ve] = await Promise.all([
      this.g.db.all<{ k: string; n: number }>(`SELECT station_id AS k, COUNT(*) AS n FROM stamps WHERE station_id IN (${q}) GROUP BY station_id`, ids),
      this.g.db.all<{ k: string; n: number }>(`SELECT to_station AS k, COUNT(*) AS n FROM card_shares WHERE to_station IN (${q}) AND revoked_at IS NULL GROUP BY to_station`, ids),
      this.g.db.all<{ k: string; n: number }>(`SELECT station_id AS k, COUNT(*) AS n FROM verified_contacts WHERE station_id IN (${q}) GROUP BY station_id`, ids),
    ]);
    for (const r of st) out.get(r.k)!.stamps = r.n;
    for (const r of sh) out.get(r.k)!.shares = r.n;
    for (const r of ve) out.get(r.k)!.verified = r.n;
    return out;
  }

  private view(r: StationRow, c: Counts, t: number): StationView {
    return { id: r.station_id, company: r.company, offer: r.offer, link: r.link, color: r.color, status: r.status, hosted: r.host_seen_at != null && t - r.host_seen_at < HOST_ONLINE_MS, level: stationLevel(this.sxp(r, c)) };
  }

  /** Every live (non-revoked) station — what lights up in the world. Cached briefly: every client polls it. */
  async list(): Promise<StationView[]> {
    const t = this.g.now();
    if (t - this.cache.at < 5000) return this.cache.list;
    const rows = await this.g.db.all<StationRow>("SELECT * FROM stations WHERE status != 'revoked'");
    const counts = await this.counts(rows.map((r) => r.station_id));
    this.cache = { at: t, list: rows.map((r) => this.view(r, counts.get(r.station_id)!, t)) };
    return this.cache.list;
  }

  async claim(id: string, input: StationClaimInput): Promise<XpEvent[]> {
    const booth = this.g.stations.get(String(input.stationId));
    if (!booth) throw new GameError('no_station', 'Unknown station');
    if (booth.id === this.g.level.hero.id) throw new GameError('reserved', 'The Launch Pad is taken');
    await this.g.requirePassport(id);
    const company = cleanText(input.company, 80), offer = cleanText(input.offer, 120), link = cleanLink(input.link);
    if (company.length < 2) throw new GameError('company', 'Enter the company name shown on your booth');
    if (input.link && !link) throw new GameError('link', 'That link does not look like a web address');
    const color = Number.isInteger(input.color) && input.color >= 0 && input.color <= 0xffffff ? input.color : 0x17b6d6;

    const t = this.g.now();
    const existing = await this.g.db.get<StationRow>('SELECT * FROM stations WHERE station_id = ?', [booth.id]);
    if (existing && existing.owner_id !== id) throw new GameError('taken', existing.status === 'revoked' ? 'This station is locked — talk to the crew at 8H18B' : 'Someone already hosts this station. If that is wrong, see the crew at 8H18B.', 409);
    if (existing?.status === 'revoked') throw new GameError('revoked', 'This claim was removed by the crew — see us at 8H18B', 403);
    if (existing) { // owner editing their profile
      await this.g.db.run('UPDATE stations SET company = ?, offer = ?, link = ?, color = ? WHERE station_id = ?', [company, offer, link, color, booth.id]);
      this.cache.at = -1e9;
      return [];
    }
    const mine = await this.g.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM stations WHERE owner_id = ? AND status != 'revoked'", [id]);
    if ((mine?.n ?? 0) >= MAX_STATIONS_PER_OWNER) throw new GameError('too_many', `One account can host up to ${MAX_STATIONS_PER_OWNER} stations`);
    const first = (mine?.n ?? 0) === 0;
    const stmts: Stmt[] = [['INSERT INTO stations (station_id, owner_id, company, offer, link, color, status, claimed_at) VALUES (?,?,?,?,?,?,?,?)', [booth.id, id, company, offer, link, color, 'pending', t]]];
    if (first) stmts.push(...this.g.award(id, 'station_claim', BASE_XP.station_claim, booth.id, null, t));
    await this.g.db.batch(stmts);
    this.cache.at = -1e9;
    return first ? [{ action: 'station_claim', xp: BASE_XP.station_claim, target: company }] : [];
  }

  private async owned(id: string, stationId: string): Promise<StationRow> {
    const r = await this.g.db.get<StationRow>('SELECT * FROM stations WHERE station_id = ?', [stationId]);
    if (!r || r.owner_id !== id || r.status === 'revoked') throw new GameError('not_host', 'You do not host this station', 403);
    return r;
  }

  /** The host screen polls this: returns the live code and counts the time the host is present. */
  async hostCode(id: string, stationId: string): Promise<HostCode> {
    const r = await this.owned(id, stationId), t = this.g.now();
    const gap = r.host_seen_at != null ? t - r.host_seen_at : Infinity;
    await this.g.db.run('UPDATE stations SET host_seen_at = ?, host_ms = host_ms + ? WHERE station_id = ?', [t, gap < HOST_ONLINE_MS * 1.5 ? gap : 0, stationId]);
    const w = Math.floor(t / HOST_WINDOW_MS), c = await this.g.hostCode(stationId, w);
    return { stationId, url: `${this.g.publicOrigin}/?h=${encodeURIComponent(c.token)}`, digits: c.digits, expiresInMs: (w + 1) * HOST_WINDOW_MS - t };
  }

  async mine(id: string): Promise<HostStation[]> {
    const rows = await this.g.db.all<StationRow>("SELECT * FROM stations WHERE owner_id = ? AND status != 'revoked' ORDER BY claimed_at", [id]);
    const counts = await this.counts(rows.map((r) => r.station_id)), t = this.g.now();
    return rows.map((r) => { const c = counts.get(r.station_id)!; return { ...this.view(r, c, t), sxp: this.sxp(r, c), stamps: c.stamps, shares: c.shares, verifiedContacts: c.verified, hostMinutes: Math.round(r.host_ms / 60_000) }; });
  }

  /** Only what each visitor consented to share with THIS station, and only while the share stands. */
  async leads(id: string, stationId: string): Promise<HostLead[]> {
    await this.owned(id, stationId);
    const rows = await this.g.db.all<{ fields: string; created_at: number; callsign: string; name: string; company: string; role: string; phone: string; email: string; verified: number }>(
      `SELECT cs.fields, cs.created_at, pl.callsign, p.name, p.company, p.role, p.phone, p.email,
              EXISTS(SELECT 1 FROM verified_contacts v WHERE v.player_id = cs.from_player AND v.station_id = cs.to_station) AS verified
       FROM card_shares cs JOIN players pl ON pl.id = cs.from_player JOIN passports p ON p.player_id = cs.from_player
       WHERE cs.to_station = ? AND cs.revoked_at IS NULL ORDER BY cs.created_at DESC LIMIT 5000`, [stationId]);
    return rows.map((r) => {
      const f = new Set(r.fields.split(',') as ShareField[]), pickF = (k: ShareField, v: string) => (f.has(k) ? v : '');
      return { callsign: r.callsign, name: pickF('name', r.name), company: pickF('company', r.company), role: pickF('role', r.role), phone: pickF('phone', r.phone), email: pickF('email', r.email), verified: r.verified === 1, at: r.created_at };
    });
  }

  /** Visitor → exhibitor: an explicit, per-station, revocable share. XP once per station. */
  async share(id: string, stationId: string, fieldsIn: unknown): Promise<XpEvent[]> {
    await this.g.requirePassport(id);
    const st = await this.g.db.get<StationRow>('SELECT * FROM stations WHERE station_id = ?', [stationId]);
    if (!st || st.status === 'revoked') throw new GameError('not_hosted', 'This station is not online yet');
    if (st.owner_id === id) throw new GameError('own_station', 'This is your own station');
    if (!(await this.g.db.get('SELECT 1 AS x FROM stamps WHERE player_id = ? AND station_id = ?', [id, stationId]))) throw new GameError('need_stamp', 'Stamp the station first');
    const fields = cleanFields(fieldsIn).join(','), t = this.g.now();
    const prior = await this.g.db.get<{ id: number }>('SELECT id FROM card_shares WHERE from_player = ? AND to_station = ?', [id, stationId]);
    if (prior) { // changing the fields, or sharing again after revoking: no second reward
      await this.g.db.run('UPDATE card_shares SET fields = ?, revoked_at = NULL, created_at = ? WHERE id = ?', [fields, t, prior.id]);
      return [];
    }
    await this.g.db.batch([
      ['INSERT INTO card_shares (from_player, to_station, fields, created_at) VALUES (?,?,?,?)', [id, stationId, fields, t]],
      ...this.g.award(id, 'share_station', BASE_XP.share_station, stationId, { fields }, t),
    ]);
    return [{ action: 'share_station', xp: BASE_XP.share_station, target: st.company }];
  }

  async revokeShare(id: string, stationId: string): Promise<void> {
    await this.g.db.run('UPDATE card_shares SET revoked_at = ? WHERE from_player = ? AND to_station = ? AND revoked_at IS NULL', [this.g.now(), id, stationId]);
  }

  /** Top stations by Station XP — the exhibitors' own leaderboard. */
  async ranked(limit: number): Promise<HostStation[]> {
    const rows = await this.g.db.all<StationRow>("SELECT * FROM stations WHERE status != 'revoked'");
    const counts = await this.counts(rows.map((r) => r.station_id)), t = this.g.now();
    return rows.map((r) => { const c = counts.get(r.station_id)!; return { ...this.view(r, c, t), sxp: this.sxp(r, c), stamps: c.stamps, shares: c.shares, verifiedContacts: c.verified, hostMinutes: Math.round(r.host_ms / 60_000) }; }).sort((a, b) => b.sxp - a.sxp).slice(0, limit);
  }

  /* ---- crew moderation ---- */

  async crewList(): Promise<CrewStationRow[]> {
    const rows = await this.g.db.all<StationRow & { callsign: string; name: string; pcompany: string }>(
      `SELECT s.*, pl.callsign, p.name, p.company AS pcompany FROM stations s JOIN players pl ON pl.id = s.owner_id JOIN passports p ON p.player_id = s.owner_id ORDER BY s.claimed_at DESC`);
    const counts = await this.counts(rows.map((r) => r.station_id)), t = this.g.now();
    return rows.map((r) => ({ ...this.view(r, counts.get(r.station_id)!, t), ownerCallsign: r.callsign, ownerName: r.name, ownerCompany: r.pcompany, claimedAt: r.claimed_at }));
  }

  async crewSetStatus(stationId: string, status: string): Promise<void> {
    if (status === 'release') await this.g.db.run('DELETE FROM stations WHERE station_id = ?', [stationId]); // frees the booth for its real exhibitor
    else if (status === 'approved' || status === 'revoked' || status === 'pending') await this.g.db.run('UPDATE stations SET status = ? WHERE station_id = ?', [status, stationId]);
    else throw new GameError('bad_status', 'Unknown status');
    this.cache.at = -1e9;
  }
}
