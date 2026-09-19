import { signal, computed } from '@preact/signals';
import type { Booth, DailyDrop, HostStation, LevelData, Lift, Me, StationView, XpEvent } from '../shared/types';
import { boothSteps, chapters, type Chapter } from '../shared/rules';
import type { Place } from './game/places';

export type Phase = 'boot' | 'start' | 'play' | 'error';
export type Modal = null | 'card' | 'prize' | 'claimed' | 'complete' | 'board' | 'booth' | 'claim' | 'mybooth' | 'swap' | 'contacts' | 'map' | 'photo' | 'menu' | 'rules' | 'tour';

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
/** The place the player is standing in (a café, a stage, the photo booth…), and whether they have sat down there. */
export const herePlace = signal<Place | null>(null);
export const seated = signal(false);
/** The photo just taken, as a data URL. */
export const photoShot = signal<string | null>(null);
/** Halls and places this browser has walked into: "hall:7", "place:cafe". A memory, not a score. */
const SEEN = 'mx_seen';
export const seen = signal<Set<string>>(new Set((() => { try { return JSON.parse(localStorage.getItem(SEEN) ?? '[]') as string[]; } catch { return []; } })()));
export function markSeen(key: string): boolean {
  if (seen.value.has(key)) return false;
  seen.value = new Set([...seen.value, key]);
  try { localStorage.setItem(SEEN, JSON.stringify([...seen.value])); } catch { /* private mode */ }
  return true;
}

/** A card-swap code that arrived in the URL (scanned with the phone's own camera). */
export const pendingLink = signal<string | null>(null);

export interface Toast { id: number; title: string; sub?: string; tone: 'xp' | 'info' | 'warn' }
/** What is on screen now: at most one. The rest wait their turn, so a busy moment never buries the instruction card. */
export const toasts = signal<Toast[]>([]);
let toastId = 0, timer: ReturnType<typeof setTimeout> | undefined;
const waiting: { t: Toast; ms: number }[] = [];
function next() {
  const n = waiting.shift(); if (!n) { toasts.value = []; timer = undefined; return; }
  toasts.value = [n.t];
  timer = setTimeout(next, waiting.length ? Math.min(n.ms, 2200) : n.ms); // a queue behind it: keep things moving
}
export function toast(title: string, sub?: string, tone: Toast['tone'] = 'info', ms = 3200) {
  const last = waiting[waiting.length - 1]?.t ?? toasts.value[0];
  if (last && last.title === title && last.sub === sub) return; // the same thing twice says nothing new
  const item = { t: { id: ++toastId, title, sub, tone }, ms };
  if (tone === 'warn') { waiting.unshift(item); clearTimeout(timer); next(); return; } // something went wrong: say it now
  waiting.push(item); if (waiting.length > 4) waiting.splice(0, waiting.length - 4);
  if (!timer) next();
}

const ACTION_LABEL: Record<string, string> = {
  passport: 'Your card is ready', dock: 'Claimed at Booth 8H18B', stamp: 'Stamped', scan: 'Scanned at the real booth', verified_contact: 'Met in person',
  share_station: 'Card left', link: 'Cards swapped', station_claim: 'Your booth is online', daily_drop: 'Booth of the day',
};
/** One action can pay several ways at once (a scan that is also the booth of the day). It is still one moment: one toast, one total. */
export function showEvents(events: XpEvent[] | undefined) {
  const list = events ?? []; if (!list.length) return;
  const total = list.reduce((n, e) => n + e.xp, 0), labels = [...new Set(list.map((e) => ACTION_LABEL[e.action] ?? e.action))], target = list.find((e) => e.target)?.target, note = list.find((e) => e.note)?.note;
  if (total > 0) toast(`+${total} points`, [...labels, target, note].filter(Boolean).join(' · '), 'xp', note ? 5200 : 3400);
  else toast(labels[0]!, target);
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
