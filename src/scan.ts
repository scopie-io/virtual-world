import { api, ApiError } from './net/api';
import { parseScan } from './ui/common';
import { demo } from './demo/client';
import { VENUE_DEFAULT } from '../shared/rules';
import { level, modal, panelStation, pendingLink, stationMap, toast, me } from './state';

/**
 * A printed booth QR can be photographed and passed around, so it only scores as "at the real booth" when the phone is
 * at MIHAS. We ask for one location fix, in the moment it matters, and keep only the yes/no. Refusing costs nothing but
 * the difference in points; the stamp itself never waits on it.
 */
async function confirmAtVenue(): Promise<void> {
  if (me.value?.onsite) return;
  try {
    if (demo.value) { await api.venue({ lat: VENUE_DEFAULT.lat, lon: VENUE_DEFAULT.lon, acc: 12 }); return; } // the demo has no GPS: this browser is simply at MITEC
    if (!('geolocation' in navigator)) return;
    toast('Checking you are at MIHAS…', 'Allow location so this scan scores in full');
    const pos = await new Promise<GeolocationPosition>((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }));
    await api.venue({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy });
  } catch { /* no fix, no permission, no signal: the scan still counts as a stamp */ }
}

/**
 * One entry point for every QR the game prints — booth QRs (live or printed) and card-swap codes —
 * whether it came from the in-game scanner or from the URL the phone's camera opened.
 */
export async function handleScan(text: string): Promise<boolean> {
  const s = parseScan(text);
  if (!s) { toast('Not a Mission X code', undefined, 'warn'); return false; }
  try {
    if (s.kind === 'link') { pendingLink.value = s.code; modal.value = 'swap'; return true; }
    if (s.kind === 'host') await api.stamp({ stationId: s.stationId, proof: 'host', code: s.code });
    else { await confirmAtVenue(); await api.stamp({ stationId: s.stationId, proof: 'beacon', beacon: s.token }); }
    // An online booth you have not left your card with yet: offer it straight away.
    const booth = level.value?.booths.find((b) => b.id === s.stationId);
    if (booth && stationMap.value.has(booth.id) && me.value?.passport && !me.value.shared.includes(booth.id)) { panelStation.value = booth; modal.value = 'booth'; }
    return true;
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'That code did not work', undefined, 'warn', 5000);
    return false;
  }
}
