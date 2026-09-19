import type { MissionTemplate, Pose, Role, ShareField, StampProof } from './rules.js';
import type { AvatarSpec } from './avatar.js';

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface Booth { id: string; hall: number; x: number; y: number; name: string; /** organiser's category, when the exhibitor is on the official list */ sector?: string; /** exhibition level: 1, 2 or 3 */ deck: number }
export interface Area extends Rect { id: string; name: string; h: number; kind: 'pad' | 'zone'; deck: number }
/** One exhibition level as a platform in the shared plan space. */
export interface DeckInfo extends Rect { level: number; boothD: number; label: string }
export interface HallRect extends Rect { id: number; deck: number }
/** Lifts with the same id are the same shaft on different decks: stepping on one offers the others. */
export interface Lift { id: string; deck: number; x: number; y: number; label: string }
export interface Gate { id: string; name: string; x: number; y: number; axis: 'x' | 'y' }
export interface Spawn { x: number; y: number; label: string; gate: string }

export interface LevelData {
  level: number;
  source: string;
  booth: { w: number; d: number; h: number };
  hall: Rect;
  walkable: Rect[];
  walls: Rect[];
  gates: Gate[];
  spawns: Record<'short' | 'epic', Spawn>;
  hero: { id: string; x: number; y: number; open: 'N' | 'E' | 'S' | 'W'; dock: { x: number; y: number } };
  areas: Area[];
  booths: Booth[];
  decks: DeckInfo[];
  halls: HallRect[];
  lifts: Lift[];
}

/** What the client knows about the signed-in player. Never contains other people's personal data. */
export interface Me {
  id: string;
  /** The name other players see: "Visitor 4821" until they have a card, then "Aisyah R.". */
  callsign: string;
  /** visitor | exhibitor — null until they choose on the first screen */
  cls: Role | null;
  /** points */
  xp: number;
  stamps: string[];
  passport: PassportView | null;
  docked: boolean;
  ticket: { token: string; code: string } | null;
  avatar: AvatarSpec;
  sharePrefs: ShareField[];
  links: number;
  /** Stations this player has shared a Passport with, and those where a host verified the contact. */
  shared: string[];
  verified: string[];
  /** Station ids this player hosts. */
  hosting: string[];
  /** Verifiably at the venue right now (venue check or on-site scan in the last 30 min). */
  onsite: boolean;
  hidden: boolean;
  /** Last on-site scan: where the person really stood. */
  anchor: { stationId: string; at: number } | null;
}

export interface PassportInput {
  name: string;
  company: string;
  role: string;
  phone: string;
  email: string;
  showContact: boolean;
  consentMarketing: boolean;
  consentNotice: boolean;
}

export interface PassportView {
  slug: string;
  name: string;
  company: string;
  role: string;
  url: string;
}

export interface XpEvent { action: string; xp: number; target?: string; note?: string }

export interface ApiOk<T> { ok: true; data: T; me?: Me; events?: XpEvent[] }
export interface ApiErr { ok: false; error: string; code: string }
export type ApiResult<T> = ApiOk<T> | ApiErr;

export interface StampRequest { stationId: string; proof: StampProof; beacon?: string; code?: string }
export interface PresencePing { x: number; y: number; h: number; /** sitting, waving, … — shown to others, nothing more */ pose?: Pose; deck?: boolean; sigma?: number; /** steps counted since the last ping (deck mode) */ steps?: number }
export interface Hologram { id: string; callsign: string; cls: Role | null; x: number; y: number; h: number; av: string; pose?: Pose; /** really there, following real steps */ deck: boolean; /** position uncertainty in metres */ sigma: number }

export interface CrewTicketView { callsign: string; name: string; company: string; role: string; alreadyDocked: boolean }

/* ---------------- M2 ---------------- */

export type StationStatus = 'pending' | 'approved' | 'revoked';
/** Public view of a claimed station — what every player may see. */
export interface StationView { id: string; company: string; offer: string; link: string; color: number; status: StationStatus; hosted: boolean; level: number }
export interface StationClaimInput { stationId: string; company: string; offer: string; link: string; color: number }

export interface HostCode { stationId: string; url: string; digits: string; expiresInMs: number }
export interface HostStation extends StationView { sxp: number; stamps: number; shares: number; verifiedContacts: number; hostMinutes: number }
export interface HostLead { callsign: string; name: string; company: string; role: string; phone: string; email: string; verified: boolean; at: number }

export interface SharedCard { name?: string; company?: string; role?: string; phone?: string; email?: string }
export interface LinkCode { code: string; url: string; expiresInMs: number }
export interface LinkPeek { callsign: string; cls: Role | null; shares: ShareField[]; alreadyLinked: boolean }
export interface Contact {
  kind: 'person' | 'station';
  key: string;
  title: string;
  sub: string;
  card: SharedCard;
  link?: string;
  at: number;
  note: string;
  verified?: boolean;
}

export interface SectorState {
  hall: number;
  holder: Role | null;
  /** Live, decayed and underdog-normalised scores since the last tick. */
  scores: Record<Role, number>;
}
export interface SectorsView { sectors: SectorState[]; nextTickInMs: number; crewSizes: Record<Role, number> }

export interface CrewStationRow extends StationView { visits: number; ownerCallsign: string; ownerName: string; ownerCompany: string; claimedAt: number }

/* ---------------- M3 ---------------- */

export interface MissionView {
  id: string;
  template: MissionTemplate;
  title: string;
  brief: string;
  xp: number;
  state: 'offered' | 'active' | 'done' | 'expired' | 'abandoned';
  /** e.g. "1 / 3" */
  progress: string;
  /** Where the trail should lead next, if the mission has a place. */
  target: { x: number; y: number; label: string; stationId?: string } | null;
  expiresInMs: number;
}
export interface StormView { zone: string; label: string; x0: number; y0: number; x1: number; y1: number; endsInMs: number; mult: number }
export interface MissionsView { active: MissionView | null; offers: MissionView[]; storm: StormView | null; darkVisitors: Record<string, number>; drop?: DailyDrop | null }

export type GcRole = 'ground' | 'astro';
export interface GcView {
  state: 'idle' | 'queued' | 'active' | 'done' | 'expired';
  role: GcRole | null;
  partner: string | null;
  /** Ground Control alone sees the target; the astronaut sees only waypoints and must be talked in. */
  target: { x: number; y: number; label: string; stationId: string } | null;
  partnerPos: { x: number; y: number } | null;
  waypoints: { x: number; y: number }[];
  expiresInMs: number;
  xp: number;
}

/* ---------------- M4 ---------------- */

export type FlagKey = (typeof import('./rules.js').FLAG_KEYS)[number];
export interface TrustView { score: number; trusted: boolean; parts: { geofence: boolean; hostCode: boolean; plausible: boolean; steps: boolean; human: boolean } }
export type BoardKind = 'xp' | 'today' | 'explorer' | 'connector' | 'stations' | 'companies';
export interface BoardRow { kind: 'player' | 'station' | 'team'; title: string; sub: string; value: number; unit: string; cls?: Role | null; /** passes the trust bar (players) / verified exhibitor (teams) */ trusted?: boolean; you?: boolean }
export interface ReviewRow { callsign: string; name: string; company: string; value: number; unit: string; xp: number; trust: TrustView; flags: number; banned: boolean; mix: string }
export interface TeamView { name: string; owner: boolean; code: string | null; members: { callsign: string; xp: number; you?: boolean }[]; score: number }
/** What is special today. */
export interface TodayView { drop: DailyDrop | null; /** people in the game right now */ online: number }
export interface DailyDrop { title: string; stationId: string; label: string; x: number; y: number; bonus: number; done: boolean }
/** Everything the booth's big screen shows. Positions only — no names, no callsigns. */
export interface ScreenView {
  dots: { x: number; y: number; cls: Role | null; deck: boolean }[];
  online: number; onsite: number;
  totals: { players: number; passports: number; docked: number; stamps: number; links: number; stations: number };
  board: BoardRow[]; /** most visited booths */ booths: BoardRow[]; sectors: SectorsView; storm: StormView | null; drop: DailyDrop | null; joinUrl: string;
}
