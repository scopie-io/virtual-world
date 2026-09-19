// The rules of Mission X, shared by the server (which decides) and the client (which displays).
// The whole game for a player: docs/game-rules.md. Change numbers here, nowhere else.

/* ---------------- who plays ---------------- */

export const ROLES = ['visitor', 'exhibitor'] as const;
export type Role = (typeof ROLES)[number];
/** One astronaut, two jackets: visitors blue, exhibitors green — the same blue and green as src/theme.ts. */
export const ROLE_INFO: Record<Role, { label: string; plural: string; color: number }> = {
  visitor: { label: 'Visitor', plural: 'Visitors', color: 0x2457f5 },
  exhibitor: { label: 'Exhibitor', plural: 'Exhibitors', color: 0x1e9e6a },
};

/* ---------------- points: fixed, and printed on the rules card ---------------- */

export const POINTS = {
  /** walk up to a booth in the game and stamp it */
  stamp: 10,
  /** scan the booth's QR at the real booth */
  scan: 50,
  /** leave your card with an exhibitor */
  leaveCard: 10,
  /** swap cards with a person you met */
  swap: 50,
  /** get your digital business card at the X */
  card: 200,
  /** show your prize code at the real Booth 8H18B */
  booth: 500,
  /** bring your own booth online (exhibitors) */
  boothOnline: 100,
} as const;

/** How a stamp was proven. virtual = walked the astronaut up; beacon = the booth's printed QR; host = the exhibitor's live QR. */
export type StampProof = 'virtual' | 'beacon' | 'host';
/** remote = played from anywhere; onsite = proven to be at the booth. */
export type Presence = 'remote' | 'onsite';
export const stampPoints = (presence: Presence) => (presence === 'onsite' ? POINTS.scan : POINTS.stamp);

/* ---------------- the mission: one journey, five chapters ---------------- */

export const MISSION_STAMPS = 5;
export interface MissionFacts { started: boolean; card: boolean; stamps: number; swaps: number; cardsLeft: number; claimed: boolean }
export interface Chapter { n: number; title: string; todo: string; done: boolean }
/** Chapters 3 and 4 can be finished in either order, and someone standing at the booth may finish 5 early. */
export function chapters(f: MissionFacts): Chapter[] {
  return [
    { n: 1, title: 'Arrive', todo: 'Land at MIHAS and take your first steps.', done: f.started },
    { n: 2, title: 'Find the X', todo: 'Follow the trail to Booth 8H18B and get your free digital business card.', done: f.card },
    { n: 3, title: 'Collect', todo: `Visit ${MISSION_STAMPS} booths. Walk up to each one and stamp it.`, done: f.stamps >= MISSION_STAMPS },
    { n: 4, title: 'Connect', todo: 'Swap cards with one person, or leave your card at one booth.', done: f.swaps + f.cardsLeft >= 1 },
    { n: 5, title: 'Make it real', todo: 'Show your prize code at the real Booth 8H18B, Hall 8.', done: f.claimed },
  ];
}

/** The exhibitor's journey is three steps on their own booth. */
export interface BoothFacts { online: boolean; visits: number; leads: number }
export function boothSteps(f: BoothFacts): Chapter[] {
  return [
    { n: 1, title: 'Light up', todo: 'Find your booth number and bring it online.', done: f.online },
    { n: 2, title: 'Get scanned', todo: 'Show your booth QR at the counter. Visitors scan it.', done: f.visits >= 1 },
    { n: 3, title: 'Lead', todo: 'Visitors leave their cards. Your list grows; export it any time.', done: f.leads >= 1 },
  ];
}

/* ---------------- limits that keep play honest (players never need to read these) ---------------- */

export const STAMP_MIN_INTERVAL_MS = 5_000;
/** A virtual stamp needs the astronaut this close to the booth centre (metres). */
export const STAMP_RADIUS_M = 5.0;
/** Fastest plausible travel between two positions the server saw (m/s). Run speed is 7. */
export const MAX_SPEED_MPS = 12;
/** Long enough for someone who plays a fortnight before the show to still claim at the booth. */
export const PRIZE_CODE_TTL_MS = 21 * 24 * 3600 * 1000;
/** After this many card swaps in a day the rest pay a token amount: a guard against farming, not a rule anyone meets. */
export const LINK_DAILY_FULL = 30;
export const LINK_OVERFLOW_XP = 10;
export const LINK_CODE_TTL_MS = 120_000;

/** The exhibitor's live QR: a new code every window; older windows stay valid long enough for a phone's camera app to open the game. */
export const HOST_WINDOW_MS = 30_000;
export const HOST_GRACE_WINDOWS = 4;
export const HOST_ONLINE_MS = 60_000;
export const MAX_STATIONS_PER_OWNER = 12;

/** What a person may choose to share. Name is always part of a share; the rest is per-share consent. */
export const SHARE_FIELDS = ['name', 'company', 'role', 'phone', 'email'] as const;
export type ShareField = (typeof SHARE_FIELDS)[number];
export const DEFAULT_SHARE: ShareField[] = ['name', 'company', 'role'];

/** With a card, a player appears as "Aisyah R." above their astronaut and on the board; without one, as "Visitor 4821". */
export const NAME_ON_BOARD = true;

/** MITEC, Jalan Dutamas 2 — 3°10′41″N 101°40′07″E. Override with VENUE_LAT / VENUE_LON / VENUE_RADIUS_M. */
export const VENUE_DEFAULT = { lat: 3.17811, lon: 101.66864, radiusM: 400 };
/** A venue check stays good this long; so does a scan at a real booth. */
export const ONSITE_TTL_MS = 30 * 60_000;
/** GPS fixes worse than this cannot place anyone inside or outside a 400 m circle. */
export const VENUE_MAX_ACCURACY_M = 250;

/** Trust: only used by the crew when a prize hangs on the board. Never shown to players. */
export const TRUST_W = { geofence: 0.25, hostCode: 0.3, plausible: 0.2, steps: 0.15, human: 0.1 } as const;
export const TRUST_MIN = 0.7;
/** Switches the crew can flip from the console without a deploy. */
export const FLAG_KEYS = ['registration', 'claims', 'links', 'holograms'] as const;

/** How busy a booth's own board entry is: visits and cards, nothing else. */
export const SXP = { claim: 0, profile: 0, stamp: 1, share: 3, verified: 2, hostHour: 0 } as const;
export const STATION_LEVELS = [0, 10, 40, 120, 300, 800];
export const stationLevel = (sxp: number) => STATION_LEVELS.reduce((lvl, need, i) => (sxp >= need ? i : lvl), 0);

/* =====================================================================================================
 * Switched off. Built for M2–M4, kept working and tested, not part of the simple game. Turning one on
 * brings its server side back; its screens were removed from the player's view (git tag m4-full).
 * ===================================================================================================== */

export interface Features {
  /** points for entering halls, landmarks and walking */
  explore: boolean;
  /** sector control between the roles, paid every 30 minutes */
  sectors: boolean;
  /** Mission Director offers and Signal Storms */
  director: boolean;
  groundControl: boolean;
  teams: boolean;
  /** the avatar editor */
  avatars: boolean;
}
export const FEATURES: Features = { explore: false, sectors: false, director: false, groundControl: false, teams: false, avatars: false };
export const ALL_FEATURES: Features = { explore: true, sectors: true, director: true, groundControl: true, teams: true, avatars: true };

/** Remote play earned this share of explore and Director rewards. */
export const REMOTE_SHARE = 0.15;
export const EXPLORE_XP = { hall_first: 100, landmark: 20 } as const;
export const SECTOR_HELD_XP = 40;
export const SECTOR_TICK_MS = 30 * 60_000;
export const INFLUENCE_TAU_MS = 45 * 60_000;
export const INFLUENCE = { stamp: 1, verified_contact: 2, link_cross_crew: 1 } as const;
export const INFLUENCE_PRESENCE: Record<Presence, number> = { remote: 0.25, onsite: 1 };

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
export const DIRECTOR_W = { proximity: 0.3, novelty: 0.25, quiet: 0.2, interest: 0.15, partner: 0.1, repeat: 0.3 } as const;
export const STORM_MS = 15 * 60_000;
export const STORM_GAP_MS = 10 * 60_000;
export const STORM_MULT = 2;

export const GC_XP = 150;
export const GC_SESSION_MS = 20 * 60_000;
export const GC_QUEUE_TTL_MS = 3 * 60_000;
export const GC_MAX_WAYPOINTS = 5;

export const TEAM_MAX = 12;
export const TEAM_SCORERS = 5;
