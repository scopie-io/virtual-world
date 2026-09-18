// Game rules shared by server (authoritative) and client (display only).
// Source: MISSION_X_Game_Systems.md §5 and §7. Change numbers here, nowhere else.

export const CLASSES = ['builder', 'strategist', 'closer', 'creator'] as const;
export type PlayerClass = (typeof CLASSES)[number];

export const CLASS_INFO: Record<PlayerClass, { label: string; line: string; jacket: number; pants: number }> = {
  builder: { label: 'The Builder', line: 'Websites, stores, landing pages', jacket: 0xd5d9de, pants: 0x1f3558 },
  strategist: { label: 'The Strategist', line: 'Brand and direction', jacket: 0x22395c, pants: 0xc9a27a },
  closer: { label: 'The Closer', line: 'Funnels, sales, payments', jacket: 0xc9a27a, pants: 0x1f3558 },
  creator: { label: 'The Creator', line: 'Content, social, video', jacket: 0x1b1b1f, pants: 0x1b1b1f },
};

export type Action =
  | 'suit_up'
  | 'passport'
  | 'dock'
  | 'stamp'
  | 'hall_first'
  | 'landmark'
  | 'verified_contact'
  | 'share_station'
  | 'link'
  | 'sector_held'
  | 'station_claim';

export const BASE_XP: Record<Action, number> = {
  suit_up: 50,
  passport: 200,
  dock: 500,
  stamp: 40,
  hall_first: 100,
  landmark: 20,
  verified_contact: 60,
  share_station: 25,
  link: 50,
  sector_held: 40,
  station_claim: 100,
};

export type Presence = 'remote' | 'onsite';
export const PRESENCE_MULT: Record<Presence, number> = { remote: 0.15, onsite: 1.0 };

/** How the stamp was proven. virtual = walked the avatar up; beacon = printed QR; host = the exhibitor's rotating code (best). */
export type StampProof = 'virtual' | 'beacon' | 'host';
export const TRUST_MULT: Record<StampProof, number> = { virtual: 1.0, beacon: 0.6, host: 1.0 };

export const STAMP_MIN_INTERVAL_MS = 45_000;
export const STAMP_DAILY_FULL = 60;
export const STAMP_OVERFLOW_MULT = 0.25;
/** A virtual stamp needs the avatar this close to the booth centre (metres). */
export const STAMP_RADIUS_M = 5.0;
/** Fastest plausible avatar travel between two server-seen positions (m/s). Run speed is 7. */
export const MAX_SPEED_MPS = 12;

/** novelty = max(0.4, 1 − 0.06·k), k = stamps already held in that hall. */
export function noveltyMult(stampsInHall: number): number {
  return Math.max(0.4, 1 - 0.06 * stampsInHall);
}

/** quiet = 1 + 0.5·(1 − heatPct): quiet stations pay up to ×1.5. */
export function quietMult(heatPct: number): number {
  return 1 + 0.5 * (1 - Math.min(1, Math.max(0, heatPct)));
}

export function stampXp(o: { presence: Presence; proof: StampProof; stampsInHall: number; heatPct: number; stampsToday: number }): number {
  const overflow = o.stampsToday >= STAMP_DAILY_FULL ? STAMP_OVERFLOW_MULT : 1;
  const xp = BASE_XP.stamp * PRESENCE_MULT[o.presence] * TRUST_MULT[o.proof] * noveltyMult(o.stampsInHall) * quietMult(o.heatPct) * overflow;
  return Math.max(1, Math.round(xp));
}

export interface RankDef {
  id: string;
  label: string;
  xp: number;
  /** Gate besides XP, evaluated on the server. */
  gate?: 'passport' | 'docked';
}

// M1 ships the first three ranks' gates; Captain+ gates (levels, constellations, links) arrive with those systems.
export const RANKS: RankDef[] = [
  { id: 'cadet', label: 'Cadet', xp: 0 },
  { id: 'navigator', label: 'Navigator', xp: 500, gate: 'passport' },
  { id: 'pilot', label: 'Pilot', xp: 1500, gate: 'docked' },
  { id: 'captain', label: 'Captain', xp: 3500, gate: 'docked' },
  { id: 'commander', label: 'Commander', xp: 7000, gate: 'docked' },
  { id: 'admiral', label: 'Admiral', xp: 12000, gate: 'docked' },
];

export function rankFor(xp: number, has: { passport: boolean; docked: boolean }): { rank: RankDef; next: RankDef | null; blockedBy: RankDef['gate'] | null } {
  let idx = 0;
  let blockedBy: RankDef['gate'] | null = null;
  for (let i = 1; i < RANKS.length; i++) {
    const r = RANKS[i]!;
    if (xp < r.xp) break;
    if (r.gate && !has[r.gate]) { blockedBy = r.gate; break; }
    idx = i;
  }
  return { rank: RANKS[idx]!, next: RANKS[idx + 1] ?? null, blockedBy };
}

/** Signal accrues at 1 per 10 XP. Spending arrives in M2; never purchasable, tradable or wagerable. */
export const signalFor = (xp: number) => Math.floor(xp / 10);

export const GOLDEN_TICKET_TTL_MS = 5 * 24 * 3600 * 1000;

/* ---------------- M2: hosts, links, crews ---------------- */

/** Rotating host code: a new code every window; older windows stay valid long enough to boot the game from a camera-app scan. */
export const HOST_WINDOW_MS = 30_000;
export const HOST_GRACE_WINDOWS = 4;
export const HOST_ONLINE_MS = 60_000;
export const MAX_STATIONS_PER_OWNER = 12;

export const LINK_CODE_TTL_MS = 120_000;
export const LINK_DAILY_FULL = 30;
export const LINK_OVERFLOW_XP = 10;

/** What a person may choose to share. Name is always part of a share; the rest is per-share consent. */
export const SHARE_FIELDS = ['name', 'company', 'role', 'phone', 'email'] as const;
export type ShareField = (typeof SHARE_FIELDS)[number];
export const DEFAULT_SHARE: ShareField[] = ['name', 'company', 'role'];

export const CREW_INFO: Record<PlayerClass, { crew: string; color: number }> = {
  builder: { crew: 'Builders', color: 0x6fe3ff },
  strategist: { crew: 'Strategists', color: 0x4d7cff },
  closer: { crew: 'Closers', color: 0xffc629 },
  creator: { crew: 'Creators', color: 0xb69cff },
};
export const SECTOR_TICK_MS = 30 * 60_000;
export const INFLUENCE_TAU_MS = 45 * 60_000;
export const INFLUENCE = { stamp: 1, verified_contact: 2, link_cross_crew: 1 } as const;
/** Until the venue geofence lands (M3) a walked-up virtual stamp moves a sector far less than being there. */
export const INFLUENCE_PRESENCE: Record<Presence, number> = { remote: 0.25, onsite: 1 };

/** Station Command (Systems doc §11). */
export const SXP = { claim: 100, profile: 100, stamp: 2, share: 10, verified: 15, hostHour: 20 } as const;
export const STATION_LEVELS = [0, 100, 300, 800, 2000, 5000];
export const stationLevel = (sxp: number) => STATION_LEVELS.reduce((lvl, need, i) => (sxp >= need ? i : lvl), 0);

/* ---------------- M3: presence engine, Mission Director, Ground Control ---------------- */

/** MITEC, Jalan Dutamas 2 — 3°10′41″N 101°40′07″E (Wikipedia). Override with VENUE_LAT / VENUE_LON / VENUE_RADIUS_M. */
export const VENUE_DEFAULT = { lat: 3.17811, lon: 101.66864, radiusM: 400 };
/** A venue check stays good this long; so does an on-site scan (you cannot leave MITEC and come back much faster). */
export const ONSITE_TTL_MS = 30 * 60_000;
/** GPS fixes worse than this cannot place anyone inside or outside a 400 m circle. */
export const VENUE_MAX_ACCURACY_M = 250;

/** On deck (physically there) the avatar follows the person: walking pace, not the 12 m/s of a joystick avatar. */
export const DECK_MAX_SPEED_MPS = 2.8;
export const DECK_STALE_MS = 10 * 60_000;
export const DECK_STALE_SIGMA_M = 12;
export const WALK_XP_PER_M = 0.1;
export const WALK_XP_DAILY_CAP = 300;

export type MissionTemplate = 'survey' | 'supply' | 'first_contact' | 'cartographer' | 'dark_sector';
export const MISSION_INFO: Record<MissionTemplate, { title: string; xp: number; minutes: number }> = {
  survey: { title: 'Survey Run', xp: 120, minutes: 20 },
  supply: { title: 'Supply Run', xp: 150, minutes: 25 },
  first_contact: { title: 'First Contact', xp: 200, minutes: 45 },
  cartographer: { title: "Cartographer's Request", xp: 180, minutes: 30 },
  dark_sector: { title: 'Dark Sector', xp: 90, minutes: 20 },
};
export const MISSION_OFFER_TTL_MS = 10 * 60_000;
export const MISSION_INFLUENCE = 3;
/** Director weights (Systems doc §10.2). */
export const DIRECTOR_W = { proximity: 0.3, novelty: 0.25, quiet: 0.2, interest: 0.15, partner: 0.1, repeat: 0.3 } as const;

export const STORM_MS = 15 * 60_000;
export const STORM_GAP_MS = 10 * 60_000;
export const STORM_MULT = 2;

export const GC_XP = 150;
export const GC_SESSION_MS = 20 * 60_000;
export const GC_QUEUE_TTL_MS = 3 * 60_000;
export const GC_MAX_WAYPOINTS = 5;

/* ---------------- M4: live ops ---------------- */

/** Trust (Systems doc §9). Only trusted players are eligible for anything a prize hangs on. */
export const TRUST_W = { geofence: 0.25, hostCode: 0.3, plausible: 0.2, steps: 0.15, human: 0.1 } as const;
export const TRUST_MIN = 0.7;
export const TEAM_MAX = 12;
export const TEAM_SCORERS = 5;
/** Kill switches the crew can flip from the console without a deploy. */
export const FLAG_KEYS = ['registration', 'claims', 'links', 'missions', 'gc', 'holograms'] as const;
