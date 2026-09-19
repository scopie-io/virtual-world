import type { ApiResult, BoardKind, BoardRow, Contact, GcView, Hologram, HostCode, HostLead, HostStation, LinkCode, LinkPeek, PassportInput, PresencePing, StampRequest, StationClaimInput, StationView, TodayView } from '../../shared/types';
import type { Role } from '../../shared/rules';
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
  start: (role: Role) => call<null>('POST', '/api/start', { role }),
  presence: (p: PresencePing & { spawn?: boolean }) => call<{ holograms: Hologram[]; online: number; deck: boolean }>('POST', '/api/presence', p),
  stamp: (r: StampRequest) => call<null>('POST', '/api/stamp', r),
  card: (p: PassportInput) => call<null>('POST', '/api/passport', p),
  /** One location fix, answered with yes/no: is this phone at MIHAS? Lets a printed booth QR score in full. */
  venue: (fix: { lat: number; lon: number; acc: number }) => call<{ onsite: boolean; distanceM: number; reason?: 'outside' | 'inaccurate' }>('POST', '/api/venue', fix, true),
  today: () => call<TodayView>('GET', '/api/today'),
  board: (kind: BoardKind) => call<BoardRow[]>('GET', `/api/boards?board=${kind}`),
  track: (name: string, props?: unknown) => { void call('POST', '/api/event', { name, props }, true).catch(() => {}); },

  /* booths that are online, and the exhibitor's side of them */
  stations: () => call<StationView[]>('GET', '/api/stations'),
  claim: (c: StationClaimInput) => call<null>('POST', '/api/station/claim', c),
  leaveCard: (stationId: string, fields: ShareField[]) => call<null>('POST', '/api/station/share', { stationId, fields }),
  takeBackCard: (stationId: string) => call<null>('POST', '/api/station/unshare', { stationId }),
  myBooths: () => call<HostStation[]>('GET', '/api/host/stations'),
  boothQr: (stationId: string) => call<HostCode>('GET', `/api/host/code?station=${q(stationId)}`),
  leads: (stationId: string) => call<HostLead[]>('GET', `/api/host/leads?station=${q(stationId)}`),

  /* swapping cards with people */
  swapPrefs: (fields: ShareField[]) => call<null>('POST', '/api/link/prefs', { fields }),
  swapCode: () => call<LinkCode>('POST', '/api/link/code', {}),
  swapPeek: (code: string) => call<LinkPeek>('POST', '/api/link/peek', { code }),
  swap: (code: string, fields: ShareField[]) => call<null>('POST', '/api/link', { code, fields }),
  contacts: () => call<Contact[]>('GET', '/api/contacts'),
  note: (key: string, note: string) => call<null>('POST', '/api/contacts/note', { key, note }),
  revokeContact: (key: string) => call<null>('POST', '/api/contacts/revoke', { key }),

  /* switched off (FEATURES.groundControl) — the world renderer still knows how to draw it */
  gcWaypoint: (x: number, y: number) => call<GcView>('POST', '/api/gc/waypoint', { x, y }),
};
