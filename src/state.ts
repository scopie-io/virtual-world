import { signal, computed } from '@preact/signals';
import type { Booth, GcView, LeaderRow, LevelData, Lift, Me, MissionsView, SectorsView, StationView, XpEvent } from '../shared/types';

export type Phase = 'boot' | 'suitup' | 'play' | 'error';
export type Modal = null | 'passport' | 'ticket' | 'board' | 'docked' | 'station' | 'claim' | 'host' | 'link' | 'contacts' | 'suit' | 'find' | 'crews' | 'menu' | 'missions' | 'gc' | 'presence' | 'team' | 'tour';

export const phase = signal<Phase>('boot');
export const level = signal<LevelData | null>(null);
export const bootError = signal('');
/** What the splash says while the page starts. */
export const bootNote = signal('Docking with the station…');
export const me = signal<Me | null>(null);
export const modal = signal<Modal>(null);
export const nearStation = signal<Booth | null>(null);
/** The station the Station / Claim sheets are about (set when they open, so walking away does not change it). */
export const panelStation = signal<Booth | null>(null);
export const atLaunchPad = signal(false);
/** Standing on a lift: the same shaft on the other decks. */
export const nearLift = signal<{ here: Lift; others: Lift[] } | null>(null);
/** The goal is on another deck, so the trail leads to a lift first: "Take the lift to Level 1". */
export const goalVia = signal<string | null>(null);
export const currentDeck = signal(2);
export const distToGoal = signal<number | null>(null);
export const guideOn = signal(true);
/** Where the trail leads. null = the Launch Pad. */
export const guideTarget = signal<{ x: number; y: number; label: string } | null>(null);
export const online = signal(0);
export const board = signal<LeaderRow[] | null>(null);
export const stations = signal<StationView[]>([]);
export const sectors = signal<SectorsView | null>(null);
export const missions = signal<MissionsView | null>(null);
export const gcView = signal<GcView | null>(null);
/** Ground Control: taps on the floor drop a marker for the astronaut instead of moving the avatar. */
export const gcMarkerMode = signal(false);
/** On deck = the avatar stands where the person really is (anchored by a scan, optionally following their steps). */
export interface DeckState { on: boolean; label: string; sigma: number; since: number; tracking: boolean }
export const deck = signal<DeckState>({ on: false, label: '', sigma: 0, since: 0, tracking: false });
/** A Link code that arrived in the URL (scanned with the phone's own camera). */
export const pendingLink = signal<string | null>(null);

export interface Toast { id: number; title: string; sub?: string; tone: 'xp' | 'info' | 'warn' }
export const toasts = signal<Toast[]>([]);
let toastId = 0;
export function toast(title: string, sub?: string, tone: Toast['tone'] = 'info', ms = 3200) {
  const t = { id: ++toastId, title, sub, tone };
  toasts.value = [...toasts.value.slice(-3), t];
  setTimeout(() => { toasts.value = toasts.value.filter((x) => x.id !== t.id); }, ms);
}

const ACTION_LABEL: Record<string, string> = {
  suit_up: 'Suited up', passport: 'Passport issued', dock: 'Docked at the Launch Pad', stamp: 'Stamped', hall_first: 'New sector', landmark: 'Landmark',
  verified_contact: 'Verified contact', share_station: 'Passport shared', link: 'Linked', sector_held: 'Your crew holds the sector', station_claim: 'Station online',
  walk: 'Walking the deck', mission: 'Mission complete', ground_control: 'Ground Control run', daily_drop: 'Daily Drop', demo_boost: 'Demo boost',
};
export function showEvents(events: XpEvent[] | undefined) {
  for (const e of events ?? []) {
    if (e.xp > 0) toast(`+${e.xp} XP`, [ACTION_LABEL[e.action] ?? e.action, e.target, e.note].filter(Boolean).join(' · '), 'xp', e.note ? 5200 : 3200);
    else if (e.target) toast(e.target); // a mission step: progress, no XP yet
  }
}

export const stampedSet = computed(() => new Set(me.value?.stamps ?? []));
export const stationMap = computed(() => new Map(stations.value.map((s) => [s.id, s])));
export const mission = computed(() => {
  const m = me.value;
  if (!m) return null;
  if (!m.passport) return { k: 'Mission 01', title: 'Find the X.', body: 'Follow the trail to the Launch Pad — Booth 8H18B, Hall 8 — and claim your Passport.' };
  if (!m.docked) return { k: 'Mission 02', title: 'Make it real.', body: 'Bring your Golden Ticket to the real Booth 8H18B. Crew scans it: +500 XP and your rank unlocks.' };
  if (m.links === 0) return { k: 'Mission 03', title: 'Shake hands.', body: 'Open Link and swap Passports with someone you meet. +50 XP each — and a real contact in your log.' };
  return { k: 'Free flight', title: 'Chart the station.', body: 'Stamp stations, scan host codes, win sectors for your crew. Quiet corners pay more.' };
});
