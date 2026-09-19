// Swapping cards between two people, and My contacts. ("link" in code and tables = one card swap.)
import { Game, GameError, cleanFields, cleanText, dayStart } from './game.js';
import { shortCode } from './crypto.js';
import type { Contact, LinkCode, LinkPeek, SharedCard, XpEvent } from '../shared/types.js';
import { INFLUENCE, LINK_CODE_TTL_MS, LINK_DAILY_FULL, LINK_OVERFLOW_XP, POINTS, type Role, type ShareField } from '../shared/rules.js';
import type { Stmt } from './db/types.js';

const pair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

function cardFrom(p: { name: string; company: string; role: string; phone: string; email: string }, fields: string): SharedCard {
  const card: SharedCard = {};
  for (const f of fields.split(',') as ShareField[]) if (f in p && p[f]) card[f] = p[f];
  return card;
}

export class Social {
  constructor(private g: Game) {}

  async setPrefs(id: string, fieldsIn: unknown): Promise<void> {
    await this.g.requirePassport(id);
    await this.g.db.run('INSERT INTO share_prefs (player_id, fields) VALUES (?,?) ON CONFLICT(player_id) DO UPDATE SET fields = excluded.fields', [id, cleanFields(fieldsIn).join(',')]);
  }

  /** A short-lived code the other person scans. Showing it is the consent to share your saved fields with whoever scans it. */
  async linkCode(id: string): Promise<LinkCode> {
    await this.g.requirePassport(id);
    const t = this.g.now(), code = shortCode(8);
    await this.g.db.batch([
      ['DELETE FROM link_codes WHERE player_id = ? OR expires_at < ?', [id, t]],
      ['INSERT INTO link_codes (code, player_id, expires_at) VALUES (?,?,?)', [code, id, t + LINK_CODE_TTL_MS]],
    ]);
    return { code, url: `${this.g.publicOrigin}/?l=${code}`, expiresInMs: LINK_CODE_TTL_MS };
  }

  private async resolve(id: string, code: unknown): Promise<string> {
    const c = String(code ?? '').trim().toUpperCase();
    const row = /^[A-Z2-9]{8}$/.test(c) ? await this.g.db.get<{ player_id: string; expires_at: number }>('SELECT player_id, expires_at FROM link_codes WHERE code = ?', [c]) : undefined;
    if (!row || row.expires_at < this.g.now()) throw new GameError('bad_link', 'That code has expired — ask them to show a fresh one', 404);
    if (row.player_id === id) throw new GameError('self', 'That is your own code — let the other person scan it');
    return row.player_id;
  }

  /** Shown on the scanner's consent sheet before anything is exchanged. Callsign only — no personal data yet. */
  async peek(id: string, code: unknown): Promise<LinkPeek> {
    await this.g.requirePassport(id);
    const other = await this.resolve(id, code), p = await this.g.player(other), [a, b] = pair(id, other);
    return {
      callsign: p.callsign, cls: p.cls as Role | null,
      shares: await this.g.sharePrefs(other), alreadyLinked: !!(await this.g.db.get('SELECT 1 AS x FROM links WHERE a_id = ? AND b_id = ?', [a, b])),
    };
  }

  async link(id: string, code: unknown, fieldsIn: unknown): Promise<XpEvent[]> {
    await this.g.requirePassport(id);
    const other = await this.resolve(id, code), [a, b] = pair(id, other), t = this.g.now();
    if (await this.g.db.get('SELECT 1 AS x FROM links WHERE a_id = ? AND b_id = ?', [a, b])) throw new GameError('dup', 'You two have already swapped cards');
    const [me, them, theirFields] = await Promise.all([this.g.player(id), this.g.player(other), this.g.sharePrefs(other)]);

    const xpFor = async (pid: string) => {
      const n = await this.g.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM links WHERE (a_id = ? OR b_id = ?) AND created_at >= ?', [pid, pid, dayStart(t)]);
      return (n?.n ?? 0) < LINK_DAILY_FULL ? POINTS.swap : LINK_OVERFLOW_XP;
    };
    const [myXp, theirXp] = await Promise.all([xpFor(id), xpFor(other)]);
    const share = (from: string, to: string, fields: string): Stmt =>
      ['INSERT INTO card_shares (from_player, to_player, fields, created_at) VALUES (?,?,?,?) ON CONFLICT(from_player, to_player) WHERE to_player IS NOT NULL DO UPDATE SET fields = excluded.fields, revoked_at = NULL', [from, to, fields, t]];
    const cross = me.cls && them.cls && me.cls !== them.cls;

    await this.g.db.batch([
      ['INSERT INTO links (a_id, b_id, created_at) VALUES (?,?,?)', [a, b, t]],
      ['DELETE FROM link_codes WHERE player_id = ?', [other]], // one code, one handshake
      share(id, other, cleanFields(fieldsIn).join(',')),
      share(other, id, theirFields.join(',')),
      ...this.g.award(id, 'link', myXp, them.callsign, null, t),
      ...this.g.award(other, 'link', theirXp, me.callsign, null, t),
      ...(cross ? [...this.g.influence(id, me.cls, 0, INFLUENCE.link_cross_crew, t), ...this.g.influence(other, them.cls, 0, INFLUENCE.link_cross_crew, t)] : []),
    ]);
    return [{ action: 'link', xp: myXp, target: them.callsign }];
  }

  /** Take back what you shared with a person. They keep nothing from us; what they already saved elsewhere is beyond reach. */
  async revokePerson(id: string, contactKey: string): Promise<void> {
    await this.g.db.run(`UPDATE card_shares SET revoked_at = ? WHERE from_player = ? AND revoked_at IS NULL AND to_player IN (SELECT id FROM players WHERE substr(id, 1, 8) = ?)`, [this.g.now(), id, contactKey.replace(/^p:/, '')]);
  }

  async contacts(id: string): Promise<Contact[]> {
    const [people, stations, notes] = await Promise.all([
      this.g.db.all<{ pid: string; callsign: string; cls: string | null; at: number; fields: string | null; name: string; company: string; role: string; phone: string; email: string }>(
        `SELECT pl.id AS pid, pl.callsign, pl.cls, l.created_at AS at, cs.fields, p.name, p.company, p.role, p.phone, p.email
         FROM links l
         JOIN players pl ON pl.id = CASE WHEN l.a_id = ? THEN l.b_id ELSE l.a_id END
         JOIN passports p ON p.player_id = pl.id
         LEFT JOIN card_shares cs ON cs.from_player = pl.id AND cs.to_player = ? AND cs.revoked_at IS NULL
         WHERE l.a_id = ? OR l.b_id = ? ORDER BY l.created_at DESC`, [id, id, id, id]),
      this.g.db.all<{ sid: string; at: number; company: string; offer: string; link: string; status: string; verified: number }>(
        `SELECT cs.to_station AS sid, cs.created_at AS at, s.company, s.offer, s.link, s.status,
                EXISTS(SELECT 1 FROM verified_contacts v WHERE v.player_id = cs.from_player AND v.station_id = cs.to_station) AS verified
         FROM card_shares cs JOIN stations s ON s.station_id = cs.to_station
         WHERE cs.from_player = ? AND cs.to_station IS NOT NULL AND cs.revoked_at IS NULL ORDER BY cs.created_at DESC`, [id]),
      this.g.db.all<{ contact_key: string; note: string }>('SELECT contact_key, note FROM contact_notes WHERE owner_id = ?', [id]),
    ]);
    const note = new Map(notes.map((n) => [n.contact_key, n.note]));
    const out: Contact[] = [];
    for (const r of people) {
      const key = `p:${r.pid.slice(0, 8)}`, card = r.fields ? cardFrom(r, r.fields) : {};
      out.push({ kind: 'person', key, title: card.name ?? r.callsign, sub: [card.role, card.company].filter(Boolean).join(' · ') || r.callsign, card, at: r.at, note: note.get(key) ?? '' });
    }
    for (const r of stations) {
      const key = `s:${r.sid}`;
      out.push({ kind: 'station', key, title: r.company, sub: [`Booth ${r.sid}`, r.offer].filter(Boolean).join(' · '), card: {}, link: r.link || undefined, at: r.at, note: note.get(key) ?? '', verified: r.verified === 1 });
    }
    return out.sort((x, y) => y.at - x.at);
  }

  async setNote(id: string, key: unknown, text: unknown): Promise<void> {
    const k = String(key ?? '');
    if (!/^(p:[0-9a-f]{8}|s:[0-9A-Z]{3,8})$/.test(k)) throw new GameError('bad_key', 'Unknown contact');
    const note = cleanText(text, 500);
    if (note) await this.g.db.run('INSERT INTO contact_notes (owner_id, contact_key, note) VALUES (?,?,?) ON CONFLICT(owner_id, contact_key) DO UPDATE SET note = excluded.note', [id, k, note]);
    else await this.g.db.run('DELETE FROM contact_notes WHERE owner_id = ? AND contact_key = ?', [id, k]);
  }
}
