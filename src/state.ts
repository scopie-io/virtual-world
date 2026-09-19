import { signal, computed } from '@preact/signals';
import type { Booth, DailyDrop, HostStation, LevelData, Lift, Me, StationView, XpEvent } from '../shared/types';
import { boothSteps, chapters, type Chapter } from '../shared/rules';

export type Phase = 'boot' | 'start' | 'play' | 'error';
export type Modal = null | 'card' | 'prize' | 'claimed' | 'complete' | 'board' | 'booth' | 'claim' | 'mybooth' | 'swap' | 'contacts' | 'find' | 'menu' | 'rules' | 'tour';

export const phase = signal<Phase>('boot');
export const level = signal<LevelData | null>(null);
export const bootError = signal('');
/** What the splash says while the page starts. */
export const bootNote = signal('Opening MIHAS…');
export const me = signal<Me | null>(null);
export const modal = signal<Modal>(null);
export const nearStation = signal<Booth | null>(null);
/** The booth the Booth / Claim sheets are about (set when they open, so walking away does not change it). */
export const panelStation = signal<Booth | null>(null);
export const atLaunchPad = signal(false);
/** Standing on a lift: the same shaft on the other levels. */
export const nearLift = signal<{ here: Lift; others: Lift[] } | null>(null);
/** The goal is on another level, so the trail leads to a lift first: "Take the lift to Level 1". */
export const goalVia = signal<string | null>(null);
export const currentDeck = signal(2);
export const distToGoal = signal<number | null>(null);
export const guideOn = signal(true);
/** Where the trail leads. null = the X, until the player has their card; after that, nowhere until they pick a place. */
export const guideTarget = signal<{ x: number; y: number; label: string } | null>(null);
export const online = signal(0);
/** Booths that are online (an exhibitor brought them into the game). */
export const stations = signal<StationView[]>([]);
/** The booth of the day, when the crew has set one. */
export const drop = signal<DailyDrop | null>(null);
/** The exhibitor's own booths, for their three steps. */
export const myBooths = signal<HostStation[]>([]);
/** A card-swap code that arrived in the URL (scanned with the phone's own camera). */
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
  passport: 'Your card is ready', dock: 'Claimed at Booth 8H18B', stamp: 'Stamped', scan: 'Scanned at the real booth', verified_contact: 'Met in person',
  share_station: 'Card left', link: 'Cards swapped', station_claim: 'Your booth is online', daily_drop: 'Booth of the day',
};
export function showEvents(events: XpEvent[] | undefined) {
  for (const e of events ?? []) {
    const label = ACTION_LABEL[e.action] ?? e.action;
    if (e.xp > 0) toast(`+${e.xp} points`, [label, e.target, e.note].filter(Boolean).join(' · '), 'xp', e.note ? 5200 : 3200);
    else toast(label, e.target);
  }
}

export const stampedSet = computed(() => new Set(me.value?.stamps ?? []));
export const stationMap = computed(() => new Map(stations.value.map((s) => [s.id, s])));

/** The journey. Visitors: five chapters. Exhibitors: three steps on their own booth. `now` is the one thing to do next. */
export interface Journey { kind: 'visitor' | 'exhibitor'; steps: Chapter[]; now: Chapter | null; done: number }
export const journey = computed<Journey | null>(() => {
  const m = me.value;
  if (!m) return null;
  const exhibitor = m.cls === 'exhibitor', b = myBooths.value[0];
  const steps = exhibitor
    ? boothSteps({ online: m.hosting.length > 0, visits: b?.stamps ?? 0, leads: b?.shares ?? 0 })
    : chapters({ started: !!m.cls, card: !!m.passport, stamps: m.stamps.length, swaps: m.links, cardsLeft: m.shared.length, claimed: m.docked });
  return { kind: exhibitor ? 'exhibitor' : 'visitor', steps, now: steps.find((s) => !s.done) ?? null, done: steps.filter((s) => s.done).length };
});
