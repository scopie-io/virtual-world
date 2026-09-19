// Live operations: the boards, the crew's review tools (trust, void, ban), kill switches and the booth of the day.
// Company teams are switched off in the simple game (FEATURES.teams). Everything a prize decision or a bad afternoon on the show floor needs.
import { Game, GameError, cleanText, dayStart, type StampOutcome } from './game.js';
import { shortCode } from './crypto.js';
import type { Stations } from './stations.js';
import type { BoardKind, BoardRow, DailyDrop, FlagKey, ReviewRow, TeamView, TrustView, XpEvent } from '../shared/types.js';
import { FLAG_KEYS, TEAM_MAX, TEAM_SCORERS, TRUST_MIN, TRUST_W, type Role } from '../shared/rules.js';

export class LiveOps {
  private flagCache: { at: number; v: Record<FlagKey, boolean> } | null = null;
  private lastSpeedFlag = new Map<string, number>();
  private banned: { at: number; ids: Set<string> } | null = null;
  private boardCache = new Map<string, { at: number; rows: BoardRow[] }>();

  constructor(private g: Game, private stationsSvc: Stations) {}

  /* ---------------- kill switches ---------------- */

  async flags(): Promise<Record<FlagKey, boolean>> {
    const t = this.g.now();
    if (this.flagCache && t - this.flagCache.at < 5000) return this.flagCache.v;
    const rows = await this.g.db.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key LIKE 'flag:%'");
    const v = Object.fromEntries(FLAG_KEYS.map((k) => [k, true])) as Record<FlagKey, boolean>;
    for (const r of rows) { const k = r.key.slice(5) as FlagKey; if (k in v) v[k] = r.value !== '0'; }
    this.flagCache = { at: t, v };
    return v;
  }
  async require(flag: FlagKey): Promise<void> { if (!(await this.flags())[flag]) throw new GameError('paused', 'This part of the game is paused for a moment — try again shortly', 503); }
  async setFlag(flag: string, on: boolean): Promise<void> {
    if (!(FLAG_KEYS as readonly string[]).includes(flag)) throw new GameError('bad_flag', 'Unknown switch');
    await this.setting(`flag:${flag}`, on ? '1' : '0'); this.flagCache = null;
  }
  private setting(key: string, value: string) { return this.g.db.run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]); }

  /* ---------------- bans + flags on players ---------------- */

  async isBanned(id: string): Promise<boolean> {
    const t = this.g.now();
    if (!this.banned || t - this.banned.at > 15_000 || t < this.banned.at) this.banned = { at: t, ids: new Set((await this.g.db.all<{ player_id: string }>('SELECT player_id FROM bans')).map((b) => b.player_id)) };
    return this.banned.ids.has(id);
  }
  /** An implausible move is remembered (at most once a minute per player): it costs the "travel plausible" part of trust. */
  async speedFlag(id: string, detail: string): Promise<void> {
    const t = this.g.now(); if (t - (this.lastSpeedFlag.get(id) ?? 0) < 60_000) return;
    this.lastSpeedFlag.set(id, t);
    await this.g.db.run('INSERT INTO flags (player_id, kind, detail, created_at) VALUES (?,?,?,?)', [id, 'speed', detail, t]);
  }
  async steps(id: string, steps: number, metres: number): Promise<void> {
    if (!(steps > 0 || metres > 0)) return;
    const day = dayStart(this.g.now());
    await this.g.db.run('INSERT INTO step_stats (player_id, day, steps, metres) VALUES (?,?,?,?) ON CONFLICT(player_id, day) DO UPDATE SET steps = steps + excluded.steps, metres = metres + excluded.metres', [id, day, Math.min(60, Math.max(0, Math.round(steps))), metres]);
  }

  /* ---------------- trust (Systems doc §9) ---------------- */

  async trust(id: string): Promise<TrustView> {
    const t = this.g.now(), d0 = dayStart(t);
    const [venue, host, speed, steps, p] = await Promise.all([
      this.g.db.get<{ ok: number }>('SELECT ok FROM venue_checks WHERE player_id = ? AND checked_at >= ?', [id, d0]),
      this.g.db.get<{ n: number }>("SELECT (SELECT COUNT(*) FROM stamps WHERE player_id = ? AND proof = 'host' AND created_at >= ?) + (SELECT COUNT(*) FROM verified_contacts WHERE player_id = ? AND created_at >= ?) AS n", [id, d0, id, d0]),
      this.g.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM flags WHERE player_id = ? AND kind = 'speed' AND created_at >= ?", [id, d0]),
      this.g.db.get<{ steps: number; metres: number }>('SELECT steps, metres FROM step_stats WHERE player_id = ? AND day = ?', [id, d0]),
      this.g.player(id),
    ]);
    const ratio = steps && steps.steps > 0 ? steps.metres / (steps.steps * 0.7) : null;
    const parts = {
      geofence: venue?.ok === 1,
      hostCode: (host?.n ?? 0) > 0,
      plausible: (speed?.n ?? 0) === 0,
      steps: !steps || steps.metres < 40 || (ratio != null && ratio >= 0.6 && ratio <= 1.7), // little deck walking yet = nothing to contradict
      human: p.docked_at != null,
    };
    const score = +(Object.entries(parts) as [keyof typeof TRUST_W, boolean][]).reduce((s, [k, ok]) => s + (ok ? TRUST_W[k] : 0), 0).toFixed(2);
    return { score, trusted: score >= TRUST_MIN, parts };
  }

  /* ---------------- boards ---------------- */

  async board(kind: BoardKind, viewer: string | null): Promise<BoardRow[]> {
    const t = this.g.now(), hit = this.boardCache.get(kind);
    let rows = hit && t - hit.at < 15_000 ? hit.rows : null;
    if (!rows) { rows = await this.buildBoard(kind, t); this.boardCache.set(kind, { at: t, rows }); }
    const me = viewer ? (await this.g.player(viewer)).callsign : null;
    return rows.map((r) => ({ ...r, you: r.kind === 'player' && r.title === me ? true : undefined }));
  }

  private async buildBoard(kind: BoardKind, t: number): Promise<BoardRow[]> {
    const d0 = dayStart(t);
    if (kind === 'stations') {
      const mine = await this.stationsSvc.ranked(20);
      return mine.map((s) => ({ kind: 'station' as const, title: s.company, sub: `Booth ${s.id}${s.hosted ? ' · at the counter now' : ''}`, value: s.stamps, unit: 'visits' })).sort((a, b) => b.value - a.value);
    }
    if (kind === 'companies') {
      const teams = await this.g.db.all<{ owner_id: string; name: string }>('SELECT owner_id, name FROM teams');
      const out: BoardRow[] = [];
      for (const tm of teams) {
        const ms = await this.g.db.all<{ xp: number }>(`SELECT pl.xp FROM players pl WHERE (pl.id = ? OR pl.id IN (SELECT player_id FROM team_members WHERE owner_id = ?)) AND pl.id NOT IN (SELECT player_id FROM bans) ORDER BY pl.xp DESC LIMIT ${TEAM_SCORERS}`, [tm.owner_id, tm.owner_id]);
        const verified = !!(await this.g.db.get("SELECT 1 AS x FROM stations WHERE owner_id = ? AND status = 'approved'", [tm.owner_id]));
        out.push({ kind: 'team', title: tm.name, sub: `${ms.length} scoring${verified ? ' · verified exhibitor' : ''}`, value: ms.reduce((s, m) => s + m.xp, 0), unit: 'XP', trusted: verified });
      }
      return out.sort((a, b) => b.value - a.value).slice(0, 20);
    }
    const sql: Record<'xp' | 'today' | 'explorer' | 'connector', string> = {
      xp: 'SELECT id, xp AS v FROM players WHERE xp > 0 AND id NOT IN (SELECT player_id FROM bans) ORDER BY xp DESC, created_at LIMIT 25',
      today: `SELECT player_id AS id, SUM(xp) AS v FROM xp_ledger WHERE voided = 0 AND created_at >= ${d0} AND player_id NOT IN (SELECT player_id FROM bans) GROUP BY player_id ORDER BY v DESC LIMIT 25`,
      explorer: `SELECT player_id AS id, COUNT(*) AS v FROM stamps WHERE created_at >= ${d0} AND player_id NOT IN (SELECT player_id FROM bans) GROUP BY player_id ORDER BY v DESC, MAX(created_at) LIMIT 25`,
      connector: `SELECT id, COUNT(*) AS v FROM (SELECT a_id AS id, created_at FROM links UNION ALL SELECT b_id, created_at FROM links) WHERE created_at >= ${d0} AND id NOT IN (SELECT player_id FROM bans) GROUP BY id ORDER BY v DESC LIMIT 25`,
    };
    const unit = { xp: 'points', today: 'points today', explorer: 'stamps today', connector: 'swaps today' }[kind];
    const out: BoardRow[] = [];
    for (const r of await this.g.db.all<{ id: string; v: number }>(sql[kind])) {
      const p = await this.g.player(r.id), tr = await this.trust(r.id), booths = (await this.g.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM stamps WHERE player_id = ?', [r.id]))?.n ?? 0;
      out.push({ kind: 'player', title: p.callsign, cls: p.cls as Role | null, sub: `${booths} booth${booths === 1 ? '' : 's'}${p.docked_at != null ? ' · mission complete at 8H18B' : ''}`, value: r.v, unit, trusted: tr.trusted });
    }
    return out;
  }

  /* ---------------- crew review ---------------- */

  async review(kind: BoardKind): Promise<ReviewRow[]> {
    const pick = kind === 'stations' || kind === 'companies' ? 'today' : kind;
    const rows = await this.buildBoard(pick, this.g.now()), out: ReviewRow[] = [];
    for (const r of rows.slice(0, 20)) {
      const p = await this.g.db.get<{ id: string; xp: number }>('SELECT id, xp FROM players WHERE callsign = ?', [r.title]); if (!p) continue;
      const [pass, flags, mix] = await Promise.all([
        this.g.passportOf(p.id),
        this.g.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM flags WHERE player_id = ?', [p.id]),
        this.g.db.all<{ action: string; xp: number }>('SELECT action, SUM(xp) AS xp FROM xp_ledger WHERE player_id = ? AND voided = 0 GROUP BY action ORDER BY xp DESC', [p.id]),
      ]);
      out.push({ callsign: r.title, name: pass?.name ?? '', company: pass?.company ?? '', value: r.value, unit: r.unit, xp: p.xp, trust: await this.trust(p.id), flags: flags?.n ?? 0, banned: await this.isBanned(p.id), mix: mix.map((m) => `${m.action} ${m.xp}`).join(' · ') });
    }
    return out;
  }

  async ledger(callsign: string) {
    return this.g.db.all<Record<string, string | number | null>>('SELECT l.id, l.action, l.target, l.xp, l.detail, l.voided, l.created_at FROM xp_ledger l JOIN players p ON p.id = l.player_id WHERE p.callsign = ? ORDER BY l.id DESC LIMIT 150', [callsign]);
  }

  /** The ledger is the truth: a bad row is voided, never deleted, and the cached total follows. */
  async setVoided(ledgerId: number, voided: boolean): Promise<void> {
    const row = await this.g.db.get<{ player_id: string; xp: number; voided: number }>('SELECT player_id, xp, voided FROM xp_ledger WHERE id = ?', [ledgerId]);
    if (!row) throw new GameError('no_row', 'No such ledger row', 404);
    if ((row.voided === 1) === voided) return;
    await this.g.db.batch([
      ['UPDATE xp_ledger SET voided = ? WHERE id = ?', [voided ? 1 : 0, ledgerId]],
      ['UPDATE players SET xp = MAX(0, xp + ?) WHERE id = ?', [voided ? -row.xp : row.xp, row.player_id]],
    ]);
    this.boardCache.clear();
  }

  async setBanned(callsign: string, banned: boolean, reason: unknown): Promise<void> {
    const p = await this.g.db.get<{ id: string }>('SELECT id FROM players WHERE callsign = ?', [callsign]);
    if (!p) throw new GameError('no_player', 'No such callsign', 404);
    if (banned) await this.g.db.run('INSERT INTO bans (player_id, reason, created_at) VALUES (?,?,?) ON CONFLICT(player_id) DO UPDATE SET reason = excluded.reason', [p.id, cleanText(reason, 200), this.g.now()]);
    else await this.g.db.run('DELETE FROM bans WHERE player_id = ?', [p.id]);
    this.banned = null; this.boardCache.clear();
  }

  /* ---------------- company teams ---------------- */

  async team(id: string): Promise<TeamView | null> {
    if (!this.g.features.teams) return null;
    const own = await this.g.db.get<{ owner_id: string; name: string; code: string }>('SELECT owner_id, name, code FROM teams WHERE owner_id = ? OR owner_id = (SELECT owner_id FROM team_members WHERE player_id = ?)', [id, id]);
    if (!own) return null;
    const members = await this.g.db.all<{ callsign: string; xp: number; id: string }>('SELECT pl.id, pl.callsign, pl.xp FROM players pl WHERE pl.id = ? OR pl.id IN (SELECT player_id FROM team_members WHERE owner_id = ?) ORDER BY pl.xp DESC', [own.owner_id, own.owner_id]);
    return { name: own.name, owner: own.owner_id === id, code: own.owner_id === id ? own.code : null, members: members.map((m) => ({ callsign: m.callsign, xp: m.xp, you: m.id === id || undefined })), score: members.slice(0, TEAM_SCORERS).reduce((s, m) => s + m.xp, 0) };
  }

  async createTeam(id: string, nameIn: unknown): Promise<TeamView> {
    if (!this.g.features.teams) throw new GameError('off', 'Not part of this game', 404);
    const pass = await this.g.requirePassport(id);
    if (await this.team(id)) throw new GameError('in_team', 'You are already in a team — leave it first');
    const name = cleanText(nameIn, 60) || pass.company;
    if (name.length < 2) throw new GameError('name', 'Give your team a name');
    await this.g.db.run('INSERT INTO teams (owner_id, name, code, created_at) VALUES (?,?,?,?)', [id, name, shortCode(8), this.g.now()]);
    this.boardCache.delete('companies');
    return (await this.team(id))!;
  }

  async joinTeam(id: string, codeIn: unknown): Promise<TeamView> {
    if (!this.g.features.teams) throw new GameError('off', 'Not part of this game', 404);
    await this.g.requirePassport(id);
    if (await this.team(id)) throw new GameError('in_team', 'You are already in a team — leave it first');
    const code = String(codeIn ?? '').trim().toUpperCase(), tm = /^[A-Z2-9]{8}$/.test(code) ? await this.g.db.get<{ owner_id: string }>('SELECT owner_id FROM teams WHERE code = ?', [code]) : undefined;
    if (!tm) throw new GameError('bad_code', 'That team code is not right', 404);
    const n = await this.g.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM team_members WHERE owner_id = ?', [tm.owner_id]);
    if ((n?.n ?? 0) + 1 >= TEAM_MAX) throw new GameError('full', `A team holds up to ${TEAM_MAX} people`);
    await this.g.db.run('INSERT INTO team_members (player_id, owner_id, joined_at) VALUES (?,?,?)', [id, tm.owner_id, this.g.now()]);
    this.boardCache.delete('companies');
    return (await this.team(id))!;
  }

  async leaveTeam(id: string): Promise<void> {
    await this.g.db.batch([
      ['DELETE FROM team_members WHERE player_id = ?', [id]],
      ['DELETE FROM team_members WHERE owner_id = ?', [id]], // the founder leaving dissolves the team
      ['DELETE FROM teams WHERE owner_id = ?', [id]],
    ]);
    this.boardCache.delete('companies');
  }

  /* ---------------- Daily Drop ---------------- */

  async drop(viewer: string | null): Promise<DailyDrop | null> {
    const rows = await this.g.db.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key LIKE 'drop:%'"), s = Object.fromEntries(rows.map((r) => [r.key.slice(5), r.value]));
    const b = this.g.stations.get(s.station ?? ''), day = dayStart(this.g.now());
    if (!b || Number(s.day) !== day) return null;
    const done = viewer ? !!(await this.g.db.get("SELECT 1 AS x FROM xp_ledger WHERE player_id = ? AND action = 'daily_drop' AND created_at >= ? AND voided = 0", [viewer, day])) : false;
    return { title: s.title || 'Daily Drop', stationId: b.id, label: b.name || `Station ${b.id}`, x: b.x, y: b.y, bonus: Number(s.bonus) || 100, done };
  }

  async setDrop(stationId: unknown, title: unknown, bonus: unknown): Promise<void> {
    const b = this.g.stations.get(String(stationId ?? '').toUpperCase());
    if (!b) throw new GameError('no_station', 'Unknown booth number');
    const n = Math.round(Number(bonus)); if (!(n >= 10 && n <= 500)) throw new GameError('bonus', 'Bonus must be 10–500 XP');
    await this.setting('drop:station', b.id); await this.setting('drop:title', cleanText(title, 60) || 'Daily Drop'); await this.setting('drop:bonus', String(n)); await this.setting('drop:day', String(dayStart(this.g.now())));
  }

  /** Today's drop pays once, and only to someone who was really at the booth. */
  async afterStamp(o: StampOutcome): Promise<XpEvent[]> {
    if (o.presence !== 'onsite') return [];
    const d = await this.drop(o.id); if (!d || d.done || d.stationId !== o.station.id) return [];
    await this.g.db.batch(this.g.award(o.id, 'daily_drop', d.bonus, o.station.id, null, o.t));
    return [{ action: 'daily_drop', xp: d.bonus, target: d.title }];
  }

  /* ---------------- Mission Control screen ---------------- */

  async totals() {
    const q = async (sql: string) => (await this.g.db.get<{ n: number }>(sql))?.n ?? 0;
    return { players: await q('SELECT COUNT(*) AS n FROM players WHERE cls IS NOT NULL'), passports: await q('SELECT COUNT(*) AS n FROM passports'), docked: await q('SELECT COUNT(*) AS n FROM players WHERE docked_at IS NOT NULL'), stamps: await q('SELECT COUNT(*) AS n FROM stamps'), links: await q('SELECT COUNT(*) AS n FROM links'), stations: await q("SELECT COUNT(*) AS n FROM stations WHERE status != 'revoked'") };
  }
}
