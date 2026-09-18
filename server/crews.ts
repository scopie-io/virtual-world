// Crews and sector control (Systems doc §8.1). Deterministic and effort-based: no chance anywhere.
import { Game } from './game.js';
import type { SectorState, SectorsView } from '../shared/types.js';
import { BASE_XP, CLASSES, INFLUENCE_TAU_MS, SECTOR_TICK_MS, type PlayerClass } from '../shared/rules.js';
import type { Stmt } from './db/types.js';

type Scores = Record<PlayerClass, number>;
const zero = (): Scores => ({ builder: 0, strategist: 0, closer: 0, creator: 0 });

export class Crews {
  private cache: { at: number; view: SectorsView | null } = { at: -1e9, view: null };
  private ticking: Promise<void> | null = null;
  constructor(private g: Game) {}
  private get halls(): number[] { return this.g.level.halls.map((h) => h.id); }

  /**
   * score[c] = Σ w·exp(−age/τ) / sqrt(active members of c in that hall)   — the sqrt is the underdog normalisation.
   * Returns the scores and who was active, as of time `at`.
   */
  private async scoresAt(hall: number, at: number): Promise<{ scores: Scores; active: Map<PlayerClass, Set<string>> }> {
    const rows = await this.g.db.all<{ crew: PlayerClass; weight: number; player_id: string; created_at: number }>(
      'SELECT crew, weight, player_id, created_at FROM influence_events WHERE hall = ? AND created_at > ? AND created_at <= ?', [hall, at - 4 * INFLUENCE_TAU_MS, at]);
    const raw = zero(), active = new Map<PlayerClass, Set<string>>(CLASSES.map((c) => [c, new Set<string>()]));
    for (const r of rows) {
      if (!(r.crew in raw)) continue;
      raw[r.crew] += r.weight * Math.exp(-(at - r.created_at) / INFLUENCE_TAU_MS);
      if (at - r.created_at <= INFLUENCE_TAU_MS) active.get(r.crew)!.add(r.player_id);
    }
    const scores = zero();
    for (const c of CLASSES) scores[c] = +(raw[c] / Math.sqrt(Math.max(1, active.get(c)!.size))).toFixed(3);
    return { scores, active };
  }

  private async holders(): Promise<Map<number, PlayerClass | null>> {
    const rows = await this.g.db.all<{ hall: number; holder: PlayerClass | null }>(
      'SELECT t.hall, t.holder FROM sector_ticks t WHERE t.tick = (SELECT MAX(tick) FROM sector_ticks x WHERE x.hall = t.hall)');
    return new Map(rows.map((r) => [r.hall, r.holder]));
  }

  /**
   * Settles every tick boundary that has passed. Lazy (called from requests) so it needs no timer and ports to Workers.
   * Idempotent: the (tick, hall) primary key makes a repeated settle a no-op.
   */
  async settle(): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = this.settleNow().finally(() => { this.ticking = null; });
    return this.ticking;
  }

  private async settleNow(): Promise<void> {
    const now = this.g.now(), current = Math.floor(now / SECTOR_TICK_MS);
    const last = await this.g.db.get<{ t: number | null }>('SELECT MAX(tick) AS t FROM sector_ticks');
    // Never replay more than a day of missed ticks (e.g. after the server was off overnight).
    const from = Math.max((last?.t ?? current - 1) + 1, current - 48);
    if (from > current) return;
    for (let tick = from; tick <= current; tick++) {
      const at = tick * SECTOR_TICK_MS, prev = await this.holders(), stmts: Stmt[] = [];
      for (const hall of this.halls) {
        const { scores, active } = await this.scoresAt(hall, at);
        const best = Math.max(...CLASSES.map((c) => scores[c]));
        const leaders = CLASSES.filter((c) => scores[c] === best && best > 0);
        const before = prev.get(hall) ?? null;
        const holder = leaders.length === 0 ? before : leaders.length === 1 ? leaders[0]! : before && leaders.includes(before) ? before : leaders[0]!; // ties → previous holder keeps it
        stmts.push(['INSERT INTO sector_ticks (tick, hall, holder, scores, created_at) VALUES (?,?,?,?,?)', [tick, hall, holder, JSON.stringify(scores), now]]);
        if (holder && best > 0) for (const pid of active.get(holder)!) stmts.push(...this.g.award(pid, 'sector_held', BASE_XP.sector_held, `hall:${hall}`, { tick }, now));
      }
      try { await this.g.db.batch(stmts); }
      catch (e) { if (!(await this.g.db.get('SELECT 1 AS x FROM sector_ticks WHERE tick = ?', [tick]))) throw e; } // someone else settled it first
    }
    if (from <= current) this.cache.at = -1e9;
  }

  async view(): Promise<SectorsView> {
    await this.settle();
    const now = this.g.now();
    if (this.cache.view && now - this.cache.at < 10_000) return { ...this.cache.view, nextTickInMs: (Math.floor(now / SECTOR_TICK_MS) + 1) * SECTOR_TICK_MS - now };
    const holders = await this.holders(), sectors: SectorState[] = [];
    for (const hall of this.halls) sectors.push({ hall, holder: holders.get(hall) ?? null, scores: (await this.scoresAt(hall, now)).scores });
    const sizes = zero();
    for (const r of await this.g.db.all<{ cls: PlayerClass; n: number }>('SELECT cls, COUNT(*) AS n FROM players WHERE cls IS NOT NULL GROUP BY cls')) if (r.cls in sizes) sizes[r.cls] = r.n;
    const view: SectorsView = { sectors, crewSizes: sizes, nextTickInMs: (Math.floor(now / SECTOR_TICK_MS) + 1) * SECTOR_TICK_MS - now };
    this.cache = { at: now, view };
    return view;
  }
}
