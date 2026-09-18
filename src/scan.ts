import { api, ApiError } from './net/api';
import { parseScan } from './ui/common';
import { level, modal, panelStation, pendingLink, stationMap, toast, me } from './state';

/**
 * One entry point for every QR the game prints — host codes, station beacons, Link codes —
 * whether it came from the in-game scanner or from the URL the phone's camera app opened.
 */
export async function handleScan(text: string): Promise<boolean> {
  const s = parseScan(text);
  if (!s) { toast('Not a Mission X code', undefined, 'warn'); return false; }
  try {
    if (s.kind === 'link') { pendingLink.value = s.code; modal.value = 'link'; return true; }
    if (s.kind === 'host') await api.stamp({ stationId: s.stationId, proof: 'host', code: s.code });
    else await api.stamp({ stationId: s.stationId, proof: 'beacon', beacon: s.token });
    // A claimed station you have not shared with yet: offer the Passport exchange straight away.
    const booth = level.value?.booths.find((b) => b.id === s.stationId);
    if (booth && stationMap.value.has(booth.id) && me.value?.passport && !me.value.shared.includes(booth.id)) { panelStation.value = booth; modal.value = 'station'; }
    return true;
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'That code did not work', undefined, 'warn', 5000);
    return false;
  }
}
