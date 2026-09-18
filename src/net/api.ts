import type {
  ApiResult, BoardKind, BoardRow, Contact, GcView, Hologram, MissionsView, TeamView, TrustView, HostCode, HostLead, HostStation, LeaderRow, LinkCode, LinkPeek, PassportInput, PresencePing, SectorsView, StampRequest, StationClaimInput, StationView,
} from '../../shared/types';
import type { AvatarSpec } from '../../shared/avatar';
import type { ShareField } from '../../shared/rules';
import { me, showEvents } from '../state';

export class ApiError extends Error { constructor(public code: string, message: string) { super(message); } }

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, quiet = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new ApiError('offline', 'No connection — check your signal and try again'); }
  let json: ApiResult<T>;
  try { json = await res.json(); } catch { throw new ApiError('server', 'The server sent something unexpected'); }
  if (!json.ok) throw new ApiError(json.code, json.error);
  if (json.me) me.value = json.me;
  if (!quiet) showEvents(json.events);
  return json.data;
}
const q = encodeURIComponent;

export const api = {
  me: () => call<null>('GET', '/api/me'),
  suitUp: (cls: string) => call<null>('POST', '/api/suit-up', { cls }),
  avatar: (spec: AvatarSpec) => call<null>('POST', '/api/avatar', { spec }),
  presence: (p: PresencePing & { spawn?: boolean }) => call<{ holograms: Hologram[]; online: number; deck: boolean }>('POST', '/api/presence', p),
  stamp: (r: StampRequest) => call<null>('POST', '/api/stamp', r),
  passport: (p: PassportInput) => call<null>('POST', '/api/passport', p),
  leaderboard: () => call<LeaderRow[]>('GET', '/api/leaderboard'),
  track: (name: string, props?: unknown) => { void call('POST', '/api/event', { name, props }, true).catch(() => {}); },

  stations: () => call<StationView[]>('GET', '/api/stations'),
  claim: (c: StationClaimInput) => call<null>('POST', '/api/station/claim', c),
  share: (stationId: string, fields: ShareField[]) => call<null>('POST', '/api/station/share', { stationId, fields }),
  unshare: (stationId: string) => call<null>('POST', '/api/station/unshare', { stationId }),
  hostStations: () => call<HostStation[]>('GET', '/api/host/stations'),
  hostCode: (stationId: string) => call<HostCode>('GET', `/api/host/code?station=${q(stationId)}`),
  hostLeads: (stationId: string) => call<HostLead[]>('GET', `/api/host/leads?station=${q(stationId)}`),

  linkPrefs: (fields: ShareField[]) => call<null>('POST', '/api/link/prefs', { fields }),
  linkCode: () => call<LinkCode>('POST', '/api/link/code', {}),
  linkPeek: (code: string) => call<LinkPeek>('POST', '/api/link/peek', { code }),
  link: (code: string, fields: ShareField[]) => call<null>('POST', '/api/link', { code, fields }),
  contacts: () => call<Contact[]>('GET', '/api/contacts'),
  note: (key: string, note: string) => call<null>('POST', '/api/contacts/note', { key, note }),
  revokeContact: (key: string) => call<null>('POST', '/api/contacts/revoke', { key }),

  sectors: () => call<SectorsView>('GET', '/api/sectors'),

  board: (kind: BoardKind) => call<BoardRow[]>('GET', `/api/boards?board=${kind}`),
  trust: () => call<TrustView>('GET', '/api/trust'),
  team: () => call<TeamView | null>('GET', '/api/team'),
  teamCreate: (name: string) => call<TeamView>('POST', '/api/team/create', { name }),
  teamJoin: (code: string) => call<TeamView>('POST', '/api/team/join', { code }),
  teamLeave: () => call<null>('POST', '/api/team/leave', {}),

  venue: (fix: { lat: number; lon: number; acc: number }) => call<{ onsite: boolean; distanceM: number; reason?: 'outside' | 'inaccurate' }>('POST', '/api/venue', fix),
  hidden: (hidden: boolean) => call<null>('POST', '/api/hidden', { hidden }),
  missions: () => call<MissionsView>('GET', '/api/missions'),
  acceptMission: (id: string) => call<MissionsView>('POST', '/api/missions/accept', { id }),
  abandonMission: () => call<MissionsView>('POST', '/api/missions/abandon', {}),
  gc: () => call<GcView>('GET', '/api/gc'),
  gcJoin: () => call<GcView>('POST', '/api/gc/join', {}),
  gcLeave: () => call<GcView>('POST', '/api/gc/leave', {}),
  gcWaypoint: (x: number, y: number) => call<GcView>('POST', '/api/gc/waypoint', { x, y }),
};
